import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import type { OrchestraDagLayout } from './orchestra-dag-layout'

export function OrchestraDagNotices({
  layout,
  hasMoreWorkers
}: {
  layout: OrchestraDagLayout
  hasMoreWorkers: boolean
}): React.JSX.Element | null {
  useTranslation()
  const incomplete = layout.missingDependencies.length > 0 || layout.unresolvedTaskIds.length > 0
  if (!incomplete && !hasMoreWorkers) {
    return null
  }
  return (
    <>
      {incomplete && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground"
        >
          <p>
            {translate(
              'orchestra.dag.incomplete',
              'Some dependencies are missing or cyclic. Dashed connections are unresolved; the graph does not infer execution order for them.'
            )}
          </p>
          <details>
            <summary className="cursor-pointer">
              {translate('orchestra.dag.showUnresolved', 'Show unresolved task IDs')}
            </summary>
            <p className="mt-2 break-all font-mono text-xs">
              {[...new Set([...layout.missingDependencies, ...layout.unresolvedTaskIds])].join(
                ', '
              )}
            </p>
          </details>
        </div>
      )}
      {hasMoreWorkers && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'orchestra.dag.partialWorkers',
            'Only loaded workers are shown. Use Workers and output to load additional dispatch attempts.'
          )}
        </p>
      )}
    </>
  )
}
