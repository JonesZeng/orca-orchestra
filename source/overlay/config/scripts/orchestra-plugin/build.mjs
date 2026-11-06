// Build the Orchestra Orca plugin (examples/plugins/orchestra) into an installable folder and a
// deterministic, checksummed zip. Browser clients load plugin panels as srcdoc documents with
// inline-only scripts, so the shared Orchestra page is bundled into one self-contained panel.html.
// Bundles ship unminified: the listing policy allows bundled output only when the source is in the
// repository, and readable output is easier to review. `source/` holds the reproducible build.
// Usage: node config/scripts/orchestra-plugin/build.mjs [--out <dir>]
//   --out defaults to out/plugins/orchestra. Only the files this build owns are replaced there,
//   so it can point at a plugin repository checkout without touching .git or other files.
//   The archive is written next to the folder as <out>-<version>.zip, with the package files at
//   its root (no wrapper folder) so any extractor yields one folder holding orca-plugin.json.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { build as esbuild } from 'esbuild'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  assertPackageLayout,
  assertSafePluginOutputDir,
  createPluginZip,
  installOwnedEntries,
  publishPluginArchive,
  readPluginIdentity,
  writePluginChecksum
} from './plugin-distribution.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const TEMPLATE = path.join(ROOT, 'examples/plugins/orchestra')
const ENTRY = path.join(
  ROOT,
  'src/renderer/src/components/orchestra/plugin-frame/orchestra-plugin-frame-entry.tsx'
)
const WORK = path.join(ROOT, 'out/plugins/.orchestra-build')
const REMOTE_ENTRY = path.join(ROOT, 'config/scripts/orchestra-plugin/remote-entry.ts')
const REMOTE_OUT = path.join(WORK, 'orchestra-remote.cjs')
const REMOTE_PACKAGE_FILE = 'orchestra-remote.cjs'
const LOCALE_URL_STUB = '\0orchestra-plugin-locale-url'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
const OUT = path.resolve(values.out ?? path.join(ROOT, 'out/plugins/orchestra'))

/** The zh strings the bundled components render; other languages read the inline English. */
function zhCatalog() {
  // Plugin-owned copy: the panel bundles only these strings, and the source/ overlay can carry
  // them without publishing unrelated work-in-progress translations from the host catalog.
  return JSON.parse(
    readFileSync(path.join(ROOT, 'config/scripts/orchestra-plugin/orchestra-zh.json'), 'utf8')
  )
}

// Panels cannot fetch, so locale catalog URLs become empty and i18n never requests them.
const stubLocaleUrls = {
  name: 'orchestra-plugin-locale-url-stub',
  enforce: 'pre',
  resolveId: (source) => (/\/locales\/[\w-]+\.json\?url$/.test(source) ? LOCALE_URL_STUB : null),
  load: (id) => (id === LOCALE_URL_STUB ? 'export default ""' : null)
}

// Tailwind's automatic detection scans all of src/renderer, so unrelated work in progress would
// change the panel's CSS. Scan only the directories the panel imports instead, and skip the
// fixture/demo files that are not bundled.
const PANEL_SOURCES = [
  '@source "../components/orchestra";',
  '@source "../components/ui";',
  '@source "../lib";',
  '@source "../components/LoadingSpinner.tsx";',
  '@source not "../components/orchestra/plugin/**";',
  '@source not "../**/*.fixture.{ts,tsx}";'
].join('\n')
const scopePanelTailwindSources = {
  name: 'orchestra-panel-tailwind-sources',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/renderer/src/assets/main.css')) {
      return null
    }
    const tailwind = "@import 'tailwindcss';"
    if (!code.includes(tailwind)) {
      throw new Error('main.css no longer imports tailwindcss as expected')
    }
    return {
      code: code.replace(tailwind, `@import "tailwindcss" source(none);\n${PANEL_SOURCES}`),
      map: null
    }
  }
}

async function bundlePanel() {
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    root: path.join(ROOT, 'src/renderer'),
    cacheDir: path.join(ROOT, '.cache/vite/orchestra-plugin'),
    mode: 'production',
    plugins: [scopePanelTailwindSources, stubLocaleUrls, react(), tailwindcss()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __ORCHESTRA_PLUGIN_ZH__: JSON.stringify(zhCatalog()),
      ORCA_FEATURE_WALL_ENABLED: 'true',
      ORCA_BUILD_COMMIT: JSON.stringify('orchestra-plugin')
    },
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@renderer': path.join(ROOT, 'src/renderer/src'),
        '@': path.join(ROOT, 'src/renderer/src')
      }
    },
    build: {
      outDir: WORK,
      emptyOutDir: true,
      reportCompressedSize: false,
      minify: false,
      lib: {
        entry: ENTRY,
        formats: ['iife'],
        name: 'OrcaOrchestraPanel',
        fileName: () => 'panel.js',
        cssFileName: 'panel'
      }
    }
  })
  const script = readFileSync(path.join(WORK, 'panel.js'), 'utf8')
  // Keep only the UI font; symbol, terminal and math fonts add megabytes the panel never draws.
  const style = readFileSync(path.join(WORK, 'panel.css'), 'utf8').replace(
    /@font-face\s*\{[^}]*\}/g,
    (rule) => (/font-family:\s*["']?Geist["']?;/.test(rule) ? rule : '')
  )
  return {
    script: script.replace(/<\/script/gi, '<\\/script'),
    style: style.replace(/<\/style/gi, '<\\/style')
  }
}

/**
 * The worker's remote-server client: Orca's own shared E2EE WebSocket client, paired connection
 * and environments store, bundled once so the worker never reimplements pairing or crypto.
 * CJS because `ws` is CommonJS and the store's Windows security module uses `createRequire(__filename)`.
 */
async function bundleRemoteClient() {
  await esbuild({
    absWorkingDir: ROOT,
    entryPoints: [REMOTE_ENTRY],
    bundle: true,
    preserveSymlinks: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    outfile: REMOTE_OUT
  })
  if (!existsSync(REMOTE_OUT)) {
    throw new Error(`remote client bundle was not written: ${REMOTE_OUT}`)
  }
  return readFileSync(REMOTE_OUT)
}

function panelDocument({ script, style }) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Orchestra</title>',
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script>${script}</script>`,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

function copyTemplate(staging) {
  mkdirSync(path.join(staging, 'worker'), { recursive: true })
  for (const file of [
    'orca-plugin.json',
    'README.md',
    'README.zh-CN.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ]) {
    cpSync(path.join(TEMPLATE, file), path.join(staging, file))
  }
  cpSync(path.join(TEMPLATE, 'assets'), path.join(staging, 'assets'), { recursive: true })
  cpSync(path.join(TEMPLATE, 'docs'), path.join(staging, 'docs'), { recursive: true })
  for (const file of readdirSync(path.join(TEMPLATE, 'worker'))) {
    if (file.endsWith('.mjs') && !file.endsWith('.test.mjs')) {
      cpSync(path.join(TEMPLATE, 'worker', file), path.join(staging, 'worker', file))
    }
  }
}

/** The reproducible build recipe ships in the repository but not in the installable zip. */
function copySource(staging) {
  const sourceDir = path.join(TEMPLATE, 'source')
  if (!existsSync(sourceDir)) {
    throw new Error(`plugin source is missing: ${sourceDir}`)
  }
  cpSync(sourceDir, path.join(staging, 'source'), { recursive: true })
}

async function main() {
  assertSafePluginOutputDir({ outDir: OUT, repoRoot: ROOT, templateDir: TEMPLATE, workDir: WORK })
  const identity = readPluginIdentity(path.join(TEMPLATE, 'orca-plugin.json'))
  mkdirSync(path.dirname(OUT), { recursive: true })
  const staging = mkdtempSync(path.join(path.dirname(OUT), `.${path.basename(OUT)}-package-`))
  const archivePath = `${OUT}-${identity.version}.zip`
  const checksumPath = `${archivePath}.sha256`
  const stagedArchive = `${archivePath}.${process.pid}.staged`
  const stagedChecksum = `${checksumPath}.${process.pid}.staged`
  let archive = null
  try {
    const panel = await bundlePanel()
    const remoteClient = await bundleRemoteClient()
    copyTemplate(staging)
    writeFileSync(path.join(staging, 'worker', REMOTE_PACKAGE_FILE), remoteClient)
    writeFileSync(path.join(staging, 'panel.html'), panelDocument(panel))
    assertPackageLayout(staging)
    archive = createPluginZip({ sourceDir: staging, archivePath: stagedArchive })
    writePluginChecksum({
      checksumPath: stagedChecksum,
      archiveName: path.basename(archivePath),
      sha256: archive.sha256
    })
    // After the zip: Orca counts every file a Git install copies toward its install limits.
    copySource(staging)
    // The staging folder is private and holds exactly the entries this build owns.
    const ownedNames = readdirSync(staging)
    installOwnedEntries({ stagedDir: staging, outDir: OUT, ownedNames })
    publishPluginArchive({ stagedArchive, stagedChecksum, archivePath, checksumPath })
    const size = (
      Buffer.byteLength(readFileSync(path.join(OUT, 'panel.html'))) /
      1024 /
      1024
    ).toFixed(2)
    console.log(`wrote ${path.relative(process.cwd(), OUT) || '.'} (panel.html ${size} MiB)`)
    console.log(
      `wrote ${path.relative(process.cwd(), archivePath)} (${(archive.bytes / 1024 / 1024).toFixed(
        2
      )} MiB, sha256 ${archive.sha256})`
    )
  } catch (error) {
    rmSync(stagedArchive, { force: true })
    rmSync(stagedChecksum, { force: true })
    throw error
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(WORK, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await main()
}
