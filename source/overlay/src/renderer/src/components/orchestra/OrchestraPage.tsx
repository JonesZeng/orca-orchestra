import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { useEffect, useRef, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { OrchestraConfirmation } from './OrchestraConfirmation'
import { OrchestraObservationControls } from './OrchestraObservationControls'
import { useOrchestraData } from './use-orchestra-data'
import type { OrchestraCall } from './orchestra-model'
import { OrchestraActionSheet } from './OrchestraActionSheet'
import {
  orchestraActionCopy,
  type OrchestraActionRequest,
  type OrchestraMutationDraft
} from './orchestra-actions'
import { OrchestraRunSidebar } from './OrchestraRunSidebar'
import { OrchestraRunContent } from './OrchestraRunContent'
import { OrchestraOperationStatus } from './OrchestraOperationStatus'
import { orchestraDraftRefusal, recheckOrchestraDraft } from './orchestra-mutation-preflight'

export default function OrchestraPage({ call }: { call: OrchestraCall }): React.JSX.Element {
  useTranslation()
  const data = useOrchestraData(call)
  const [coordinator, setCoordinator] = useState('')
  const [request, setRequest] = useState<OrchestraActionRequest | null>(null)
  const [draft, setDraft] = useState<OrchestraMutationDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [requestId, setRequestId] = useState('')
  const mutationLock = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = data.runs.find((entry) => entry.id === data.selectedRunId)
  const snapshot = data.snapshot?.runId === data.selectedRunId ? data.snapshot : null
  const readOnly = run?.legacy === 1 || snapshot?.legacyReadOnly === true
  const unavailable = Boolean(data.error) || !snapshot
  const disabled = busy || recoveryRequired || !coordinator.trim() || readOnly || unavailable
  const scope = useRef({
    runId: data.selectedRunId,
    coordinator,
    snapshot,
    unavailable: Boolean(data.error)
  })
  scope.current = {
    runId: data.selectedRunId,
    coordinator,
    snapshot,
    unavailable: Boolean(data.error)
  }

  function chooseRun(id: string): void {
    if (mutationLock.current) {
      return
    }
    setRequest(null)
    setDraft(null)
    setNotice(null)
    data.selectRun(id)
  }

  function changeCoordinator(value: string): void {
    if (mutationLock.current) {
      return
    }
    setCoordinator(value)
    setRequest(null)
    setDraft(null)
  }

  async function confirm(): Promise<void> {
    if (!draft || mutationLock.current || recoveryRequired) {
      return
    }
    if (draft.method !== 'orchestration.runCreate' && disabled) {
      return
    }
    mutationLock.current = true
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    let sent = false
    try {
      const refusal = await recheckOrchestraDraft(call, draft, scope.current)
      if (!alive.current) {
        return
      }
      const stale = refusal ?? orchestraDraftRefusal(draft, scope.current)
      if (stale) {
        setNotice(
          translate('orchestra.mutation.notSent', 'Operation not sent: {{reason}}', {
            reason: stale
          })
        )
        setDraft(null)
        setRequest(null)
        return
      }
      sent = true
      await call(draft.method, draft.params, true)
      if (!alive.current) {
        return
      }
      setNotice(
        translate('orchestra.mutation.confirmed', '{{action}}: the runtime reported success.', {
          action: draft.request ? orchestraActionCopy(draft.request).title : draft.label
        })
      )
      setDraft(null)
      setRequest(null)
      await data.refresh()
    } catch (cause) {
      if (!alive.current) {
        return
      }
      if (!sent) {
        setNotice(
          translate(
            'orchestra.mutation.preflightUnavailable',
            'Operation not sent: current state could not be verified. Refresh before trying again.'
          )
        )
        setDraft(null)
        setRequest(null)
        return
      }
      setMutationError(
        cause instanceof Error
          ? cause.message
          : translate('orchestra.mutation.unconfirmed', 'The request was not confirmed.')
      )
      setRecoveryRequired(true)
      setRequestId(
        typeof cause === 'object' &&
          cause !== null &&
          'requestId' in cause &&
          typeof cause.requestId === 'string'
          ? cause.requestId
          : ''
      )
      setDraft(null)
      setRequest(null)
    } finally {
      mutationLock.current = false
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-border bg-muted p-2">
            <Layers3 className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-semibold">{translate('orchestra.title', 'Orchestra')}</h1>
            <p className="text-xs text-muted-foreground">
              {translate('orchestra.subtitle', 'Coordinate \u00b7 Intervene \u00b7 Observe')}
            </p>
          </div>
        </div>
        <OrchestraObservationControls data={data} busy={busy} />
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <OrchestraRunSidebar
          data={data}
          coordinator={coordinator}
          busy={busy}
          recoveryRequired={recoveryRequired}
          onSelectRun={chooseRun}
          onCoordinatorChange={changeCoordinator}
          onCreateRun={() => setRequest({ kind: 'run' })}
        />
        <main className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
          <OrchestraOperationStatus
            error={data.error}
            runsLimited={data.runsLimited}
            mutationError={mutationError}
            requestId={requestId}
            call={call}
            loading={data.loading}
            busy={busy}
            notice={notice}
            onRefresh={() => void data.refresh()}
            onUnlock={() => {
              setRecoveryRequired(false)
              setMutationError(null)
            }}
          />
          <OrchestraRunContent
            data={data}
            coordinator={coordinator}
            disabled={disabled}
            call={call}
            onAction={setRequest}
          />
        </main>
      </div>
      <OrchestraActionSheet
        key={`${data.selectedRunId}:${coordinator}`}
        request={request}
        runId={data.selectedRunId}
        coordinator={coordinator.trim()}
        disabled={busy || recoveryRequired || Boolean(data.error)}
        onClose={() => setRequest(null)}
        onPreview={(next) => {
          setRequest(null)
          setDraft(next)
        }}
      />
      <OrchestraConfirmation
        draft={draft}
        busy={busy}
        disabled={recoveryRequired || Boolean(data.error)}
        coordinator={coordinator}
        runId={data.selectedRunId}
        onClose={() => setDraft(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  )
}
