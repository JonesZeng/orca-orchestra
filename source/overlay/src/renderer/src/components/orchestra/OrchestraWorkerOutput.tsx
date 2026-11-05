import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { parseWorkerOutput, type OrchestraCall } from './orchestra-model'
import { translate } from '@/i18n/i18n'
import { useOrchestraObservation } from './use-orchestra-observation'

type OutputSource = 'auto' | 'terminal' | 'transcript'

export function orchestraLivenessLabel(verdict: 'live' | 'unverifiable' | 'exited'): string {
  switch (verdict) {
    case 'live':
      return translate('orchestra.worker.liveness.live', 'Observed live (live)')
    case 'unverifiable':
      return translate('orchestra.worker.liveness.unverifiable', 'Cannot verify (unverifiable)')
    case 'exited':
      return translate('orchestra.worker.liveness.exited', 'Exit confirmed (exited)')
  }
}

export function OrchestraWorkerOutput({
  call,
  dispatchId,
  live = false
}: {
  call: OrchestraCall
  dispatchId: string | null
  live?: boolean
}): React.JSX.Element {
  useTranslation()
  const [source, setSource] = useState<OutputSource>('auto')
  return (
    <section
      className="flex min-h-96 min-w-0 flex-col rounded-xl border border-border bg-card text-card-foreground"
      aria-label={translate('orchestra.output.region', 'Worker output')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="size-4" aria-hidden />
          {translate('orchestra.output.title', 'Execution output')}
        </h3>
        <Select
          value={source}
          onValueChange={(value) => {
            if (value === 'auto' || value === 'terminal' || value === 'transcript') {
              setSource(value)
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={translate('orchestra.output.source', 'Output source')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {translate('orchestra.output.sourceAuto', 'Choose automatically')}
            </SelectItem>
            <SelectItem value="transcript">
              {translate('orchestra.output.sourceTranscript', 'Session transcript')}
            </SelectItem>
            <SelectItem value="terminal">
              {translate('orchestra.output.sourceTerminal', 'Terminal snapshot')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <OutputSnapshot
        key={`${dispatchId}:${source}`}
        call={call}
        dispatchId={dispatchId}
        source={source}
        live={live}
      />
    </section>
  )
}

function OutputSnapshot({
  call,
  dispatchId,
  source,
  live
}: {
  call: OrchestraCall
  dispatchId: string | null
  source: OutputSource
  live: boolean
}): React.JSX.Element {
  useTranslation()
  const [output, setOutput] = useState<ReturnType<typeof parseWorkerOutput> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const read = useCallback(async (): Promise<void> => {
    if (!dispatchId || pending.current) {
      return
    }
    const version = generation.current
    pending.current = true
    setLoading(true)
    try {
      const result = parseWorkerOutput(
        await call('orchestration.workerRead', {
          dispatch: dispatchId,
          source,
          limit: 200
        })
      )
      if (result.dispatchId !== dispatchId) {
        throw new Error(
          translate(
            'orchestra.output.wrongDispatch',
            'The runtime returned output for a different Dispatch.'
          )
        )
      }
      if (generation.current === version) {
        setOutput(result)
        setError(null)
      }
    } catch (cause) {
      if (generation.current === version) {
        setError(
          cause instanceof Error
            ? cause.message
            : translate('orchestra.output.readFailed', 'Could not read output')
        )
      }
    } finally {
      if (generation.current === version) {
        pending.current = false
        setLoading(false)
      }
    }
  }, [call, dispatchId, source])
  const observing = useOrchestraObservation(read, live && dispatchId !== null)
  useEffect(() => {
    const version = generation.current
    void read()
    return () => {
      generation.current = version + 1
      pending.current = false
    }
  }, [read])
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-xs text-muted-foreground">
        <span className="break-all">
          {dispatchId
            ? [
                dispatchId,
                output?.agentLiveness &&
                  translate('orchestra.output.agentLiveness', 'Agent: {{liveness}}', {
                    liveness: orchestraLivenessLabel(output.agentLiveness)
                  }),
                output?.liveness &&
                  translate('orchestra.output.terminalLiveness', 'Terminal: {{liveness}}', {
                    liveness: orchestraLivenessLabel(output.liveness)
                  })
              ]
                .filter(Boolean)
                .join(' · ')
            : translate('orchestra.output.selectWorker', 'Select a worker from the list')}
        </span>
        {observing && (
          <span>{translate('orchestra.output.livePoll', 'Observing every 3 seconds')}</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!dispatchId || loading}
          onClick={() => void read()}
        >
          {loading ? <LoadingSpinner /> : <RefreshCw />}
          {translate('orchestra.output.refresh', 'Read latest')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-4 pb-4 text-xs text-destructive">
          {translate(
            'orchestra.output.staleError',
            'Read failed; existing output may be stale. {{error}}',
            { error }
          )}
        </p>
      )}
      {output && (
        <>
          <pre className="max-h-[36rem] flex-1 overflow-auto whitespace-pre-wrap break-words bg-editor-surface p-4 font-mono text-xs leading-6 scrollbar-editor">
            {output.text || translate('orchestra.output.emptyPage', 'This page has no output.')}
          </pre>
          <div className="space-y-1 border-t border-border p-4 text-xs text-muted-foreground">
            <p>
              {output.source === 'terminal'
                ? translate(
                    'orchestra.output.terminalReadOnly',
                    'Read-only terminal snapshot. Each read is limited to 200 entries and writes nothing to the terminal.'
                  )
                : translate(
                    'orchestra.output.transcriptReadOnly',
                    'Read-only session transcript. Each read is limited to 200 entries and writes nothing to the terminal.'
                  )}
            </p>
            {output.clipped && (
              <p>
                {translate(
                  'orchestra.output.clipped',
                  'Content is truncated; this is not a complete execution record.'
                )}
              </p>
            )}
            {[...new Set(output.warnings)].map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </>
      )}
      {!output && !loading && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {translate(
            'orchestra.output.empty',
            'Select a worker to view output returned by its host.'
          )}
        </div>
      )}
      {loading && !output && (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          {translate('orchestra.output.loading', 'Reading from the execution host…')}
        </p>
      )}
    </>
  )
}
