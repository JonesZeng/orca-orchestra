import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { Plus, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { useOrchestraData } from './use-orchestra-data'

export function OrchestraRunSidebar({
  data,
  coordinator,
  busy,
  recoveryRequired,
  onSelectRun,
  onCoordinatorChange,
  onCreateRun
}: {
  data: ReturnType<typeof useOrchestraData>
  coordinator: string
  busy: boolean
  recoveryRequired: boolean
  onSelectRun: (id: string) => void
  onCoordinatorChange: (value: string) => void
  onCreateRun: () => void
}): React.JSX.Element {
  useTranslation()
  const run = data.runs.find((entry) => entry.id === data.selectedRunId)
  return (
    <aside
      className="flex shrink-0 flex-col gap-5 border-b border-border bg-sidebar p-5 text-sidebar-foreground lg:w-72 lg:border-r lg:border-b-0"
      aria-label={translate('orchestra.runSidebar.list', 'Run list')}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {translate('orchestra.runSidebar.heading', 'Objectives / Runs')}
        </h2>
        <Badge variant="outline">
          {data.runs.length}
          {data.hasMoreRuns ? '+' : ''}
        </Badge>
      </div>
      <nav
        className="max-h-72 space-y-2 overflow-auto scrollbar-sleek lg:max-h-[32rem]"
        aria-label={translate('orchestra.runSidebar.select', 'Select a Run')}
      >
        {data.runs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={busy}
            data-current={entry.id === data.selectedRunId}
            onClick={() => onSelectRun(entry.id)}
            className={cn(
              'w-full rounded-md border border-transparent p-3 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50',
              entry.id === data.selectedRunId && 'border-sidebar-border bg-sidebar-accent'
            )}
          >
            <p className="line-clamp-2 break-words text-sm font-medium leading-6">
              {entry.objective}
            </p>
            <p className="mt-2 truncate font-mono text-2xs text-muted-foreground">{entry.id}</p>
            {entry.legacy === 1 && (
              <p className="mt-2 text-2xs text-muted-foreground">
                {translate('orchestra.runSidebar.legacy', 'Legacy Run · Read-only')}
              </p>
            )}
          </button>
        ))}
        {!data.runs.length && (
          <p className="py-6 text-sm leading-6 text-muted-foreground">
            {data.loading
              ? translate('orchestra.runSidebar.loading', 'Reading Runs…')
              : translate(
                  'orchestra.runSidebar.empty',
                  'No Runs yet. Enter a coordinator handle, then create an objective.'
                )}
          </p>
        )}
      </nav>
      {data.hasMoreRuns && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || data.loading}
          onClick={() => void data.loadMoreRuns()}
        >
          {translate('orchestra.runSidebar.loadMore', 'Load more Runs')}
        </Button>
      )}
      <div className="space-y-3 border-t border-sidebar-border pt-5">
        <Label htmlFor="orchestra-coordinator">
          {translate('orchestra.runSidebar.coordinator', 'Acting identity · Coordinator handle')}
        </Label>
        <Input
          id="orchestra-coordinator"
          value={coordinator}
          disabled={busy}
          onChange={(event) => onCoordinatorChange(event.target.value)}
          placeholder={translate(
            'orchestra.runSidebar.coordinatorPlaceholder',
            'term_… or session address'
          )}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'orchestra.runSidebar.identityHint',
            'Specify the coordinator that owns this Run. The runtime still checks authority; this page does not take over legacy Runs.'
          )}
        </p>
        {run?.coordinator_handle && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onCoordinatorChange(run.coordinator_handle ?? '')}
          >
            {translate('orchestra.runSidebar.useCoordinator', 'Use this Run’s coordinator')}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy || recoveryRequired || !coordinator.trim() || Boolean(data.error)}
          onClick={() => onCreateRun()}
        >
          <Plus />
          {translate('orchestra.runSidebar.create', 'New Run')}
        </Button>
      </div>
      <p className="mt-auto flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {translate(
          'orchestra.runSidebar.safety',
          'Browsing does not dispatch tasks. Every write requires a preview and confirmation.'
        )}
      </p>
    </aside>
  )
}
