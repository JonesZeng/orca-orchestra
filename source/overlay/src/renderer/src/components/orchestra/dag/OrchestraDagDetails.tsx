import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, MessageSquare, ShieldQuestion } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { OrchestraCall, OrchestraGate, OrchestraTask } from '../orchestra-model'
import type { OrchestraActionRequest } from '../orchestra-actions'
import { taskTitle } from '../OrchestraTaskBoard'
import { OrchestraWorkerOutput } from '../OrchestraWorkerOutput'
import { workerStateLabel } from '../OrchestraWorkerPanel'
import { dagAgentActivity, dagLivenessLabel, dagTaskStatus } from './orchestra-dag-status'
import { representativeAttempt, type OrchestraDagModel } from './use-orchestra-dag-model'

type Props = {
  task: OrchestraTask
  model: OrchestraDagModel
  gates: readonly OrchestraGate[]
  observing: boolean
  disabled: boolean
  call: OrchestraCall
  /** Omitted on read-only surfaces: intervention controls are not rendered. */
  onAction?: (action: OrchestraActionRequest) => void
}

function dependencyTitle(model: OrchestraDagModel, id: string): string {
  const dependency = model.tasks.get(id)
  return dependency ? taskTitle(dependency) : id
}

export function OrchestraDagDetails({
  task,
  model,
  gates: allGates,
  observing,
  disabled,
  call,
  onAction
}: Props): React.JSX.Element {
  useTranslation()
  const [selectedDispatch, setSelectedDispatch] = useState<string | null>(null)
  const attempts = model.attempts.get(task.id) ?? []
  const fallback = representativeAttempt(task, model)
  const worker = attempts.find((entry) => entry.dispatchId === selectedDispatch) ?? fallback.worker
  const isCurrent = worker !== undefined && worker.dispatchId === task.dispatch_id
  const gates = allGates.filter((gate) => gate.task_id === task.id && gate.status === 'pending')
  return (
    <section
      className="space-y-4"
      aria-label={translate('orchestra.dag.inspector', 'Selected task inspector')}
    >
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 text-card-foreground">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Badge variant={task.status === 'failed' ? 'destructive' : 'outline'}>
              {dagTaskStatus(task.status)}
            </Badge>
            <h3 className="break-words text-base font-semibold">{taskTitle(task)}</h3>
            <p className="break-all font-mono text-2xs text-muted-foreground">{task.id}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onAction && task.status === 'ready' && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onAction({ kind: 'dispatch', taskId: task.id, taskTitle: taskTitle(task) })
                }
              >
                <ArrowRight />
                {translate('orchestra.tasks.dispatch', 'Dispatch to agent')}
              </Button>
            )}
            {onAction && worker && isCurrent && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onAction({ kind: 'message', to: `dispatch:${worker.dispatchId}` })}
              >
                <MessageSquare />
                {translate('orchestra.worker.intervene', 'Send intervention')}
              </Button>
            )}
          </div>
        </div>
        <p className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 scrollbar-sleek">
          {task.spec}
        </p>
        {task.text_truncated && (
          <p className="text-xs text-muted-foreground">
            {translate(
              'orchestra.dag.textTruncated',
              'This view received a shortened spec or result. Open the task in Orca for the full text.'
            )}
          </p>
        )}
        {task.deps.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3 text-xs">
            <p className="font-medium">
              {translate('orchestra.tasks.dependencies', 'Dependencies')}
            </p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              {task.deps.map((dep) => (
                <li key={dep}>{dependencyTitle(model, dep)}</li>
              ))}
            </ul>
          </div>
        )}
        {gates.map((gate) => (
          <div
            key={gate.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
          >
            <p className="flex items-start gap-2 text-sm">
              <ShieldQuestion className="size-4 shrink-0" aria-hidden />
              {gate.question}
            </p>
            {onAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onAction({
                    kind: 'gate',
                    gateId: gate.id,
                    question: gate.question,
                    options: gate.options
                  })
                }
              >
                {translate('orchestra.decisions.resolve', 'Enter a resolution')}
              </Button>
            )}
          </div>
        ))}
        {task.result && (
          <details className="border-t border-border pt-3 text-sm">
            <summary className="cursor-pointer">
              {translate('orchestra.tasks.result', 'Result')}
            </summary>
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs scrollbar-sleek">
              {task.result}
            </p>
          </details>
        )}
      </div>
      {attempts.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {translate('orchestra.dag.attempts', '{{count}} dispatch attempts loaded', {
                count: attempts.length
              })}
            </span>
            <Select value={worker?.dispatchId ?? ''} onValueChange={setSelectedDispatch}>
              <SelectTrigger
                className="min-w-0 max-w-full"
                aria-label={translate('orchestra.dag.selectDispatch', 'Select a dispatch attempt')}
              >
                <SelectValue
                  placeholder={translate(
                    'orchestra.dag.chooseAttempt',
                    'Choose an attempt to inspect'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {attempts.map((attempt) => (
                  <SelectItem key={attempt.dispatchId} value={attempt.dispatchId}>
                    {attempt.dispatchId} · {workerStateLabel(attempt.workerState)}
                    {attempt.dispatchId === task.dispatch_id
                      ? translate('orchestra.dag.currentAttempt', ' · current')
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {worker && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {translate('orchestra.dag.agentStatus', '{{provider}} · {{activity}}', {
                  provider: worker.projection?.provider?.id ?? '—',
                  activity: !isCurrent
                    ? translate('orchestra.dag.earlierAttempt', 'Earlier attempt · not current')
                    : observing
                      ? dagAgentActivity(worker)
                      : translate('orchestra.dag.snapshotActivity', 'Snapshot · activity not live')
                })}
              </p>
              <p>
                {translate('orchestra.dag.hostVerdict', '{{host}} · {{verdict}}', {
                  host: worker.projection?.host.id ?? '—',
                  verdict: dagLivenessLabel(worker, observing)
                })}
              </p>
              {worker.projection?.stage.detail && (
                <p className="break-words">{worker.projection.stage.detail}</p>
              )}
            </div>
          )}
          <OrchestraWorkerOutput
            key={worker?.dispatchId ?? 'none'}
            call={call}
            dispatchId={worker?.dispatchId ?? null}
            live={observing && isCurrent}
          />
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          {translate(
            'orchestra.dag.noDispatch',
            'No dispatch is loaded for this task. Ready tasks can be assigned to an existing agent.'
          )}
        </p>
      )}
    </section>
  )
}
