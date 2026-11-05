import { translate } from '@/i18n/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { orchestraReadError } from './orchestra-read-error'
import { readOrchestraRunSnapshot } from './orchestra-snapshot-reads'
import {
  ORCHESTRA_OBSERVATION_INTERVAL_MS,
  useOrchestraObservation
} from './use-orchestra-observation'
import {
  ORCHESTRA_ROW_LIMIT,
  parseOrchestraRuns,
  parseOrchestraWorkers,
  type OrchestraCall,
  type OrchestraRun,
  type OrchestraSnapshot
} from './orchestra-model'

type Operation = 'refresh' | 'poll' | 'runs' | 'workers'
type RequestState = {
  runs: OrchestraRun[]
  selected: string | null
  snapshot: OrchestraSnapshot | null
  runCursor: string | null
  busy: boolean
  pending: boolean
  mounted: boolean
  generation: number
  selectionVersion: number
  runsExpanded: boolean
  runsReadAt: number
}
const PAGE_SIZE = 100

function mergeRows<T>(rows: T[], incoming: T[], key: (row: T) => string): T[] {
  const byId = new Map(rows.map((row) => [key(row), row]))
  for (const row of incoming) {
    byId.set(key(row), row)
  }
  return [...byId.values()].slice(0, ORCHESTRA_ROW_LIMIT)
}

export function useOrchestraData(call: OrchestraCall) {
  const [live, setLive] = useState(true)
  const [runs, setRuns] = useState<OrchestraRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<OrchestraSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [runCursor, setRunCursor] = useState<string | null>(null)
  const state = useRef<RequestState>({
    runs: [],
    selected: null,
    snapshot: null,
    runCursor: null,
    busy: false,
    pending: false,
    mounted: false,
    generation: 0,
    selectionVersion: 0,
    runsExpanded: false,
    runsReadAt: 0
  })
  const latestRefresh = useRef<() => Promise<void>>(async () => {})

  const perform = useCallback(
    async (operation: Operation, generation: number, selectionVersion: number) => {
      const current = state.current
      const valid = () =>
        current.mounted &&
        current.generation === generation &&
        current.selectionVersion === selectionVersion
      let target = current.selected
      if (
        operation !== 'workers' &&
        (operation !== 'poll' || !current.runs.length || Date.now() - current.runsReadAt >= 30_000)
      ) {
        const page = parseOrchestraRuns(
          await call('orchestration.runList', {
            limit: PAGE_SIZE,
            ...(operation === 'runs' && current.runCursor ? { cursor: current.runCursor } : {})
          })
        )
        if (!valid()) {
          return
        }
        current.runsReadAt = Date.now()
        current.runs =
          operation === 'runs'
            ? mergeRows(current.runs, page.runs, (row) => row.id)
            : mergeRows(
                page.runs,
                current.runs.filter((run) => !page.runs.some((fresh) => fresh.id === run.id)),
                (row) => row.id
              )
        if (operation === 'runs' || !current.runsExpanded) {
          current.runCursor = page.nextCursor
        }
        if (operation === 'runs') {
          current.runsExpanded = true
        }
        setRuns(current.runs)
        setRunCursor(current.runCursor)
        if (!current.selected && current.runs.length) {
          current.selected = current.runs[0].id
          setSelectedRunId(current.selected)
        }
        target = current.selected
        if (operation === 'runs') {
          return
        }
      }
      if (!target) {
        return
      }
      const run = current.runs.find((candidate) => candidate.id === target)
      if (!run) {
        return
      }
      if (operation === 'workers') {
        const before = current.snapshot
        if (!before?.workerCursor || before.runId !== target) {
          return
        }
        const page = parseOrchestraWorkers(
          await call('orchestration.workerList', {
            run: target,
            limit: PAGE_SIZE,
            paginate: true,
            includeRemote: true,
            cursor: before.workerCursor
          })
        )
        if (!valid() || current.selected !== target) {
          return
        }
        if (page.workers.some((worker) => worker.runId !== target)) {
          throw new Error(
            translate(
              'orchestra.data.crossRunWorkers',
              'The server returned workers for a different run.'
            )
          )
        }
        current.snapshot = {
          ...before,
          workers: mergeRows(before.workers, page.workers, (row) => row.dispatchId),
          workerTotal: page.page?.total ?? before.workerTotal,
          hasMoreWorkers: page.page?.hasMore ?? false,
          workerCursor: page.page?.nextCursor ?? null,
          warnings: [
            ...new Set([
              ...before.warnings,
              ...(page.warnings ?? []),
              ...(page.partialHostErrors?.length
                ? [
                    translate(
                      'orchestra.data.partialHosts',
                      'Some execution hosts could not be observed.'
                    )
                  ]
                : [])
            ])
          ]
        }
        if (
          current.snapshot.workers.length >= ORCHESTRA_ROW_LIMIT &&
          current.snapshot.hasMoreWorkers
        ) {
          current.snapshot.hasMoreWorkers = false
          current.snapshot.warnings.push(
            translate(
              'orchestra.data.workerLimit',
              'The display limit of {{limit}} Workers has been reached.',
              { limit: ORCHESTRA_ROW_LIMIT }
            )
          )
        }
        setSnapshot(current.snapshot)
        return
      }
      const observation = await readOrchestraRunSnapshot(
        call,
        run,
        current.snapshot?.workers.length
      )
      if (!valid() || current.selected !== target) {
        return
      }
      current.snapshot = observation
      setSnapshot(current.snapshot)
      setRefreshedAt(Date.now())
    },
    [call]
  )

  const request = useCallback(
    async (operation: Operation = 'refresh'): Promise<void> => {
      const current = state.current
      if (!current.mounted) {
        return
      }
      if (current.busy) {
        if (operation === 'refresh') {
          current.pending = true
        }
        return
      }
      current.busy = true
      setLoading(true)
      const generation = current.generation
      const selectionVersion = current.selectionVersion
      current.pending = false
      try {
        await perform(operation, generation, selectionVersion)
        if (
          current.mounted &&
          current.generation === generation &&
          current.selectionVersion === selectionVersion
        ) {
          setError(null)
        }
      } catch (failure) {
        if (
          current.mounted &&
          current.generation === generation &&
          current.selectionVersion === selectionVersion
        ) {
          setError(orchestraReadError(failure))
        }
      } finally {
        current.busy = false
        if (current.mounted) {
          setLoading(false)
          if (current.pending) {
            void latestRefresh.current()
          }
        }
      }
    },
    [perform]
  )

  const refresh = useCallback(() => request('refresh'), [request])
  const poll = useCallback(() => request('poll'), [request])
  const observing = useOrchestraObservation(poll, live)
  const selectRun = useCallback(
    (id: string) => {
      if (state.current.selected === id) {
        return
      }
      state.current.selectionVersion++
      state.current.selected = id
      state.current.snapshot = null
      setSelectedRunId(id)
      setSnapshot(null)
      setRefreshedAt(null)
      setError(null)
      void refresh()
    },
    [refresh]
  )

  useEffect(() => {
    latestRefresh.current = refresh
    const current = state.current
    current.mounted = true
    current.generation++
    void refresh()
    return () => {
      current.mounted = false
      current.generation++
    }
  }, [refresh])

  return {
    live,
    setLive,
    observing,
    refreshMs: ORCHESTRA_OBSERVATION_INTERVAL_MS,
    runs,
    selectedRunId,
    selectRun,
    snapshot,
    loading,
    error,
    refreshedAt,
    refresh,
    hasMoreRuns: runCursor !== null && runs.length < ORCHESTRA_ROW_LIMIT,
    runsLimited: runCursor !== null && runs.length >= ORCHESTRA_ROW_LIMIT,
    loadMoreRuns: () => request('runs'),
    loadMoreWorkers: () => request('workers')
  }
}
