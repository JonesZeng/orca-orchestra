import { z } from 'zod'
import { translate } from '@/i18n/i18n'
import type { OrchestraMutationDraft } from './orchestra-actions'
import type { OrchestraCall, OrchestraSnapshot } from './orchestra-model'

export type OrchestraMutationScope = {
  runId: string | null
  coordinator: string
  snapshot: OrchestraSnapshot | null
  unavailable?: boolean
}

export function orchestraDraftRefusal(
  draft: OrchestraMutationDraft,
  scope: OrchestraMutationScope
): string | null {
  if (scope.unavailable) {
    return translate(
      'orchestra.preflight.stateUnavailable',
      'Current state is unavailable. Refresh before confirming.'
    )
  }
  const from = draft.params.from ?? draft.params.callerTerminalHandle
  if (from !== scope.coordinator.trim()) {
    return translate(
      'orchestra.preflight.coordinatorChanged',
      'The coordinator changed. Preview the operation again.'
    )
  }
  if (draft.method === 'orchestration.runCreate') {
    return null
  }
  if (!scope.runId || draft.params.run !== scope.runId || scope.snapshot?.runId !== scope.runId) {
    return translate(
      'orchestra.preflight.runChanged',
      'The run scope changed. Select the run and preview again.'
    )
  }
  if (scope.snapshot.legacyReadOnly) {
    return translate('orchestra.preflight.readOnly', 'This run is now read-only.')
  }
  if (draft.method === 'orchestration.dispatch') {
    const task = scope.snapshot.tasks.find((entry) => entry.id === draft.params.task)
    if (task?.status !== 'ready') {
      return translate(
        'orchestra.preflight.taskNotReady',
        'The task is no longer ready. Refresh and check its state.'
      )
    }
  }
  if (draft.method === 'orchestration.gateResolve') {
    const gate = scope.snapshot.gates.find((entry) => entry.id === draft.params.id)
    const task = scope.snapshot.tasks.find((entry) => entry.id === gate?.task_id)
    if (gate?.status !== 'pending' || task?.status !== 'blocked') {
      return translate(
        'orchestra.preflight.gateChanged',
        'The gate or task state changed. The existing decision was not overwritten.'
      )
    }
  }
  return null
}

const TaskList = z.object({
  runId: z.string(),
  legacyReadOnly: z.boolean().optional(),
  tasks: z.array(z.object({ id: z.string(), run_id: z.string(), status: z.string() }))
})
const GateList = z.object({
  runId: z.string(),
  gates: z.array(
    z.object({ id: z.string(), run_id: z.string(), task_id: z.string(), status: z.string() })
  )
})

/** Recheck live facts after confirmation; server-side state guards remain authoritative. */
export async function recheckOrchestraDraft(
  call: OrchestraCall,
  draft: OrchestraMutationDraft,
  scope: OrchestraMutationScope
): Promise<string | null> {
  const refusal = orchestraDraftRefusal(draft, scope)
  if (refusal) {
    return refusal
  }
  if (draft.method !== 'orchestration.dispatch' && draft.method !== 'orchestration.gateResolve') {
    return null
  }
  const tasks = TaskList.parse(await call('orchestration.taskList', { run: scope.runId }))
  if (tasks.legacyReadOnly) {
    return translate('orchestra.preflight.readOnly', 'This run is now read-only.')
  }
  if (tasks.runId !== scope.runId || tasks.tasks.some((task) => task.run_id !== scope.runId)) {
    return translate(
      'orchestra.preflight.foreignTasks',
      'The runtime returned tasks from another run. The operation was refused.'
    )
  }
  if (draft.method === 'orchestration.dispatch') {
    return tasks.tasks.find((task) => task.id === draft.params.task)?.status === 'ready'
      ? null
      : translate(
          'orchestra.preflight.taskNotReady',
          'The task is no longer ready. Refresh and check its state.'
        )
  }
  const gates = GateList.parse(await call('orchestration.gateList', { run: scope.runId }))
  if (gates.runId !== scope.runId || gates.gates.some((gate) => gate.run_id !== scope.runId)) {
    return translate(
      'orchestra.preflight.foreignGates',
      'The runtime returned gates from another run. The operation was refused.'
    )
  }
  const gate = gates.gates.find((entry) => entry.id === draft.params.id)
  const task = tasks.tasks.find((entry) => entry.id === gate?.task_id)
  return gate?.status === 'pending' && task?.status === 'blocked'
    ? null
    : translate(
        'orchestra.preflight.gateChanged',
        'The gate or task state changed. The existing decision was not overwritten.'
      )
}
