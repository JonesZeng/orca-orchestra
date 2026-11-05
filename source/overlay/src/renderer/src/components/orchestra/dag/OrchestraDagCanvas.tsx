import { useId, type KeyboardEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { OrchestraDagNode } from './OrchestraDagNode'
import { dagWorkerIsActive } from './orchestra-dag-status'
import { representativeAttempt, type OrchestraDagModel } from './use-orchestra-dag-model'

type Props = {
  model: OrchestraDagModel
  scrollRef: RefObject<HTMLDivElement | null>
  viewport: { width: number; height: number }
  scale: number
  selectedId: string | undefined
  live: boolean
  onSelect: (taskId: string) => void
}

/** Nearest neighbor by row, so Left/Right follow edges instead of jumping across the column. */
function nearest(model: OrchestraDagModel, from: string, candidates: readonly string[]) {
  const row = model.slots.get(from)?.row ?? 0
  let best: string | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const id of candidates) {
    const next = Math.abs((model.slots.get(id)?.row ?? 0) - row)
    if (next < distance) {
      best = id
      distance = next
    }
  }
  return best
}

export function nextDagTask(
  model: OrchestraDagModel,
  from: string,
  key: string
): string | undefined {
  const slot = model.slots.get(from)
  if (!slot) {
    return undefined
  }
  const column = model.columns[slot.layer] ?? []
  switch (key) {
    case 'ArrowUp':
      return column[slot.row - 1]
    case 'ArrowDown':
      return column[slot.row + 1]
    case 'ArrowRight':
      return nearest(model, from, model.dependents.get(from) ?? model.columns[slot.layer + 1] ?? [])
    case 'ArrowLeft':
      return nearest(
        model,
        from,
        model.dependencies.get(from) ?? model.columns[slot.layer - 1] ?? []
      )
    case 'Home':
      return model.columns[0]?.[0]
    case 'End':
      return model.columns.at(-1)?.at(-1)
    default:
      return undefined
  }
}

export function OrchestraDagCanvas({
  model,
  scrollRef,
  viewport,
  scale,
  selectedId,
  live,
  onSelect
}: Props): React.JSX.Element {
  useTranslation()
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { layout } = model
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const from =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId
        : undefined
    const next = from ? nextDagTask(model, from, event.key) : undefined
    if (!next) {
      return
    }
    event.preventDefault()
    onSelect(next)
    // Focus scrolls the node into view inside the scaled canvas.
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(next)}"]`)
      ?.focus({ preventScroll: false })
  }
  return (
    <div
      ref={scrollRef}
      className="orchestra-dag-canvas h-[29rem] overflow-auto scrollbar-sleek max-sm:h-[22rem]"
      role="region"
      aria-label={translate(
        'orchestra.dag.canvas',
        'Graph canvas. Scroll to pan; arrow keys move between tasks and their dependencies.'
      )}
      onKeyDown={onKeyDown}
    >
      <div
        className="relative"
        style={{
          width: Math.max(viewport.width - 4, layout.width * scale),
          height: Math.max(viewport.height - 4, layout.height * scale)
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            left: Math.max(0, (viewport.width - layout.width * scale) / 2),
            top: Math.max(0, (viewport.height - layout.height * scale) / 2),
            transform: `scale(${scale})`
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 text-muted-foreground"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const target = model.tasks.get(edge.target)
              const active =
                target?.status === 'dispatched' && target.dispatch_id
                  ? dagWorkerIsActive(model.workers.get(target.dispatch_id), live)
                  : false
              const touched = edge.target === selectedId || edge.source === selectedId
              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  markerEnd={`url(#${markerId})`}
                  stroke="currentColor"
                  strokeWidth={touched ? 2.5 : 1.5}
                  className={cn(
                    'orchestra-dag-edge',
                    active && !edge.unresolved && 'orchestra-dag-flow text-foreground',
                    edge.unresolved && 'orchestra-dag-unresolved',
                    touched && 'text-foreground'
                  )}
                />
              )
            })}
          </svg>
          {layout.nodes.map((node) => {
            const attempt = representativeAttempt(node.task, model)
            return (
              <OrchestraDagNode
                key={node.task.id}
                task={node.task}
                worker={attempt.worker}
                current={attempt.current}
                attemptCount={model.attempts.get(node.task.id)?.length ?? 0}
                x={node.x}
                y={node.y}
                selected={selectedId === node.task.id}
                unresolved={node.unresolved}
                pendingGates={model.pendingGates.get(node.task.id) ?? 0}
                observing={live}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
