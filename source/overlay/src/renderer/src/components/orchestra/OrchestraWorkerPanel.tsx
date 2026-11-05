import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, MessageSquare, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrchestraCall, OrchestraWorker } from './orchestra-model'
import { OrchestraWorkerOutput, orchestraLivenessLabel } from './OrchestraWorkerOutput'
import type { OrchestraActionRequest } from './orchestra-actions'
import { translate } from '@/i18n/i18n'

export function workerStateLabel(state: string): string {
  switch (state) {
    case 'pending':
      return translate('orchestra.worker.statePending', 'Pending (pending)')
    case 'dispatched':
      return translate('orchestra.worker.stateDispatched', 'Dispatched (dispatched)')
    case 'completed':
      return translate('orchestra.worker.stateCompleted', 'Completed (completed)')
    case 'circuit_broken':
      return translate(
        'orchestra.worker.stateCircuitBroken',
        'Circuit breaker open (circuit_broken)'
      )
    case 'starting':
      return translate('orchestra.worker.stateStarting', 'Starting (starting)')
    case 'ready':
      return translate('orchestra.worker.stateReady', 'Ready (ready)')
    case 'start_unknown':
      return translate('orchestra.worker.stateStartUnknown', 'Start unconfirmed (start_unknown)')
    case 'failed':
      return translate('orchestra.worker.stateFailed', 'Failed (failed)')
    case 'succeeded':
      return translate('orchestra.worker.stateSucceeded', 'Succeeded (succeeded)')
    case 'stopping':
      return translate('orchestra.worker.stateStopping', 'Stopping (stopping)')
    case 'stop_unknown':
      return translate('orchestra.worker.stateStopUnknown', 'Stop unconfirmed (stop_unknown)')
    case 'stopped':
      return translate('orchestra.worker.stateStopped', 'Stopped (stopped)')
    case 'abandoned':
      return translate('orchestra.worker.stateAbandoned', 'Abandoned (abandoned)')
    case 'unsupervised':
      return translate('orchestra.worker.stateUnsupervised', 'Unsupervised (unsupervised)')
    default:
      return state
  }
}

export function OrchestraWorkerPanel({
  call,
  workers,
  disabled,
  onAction,
  total,
  hasMore,
  onLoadMore,
  live = false
}: {
  call: OrchestraCall
  workers: OrchestraWorker[]
  disabled: boolean
  onAction: (request: OrchestraActionRequest) => void
  total: number
  hasMore: boolean
  onLoadMore: () => void
  live?: boolean
}): React.JSX.Element {
  useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {translate(
            'orchestra.worker.loaded',
            'Loaded {{loaded}} of {{total}} Dispatches. Process state is reported by the execution host.',
            { loaded: workers.length, total }
          )}
        </p>
        {workers.map((worker) => (
          <Card key={worker.dispatchId}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="size-4" aria-hidden />
                <CardTitle>
                  {worker.projection?.provider?.id ?? translate('orchestra.worker.agent', 'Agent')}
                </CardTitle>
                <Badge variant="outline">{workerStateLabel(worker.dispatchStatus)}</Badge>
              </div>
              <p className="break-all font-mono text-2xs text-muted-foreground">
                {worker.dispatchId}
              </p>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt className="text-muted-foreground">
                  {translate('orchestra.worker.state', 'Worker state')}
                </dt>
                <dd>{workerStateLabel(worker.workerState)}</dd>
                <dt className="text-muted-foreground">
                  {translate('orchestra.worker.host', 'Execution host')}
                </dt>
                <dd className="break-all">
                  {worker.projection?.host.id ??
                    translate('orchestra.worker.hostMissing', 'Host information was not provided')}
                </dd>
                <dt className="text-muted-foreground">
                  {translate('orchestra.worker.process', 'Process')}
                </dt>
                <dd>
                  {orchestraLivenessLabel(worker.projection?.liveness.verdict ?? 'unverifiable')}
                </dd>
              </dl>
              {worker.projection?.stage.detail && (
                <p className="mt-3 break-words text-xs text-muted-foreground">
                  {worker.projection.stage.detail}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelected(worker.dispatchId)}>
                  <Terminal />
                  {translate('orchestra.worker.viewOutput', 'View output')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onAction({ kind: 'message', to: `dispatch:${worker.dispatchId}` })}
                >
                  <MessageSquare />
                  {translate('orchestra.worker.intervene', 'Send intervention')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!workers.length && (
          <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
            {translate(
              'orchestra.worker.empty',
              'No workers yet. Dispatch a ready task to a running agent.'
            )}
          </div>
        )}
        {hasMore && (
          <Button variant="outline" onClick={onLoadMore}>
            {translate('orchestra.worker.loadMore', 'Load more workers')}
          </Button>
        )}
      </div>
      <OrchestraWorkerOutput key={selected} call={call} dispatchId={selected} live={live} />
    </div>
  )
}
