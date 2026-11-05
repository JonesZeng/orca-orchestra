import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Expand, Minus, Network, Plus } from 'lucide-react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { OrchestraCall, OrchestraSnapshot } from '../orchestra-model'
import type { OrchestraActionRequest } from '../orchestra-actions'
import { OrchestraDagCanvas } from './OrchestraDagCanvas'
import { OrchestraDagDetails } from './OrchestraDagDetails'
import { OrchestraDagNotices } from './OrchestraDagNotices'
import { useOrchestraDagModel, useSettledValue, useSnapshotStale } from './use-orchestra-dag-model'
import './orchestra-dag.css'

type Props = {
  snapshot: OrchestraSnapshot
  observing: boolean
  unavailable: boolean
  refreshedAt: number | null
  refreshMs: number
  disabled: boolean
  call: OrchestraCall
  /** Omitted on read-only surfaces such as the Orca plugin panel: write controls are not rendered. */
  onAction?: (action: OrchestraActionRequest) => void
}

const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.5

function ObservationBadge(props: {
  unavailable: boolean
  observing: boolean
  stale: boolean
}): React.JSX.Element {
  if (props.unavailable) {
    return (
      <Badge variant="destructive">
        {translate('orchestra.dag.unavailable', 'Read failed · last snapshot kept')}
      </Badge>
    )
  }
  if (!props.observing) {
    return (
      <Badge variant="secondary">{translate('orchestra.dag.paused', 'Observation paused')}</Badge>
    )
  }
  return props.stale ? (
    <Badge variant="destructive">{translate('orchestra.dag.stale', 'Snapshot stale')}</Badge>
  ) : (
    <Badge variant="outline">{translate('orchestra.dag.live', 'Observing')}</Badge>
  )
}

export function OrchestraDag({
  snapshot,
  observing,
  unavailable,
  refreshedAt,
  refreshMs,
  disabled,
  call,
  onAction
}: Props): React.JSX.Element {
  useTranslation()
  const model = useOrchestraDagModel(snapshot)
  const { layout } = model
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      snapshot.tasks.find((task) => task.status === 'dispatched')?.id ??
      layout.nodes[0]?.task.id ??
      null
  )
  const [zoom, setZoom] = useState<number | null>(null)
  const [viewport, setViewport] = useState({ width: 900, height: 460 })
  const scroll = useRef<HTMLDivElement>(null)
  const graphEmpty = layout.nodes.length === 0
  useEffect(() => {
    const element = scroll.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(() =>
      setViewport({ width: element.clientWidth, height: element.clientHeight })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [graphEmpty])
  const stale = useSnapshotStale(refreshedAt, unavailable, Math.max(10_000, refreshMs * 3))
  const live = observing && !stale
  const fit = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min((viewport.width - 16) / layout.width, (viewport.height - 16) / layout.height)
    )
  )
  const scale = zoom ?? fit
  // A task that left the snapshot or the 500-node graph falls back to a laid-out node.
  const selected =
    (selectedId && model.slots.has(selectedId) ? model.tasks.get(selectedId) : undefined) ??
    layout.nodes[0]?.task
  const inspectedId = useSettledValue(selected?.id, 250)
  const inspected = inspectedId ? model.tasks.get(inspectedId) : undefined
  const select = useCallback((taskId: string) => setSelectedId(taskId), [])
  const changeZoom = (value: number): void => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)))

  if (!snapshot.tasks.length) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-8 text-center">
        <Network className="size-8 text-muted-foreground" aria-hidden />
        <h3 className="font-medium">
          {translate('orchestra.dag.empty', 'Build a task graph for this Run')}
        </h3>
        <p className="max-w-xl text-sm text-muted-foreground">
          {translate(
            'orchestra.dag.emptyDescription',
            'Add tasks and their dependencies. Agent activity will appear on the graph when a task is dispatched.'
          )}
        </p>
        {onAction && (
          <Button variant="outline" disabled={disabled} onClick={() => onAction({ kind: 'task' })}>
            <Plus />
            {translate('orchestra.tasks.add', 'Add task')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section
        className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
        aria-label={translate('orchestra.dag.region', 'Live task dependency graph')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Network className="size-4" aria-hidden />
            <span className="font-medium">{translate('orchestra.dag.title', 'Task DAG')}</span>
            <ObservationBadge unavailable={unavailable} observing={observing} stale={stale} />
            <span className="text-muted-foreground" aria-live="polite">
              {refreshedAt
                ? translate('orchestra.read.updatedAt', 'Last read {{time}}', {
                    time: new Date(refreshedAt).toLocaleTimeString(getIntlLocale())
                  })
                : translate('orchestra.read.waiting', 'Waiting for runtime data')}
            </span>
            <span className="text-muted-foreground max-sm:hidden">
              {translate('orchestra.dag.refreshInterval', 'Polls every {{seconds}} s', {
                seconds: refreshMs / 1000
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={scale <= MIN_ZOOM}
              aria-label={translate('orchestra.dag.zoomOut', 'Zoom out')}
              onClick={() => changeZoom(scale - 0.15)}
            >
              <Minus />
              <span className="max-sm:sr-only">
                {translate('orchestra.dag.zoomOut', 'Zoom out')}
              </span>
            </Button>
            <span className="w-12 text-center font-mono text-xs tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={scale >= MAX_ZOOM}
              aria-label={translate('orchestra.dag.zoomIn', 'Zoom in')}
              onClick={() => changeZoom(scale + 0.15)}
            >
              <Plus />
              <span className="max-sm:sr-only">{translate('orchestra.dag.zoomIn', 'Zoom in')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setZoom(null)
                scroll.current?.scrollTo({ left: 0, top: 0 })
              }}
            >
              <Expand />
              {translate('orchestra.dag.fit', 'Fit graph')}
            </Button>
          </div>
        </div>
        <OrchestraDagCanvas
          model={model}
          scrollRef={scroll}
          viewport={viewport}
          scale={scale}
          selectedId={selected?.id}
          live={live}
          onSelect={select}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            {translate(
              'orchestra.dag.legend',
              'Arrows: prerequisite → dependent task. Motion: freshly observed agent work.'
            )}
          </span>
          <span className="max-sm:hidden">
            {translate('orchestra.dag.keyboardHint', 'Arrow keys: move · ←/→ follow dependencies')}
          </span>
        </div>
      </section>
      <OrchestraDagNotices layout={layout} hasMoreWorkers={snapshot.hasMoreWorkers} />
      {inspected && (
        <OrchestraDagDetails
          key={inspected.id}
          task={inspected}
          model={model}
          gates={snapshot.gates}
          observing={live}
          disabled={disabled || stale}
          call={call}
          onAction={onAction}
        />
      )}
    </div>
  )
}
