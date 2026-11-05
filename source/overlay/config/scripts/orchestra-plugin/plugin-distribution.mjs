// Packaging rules for config/scripts/orchestra-plugin/build.mjs: where a build may write, and how
// the folder becomes a deterministic, checksummed zip. Kept separate so tests need no Vite build.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'

// fflate writes DOS date/time from local getters, so use local midnight rather than a UTC instant.
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0).getTime()

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

/** Resolve symlinks in every existing ancestor, then re-append the missing suffix. */
export function canonicalPath(target) {
  const resolved = path.resolve(target)
  const missing = []
  let existing = resolved
  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) {
      return resolved
    }
    missing.unshift(path.basename(existing))
    existing = parent
  }
  return path.join(realpathSync(existing), ...missing)
}

/**
 * Refuse an --out that could delete source: the Orca checkout or an ancestor of it, the plugin
 * template, the build workspace, or any other place inside the checkout except `out/`.
 */
export function assertSafePluginOutputDir({ outDir, repoRoot, templateDir, workDir }) {
  const out = canonicalPath(outDir)
  const repo = canonicalPath(repoRoot)
  const template = canonicalPath(templateDir)
  const work = canonicalPath(workDir)
  if (within(out, repo)) {
    throw new Error(`refusing --out ${out}: it is the Orca checkout or an ancestor of it`)
  }
  if (within(template, out)) {
    throw new Error(`refusing --out ${out}: it is the plugin template or inside it`)
  }
  if (within(work, out) || within(out, work)) {
    throw new Error(`refusing --out ${out}: it overlaps the build workspace ${work}`)
  }
  if (within(repo, out) && !within(path.join(repo, 'out'), out)) {
    throw new Error(`refusing --out ${out}: inside the Orca checkout it must stay under out/`)
  }
  if (existsSync(out) && !statSync(out).isDirectory()) {
    throw new Error(`refusing --out ${out}: it is a file, not a folder`)
  }
}

/** The manifest identity used for the folder and archive names. */
export function readPluginIdentity(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.id !== 'string' || !manifest.id) {
    throw new Error(`${manifestPath} has no id`)
  }
  if (typeof manifest.version !== 'string' || !manifest.version) {
    throw new Error(`${manifestPath} has no version`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) {
    throw new Error(`${manifestPath} has an unsafe id for a folder name`)
  }
  return { id: manifest.id, version: manifest.version, manifest }
}

export const PACKAGE_FILES = [
  'orca-plugin.json',
  'panel.html',
  'worker/main.mjs',
  'assets/icon.png',
  'assets/cover.png',
  'docs/DEVELOPMENT.md',
  'docs/SECURITY.md',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md'
]

/** Every image the manifest declares must be in the package; validation reads these files. */
export function manifestImagePaths(manifest) {
  return [
    ...(typeof manifest.icon === 'string' ? [manifest.icon] : []),
    ...(manifest.cover?.path ? [manifest.cover.path] : []),
    ...(manifest.screenshots ?? []).flatMap((shot) => (shot?.path ? [shot.path] : []))
  ]
}

/** Every package the build writes must be installable and self-contained. */
export function assertPackageLayout(rootDir) {
  for (const relative of PACKAGE_FILES) {
    if (!existsSync(path.join(rootDir, relative))) {
      throw new Error(`package is missing ${relative}`)
    }
  }
  const html = readFileSync(path.join(rootDir, 'panel.html'), 'utf8')
  // Why no `i` flag: unminified JavaScript contains `new URL("https:…")`, which is not a fetch.
  for (const pattern of [/<script[^>]+\bsrc=/i, /<link[^>]+\bhref=/i, /url\(\s*['"]?https?:/]) {
    if (pattern.test(html)) {
      throw new Error(`panel.html is not self-contained: it references ${pattern}`)
    }
  }
  const manifest = JSON.parse(readFileSync(path.join(rootDir, 'orca-plugin.json'), 'utf8'))
  const main = manifest.main
  if (typeof main !== 'string' || !existsSync(path.join(rootDir, main))) {
    throw new Error(`manifest main ${String(main)} does not exist in the package`)
  }
  for (const relative of manifestImagePaths(manifest)) {
    if (!existsSync(path.join(rootDir, relative))) {
      throw new Error(`manifest image ${relative} does not exist in the package`)
    }
  }
}

function collectFiles(rootDir, relative = '') {
  const directory = path.join(rootDir, relative)
  const entries = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      throw new Error(`package contains a symbolic link: ${child}`)
    }
    if (entry.isDirectory()) {
      entries.push(...collectFiles(rootDir, child))
    } else if (entry.isFile()) {
      entries.push(child)
    }
  }
  return entries
}

/**
 * Write a deterministic zip of `sourceDir` with its files at the archive root.
 * No wrapper folder: every extractor gives a folder whose root holds orca-plugin.json.
 * Fixed order and a local DOS timestamp make two builds of identical bytes identical archives.
 */
export function createPluginZip({ sourceDir, archivePath }) {
  if (within(sourceDir, archivePath)) {
    throw new Error(`archive ${archivePath} must stay outside its source ${sourceDir}`)
  }
  const files = {}
  for (const relative of collectFiles(sourceDir)) {
    files[relative] = new Uint8Array(readFileSync(path.join(sourceDir, relative)))
  }
  const archive = zipSync(files, { level: 9, mtime: ZIP_MTIME, os: 0 })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  mkdirSync(path.dirname(archivePath), { recursive: true })
  const temporary = `${archivePath}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, archive)
    renameSync(temporary, archivePath)
  } finally {
    rmSync(temporary, { force: true })
  }
  return { archivePath, sha256, bytes: archive.length }
}

/** Write a `sha256sum -c` compatible checksum file for a published archive name. */
export function writePluginChecksum({ checksumPath, archiveName, sha256 }) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`invalid archive checksum ${sha256}`)
  }
  mkdirSync(path.dirname(checksumPath), { recursive: true })
  const temporary = `${checksumPath}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${sha256}  ${archiveName}\n`)
    renameSync(temporary, checksumPath)
  } finally {
    rmSync(temporary, { force: true })
  }
  return checksumPath
}

/** Publish the archive and checksum only after the package folder replacement succeeded. */
export function publishPluginArchive({ stagedArchive, stagedChecksum, archivePath, checksumPath }) {
  renameSync(stagedArchive, archivePath)
  renameSync(stagedChecksum, checksumPath)
  return { archivePath, checksumPath }
}

/**
 * Replace only the entries the build owns. A missing output folder is renamed into place in one
 * step; an existing folder keeps unrelated files and rolls back its old owned entries on failure.
 */
export function installOwnedEntries({ stagedDir, outDir, ownedNames }) {
  const names = [...ownedNames].sort()
  for (const name of names) {
    if (!existsSync(path.join(stagedDir, name))) {
      throw new Error(`staged package is missing ${name}`)
    }
  }
  mkdirSync(path.dirname(path.resolve(outDir)), { recursive: true })
  if (!existsSync(outDir)) {
    renameSync(stagedDir, outDir)
    return names
  }
  const backupDir = mkdtempSync(
    path.join(path.dirname(path.resolve(outDir)), `.${path.basename(outDir)}-previous-`)
  )
  const previous = []
  const installed = []
  try {
    for (const name of names) {
      const target = path.join(outDir, name)
      if (existsSync(target)) {
        renameSync(target, path.join(backupDir, name))
        previous.push(name)
      }
    }
    for (const name of names) {
      renameSync(path.join(stagedDir, name), path.join(outDir, name))
      installed.push(name)
    }
  } catch (error) {
    for (const name of installed.toReversed()) {
      rmSync(path.join(outDir, name), { recursive: true, force: true })
    }
    for (const name of previous.toReversed()) {
      renameSync(path.join(backupDir, name), path.join(outDir, name))
    }
    throw error
  } finally {
    rmSync(backupDir, { recursive: true, force: true })
  }
  return names
}
