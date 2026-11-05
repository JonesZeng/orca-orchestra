import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { OrchestraReceiptInspector } from './OrchestraReceiptInspector'
import type { OrchestraCall } from './orchestra-model'

export function OrchestraOperationStatus({
  error,
  runsLimited,
  mutationError,
  requestId,
  call,
  loading,
  busy,
  onRefresh,
  onUnlock,
  notice
}: {
  error: string | null
  runsLimited: boolean
  mutationError: string | null
  requestId: string
  call: OrchestraCall
  loading: boolean
  busy: boolean
  onRefresh: () => void
  onUnlock: () => void
  notice: string | null
}): React.JSX.Element {
  useTranslation()
  return (
    <>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">
            {translate(
              'orchestra.read.failed',
              'State could not be read. Write operations are paused.'
            )}
          </p>
          <p className="mt-1 break-words">{error}</p>
          <p className="mt-2">
            {translate(
              'orchestra.read.preserved',
              'The last successful snapshot is preserved. A connection failure does not prove that a Worker exited.'
            )}
          </p>
        </div>
      )}
      {runsLimited && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'orchestra.runs.limit',
            'The display limit has been reached. Only the 500 most recently loaded Runs are shown.'
          )}
        </p>
      )}
      {mutationError && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">
            {translate(
              'orchestra.mutation.failed',
              'The request failed or its outcome is unknown. It was not retried.'
            )}
          </p>
          <p className="break-words">{mutationError}</p>
          <p>
            {translate(
              'orchestra.mutation.recovery',
              'The operation may already have taken effect. Inspect its receipt and check the task, decision, or recipient before starting another operation.'
            )}
          </p>
          <OrchestraReceiptInspector key={requestId} call={call} initialRequestId={requestId} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
              {translate('orchestra.mutation.inspect', 'Refresh and inspect state')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy || loading} onClick={onUnlock}>
              {translate('orchestra.mutation.unlock', 'I have checked; unlock write operations')}
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm"
        >
          <Info className="size-4" aria-hidden />
          {notice}
        </p>
      )}
    </>
  )
}
