import { memo } from 'react'
import { Bot, CheckCircle2, Circle, CircleAlert, Loader2, ShieldQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { OrchestraTask, OrchestraWorker } from '../orchestra-model'
import { taskTitle } from '../OrchestraTaskBoard'
import { NODE_HEIGHT, NODE_WIDTH } from './orchestra-dag-layout'
import {
  dagAgentActivity,
  dagLivenessLabel,
  dagTaskStatus,
  dagWorkerIsActive
} from './orchestra-dag-status'

type Props = {
  task: OrchestraTask
  /** The current dispatch when `current`, otherwise the last loaded earlier attempt. */
  worker?: OrchestraWorker
  current: boolean
  attemptCount: number
  x: number
  y: number
  selected: boolean
  unresolved: boolean
  pendingGates: number
  observing: boolean
  onSelect: (taskId: string) => void
}

function NodeIcon({ task, active }: { task: OrchestraTask; active: boolean }): React.JSX.Element {
  if (active) {
    return <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
  }
  if (task.status === 'completed') {
    return <CheckCircle2 className="size-4" aria-hidden />
  }
  if (task.status === 'failed' || task.status === 'blocked') {
    return <CircleAlert className="size-4" aria-hidden />
  }
  return <Circle className="size-4" aria-hidden />
}

function activityText(props: Props): string {
  const { worker, current, attemptCount, observing } = props
  if (worker && current) {
    return observing
      ? dagAgentActivity(worker)
      : translate('orchestra.dag.snapshotActivity', 'Snapshot · activity not live')
  }
  if (attemptCount > 0) {
    return translate('orchestra.dag.pastAttempts', '{{count}} earlier dispatch attempts', {
      count: attemptCount
    })
  }
  return translate('orchestra.dag.selectHint', 'Select to inspect dependencies')
}

function OrchestraDagNodeView(props: Props): React.JSX.Element {
  useTranslation()
  const { task, worker, current, x, y, selected, unresolved, pendingGates, observing } = props
  const active = current && task.status === 'dispatched' && dagWorkerIsActive(worker, observing)
  return (
    <button
      type="button"
      data-task-id={task.id}
      data-current={selected}
      data-active={active}
      aria-pressed={selected}
      tabIndex={selected ? 0 : -1}
      aria-label={translate('orchestra.dag.nodeLabel', '{{title}} · {{status}}. Inspect task.', {
        title: taskTitle(task),
        status: dagTaskStatus(task.status)
      })}
      onClick={() => props.onSelect(task.id)}
      className={cn(
        'absolute flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left text-card-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        selected && 'border-ring ring-2 ring-ring',
        unresolved && 'border-dashed',
        active && 'orchestra-dag-node-active',
        task.status === 'failed' && 'border-destructive'
      )}
      style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs">
          <NodeIcon task={task} active={active} />
          {dagTaskStatus(task.status)}
        </span>
        {pendingGates > 0 && (
          <Badge variant="secondary">
            <ShieldQuestion aria-hidden />
            {pendingGates}
          </Badge>
        )}
      </span>
      <span className="line-clamp-2 text-sm font-semibold leading-5">{taskTitle(task)}</span>
      <span className="mt-auto flex min-w-0 flex-col gap-1 border-t border-border pt-2 text-xs">
        <span className="flex items-center gap-2">
          <Bot className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {worker?.projection?.provider?.id ??
              task.assignee_handle ??
              translate('orchestra.dag.noAgent', 'No linked agent')}
          </span>
        </span>
        <span className="truncate text-muted-foreground">{activityText(props)}</span>
        {worker && current && (
          <span className="truncate text-2xs text-muted-foreground">
            {translate('orchestra.dag.hostVerdict', '{{host}} · {{verdict}}', {
              host: worker.projection?.host.id ?? '—',
              verdict: dagLivenessLabel(worker, observing)
            })}
          </span>
        )}
      </span>
    </button>
  )
}

/** Memoized so selection moves and toolbar updates re-render only the nodes they change. */
export const OrchestraDagNode = memo(OrchestraDagNodeView)
