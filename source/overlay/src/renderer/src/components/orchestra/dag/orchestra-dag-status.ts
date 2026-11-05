import { translate } from '@/i18n/i18n'
import type { OrchestraTask, OrchestraWorker } from '../orchestra-model'
import { orchestraLivenessLabel } from '../OrchestraWorkerOutput'

export function dagTaskStatus(status: OrchestraTask['status']): string {
  switch (status) {
    case 'pending':
      return translate('orchestra.tasks.statusPending', 'Pending')
    case 'blocked':
      return translate('orchestra.tasks.statusBlocked', 'Blocked')
    case 'ready':
      return translate('orchestra.tasks.statusReady', 'Ready')
    case 'dispatched':
      return translate('orchestra.tasks.statusDispatched', 'Dispatched')
    case 'completed':
      return translate('orchestra.tasks.statusCompleted', 'Completed')
    case 'failed':
      return translate('orchestra.tasks.statusFailed', 'Failed')
  }
}

export function dagAgentActivity(worker: OrchestraWorker): string {
  if (worker.projection?.evidence?.liveStatus !== 'fresh') {
    return translate('orchestra.dag.activityUnknown', 'Activity unverified')
  }
  switch (worker.projection?.stage.activity) {
    case 'working':
      return translate('orchestra.dag.working', 'Working')
    case 'blocked':
      return translate('orchestra.dag.blocked', 'Needs attention')
    case 'waiting':
      return translate('orchestra.dag.waiting', 'Waiting')
    case 'done':
      return translate('orchestra.dag.done', 'Agent turn finished')
    default:
      return translate('orchestra.dag.activityUnknown', 'Activity unverified')
  }
}

export function dagWorkerIsActive(
  worker: OrchestraWorker | undefined,
  observing: boolean
): boolean {
  return Boolean(
    observing &&
    worker?.projection?.liveness.verdict === 'live' &&
    worker.projection.evidence?.liveStatus === 'fresh' &&
    worker.projection.stage.activity === 'working'
  )
}

const HOST_CONTACT_LOST = new Set(['host_unavailable', 'peer_changed'])

/** Agent liveness as observed now: a proven exit stays exited; lost contact is never an exit. */
export function dagLivenessLabel(worker: OrchestraWorker, observing: boolean): string {
  const liveness = worker.projection?.liveness
  if (liveness?.verdict === 'exited') {
    return orchestraLivenessLabel('exited')
  }
  if (liveness?.verdict === 'unverifiable' && HOST_CONTACT_LOST.has(liveness.reason ?? '')) {
    return translate('orchestra.dag.hostUnreachable', 'Host unreachable · not proof of exit')
  }
  return orchestraLivenessLabel(
    observing && worker.projection?.evidence?.liveStatus === 'fresh' && liveness
      ? liveness.verdict
      : 'unverifiable'
  )
}
