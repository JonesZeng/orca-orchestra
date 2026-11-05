import { createRequire } from 'node:module'

/**
 * Saved Orca servers the Orchestra panel can target. This module holds the pairing credentials
 * (device token and host key) only inside the worker: rows returned to the panel carry no
 * endpoints, tokens or keys.
 *
 * The heavy client lives in `orchestra-remote.cjs`, generated at plugin build time from this
 * checkout's `src/shared/remote-runtime` (see config/scripts/orchestra-plugin/build.mjs). It is
 * loaded lazily so local-only panels never pay for it and a source-folder install still works.
 */

const REMOTE_BUNDLE = './orchestra-remote.cjs'
const LOCAL_TARGET = Object.freeze({ kind: 'local', id: 'local' })
const MAX_TARGETS = 100
const MAX_NAME_LENGTH = 200
// Paired CLI callers send the same capability; the server uses it for agent.launch behavior.
const CLIENT_CAPABILITIES = ['agent.launch.v2']

let bundle = null

function loadBundle() {
  if (bundle) {
    return bundle
  }
  try {
    bundle = createRequire(import.meta.url)(REMOTE_BUNDLE)
  } catch {
    throw remoteError(
      'unavailable',
      'This plugin build has no remote-server support. Rebuild the plugin, then reopen this panel.'
    )
  }
  return bundle
}

function remoteError(code, message) {
  return Object.assign(new Error(message), { code })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiresTunnel(environment) {
  return (
    environment.connectionDependency === 'ssh-tunnel' ||
    (isRecord(environment.orcadDeployment) && environment.orcadDeployment.kind === 'wsl')
  )
}

/** The only fields a panel may see; deliberately not a spread of the stored environment. */
function publicTarget(environment) {
  if (
    !isRecord(environment) ||
    typeof environment.id !== 'string' ||
    environment.id.length === 0 ||
    environment.id.length > 128 ||
    typeof environment.name !== 'string' ||
    environment.name.length === 0
  ) {
    return null
  }
  return {
    kind: 'environment',
    id: environment.id,
    name: environment.name.slice(0, MAX_NAME_LENGTH),
    lastUsedAt: Number.isFinite(environment.lastUsedAt) ? environment.lastUsedAt : null,
    requiresTunnel: requiresTunnel(environment)
  }
}

function preferredEndpoint(environment) {
  const endpoints = Array.isArray(environment.endpoints) ? environment.endpoints : []
  const preferred = endpoints.find((entry) => entry?.id === environment.preferredEndpointId)
  return preferred ?? endpoints[0]
}

export function createRemoteTargets({ load = loadBundle } = {}) {
  function list(userDataPath) {
    let module
    try {
      module = load()
    } catch {
      return { targets: [LOCAL_TARGET], warning: 'remoteUnavailable' }
    }
    let environments
    try {
      environments = module.listEnvironments(userDataPath)
    } catch {
      // A corrupt or newer-format store must not take the whole selector down.
      return { targets: [LOCAL_TARGET], warning: 'savedServersUnreadable' }
    }
    if (!Array.isArray(environments)) {
      return { targets: [LOCAL_TARGET], warning: 'savedServersUnreadable' }
    }
    const targets = [LOCAL_TARGET]
    for (const environment of environments) {
      const target = publicTarget(environment)
      if (target) {
        targets.push(target)
      }
      if (targets.length >= MAX_TARGETS) {
        break
      }
    }
    return { targets }
  }

  function resolve(userDataPath, id) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
      throw remoteError('invalid_params', 'This saved server is not available. Pick another host.')
    }
    let environments
    try {
      environments = load().listEnvironments(userDataPath)
    } catch {
      throw remoteError(
        'unavailable',
        'Orca could not read its saved servers. Restart Orca and reopen this panel.'
      )
    }
    const environment = Array.isArray(environments)
      ? environments.find((entry) => entry?.id === id)
      : undefined
    if (!environment) {
      throw remoteError(
        'invalid_params',
        'This saved server is no longer available. Pick another host.'
      )
    }
    const endpoint = preferredEndpoint(environment)
    if (
      !isRecord(endpoint) ||
      typeof endpoint.endpoint !== 'string' ||
      endpoint.endpoint.length === 0 ||
      typeof endpoint.deviceToken !== 'string' ||
      endpoint.deviceToken.length === 0 ||
      typeof endpoint.publicKeyB64 !== 'string' ||
      endpoint.publicKeyB64.length === 0
    ) {
      throw remoteError(
        'unavailable',
        'This saved server has no usable pairing. Pair it again in Orca.'
      )
    }
    let connection
    try {
      connection = load().pairedRuntimeConnectionFromOffer({
        endpoint: endpoint.endpoint,
        deviceToken: endpoint.deviceToken,
        publicKeyB64: endpoint.publicKeyB64,
        ...(typeof environment.pairedDeviceId === 'string'
          ? { pairedDeviceId: environment.pairedDeviceId }
          : {})
      })
    } catch {
      throw remoteError(
        'invalid_params',
        'This saved server pairing is invalid. Pair it again in Orca.'
      )
    }
    return { connection, requiresTunnel: requiresTunnel(environment) }
  }

  async function send({
    connection,
    method,
    params,
    envelope,
    timeoutMs,
    signal,
    requiresTunnel: tunnel
  }) {
    try {
      return await load().sendRemoteRuntimeRequest(
        connection,
        method,
        params,
        timeoutMs,
        envelope,
        signal,
        CLIENT_CAPABILITIES
      )
    } catch (error) {
      const source = typeof error?.code === 'string' ? error.code : ''
      const code =
        source === 'remote_runtime_unavailable' || source === 'runtime_unavailable'
          ? 'unavailable'
          : source === 'runtime_timeout' || source === 'timeout'
            ? 'timeout'
            : source === 'unauthorized'
              ? 'unauthorized'
              : source === 'invalid_argument'
                ? 'invalid_params'
                : 'action_failed'
      let message = error instanceof Error ? error.message : String(error)
      if (tunnel && (code === 'unavailable' || code === 'timeout')) {
        message =
          'Orca could not reach this saved server. Open it in Orca first so its tunnel is running, then retry.'
      }
      throw remoteError(code, message)
    }
  }

  return { list, resolve, send }
}

export { LOCAL_TARGET }
