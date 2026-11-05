import { translate } from '@/i18n/i18n'
import { z } from 'zod'

export type OrchestraCall = (
  method: string,
  params?: unknown,
  mutation?: boolean
) => Promise<unknown>

export const ORCHESTRA_ROW_LIMIT = 500
const OUTPUT_LIMIT = 64_000
const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)
const stringList = z.union([z.array(z.string()), z.string()]).transform((value, ctx) => {
  if (Array.isArray(value)) {
    return value
  }
  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(value))
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    /* Invalid persisted JSON must not silently remove dependencies. */
  }
  ctx.addIssue({
    code: 'custom',
    message: translate('orchestra.data.invalidList', 'Invalid string-list JSON')
  })
  return z.NEVER
})

const RunSchema = z.object({
  id: z.string(),
  objective: z.string(),
  coordinator_handle: nullableText,
  legacy: z.number(),
  created_at: z.string(),
  updated_at: z.string()
})
const TaskSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  task_title: nullableText,
  display_name: nullableText,
  spec: z.string(),
  status: z.enum(['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']),
  deps: stringList,
  result: nullableText,
  assignee_handle: nullableText,
  dispatch_id: nullableText,
  /** Set by bounded transports that shortened spec or result. */
  text_truncated: z.boolean().optional()
})
const GateSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  question: z.string(),
  options: stringList,
  status: z.enum(['pending', 'resolved', 'timeout']),
  resolution: nullableText
})
const LivenessSchema = z.object({
  verdict: z.enum(['live', 'unverifiable', 'exited']),
  reason: z.string().optional()
})
const WorkerSchema = z.object({
  dispatchId: z.string(),
  taskId: z.string(),
  runId: z.string(),
  workerState: z.string(),
  dispatchStatus: z.string(),
  agentTerminalHandle: nullableText,
  terminalState: nullableText,
  projection: z
    .object({
      provider: z.object({ id: z.string(), model: nullableText }).nullable(),
      host: z.object({ kind: z.enum(['local', 'remote']), id: z.string() }),
      stage: z.object({ activity: z.string(), detail: nullableText }),
      liveness: LivenessSchema,
      evidence: z
        .object({
          liveStatus: z.enum(['fresh', 'stale', 'unavailable', 'redacted_restore']),
          lastObservedAt: z.number().nullable()
        })
        .optional(),
      outcome: z.string()
    })
    .nullable()
    .optional()
})
const RunsSchema = z.object({ runs: z.array(RunSchema), nextCursor: nullableText })
const TasksSchema = z.object({
  runId: z.string(),
  tasks: z.array(TaskSchema),
  legacyReadOnly: z.boolean().optional(),
  count: z.number().optional()
})
const GatesSchema = z.object({
  runId: z.string(),
  gates: z.array(GateSchema),
  count: z.number().optional()
})
const WorkersSchema = z.object({
  workers: z.array(WorkerSchema),
  warnings: z.array(z.string()).optional(),
  partialHostErrors: z.array(z.unknown()).optional(),
  page: z.object({ total: z.number(), hasMore: z.boolean(), nextCursor: nullableText }).optional()
})

export type OrchestraRun = z.infer<typeof RunSchema>
export type OrchestraTask = z.infer<typeof TaskSchema>
export type OrchestraGate = z.infer<typeof GateSchema>
export type OrchestraWorker = z.infer<typeof WorkerSchema>
export type OrchestraSnapshot = {
  runId: string
  tasks: OrchestraTask[]
  gates: OrchestraGate[]
  workers: OrchestraWorker[]
  legacyReadOnly: boolean
  workerTotal: number
  hasMoreWorkers: boolean
  workerCursor: string | null
  warnings: string[]
}

export function parseOrchestraRuns(value: unknown) {
  return RunsSchema.parse(value)
}

export function parseOrchestraWorkers(value: unknown) {
  return WorkersSchema.parse(value)
}

export function parseOrchestraSnapshot(
  run: OrchestraRun,
  taskResponse: unknown,
  gateResponse: unknown,
  workerResponse: unknown
): OrchestraSnapshot {
  const tasks = TasksSchema.parse(taskResponse)
  const gates = GatesSchema.parse(gateResponse)
  const workers = parseOrchestraWorkers(workerResponse)
  // Bounded transports (the plugin facade) send at most the display limit plus the true count.
  const taskTotal = Math.max(tasks.count ?? 0, tasks.tasks.length)
  const gateTotal = Math.max(gates.count ?? 0, gates.gates.length)
  if (
    tasks.runId !== run.id ||
    gates.runId !== run.id ||
    tasks.tasks.some((task) => task.run_id !== run.id) ||
    gates.gates.some((gate) => gate.run_id !== run.id) ||
    workers.workers.some((worker) => worker.runId !== run.id)
  ) {
    throw new Error(
      translate('orchestra.data.crossRun', 'The server returned data for a different run.')
    )
  }
  return {
    runId: run.id,
    tasks: tasks.tasks.slice(0, ORCHESTRA_ROW_LIMIT),
    gates: gates.gates.slice(0, ORCHESTRA_ROW_LIMIT),
    workers: workers.workers.slice(0, ORCHESTRA_ROW_LIMIT),
    legacyReadOnly: run.legacy !== 0 || tasks.legacyReadOnly === true,
    workerTotal: workers.page?.total ?? workers.workers.length,
    hasMoreWorkers: workers.page?.hasMore ?? false,
    workerCursor: workers.page?.nextCursor ?? null,
    warnings: [
      ...(workers.warnings ?? []),
      ...(workers.partialHostErrors?.length
        ? [translate('orchestra.data.partialHosts', 'Some execution hosts could not be observed.')]
        : []),
      ...(taskTotal > ORCHESTRA_ROW_LIMIT
        ? [
            translate('orchestra.data.taskLimit', 'Showing {{shown}} of {{total}} tasks.', {
              shown: ORCHESTRA_ROW_LIMIT,
              total: taskTotal
            })
          ]
        : []),
      ...(gateTotal > ORCHESTRA_ROW_LIMIT
        ? [
            translate(
              'orchestra.data.gateLimit',
              'Showing {{shown}} of {{total}} decision gates.',
              { shown: ORCHESTRA_ROW_LIMIT, total: gateTotal }
            )
          ]
        : [])
    ]
  }
}

const OutputSchema = z.object({
  dispatchId: z.string(),
  source: z.enum(['terminal', 'transcript']),
  cursor: nullableText,
  status: z.object({ liveness: z.enum(['live', 'unverifiable', 'exited']).optional() }).optional(),
  // The agent verdict; status.liveness above is the terminal's.
  projection: z.object({ liveness: LivenessSchema }).nullable().optional(),
  warnings: z.array(z.string()).optional(),
  contentComplete: z.boolean().optional(),
  terminal: z
    .object({ tail: z.array(z.string()), truncated: z.boolean(), limited: z.boolean().optional() })
    .optional(),
  transcript: z
    .object({
      messages: z.array(
        z.object({
          role: z.string(),
          blocks: z.array(z.object({ type: z.string(), text: z.string().optional() }))
        })
      ),
      limited: z.boolean()
    })
    .optional()
})

export function parseWorkerOutput(value: unknown) {
  const output = OutputSchema.parse(value)
  if (
    (output.source === 'terminal' && !output.terminal) ||
    (output.source === 'transcript' && !output.transcript)
  ) {
    throw new Error(
      translate(
        'orchestra.data.missingOutput',
        'The server returned no worker output for its declared source.'
      )
    )
  }
  const raw =
    output.source === 'terminal'
      ? (output.terminal?.tail.join('\n') ?? '')
      : (output.transcript?.messages
          .map(
            (message) =>
              `[${message.role}]\n${message.blocks.map((block) => (block.type === 'text' ? (block.text ?? '') : `[${block.type}]`)).join('\n')}`
          )
          .join('\n\n') ?? '')
  return {
    dispatchId: output.dispatchId,
    source: output.source,
    text: raw.slice(-OUTPUT_LIMIT),
    cursor: output.cursor,
    liveness: output.status?.liveness,
    agentLiveness: output.projection?.liveness.verdict,
    clipped:
      raw.length > OUTPUT_LIMIT ||
      output.terminal?.truncated === true ||
      output.terminal?.limited === true ||
      output.transcript?.limited === true ||
      output.contentComplete === false,
    warnings: output.warnings ?? []
  }
}
