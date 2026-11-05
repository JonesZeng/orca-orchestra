import { useTranslation } from 'react-i18next'
import { Pause, Play, RefreshCw } from 'lucide-react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { useOrchestraData } from './use-orchestra-data'

export function OrchestraObservationControls({
  data,
  busy
}: {
  data: ReturnType<typeof useOrchestraData>
  busy: boolean
}): React.JSX.Element {
  useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-muted-foreground">
        {data.refreshedAt
          ? translate('orchestra.read.updatedAt', 'Last read {{time}}', {
              time: new Date(data.refreshedAt).toLocaleTimeString(getIntlLocale())
            })
          : translate('orchestra.read.waiting', 'Waiting for runtime data')}
      </span>
      <Badge variant={data.error ? 'destructive' : 'outline'}>
        {data.error
          ? translate('orchestra.read.unavailable', 'Read unavailable')
          : data.observing
            ? translate('orchestra.observe.polling', 'Observing · {{seconds}}s polling', {
                seconds: data.refreshMs / 1_000
              })
            : translate('orchestra.observe.paused', 'Observation paused')}
      </Badge>
      <Button
        variant="outline"
        size="sm"
        aria-pressed={data.live}
        onClick={() => {
          data.setLive(!data.live)
          if (!data.live && document.visibilityState !== 'hidden') {
            void data.refresh()
          }
        }}
      >
        {data.live ? <Pause /> : <Play />}
        {data.live
          ? translate('orchestra.observe.pause', 'Pause observation')
          : translate('orchestra.observe.resume', 'Resume observation')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={data.loading || busy}
        onClick={() => void data.refresh()}
      >
        {data.loading ? <LoadingSpinner /> : <RefreshCw />}
        {translate('orchestra.refresh', 'Refresh')}
      </Button>
      <p className="basis-full text-right text-xs text-muted-foreground">
        {translate(
          'orchestra.observe.readOnly',
          'Pausing observation does not pause agents or tasks.'
        )}
      </p>
    </div>
  )
}
