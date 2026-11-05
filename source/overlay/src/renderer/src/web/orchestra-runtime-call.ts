import { z } from 'zod'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  ORCHESTRATION_CONTRACT_VERSION
} from '../../../shared/orchestration-runtime-capabilities'
import type { WebRuntimeClient } from './web-runtime-client'

const Status = z.object({ capabilities: z.array(z.string()) })
// Why no workerShow: it recovers interrupted worker rows (a write) while answering.
const READ_METHODS = new Set([
  'orchestration.runList',
  'orchestration.runShow',
  'orchestration.taskList',
  'orchestration.workerList',
  'orchestration.workerRead',
  'orchestration.gateList',
  'orchestration.check',
  'orchestration.requestShow'
])
// Exactly the confirmed actions the UI offers; worker lifecycle stays in existing Orca workflows.
const WRITE_METHODS = new Set([
  'orchestration.runCreate',
  'orchestration.taskCreate',
  'orchestration.dispatch',
  'orchestration.send',
  'orchestration.gateResolve'
])

/** Durable ids make a lost reply inspectable; a transport failure is never retried here. */
export function createOrchestraRuntimeCall(
  client: Pick<WebRuntimeClient, 'call' | 'connectionEpoch'>,
  assertPairing: () => void = () => undefined
): (method: string, params?: unknown, mutation?: boolean) => Promise<unknown> {
  return async (method, params, mutation = false) => {
    const writes = isOrchestrationMutation(method, params)
    if (
      (writes && (!mutation || !WRITE_METHODS.has(method))) ||
      (!writes && !READ_METHODS.has(method) && method !== 'orchestration.dispatch')
    ) {
      throw new Error('This operation is not available in Orchestra.')
    }
    assertPairing()
    let expectedConnectionEpoch: number | undefined
    if (writes) {
      const probeEpoch = client.connectionEpoch
      const status = await client.call('status.get', undefined, { timeoutMs: 15_000 })
      if (!status.ok) {
        throw new Error(status.error.message)
      }
      if (probeEpoch !== client.connectionEpoch) {
        throw new Error('The runtime connection changed. Refresh before acting; nothing was sent.')
      }
      const parsed = Status.safeParse(status.result)
      if (
        !parsed.success ||
        !parsed.data.capabilities.includes(ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY)
      ) {
        throw new Error('This runtime needs an orchestration update. No operation was sent.')
      }
      expectedConnectionEpoch = probeEpoch
      assertPairing()
    }
    const requestId = writes ? createBrowserUuid() : undefined
    try {
      const response = await client.call(method, params, {
        timeoutMs: writes ? 60_000 : 20_000,
        expectedConnectionEpoch,
        ...(requestId
          ? { orchestration: { contractVersion: ORCHESTRATION_CONTRACT_VERSION, requestId } }
          : {})
      })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      assertPairing()
      return response.result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!requestId) {
        throw error
      }
      throw Object.assign(
        new Error(
          `${message}\nRequest ID: ${requestId}. Completion may be unknown. Inspect this request's receipt before submitting again; no automatic retry was made.`
        ),
        { requestId }
      )
    }
  }
}
