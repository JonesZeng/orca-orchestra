import { translate } from '@/i18n/i18n'

export type OrchestraActionRequest =
  | { kind: 'run' }
  | { kind: 'task' }
  | { kind: 'message'; to?: string }
  | { kind: 'dispatch'; taskId: string; taskTitle: string }
  | { kind: 'gate'; gateId: string; question: string; options: string[] }

export type OrchestraMutationDraft = {
  label: string
  description: string
  method: string
  params: Record<string, unknown>
  request?: OrchestraActionRequest
}

export type OrchestraActionField = {
  name: string
  label: string
  hint?: string
  multiline?: boolean
  optional?: boolean
}

export type OrchestraActionValues = Record<string, string>

export function orchestraActionCopy(request: OrchestraActionRequest): {
  title: string
  description: string
  fields: OrchestraActionField[]
} {
  switch (request.kind) {
    case 'run':
      return {
        title: translate('orchestra.actions.runTitle', 'Create run'),
        description: translate(
          'orchestra.actions.runDescription',
          'Create a run bound to the specified coordinator. This does not start any workers.'
        ),
        fields: [
          {
            name: 'objective',
            label: translate('orchestra.actions.objective', 'Objective'),
            multiline: true
          }
        ]
      }
    case 'task':
      return {
        title: translate('orchestra.actions.taskTitle', 'Add task'),
        description: translate(
          'orchestra.actions.taskDescription',
          'Add a task to this run. It can be dispatched manually once its dependencies are satisfied.'
        ),
        fields: [
          { name: 'title', label: translate('orchestra.actions.taskName', 'Task name') },
          {
            name: 'spec',
            label: translate('orchestra.actions.taskSpec', 'Task instructions'),
            multiline: true
          },
          {
            name: 'deps',
            label: translate('orchestra.actions.dependencies', 'Dependency task IDs'),
            hint: translate(
              'orchestra.actions.dependenciesHint',
              'Separate IDs with commas or newlines. Leave blank for no dependencies.'
            ),
            multiline: true,
            optional: true
          }
        ]
      }
    case 'message':
      return {
        title: translate('orchestra.actions.messageTitle', 'Send intervention'),
        description: translate(
          'orchestra.actions.messageDescription',
          'Send a high-priority message to one agent. Sending does not mean the agent has read or acted on it.'
        ),
        fields: [
          {
            name: 'to',
            label: translate('orchestra.actions.recipient', 'Recipient'),
            hint: translate(
              'orchestra.actions.recipientHint',
              'Use an exact terminal handle, Orca session address, or dispatch address. @ broadcasts are not supported.'
            )
          },
          { name: 'subject', label: translate('orchestra.actions.subject', 'Subject') },
          {
            name: 'body',
            label: translate('orchestra.actions.messageBody', 'Message'),
            multiline: true
          }
        ]
      }
    case 'dispatch':
      return {
        title: translate('orchestra.actions.dispatchTitle', 'Dispatch task'),
        description: translate(
          'orchestra.actions.dispatchDescription',
          'Send “{{taskTitle}}” to the target agent. Execution may start immediately.',
          { taskTitle: request.taskTitle }
        ),
        fields: [
          {
            name: 'to',
            label: translate('orchestra.actions.targetAgent', 'Target agent'),
            hint: translate(
              'orchestra.actions.targetAgentHint',
              'Use an exact terminal handle or Orca session address, not the current coordinator.'
            )
          }
        ]
      }
    case 'gate':
      return {
        title: translate('orchestra.actions.gateTitle', 'Resolve decision gate'),
        description: translate(
          'orchestra.actions.gateDescription',
          '{{question}}\nSubmitting records your response and marks the task ready again. Even “reject” or “wait” unblocks the task. Cancel to keep it blocked.',
          { question: request.question }
        ),
        fields: [
          {
            name: 'resolution',
            label: translate('orchestra.actions.resolution', 'Resolution'),
            multiline: true
          }
        ]
      }
  }
}

export function buildOrchestraMutation(
  request: OrchestraActionRequest,
  values: OrchestraActionValues,
  scope: { runId: string | null; coordinator: string }
): { ok: true; draft: OrchestraMutationDraft } | { ok: false; error: string; field?: string } {
  const from = scope.coordinator.trim()
  const run = scope.runId?.trim()
  if (!from || from.startsWith('@')) {
    return {
      ok: false,
      error: translate(
        'orchestra.actions.coordinatorRequired',
        'Specify the coordinator handle before acting.'
      )
    }
  }
  if (request.kind !== 'run' && !run) {
    return {
      ok: false,
      error: translate('orchestra.actions.runRequired', 'Select a run before acting.')
    }
  }
  const copy = orchestraActionCopy(request)
  const input = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()])
  )
  const missing = copy.fields.find((field) => !field.optional && !input[field.name])
  if (missing) {
    return {
      ok: false,
      error: translate('orchestra.actions.fieldRequired', 'Enter {{field}}.', {
        field: missing.label
      }),
      field: missing.name
    }
  }
  if (request.kind === 'dispatch' || request.kind === 'message') {
    if (input.to.startsWith('@') || /\s/.test(input.to)) {
      return {
        ok: false,
        error: translate(
          'orchestra.actions.singleRecipientRequired',
          'Enter one exact recipient address. Broadcasts are not supported.'
        ),
        field: 'to'
      }
    }
    if (request.kind === 'dispatch' && input.to === from) {
      return {
        ok: false,
        error: translate(
          'orchestra.actions.selfDispatchRefused',
          'A task cannot be dispatched to the current coordinator.'
        ),
        field: 'to'
      }
    }
  }
  const base = { label: copy.title, description: copy.description, request }
  switch (request.kind) {
    case 'run':
      return {
        ok: true,
        draft: {
          ...base,
          method: 'orchestration.runCreate',
          params: { objective: input.objective, from }
        }
      }
    case 'task': {
      const deps = [
        ...new Set(
          (input.deps ?? '')
            .split(/[,\n]/)
            .map((id) => id.trim())
            .filter(Boolean)
        )
      ]
      if (deps.some((id) => /[\s[\]"]/.test(id))) {
        return {
          ok: false,
          error: translate(
            'orchestra.actions.invalidDependencies',
            'Use task IDs separated by commas or newlines.'
          ),
          field: 'deps'
        }
      }
      return {
        ok: true,
        draft: {
          ...base,
          method: 'orchestration.taskCreate',
          params: {
            taskTitle: input.title,
            spec: input.spec,
            deps: JSON.stringify(deps),
            callerTerminalHandle: from,
            run
          }
        }
      }
    }
    case 'message':
      return {
        ok: true,
        draft: {
          ...base,
          method: 'orchestration.send',
          params: {
            to: input.to,
            subject: input.subject,
            body: input.body,
            type: 'status',
            priority: 'high',
            from,
            run
          }
        }
      }
    case 'dispatch':
      if (!request.taskId.trim()) {
        return {
          ok: false,
          error: translate(
            'orchestra.actions.missingTaskId',
            'Task ID is missing. Refresh before trying again.'
          )
        }
      }
      return {
        ok: true,
        draft: {
          ...base,
          method: 'orchestration.dispatch',
          params: { task: request.taskId, to: input.to, inject: true, from, run }
        }
      }
    case 'gate':
      if (!request.gateId.trim()) {
        return {
          ok: false,
          error: translate(
            'orchestra.actions.missingGateId',
            'Decision gate ID is missing. Refresh before trying again.'
          )
        }
      }
      return {
        ok: true,
        draft: {
          ...base,
          method: 'orchestration.gateResolve',
          params: { id: request.gateId, resolution: input.resolution, from, run }
        }
      }
  }
}
