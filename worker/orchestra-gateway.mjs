/**
 * The only runtime calls this plugin makes. The worker holds the runtime token, so it re-checks
 * what the panel asks for: Orchestra's reads, and exactly the confirmed writes its UI offers.
 * Worker lifecycle, terminal input, mail acknowledgement and every other runtime method stay out
 * of reach. Envelope fields are rebuilt here, never forwarded from the panel.
 */
export const READ_METHODS = new Set([
  'orchestration.runList',
  'orchestration.runShow',
  'orchestration.taskList',
  'orchestration.gateList',
  'orchestration.workerList',
  'orchestration.workerRead',
  'orchestration.requestShow'
])
export const WRITE_METHODS = new Set([
  'orchestration.runCreate',
  'orchestration.taskCreate',
  'orchestration.dispatch',
  'orchestration.send',
  'orchestration.gateResolve'
])
const STATUS_METHOD = 'status.get'
const READ_TIMEOUT_MS = 20_000
const WRITE_TIMEOUT_MS = 60_000
// plugin.request waits at most 120 s; answer before it gives up.
const MAX_TIMEOUT_MS = 110_000
// The UI and this plugin ship together; an older runtime refuses anything but its own contract.
export const CONTRACT_VERSION = 1
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/
// Saved environment ids are UUIDs; refuse URLs, paths and selector syntax outright.
const TARGET_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Plugin answers are capped at 1 MiB by the panel bridge; keep headroom for its own framing. */
export const ANSWER_LIMIT_BYTES = 1024 * 1024
export const ANSWER_BUDGET_BYTES = ANSWER_LIMIT_BYTES - 16 * 1024
export const ROW_LIMIT = 500
const ROW_TEXT_LIMIT = 4000
const ROW_TEXT_LIMITS = [ROW_TEXT_LIMIT, 1000, 200]
const OUTPUT_TEXT_LIMITS = [16_000, 4000, 1000]

export class GatewayError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GatewayError'
    this.code = code
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWrite(method, params) {
  if (method === 'orchestration.dispatch') {
    return !(isRecord(params) && params.dryRun === true)
  }
  return WRITE_METHODS.has(method)
}

/** The panel may pick this Mac or one saved environment id; it never supplies an endpoint. */
function parseTarget(value) {
  if (value === undefined) {
    return { kind: 'local' }
  }
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new GatewayError('invalid_params', 'Expected target to be { kind: local | environment }.')
  }
  if (value.kind === 'local') {
    if (value.id !== undefined) {
      throw new GatewayError('invalid_params', 'A local target takes no id.')
    }
    return { kind: 'local' }
  }
  if (value.kind === 'environment') {
    if (typeof value.id !== 'string' || !TARGET_ID.test(value.id)) {
      throw new GatewayError('invalid_params', 'A server target needs a saved environment id.')
    }
    return { kind: 'environment', id: value.id }
  }
  throw new GatewayError('invalid_params', 'target.kind must be local or environment.')
}

function timeoutFor(requested, fallback) {
  return requested ? Math.min(Math.max(requested, 1000), MAX_TIMEOUT_MS) : fallback
}

/** Turns a panel request into the runtime call to make, or refuses it. */
export function admitOrchestraCall(input) {
  if (!isRecord(input) || typeof input.method !== 'string') {
    throw new GatewayError('invalid_params', 'Expected { method, params? }.')
  }
  const { method, params } = input
  if (params !== undefined && !isRecord(params)) {
    throw new GatewayError('invalid_params', 'params must be an object.')
  }
  const requested =
    Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? Math.ceil(input.timeoutMs) : 0
  const target = parseTarget(input.target)
  if (method === STATUS_METHOD) {
    return {
      method,
      params: undefined,
      envelope: {},
      timeoutMs: timeoutFor(requested, READ_TIMEOUT_MS),
      write: false,
      target
    }
  }
  if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) {
    throw new GatewayError('not_permitted', `${method} is not available in Orchestra.`)
  }
  const write = isWrite(method, params)
  if (!write) {
    return {
      method,
      params,
      envelope: {},
      timeoutMs: timeoutFor(requested, READ_TIMEOUT_MS),
      write,
      target
    }
  }
  const contract = input.orchestration
  if (
    !isRecord(contract) ||
    contract.contractVersion !== CONTRACT_VERSION ||
    typeof contract.requestId !== 'string' ||
    !REQUEST_ID.test(contract.requestId)
  ) {
    // Without a durable request id a lost reply could not be inspected later.
    throw new GatewayError('invalid_params', `${method} needs an orchestration request id.`)
  }
  return {
    method,
    params,
    envelope: {
      orchestrationContractVersion: contract.contractVersion,
      orchestrationRequestId: contract.requestId
    },
    timeoutMs: timeoutFor(requested, WRITE_TIMEOUT_MS),
    write,
    target
  }
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null')
}

function answerSize(result) {
  return byteSize({ ok: true, result })
}

function clip(text, limit) {
  return typeof text === 'string' && text.length > limit ? `${text.slice(0, limit)}…` : text
}

function clipRows(rows, fields, limit) {
  return rows.map((row) => {
    if (!isRecord(row)) {
      return row
    }
    let clipped = false
    const next = { ...row }
    for (const field of fields) {
      if (typeof row[field] === 'string' && row[field].length > limit) {
        next[field] = clip(row[field], limit)
        clipped = true
      }
    }
    return clipped ? { ...next, text_truncated: true } : next
  })
}

/** Keeps the Run's rows within the display limit and the answer under the bridge cap. */
function boundRows(result, key, fields, method) {
  if (!isRecord(result) || !Array.isArray(result[key])) {
    throw new GatewayError('action_failed', `Orca answered ${method} without ${key}.`)
  }
  const rows = result[key]
  // Keep the true total so the UI can say how many rows it is not showing.
  const reported = Number.isInteger(result.count) && result.count >= 0 ? result.count : 0
  const count = Math.max(reported, rows.length)
  let bounded = { ...result, [key]: rows.slice(0, ROW_LIMIT), count }
  if (answerSize(bounded) <= ANSWER_BUDGET_BYTES) {
    return bounded
  }
  for (const limit of ROW_TEXT_LIMITS) {
    bounded = { ...bounded, [key]: clipRows(bounded[key], fields, limit) }
    if (answerSize(bounded) <= ANSWER_BUDGET_BYTES) {
      break
    }
  }
  return bounded
}

function clipWorkerOutput(result, limit) {
  const clipping = new Set(
    Array.isArray(result.clipping)
      ? result.clipping.filter((entry) => typeof entry === 'string')
      : []
  )
  clipping.add('panel_budget')
  const next = { ...result, contentComplete: false, clipping: [...clipping] }
  if (isRecord(result.terminal) && Array.isArray(result.terminal.tail)) {
    next.terminal = {
      ...result.terminal,
      truncated: true,
      tail: result.terminal.tail.map((line) => clip(line, limit))
    }
  }
  if (isRecord(result.transcript) && Array.isArray(result.transcript.messages)) {
    next.transcript = {
      ...result.transcript,
      limited: true,
      messages: result.transcript.messages.map((message) =>
        isRecord(message) && Array.isArray(message.blocks)
          ? {
              ...message,
              blocks: message.blocks.map((block) =>
                isRecord(block) ? { ...block, text: clip(block.text, limit) } : block
              )
            }
          : message
      )
    }
  }
  return next
}

function boundWorkerOutput(result) {
  if (!isRecord(result)) {
    throw new GatewayError('action_failed', 'Orca answered workerRead without output.')
  }
  let bounded = result
  for (const limit of OUTPUT_TEXT_LIMITS) {
    if (answerSize(bounded) <= ANSWER_BUDGET_BYTES) {
      break
    }
    bounded = clipWorkerOutput(bounded, limit)
  }
  return bounded
}

/** What the panel receives: runtime results shaped to fit, status reduced to its capabilities. */
export function shapeOrchestraResult(method, result) {
  let shaped = result
  if (method === STATUS_METHOD) {
    if (
      !isRecord(result) ||
      (result.capabilities !== undefined && !Array.isArray(result.capabilities))
    ) {
      throw new GatewayError('action_failed', 'Orca answered status.get without a capability list.')
    }
    shaped = {
      capabilities: Array.isArray(result.capabilities)
        ? result.capabilities.filter((entry) => typeof entry === 'string')
        : []
    }
  } else if (method === 'orchestration.taskList') {
    shaped = boundRows(result, 'tasks', ['spec', 'result'], method)
  } else if (method === 'orchestration.gateList') {
    shaped = boundRows(result, 'gates', ['question', 'resolution'], method)
  } else if (method === 'orchestration.workerRead') {
    shaped = boundWorkerOutput(result)
  }
  if (answerSize(shaped) > ANSWER_BUDGET_BYTES) {
    throw new GatewayError('too_large', `${method} answered with more than a panel can receive.`)
  }
  return shaped
}
