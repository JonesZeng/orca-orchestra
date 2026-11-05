import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import {
  Activity,
  GitBranch,
  Layers3,
  MessageSquare,
  Network,
  Plus,
  ShieldCheck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { OrchestraCall } from './orchestra-model'
import type { useOrchestraData } from './use-orchestra-data'
import type { OrchestraActionRequest } from './orchestra-actions'
import { OrchestraTaskBoard } from './OrchestraTaskBoard'
import { OrchestraDecisionPanel } from './OrchestraDecisionPanel'
import { OrchestraWorkerPanel } from './OrchestraWorkerPanel'
import { OrchestraDag } from './dag/OrchestraDag'

export function OrchestraRunContent({
  data,
  coordinator,
  disabled,
  call,
  onAction
}: {
  data: ReturnType<typeof useOrchestraData>
  coordinator: string
  disabled: boolean
  call: OrchestraCall
  onAction: (request: OrchestraActionRequest) => void
}): React.JSX.Element {
  useTranslation()
  const run = data.runs.find((entry) => entry.id === data.selectedRunId)
  const snapshot = data.snapshot?.runId === data.selectedRunId ? data.snapshot : null
  const readOnly = run?.legacy === 1 || snapshot?.legacyReadOnly === true
  const tasks = snapshot?.tasks ?? []
  const pendingGates = snapshot?.gates.filter((gate) => gate.status === 'pending') ?? []
  const completed = tasks.filter((task) => task.status === 'completed').length
  return (
    <>
      {run ? (
        <>
          <section className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {translate('orchestra.runView.objective', 'Run objective')}
              </p>
              <h2 className="whitespace-pre-wrap break-words text-xl font-semibold leading-8">
                {run.objective}
              </h2>
              <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{run.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => onAction({ kind: 'message' })}
              >
                <MessageSquare />
                {translate('orchestra.runView.intervene', 'Send intervention')}
              </Button>
              <Button disabled={disabled} onClick={() => onAction({ kind: 'task' })}>
                <Plus />
                {translate('orchestra.tasks.add', 'Add task')}
              </Button>
            </div>
          </section>
          {readOnly && (
            <p className="rounded-lg border border-border bg-muted p-3 text-sm">
              {translate(
                'orchestra.runView.legacyReadOnly',
                'This is a read-only legacy Run. Its coordinator must use the Orca migration flow; this page does not offer takeover.'
              )}
            </p>
          )}
          {!coordinator.trim() && (
            <p className="text-sm text-muted-foreground">
              {translate(
                'orchestra.runView.observationMode',
                'Observation mode. Specify a coordinator on the left to preview orchestration and intervention actions.'
              )}
            </p>
          )}
          <section
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label={translate('orchestra.runView.overview', 'Run overview')}
          >
            {[
              { label: translate('orchestra.runView.totalTasks', 'Tasks'), value: tasks.length },
              {
                label: translate('orchestra.runView.completedTasks', 'Completed'),
                value: completed
              },
              {
                label: translate('orchestra.runView.runningTasks', 'In progress'),
                value: tasks.filter((task) => task.status === 'dispatched').length
              },
              {
                label: translate('orchestra.runView.pendingDecisions', 'Pending decisions'),
                value: pendingGates.length
              }
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border bg-card p-4 text-card-foreground"
              >
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {snapshot ? item.value : '—'}
                </p>
              </div>
            ))}
          </section>
          {!snapshot ? (
            <div
              role="status"
              className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
            >
              {data.loading
                ? translate(
                    'orchestra.runView.loadingSnapshot',
                    'Reading tasks, workers, and decisions…'
                  )
                : translate(
                    'orchestra.runView.missingSnapshot',
                    'No snapshot is available for this Run. Refresh to try again.'
                  )}
            </div>
          ) : (
            <>
              {snapshot.warnings.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {[...new Set(snapshot.warnings)].map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
              <Tabs key={run.id} defaultValue="dag">
                <div className="@container/orchestra-tabs overflow-x-auto scrollbar-sleek">
                  <TabsList
                    variant="line"
                    className="@max-[26rem]/orchestra-tabs:!h-auto @max-[26rem]/orchestra-tabs:w-full @max-[26rem]/orchestra-tabs:flex-wrap"
                  >
                    <TabsTrigger value="dag">
                      <Network />
                      {translate('orchestra.dag.tab', 'Live DAG')}
                    </TabsTrigger>
                    <TabsTrigger value="tasks">
                      <GitBranch />
                      {translate('orchestra.runView.tasksTab', 'Task dependencies')}
                    </TabsTrigger>
                    <TabsTrigger value="workers">
                      <Activity />
                      {translate('orchestra.runView.workersTab', 'Workers and output')}
                    </TabsTrigger>
                    <TabsTrigger value="decisions">
                      <ShieldCheck />
                      {translate('orchestra.runView.decisionsTab', 'Decisions')}{' '}
                      {pendingGates.length > 0 && <span>({pendingGates.length})</span>}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="dag" className="mt-5">
                  <OrchestraDag
                    snapshot={snapshot}
                    call={call}
                    disabled={disabled}
                    observing={data.observing}
                    unavailable={Boolean(data.error)}
                    refreshedAt={data.refreshedAt}
                    refreshMs={data.refreshMs}
                    onAction={onAction}
                  />
                </TabsContent>
                <TabsContent value="tasks" className="mt-5">
                  <OrchestraTaskBoard tasks={tasks} disabled={disabled} onAction={onAction} />
                </TabsContent>
                <TabsContent value="workers" className="mt-5">
                  <OrchestraWorkerPanel
                    key={run.id}
                    call={call}
                    workers={snapshot.workers}
                    live={data.observing && !data.error}
                    disabled={disabled}
                    onAction={onAction}
                    total={snapshot.workerTotal}
                    hasMore={snapshot.hasMoreWorkers}
                    onLoadMore={() => void data.loadMoreWorkers()}
                  />
                </TabsContent>
                <TabsContent value="decisions" className="mt-5">
                  <OrchestraDecisionPanel
                    gates={snapshot.gates}
                    disabled={disabled}
                    onAction={onAction}
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      ) : (
        <div className="flex min-h-96 flex-col items-center justify-center gap-4 text-center">
          <Layers3 className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold">
            {translate('orchestra.runView.emptyTitle', 'See the collaboration in one place')}
          </h2>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            {translate(
              'orchestra.runView.emptyDescription',
              'Select a Run to inspect task dependencies, worker output, and pending decisions. Adding tasks, dispatching work, and sending interventions always require your confirmation.'
            )}
          </p>
        </div>
      )}
    </>
  )
}
