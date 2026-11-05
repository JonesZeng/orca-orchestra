import { z } from 'zod'
import { translate } from '@/i18n/i18n'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
import type { WebRuntimeCallOptions } from '../../../web/web-runtime-request-registry'
import {
  LOCAL_ORCHESTRA_TARGET,
  orchestraTargetRequest,
  type OrchestraTarget
} from './orchestra-plugin-targets'
import type { OrcaPanelFrame } from './orca-panel-frame'

/** The handler examples/plugins/orchestra/worker/main.mjs registers. */
const ORCHESTRA_CALL = 'orchestra.call'
const DEFAULT_TIMEOUT_MS = 20_000
// plugin.request gives up after 120 s; leave the worker time to answer its own timeout first.
const BRIDGE_GRACE_MS = 5_000
const BRIDGE_MAX_TIMEOUT_MS = 120_000

const WorkerAnswer = z.object({
  output: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), result: z.unknown() }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() })
    })
  ])
})

function bridgeFailure(error: unknown): Error {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code ?? '') : ''
  switch (code) {
    case 'unknown_method':
      return new Error(
        translate(
          'orchestra.pluginFrame.updateOrca',
          "This Orca cannot run the Orchestra plugin's worker. Update Orca to 1.4.246 or newer."
        )
      )
    case 'consent_required':
      return new Error(
        translate(
          'orchestra.pluginFrame.approve',
          'Approve the Orchestra plugin in Settings → Plugins, then reopen this panel.'
        )
      )
    case 'rate_limited':
      return new Error(
        translate(
          'orchestra.pluginFrame.paced',
          'Orca is pacing this panel. The last snapshot is kept.'
        )
      )
    default:
      return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * A runtime client for the shared Orchestra call adapter that reaches Orca through this plugin's
 * own worker, which holds the runtime connection. Runtime refusals arrive as failed responses;
 * a bridge or worker failure rejects, so writes keep their request id for receipt inspection.
 */
export function createOrchestraPluginRuntimeClient(
  frame: OrcaPanelFrame,
  target: OrchestraTarget = LOCAL_ORCHESTRA_TARGET
): {
  connectionEpoch: number
  call(
    method: string,
    params?: unknown,
    options?: WebRuntimeCallOptions
  ): Promise<RuntimeRpcResponse<unknown>>
} {
  return {
    // Each worker call opens its own runtime connection; there is no session to be replaced.
    connectionEpoch: 0,
    async call(method, params, options) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let answer: unknown
      try {
        answer = await frame.host.call(
          'plugin.request',
          {
            name: ORCHESTRA_CALL,
            input: {
              method,
              ...(params === undefined ? {} : { params }),
              timeoutMs,
              target: orchestraTargetRequest(target),
              ...(options?.orchestration ? { orchestration: options.orchestration } : {})
            },
            timeoutMs: Math.min(timeoutMs + BRIDGE_GRACE_MS, BRIDGE_MAX_TIMEOUT_MS)
          },
          { signal: options?.signal }
        )
      } catch (error) {
        throw bridgeFailure(error)
      }
      const { output } = WorkerAnswer.parse(answer)
      return output.ok
        ? { id: ORCHESTRA_CALL, ok: true, result: output.result, _meta: { runtimeId: '' } }
        : { id: ORCHESTRA_CALL, ok: false, error: output.error }
    }
  }
}
