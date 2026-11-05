import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { TooltipProvider } from '@/components/ui/tooltip'
import OrchestraPage from '../OrchestraPage'
import { createOrchestraRuntimeCall } from '../../../web/orchestra-runtime-call'
import { createOrchestraPluginRuntimeClient } from './orchestra-plugin-runtime-client'
import {
  LOCAL_ORCHESTRA_TARGET,
  orchestraTargetKey,
  parseOrchestraTargets,
  type OrchestraTarget
} from './orchestra-plugin-targets'
import type { OrcaPanelFrame } from './orca-panel-frame'

// Saved servers come from the worker's in-process read; no network is involved.
const TARGETS_TIMEOUT_MS = 5_000

function targetsWarningMessage(warning: string): string | null {
  switch (warning) {
    case 'savedServersUnreadable':
      return translate(
        'orchestra.pluginFrame.target.unreadable',
        'Saved servers could not be read. Restart Orca and reopen this panel.'
      )
    case 'runtimeNotFound':
      return translate(
        'orchestra.pluginFrame.target.runtimeNotFound',
        "Could not find this Orca's runtime. Restart Orca and retry."
      )
    case 'remoteUnavailable':
      return translate(
        'orchestra.pluginFrame.target.remoteUnavailable',
        'This plugin build cannot reach saved servers. Rebuild the plugin and reopen this panel.'
      )
    default:
      return null
  }
}

/** The Orchestra page in an Orca plugin panel, acting on this Orca or one saved paired server. */
export function OrchestraPluginFrame({ frame }: { frame: OrcaPanelFrame }): React.JSX.Element {
  useTranslation()
  const [targets, setTargets] = useState<OrchestraTarget[]>([LOCAL_ORCHESTRA_TARGET])
  const [selectedKey, setSelectedKey] = useState('local')
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      let output: unknown
      try {
        const answer = (await frame.host.call('plugin.request', {
          name: 'orchestra.targets',
          timeoutMs: TARGETS_TIMEOUT_MS
        })) as { output?: unknown }
        output = answer?.output
      } catch {
        // An older worker has no targets handler; the panel stays on this Orca.
        return
      }
      if (!alive) {
        return
      }
      const parsed = parseOrchestraTargets(output)
      setTargets(parsed.targets)
      setWarning(parsed.warning ? targetsWarningMessage(parsed.warning) : null)
      // A server removed in Orca while the panel was open falls back to this Orca.
      setSelectedKey((current) =>
        parsed.targets.some((entry) => orchestraTargetKey(entry) === current) ? current : 'local'
      )
    })()
    return () => {
      alive = false
    }
  }, [frame])

  const target = useMemo(
    () =>
      targets.find((entry) => orchestraTargetKey(entry) === selectedKey) ?? LOCAL_ORCHESTRA_TARGET,
    [selectedKey, targets]
  )
  const targetKey = orchestraTargetKey(target)
  // Same allowlist, contract envelope and receipt rules as the desktop window; the target is injected
  // into every worker request, and remounting on a switch clears runs, previews and confirmations.
  const call = useMemo(
    () => createOrchestraRuntimeCall(createOrchestraPluginRuntimeClient(frame, target)),
    [frame, target]
  )
  const hostLabel = translate('orchestra.pluginFrame.target.label', 'Host')
  const selectedName =
    target.kind === 'local'
      ? translate('orchestra.pluginFrame.target.local', 'This computer')
      : target.name

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          <label htmlFor="orchestra-target" className="font-medium text-foreground">
            {hostLabel}
          </label>
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger id="orchestra-target" className="h-7 w-56" aria-label={hostLabel}>
              <SelectValue>{selectedName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {targets.map((entry) => (
                <SelectItem key={orchestraTargetKey(entry)} value={orchestraTargetKey(entry)}>
                  {entry.kind === 'local'
                    ? translate('orchestra.pluginFrame.target.local', 'This computer')
                    : entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="min-w-0 flex-1 truncate">
            {translate('orchestra.pluginFrame.scope', 'Writes are previewed and confirmed')}
          </span>
        </header>
        {warning && (
          <p
            role="status"
            className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
          >
            {warning}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
          <OrchestraPage key={targetKey} call={call} />
        </div>
      </div>
    </TooltipProvider>
  )
}
