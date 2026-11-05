import {
  parseOrchestraSnapshot,
  parseOrchestraWorkers,
  ORCHESTRA_ROW_LIMIT,
  type OrchestraCall,
  type OrchestraRun,
  type OrchestraSnapshot
} from './orchestra-model'
import { translate } from '@/i18n/i18n'

export async function readOrchestraRunSnapshot(
  call: OrchestraCall,
  run: OrchestraRun,
  loadedWorkerCount = 100
): Promise<OrchestraSnapshot> {
  // Settle all reads so a failed sibling cannot overlap the next observation cycle.
  const responses = await Promise.allSettled([
    call('orchestration.taskList', { run: run.id }),
    call('orchestration.gateList', { run: run.id }),
    call('orchestration.workerList', {
      run: run.id,
      limit: 100,
      paginate: true,
      includeRemote: true
    })
  ])
  const values = responses.map((response) => {
    if (response.status === 'rejected') {
      throw response.reason
    }
    return response.value
  })
  const workers = parseOrchestraWorkers(values[2])
  const wanted = Math.min(ORCHESTRA_ROW_LIMIT, Math.max(100, loadedWorkerCount))
  const seen = new Set<string>()
  while (workers.workers.length < wanted && workers.page?.hasMore && workers.page.nextCursor) {
    const cursor = workers.page.nextCursor
    if (seen.has(cursor) || seen.size >= 4) {
      throw new Error(
        translate(
          'orchestra.observe.invalidWorkerPage',
          'Worker pagination did not converge. The previous snapshot is preserved.'
        )
      )
    }
    seen.add(cursor)
    const next = parseOrchestraWorkers(
      await call('orchestration.workerList', {
        run: run.id,
        limit: 100,
        paginate: true,
        includeRemote: true,
        cursor
      })
    )
    workers.workers.push(...next.workers)
    workers.warnings = [...(workers.warnings ?? []), ...(next.warnings ?? [])]
    workers.partialHostErrors = [
      ...(workers.partialHostErrors ?? []),
      ...(next.partialHostErrors ?? [])
    ]
    workers.page = next.page
  }
  return parseOrchestraSnapshot(run, values[0], values[1], workers)
}
