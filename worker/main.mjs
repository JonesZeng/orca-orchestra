import { dirname } from 'node:path'
import { admitOrchestraCall, shapeOrchestraResult } from './orchestra-gateway.mjs'
import { createRemoteTargets } from './remote-targets.mjs'
import { locateRuntime } from './runtime-endpoint.mjs'
import { runtimeRequest } from './runtime-request.mjs'

const PLUGIN_DIR = dirname(import.meta.dirname)
const LOCAL_TARGET = Object.freeze({ kind: 'local', id: 'local' })

/** `code` is a plugin host error code, which `plugin.request` hands to the panel unchanged. */
function panelError(code, message) {
  return Object.assign(new Error(message), { code })
}

function preflightKey(panel) {
  const id = panel?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Writes are confirmed against one target; a local confirmation never authorizes a server write. */
function targetKey(target) {
  return target.kind === 'local' ? 'local' : `environment:${target.id}`
}

function responseRuntimeId(response) {
  const meta = typeof response === 'object' && response !== null ? response._meta : null
  return meta && typeof meta.runtimeId === 'string' && meta.runtimeId.length > 0
    ? meta.runtimeId
    : null
}

/**
 * Answers the panel's `orchestra.call` requests against this Orca's runtime or one saved paired
 * server. A runtime refusal comes back as `{ ok: false, error }`, like every other Orca client
 * sees it; only transport problems reject. The target is pinned per request: a local confirmation
 * never authorizes a server write, and a confirmed write is never retried automatically.
 */
export function createOrchestraCallHandler({ locate, request, remote }) {
  let located = null
  // `${panelId}\0${targetKey}` -> runtimeId the panel confirmed with status.get.
  const preflights = new Map()

  async function locateTarget() {
    if (!located) {
      located = await locate()
    }
    if (!located) {
      throw panelError('unavailable', "Could not find this Orca's runtime. Restart Orca and retry.")
    }
    return located
  }

  async function refreshSameRuntime(target) {
    located = null
    let next
    try {
      next = await locate()
    } catch {
      next = null
    }
    if (
      !next ||
      next.userDataPath !== target.userDataPath ||
      next.metadata.runtimeId !== target.metadata.runtimeId
    ) {
      throw panelError(
        'unavailable',
        "Orca's runtime changed while this request was being prepared. Nothing was sent; try again."
      )
    }
    located = next
    return next
  }

  async function resolveTarget(call) {
    if (call.target.kind === 'local') {
      return { kind: 'local', key: 'local', runtime: await locateTarget() }
    }
    if (!remote) {
      throw panelError('unavailable', 'This plugin build has no remote-server support.')
    }
    // The local runtime names the profile whose saved servers the desktop and CLI share.
    const runtime = await locateTarget()
    let resolved
    try {
      resolved = await remote.resolve(runtime.userDataPath, call.target.id)
    } catch (error) {
      throw panelError(error.code ?? 'invalid_params', error.message)
    }
    return {
      kind: 'environment',
      key: `environment:${call.target.id}`,
      connection: resolved.connection,
      requiresTunnel: resolved.requiresTunnel
    }
  }

  function send(target, call, signal) {
    if (target.kind === 'local') {
      return request(target.runtime.metadata, { ...call, signal })
    }
    return remote.send({
      connection: target.connection,
      method: call.method,
      params: call.params,
      envelope: call.envelope,
      timeoutMs: call.timeoutMs,
      signal,
      requiresTunnel: target.requiresTunnel
    })
  }

  return async function handle(input, { panel, signal } = {}) {
    let call
    try {
      call = admitOrchestraCall(input)
    } catch (error) {
      throw panelError(error.code ?? 'invalid_params', error.message)
    }
    // Consume one per-write permission before sending; a safe retry keeps it.
    const key = preflightKey(panel)
    let confirmedRuntimeId
    if (call.write) {
      if (key === null) {
        throw panelError('invalid_params', 'This action must come from an open Orchestra panel.')
      }
      const mapKey = `${key}\0${targetKey(call.target)}`
      confirmedRuntimeId = preflights.get(mapKey)
      preflights.delete(mapKey)
      if (confirmedRuntimeId === undefined) {
        throw panelError(
          'unavailable',
          'Orca restarted after this action was confirmed. Nothing was sent; refresh and confirm again.'
        )
      }
    }
    for (let attempt = 0; ; attempt += 1) {
      const target = await resolveTarget(call)
      if (
        call.write &&
        target.kind === 'local' &&
        target.runtime.metadata.runtimeId !== confirmedRuntimeId
      ) {
        throw panelError(
          'unavailable',
          'The Orca runtime changed after this action was confirmed. Nothing was sent; refresh and confirm again.'
        )
      }
      let response
      try {
        response = await send(target, call, signal)
      } catch (error) {
        // A refused local connection sent nothing; retry once only if the runtime is still the same one.
        if (
          target.kind === 'local' &&
          attempt === 0 &&
          !signal?.aborted &&
          error.code === 'unavailable' &&
          error.sent === false
        ) {
          await refreshSameRuntime(target.runtime)
          continue
        }
        throw panelError(error.code ?? 'action_failed', error.message)
      }
      if (typeof response !== 'object' || response === null || typeof response.ok !== 'boolean') {
        throw panelError('action_failed', 'Orca sent an unreadable answer.')
      }
      if (!response.ok) {
        return response
      }
      try {
        const result = shapeOrchestraResult(call.method, response.result)
        if (call.method === 'status.get' && key !== null) {
          const runtimeId =
            target.kind === 'local'
              ? target.runtime.metadata.runtimeId
              : responseRuntimeId(response)
          if (runtimeId) {
            preflights.set(`${key}\0${target.key}`, runtimeId)
          }
        }
        if (
          call.write &&
          target.kind === 'environment' &&
          responseRuntimeId(response) !== confirmedRuntimeId
        ) {
          // The server answered from a different incarnation than the one the panel confirmed.
          // The mutation may have landed; never retry, and point at the receipt.
          return {
            ok: false,
            error: {
              code: 'unavailable',
              message: `The Orca server restarted after this action was confirmed. Completion may be unknown; inspect request ${call.envelope.orchestrationRequestId} before retrying.`
            }
          }
        }
        return { ok: true, result }
      } catch (error) {
        throw panelError(error.code ?? 'action_failed', error.message)
      }
    }
  }
}

/** The saved servers a panel may choose from; IDs and names only, never credentials. */
export function createTargetsHandler({ locate, remote }) {
  return async function handle() {
    let userDataPath = null
    try {
      userDataPath = (await locate())?.userDataPath ?? null
    } catch {
      userDataPath = null
    }
    if (!userDataPath) {
      return { targets: [LOCAL_TARGET], warning: 'runtimeNotFound' }
    }
    if (!remote) {
      return { targets: [LOCAL_TARGET], warning: 'remoteUnavailable' }
    }
    return remote.list(userDataPath)
  }
}

export default function activate(orca) {
  const remote = createRemoteTargets()
  const locate = () => locateRuntime({ pluginDir: PLUGIN_DIR })
  orca.panels.handle(
    'orchestra.call',
    createOrchestraCallHandler({ locate, request: runtimeRequest, remote })
  )
  orca.panels.handle('orchestra.targets', createTargetsHandler({ locate, remote }))
}
