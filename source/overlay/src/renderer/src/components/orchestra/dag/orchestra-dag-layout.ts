import type { OrchestraTask } from '../orchestra-model'

export const NODE_WIDTH = 260
export const NODE_HEIGHT = 180
const COLUMN_GAP = 90
const ROW_GAP = 32
const PADDING = 32
const TASK_LIMIT = 500

export type OrchestraDagNode = {
  task: OrchestraTask
  x: number
  y: number
  layer: number
  unresolved: boolean
}

export type OrchestraDagEdge = {
  id: string
  source: string
  target: string
  path: string
  unresolved: boolean
}

export type OrchestraDagLayout = {
  nodes: OrchestraDagNode[]
  edges: OrchestraDagEdge[]
  width: number
  height: number
  missingDependencies: string[]
  unresolvedTaskIds: string[]
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

const ORDERING_SWEEPS = 4

/** Deterministic barycenter sweeps: fewer crossings without moving nodes between layers. */
function orderRanks(
  ranks: Map<number, string[]>,
  dependencies: ReadonlyMap<string, readonly string[]>,
  children: ReadonlyMap<string, readonly string[]>
): void {
  const layers = [...ranks.keys()].sort((a, b) => a - b)
  const position = new Map<string, number>()
  const remember = (rank: readonly string[]): void =>
    rank.forEach((id, index) => position.set(id, index))
  layers.forEach((layer) => remember(ranks.get(layer) ?? []))
  const reorder = (layer: number, neighbors: ReadonlyMap<string, readonly string[]>): void => {
    const rank = ranks.get(layer) ?? []
    const weight = new Map<string, number>()
    for (const id of rank) {
      const placed = (neighbors.get(id) ?? []).flatMap((other) => {
        const index = position.get(other)
        return index === undefined || other === id ? [] : [index]
      })
      // Nodes without placed neighbors keep their current slot.
      weight.set(
        id,
        placed.length
          ? placed.reduce((sum, index) => sum + index, 0) / placed.length
          : (position.get(id) ?? 0)
      )
    }
    // Array.prototype.sort is stable, so equal weights keep the previous deterministic order.
    rank.sort((left, right) => (weight.get(left) ?? 0) - (weight.get(right) ?? 0))
    remember(rank)
  }
  for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep++) {
    const downward = sweep % 2 === 0
    const order = downward ? layers.slice(1) : layers.slice(0, -1).toReversed()
    for (const layer of order) {
      reorder(layer, downward ? dependencies : children)
    }
  }
}

function edgePath(source: OrchestraDagNode, target: OrchestraDagNode): string {
  const sx = source.x + NODE_WIDTH
  const sy = source.y + NODE_HEIGHT / 2
  const tx = target.x
  const ty = target.y + NODE_HEIGHT / 2
  if (source.task.id === target.task.id) {
    const above = source.y - 24
    return `M ${sx} ${sy} C ${sx + 24} ${above} ${tx - 24} ${above} ${tx} ${ty}`
  }
  const bend = tx > sx ? (tx - sx) / 2 : 24
  return `M ${sx} ${sy} C ${sx + bend} ${sy} ${tx - bend} ${ty} ${tx} ${ty}`
}

export function buildOrchestraDagLayout(tasks: readonly OrchestraTask[]): OrchestraDagLayout {
  const byId = new Map(tasks.slice(0, TASK_LIMIT).map((task) => [task.id, task]))
  const ids = [...byId.keys()].sort(compareIds)
  const dependencies = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  const indegrees = new Map<string, number>()
  const layers = new Map<string, number>()
  const missing = new Set<string>()
  const incomplete = new Set<string>()
  for (const id of ids) {
    const task = byId.get(id)
    if (!task) {
      continue
    }
    const known: string[] = []
    for (const dep of [...new Set(task.deps)].sort(compareIds)) {
      if (!byId.has(dep)) {
        missing.add(dep)
        incomplete.add(id)
        continue
      }
      known.push(dep)
      const dependents = children.get(dep) ?? []
      dependents.push(id)
      children.set(dep, dependents)
    }
    dependencies.set(id, known)
    indegrees.set(id, known.length)
    layers.set(id, 0)
  }

  const queue = ids.filter((id) => indegrees.get(id) === 0)
  const visited = new Set<string>()
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    visited.add(id)
    for (const child of children.get(id) ?? []) {
      layers.set(child, Math.max(layers.get(child) ?? 0, (layers.get(id) ?? 0) + 1))
      if (incomplete.has(id)) {
        incomplete.add(child)
      }
      const remaining = (indegrees.get(child) ?? 1) - 1
      indegrees.set(child, remaining)
      if (remaining === 0) {
        queue.push(child)
      }
    }
  }

  // Cycles and their downstream nodes stay visible without pretending to have a DAG ordering.
  const unresolvedTaskIds = ids.filter((id) => !visited.has(id))
  const unresolvedLayer = Math.max(-1, ...[...visited].map((id) => layers.get(id) ?? 0)) + 1
  for (const id of unresolvedTaskIds) {
    layers.set(id, unresolvedLayer)
    incomplete.add(id)
  }
  const ranks = new Map<number, string[]>()
  for (const id of ids) {
    const layer = layers.get(id) ?? 0
    const rank = ranks.get(layer) ?? []
    rank.push(id)
    ranks.set(layer, rank)
  }
  orderRanks(ranks, dependencies, children)
  const rowCount = Math.max(1, ...[...ranks.values()].map((rank) => rank.length))
  const height = rowCount * NODE_HEIGHT + (rowCount - 1) * ROW_GAP + PADDING * 2
  const nodes: OrchestraDagNode[] = []
  for (const layer of [...ranks.keys()].sort((a, b) => a - b)) {
    const rank = ranks.get(layer) ?? []
    const rankHeight = rank.length * NODE_HEIGHT + (rank.length - 1) * ROW_GAP
    const top = (height - rankHeight) / 2
    for (const [row, id] of rank.entries()) {
      const task = byId.get(id)
      if (task) {
        nodes.push({
          task,
          x: PADDING + layer * (NODE_WIDTH + COLUMN_GAP),
          y: top + row * (NODE_HEIGHT + ROW_GAP),
          layer,
          unresolved: incomplete.has(id)
        })
      }
    }
  }
  const nodesById = new Map(nodes.map((node) => [node.task.id, node]))
  const edges: OrchestraDagEdge[] = []
  for (const target of nodes) {
    for (const sourceId of dependencies.get(target.task.id) ?? []) {
      const source = nodesById.get(sourceId)
      if (source) {
        edges.push({
          id: JSON.stringify([sourceId, target.task.id]),
          source: sourceId,
          target: target.task.id,
          path: edgePath(source, target),
          unresolved: source.unresolved || target.unresolved
        })
      }
    }
  }
  return {
    nodes,
    edges,
    width:
      Math.max(1, ranks.size) * NODE_WIDTH + Math.max(0, ranks.size - 1) * COLUMN_GAP + PADDING * 2,
    height,
    missingDependencies: [...missing].sort(compareIds),
    unresolvedTaskIds
  }
}
