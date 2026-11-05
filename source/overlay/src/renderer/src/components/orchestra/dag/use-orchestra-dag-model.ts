import { useEffect, useMemo, useState } from 'react'
import type { OrchestraSnapshot, OrchestraTask, OrchestraWorker } from '../orchestra-model'
import { buildOrchestraDagLayout, type OrchestraDagLayout } from './orchestra-dag-layout'

export type OrchestraDagModel = {
  layout: OrchestraDagLayout
  tasks: ReadonlyMap<string, OrchestraTask>
  workers: ReadonlyMap<string, OrchestraWorker>
  /** Loaded dispatch attempts per task, in the order the runtime listed them. */
  attempts: ReadonlyMap<string, readonly OrchestraWorker[]>
  pendingGates: ReadonlyMap<string, number>
  /** Task ids per layer, top to bottom, for arrow-key navigation. */
  columns: readonly (readonly string[])[]
  slots: ReadonlyMap<string, { layer: number; row: number }>
  dependents: ReadonlyMap<string, readonly string[]>
  dependencies: ReadonlyMap<string, readonly string[]>
}

function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    list.push(value)
  } else {
    map.set(key, [value])
  }
}

/** Derive every per-snapshot index once instead of on each render of a 500-node graph. */
export function useOrchestraDagModel(snapshot: OrchestraSnapshot): OrchestraDagModel {
  const layout = useMemo(() => buildOrchestraDagLayout(snapshot.tasks), [snapshot.tasks])
  const indexes = useMemo(() => {
    const attempts = new Map<string, OrchestraWorker[]>()
    for (const worker of snapshot.workers) {
      appendTo(attempts, worker.taskId, worker)
    }
    const pendingGates = new Map<string, number>()
    for (const gate of snapshot.gates) {
      if (gate.status === 'pending') {
        pendingGates.set(gate.task_id, (pendingGates.get(gate.task_id) ?? 0) + 1)
      }
    }
    return {
      tasks: new Map(snapshot.tasks.map((task) => [task.id, task])),
      workers: new Map(snapshot.workers.map((worker) => [worker.dispatchId, worker])),
      attempts,
      pendingGates
    }
  }, [snapshot.tasks, snapshot.workers, snapshot.gates])
  const navigation = useMemo(() => {
    const byLayer = new Map<number, { id: string; y: number }[]>()
    for (const node of layout.nodes) {
      appendTo(byLayer, node.layer, { id: node.task.id, y: node.y })
    }
    const columns = [...byLayer.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, nodes]) => nodes.sort((a, b) => a.y - b.y).map((node) => node.id))
    const slots = new Map<string, { layer: number; row: number }>()
    columns.forEach((column, layer) => column.forEach((id, row) => slots.set(id, { layer, row })))
    const dependents = new Map<string, string[]>()
    const dependencies = new Map<string, string[]>()
    for (const edge of layout.edges) {
      appendTo(dependents, edge.source, edge.target)
      appendTo(dependencies, edge.target, edge.source)
    }
    return { columns, slots, dependents, dependencies }
  }, [layout])
  return { layout, ...indexes, ...navigation }
}

/** The attempt a node represents: the task's current dispatch, else the last loaded attempt. */
export function representativeAttempt(
  task: OrchestraTask,
  model: Pick<OrchestraDagModel, 'workers' | 'attempts'>
): { worker: OrchestraWorker | undefined; current: boolean } {
  const current = task.dispatch_id ? model.workers.get(task.dispatch_id) : undefined
  if (current) {
    return { worker: current, current: true }
  }
  return { worker: model.attempts.get(task.id)?.at(-1), current: false }
}

/** Flip to stale once, at the deadline, instead of re-rendering the graph every second. */
export function useSnapshotStale(
  refreshedAt: number | null,
  unavailable: boolean,
  thresholdMs: number
): boolean {
  const [expiredAt, setExpiredAt] = useState<number | null>(null)
  useEffect(() => {
    if (refreshedAt === null) {
      return
    }
    const remaining = refreshedAt + thresholdMs - Date.now()
    const timer = window.setTimeout(() => setExpiredAt(refreshedAt), Math.max(0, remaining))
    return () => window.clearTimeout(timer)
  }, [refreshedAt, thresholdMs])
  return unavailable || refreshedAt === null || expiredAt === refreshedAt
}

/** Keep selection highlight immediate while expensive inspector reads wait for the user to settle. */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
