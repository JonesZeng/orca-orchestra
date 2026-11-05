import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'

const MAX_FRAME_BYTES = 32 * 1024 * 1024
const MAX_PLUGIN_ERROR_LENGTH = 8192
const MAX_PLUGIN_ERROR_CODE_LENGTH = 64
const MAX_TIMER_MS = 2_147_483_647

export class RuntimeRequestError extends Error {
  /** `sent` is false when the request never left this process, so a retry cannot duplicate it. */
  constructor(code, message, sent) {
    super(message)
    this.name = 'RuntimeRequestError'
    this.code = code
    this.sent = sent
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRuntimeTarget(metadata) {
  return (
    isRecord(metadata) &&
    typeof metadata.endpoint === 'string' &&
    metadata.endpoint.length > 0 &&
    typeof metadata.authToken === 'string' &&
    metadata.authToken.length > 0 &&
    typeof metadata.runtimeId === 'string' &&
    metadata.runtimeId.length > 0
  )
}

function connectFailure(error) {
  const code = isRecord(error) || error instanceof Error ? error.code : null
  return typeof code === 'string' && code
    ? `Could not reach Orca's runtime: ${code}`
    : "Could not reach Orca's runtime."
}

/**
 * One request over Orca's local runtime socket, framed like the Orca CLI: a JSON line out,
 * keepalive lines while the runtime works, then the response line with the same id. The timeout
 * is an absolute deadline: keepalives show progress but never extend it past the panel's budget.
 */
export function runtimeRequest(
  metadata,
  { method, params, envelope = {}, timeoutMs, signal, connect = createConnection }
) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    let sent = false
    let settled = false
    let socket = null
    let timer = null
    let buffered = ''
    let bufferedBytes = 0

    const finish = (error, response) => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      signal?.removeEventListener('abort', onAbort)
      socket?.destroy()
      if (error) {
        reject(error)
      } else {
        resolve(response)
      }
    }
    const fail = (code, message) => finish(new RuntimeRequestError(code, message, sent))
    const onAbort = () => fail('cancelled', 'The panel stopped waiting for Orca.')

    if (signal?.aborted) {
      fail('cancelled', 'The panel stopped waiting for Orca.')
      return
    }
    if (!isRuntimeTarget(metadata)) {
      fail('unavailable', "Orca's runtime metadata has no transport.")
      return
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      fail('invalid_params', 'The runtime request needs a positive timeout.')
      return
    }

    let payload
    try {
      payload = `${JSON.stringify({
        id,
        authToken: metadata.authToken,
        method,
        params,
        ...envelope
      })}\n`
    } catch {
      fail('invalid_params', 'The request could not be serialized.')
      return
    }

    timer = setTimeout(
      () => fail('timeout', 'Orca did not answer in time.'),
      Math.min(timeoutMs, MAX_TIMER_MS)
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      socket = connect(metadata.endpoint)
    } catch (error) {
      fail('unavailable', connectFailure(error))
      return
    }

    socket.setEncoding('utf8')
    socket.on('connect', () => {
      if (settled) {
        return
      }
      // Set before writing: a partially written frame must not be retried.
      sent = true
      try {
        socket.write(payload)
      } catch (error) {
        fail('unavailable', connectFailure(error))
      }
    })
    socket.on('error', (error) => fail('unavailable', connectFailure(error)))
    socket.on('close', () => fail('unavailable', 'Orca closed the connection before answering.'))
    socket.on('data', (chunk) => {
      if (settled) {
        return
      }
      buffered += String(chunk)
      bufferedBytes += Buffer.byteLength(chunk)
      if (bufferedBytes > MAX_FRAME_BYTES) {
        fail('too_large', 'Orca sent a larger answer than this panel reads.')
        return
      }
      let newline = buffered.indexOf('\n')
      while (newline !== -1 && !settled) {
        const prefix = buffered.slice(0, newline + 1)
        const line = prefix.trim()
        buffered = buffered.slice(newline + 1)
        bufferedBytes -= Buffer.byteLength(prefix)
        newline = buffered.indexOf('\n')
        if (line) {
          readLine(line)
        }
      }
    })

    function readLine(line) {
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        fail('action_failed', 'Orca sent an unreadable answer.')
        return
      }
      if (isRecord(frame) && frame._keepalive === true) {
        return
      }
      if (!isRecord(frame) || frame.id !== id || typeof frame.ok !== 'boolean') {
        fail('action_failed', 'Orca answered a different request.')
        return
      }
      const runtimeId = isRecord(frame._meta) ? frame._meta.runtimeId : undefined
      if (frame.ok) {
        if (runtimeId !== metadata.runtimeId) {
          fail(
            'unavailable',
            typeof runtimeId === 'string'
              ? 'Orca restarted while the request was in flight.'
              : 'Orca answered without its runtime identity.'
          )
          return
        }
        finish(null, { ok: true, result: frame.result })
        return
      }
      // A refusal applied no effects, so an unverifiable failure frame may still be reported.
      if (typeof runtimeId === 'string' && runtimeId !== metadata.runtimeId) {
        fail('unavailable', 'Orca restarted while the request was in flight.')
        return
      }
      const error = frame.error
      if (!isRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') {
        fail('action_failed', 'Orca sent an unreadable failure.')
        return
      }
      finish(null, {
        ok: false,
        error: {
          code: error.code.slice(0, MAX_PLUGIN_ERROR_CODE_LENGTH),
          message: error.message.slice(0, MAX_PLUGIN_ERROR_LENGTH)
        }
      })
    }
  })
}
