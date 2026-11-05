import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const METADATA_FILE = 'orca-runtime.json'
// `<userData>/plugins/<key>/<hash>` reaches userData in three steps; stay near the plugin root
// instead of reading metadata files from arbitrary home-directory ancestors.
const ANCESTOR_LIMIT = 4

/** Path rules follow the platform being described, not the OS running the check. */
function pathsFor(platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * Orca profiles that may host this worker, most specific first. An installed plugin lives at
 * `<userData>/plugins/<key>/<hash>`, so its own ancestors name the profile; a development folder
 * relies on the parent's `--user-data-dir` or the platform default.
 */
export function userDataCandidates({ pluginDir, env, platform, home, parentArgs = [] }) {
  const path = pathsFor(platform)
  const candidates = []
  let dir = pluginDir
  for (let depth = 0; depth < ANCESTOR_LIMIT && dir; depth += 1) {
    candidates.push(dir)
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  if (env.ORCA_USER_DATA_PATH) {
    candidates.push(env.ORCA_USER_DATA_PATH)
  }
  const flagged = userDataDirFlag(parentArgs)
  if (flagged) {
    candidates.push(flagged)
  }
  candidates.push(platformUserDataPath({ env, platform, home }))
  return [...new Set(candidates)]
}

export function userDataDirFlag(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('--user-data-dir=')) {
      return arg.slice('--user-data-dir='.length) || null
    }
    if (arg === '--user-data-dir' && args[index + 1]) {
      return args[index + 1]
    }
  }
  return null
}

/** Same paths as the Orca CLI; the worker env drops APPDATA and XDG_CONFIG_HOME. */
export function platformUserDataPath({ env, platform, home }) {
  const path = pathsFor(platform)
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'orca')
  }
  if (platform === 'win32') {
    return path.join(
      env.APPDATA || path.join(env.USERPROFILE || home, 'AppData', 'Roaming'),
      'orca'
    )
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca')
}

export function parseRuntimeMetadata(raw, platform) {
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const kind = platform === 'win32' ? 'named-pipe' : 'unix'
  const transport = Array.isArray(value?.transports)
    ? value.transports.find(
        (entry) =>
          entry?.kind === kind && typeof entry.endpoint === 'string' && entry.endpoint.length > 0
      )
    : undefined
  if (
    !transport ||
    typeof value.authToken !== 'string' ||
    !value.authToken ||
    typeof value.runtimeId !== 'string' ||
    !value.runtimeId
  ) {
    return null
  }
  return {
    runtimeId: value.runtimeId,
    pid: Number.isInteger(value.pid) ? value.pid : null,
    endpoint: transport.endpoint,
    authToken: value.authToken
  }
}

/** Linux exposes the parent's argv; elsewhere the walk-up and defaults decide. */
async function readParentArgs(ppid, platform, read) {
  if (platform !== 'linux' || !ppid) {
    return []
  }
  try {
    const raw = await read(`/proc/${ppid}/cmdline`)
    return raw.split('\0').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * The runtime of the Orca that started this worker. Workers are forked by Orca's main process,
 * which also writes the metadata, so only a matching pid identifies the owning profile: a valid
 * metadata file in another candidate belongs to some other host and is never used as a fallback.
 */
export async function locateRuntime({
  pluginDir,
  env = process.env,
  platform = process.platform,
  home = homedir(),
  ppid = process.ppid,
  read = (path) => readFile(path, 'utf8')
}) {
  if (!pluginDir || !Number.isInteger(ppid) || ppid <= 0) {
    return null
  }
  const path = pathsFor(platform)
  const parentArgs = await readParentArgs(ppid, platform, read)
  let found = null
  for (const userDataPath of userDataCandidates({
    pluginDir,
    env,
    platform,
    home,
    parentArgs
  })) {
    let metadata
    try {
      metadata = parseRuntimeMetadata(await read(path.join(userDataPath, METADATA_FILE)), platform)
    } catch {
      continue
    }
    if (!metadata || metadata.pid !== ppid) {
      continue
    }
    // Two profiles claiming this parent cannot both own it; refuse instead of picking one.
    if (found && found.metadata.runtimeId !== metadata.runtimeId) {
      return null
    }
    found ??= { userDataPath, metadata }
  }
  return found
}
