# Development and release

The published repository is the built release folder, not the Orca checkout. Its root holds
`orca-plugin.json`, so **Add plugin → From a Git URL** installs it directly.

## Source and output

- Source template: `examples/plugins/orchestra` in the Orca checkout (manifest, worker, docs,
  assets, and `source/`; no `panel.html`).
- Build entry: `config/scripts/orchestra-plugin/build.mjs`.
- `panel.html` and `worker/orchestra-remote.cjs` are generated. Everything else is copied.
- Both bundles are built unminified and deterministic. The listing policy allows bundled output
  when its source is in the repository; `source/` makes the bundles reproducible and reviewable.

## Build

Building needs an Orca checkout at a version that contains the Orchestra panel entry point, with
its JavaScript dependencies installed (`pnpm install`). Consumers need none of that.

```sh
node config/scripts/orchestra-plugin/build.mjs
# or: pnpm build:orchestra-plugin
```

Outputs, relative to the checkout:

- `out/plugins/orchestra/` — installable folder, plus `source/`
- `out/plugins/orchestra-0.2.1.zip` — deterministic archive, package files at its root
- `out/plugins/orchestra-0.2.1.zip.sha256` — `sha256sum -c` compatible

Choose another output folder with `--out <folder>`. The build replaces only the entries it owns
(`orca-plugin.json`, `panel.html`, `worker/`, `assets/`, `docs/`, `source/`, both READMEs,
`LICENSE`, `THIRD_PARTY_NOTICES.md`) and leaves `.git` and unrelated files alone:

```sh
node config/scripts/orchestra-plugin/build.mjs --out ../orca-orchestra
```

It refuses an output folder that is the Orca checkout (or an ancestor), the template, the build
workspace, or anything inside the checkout outside `out/`. It stages and validates the package
before replacing anything, and rolls back the previous owned files if a replacement fails.

## Package contents

```
orca-plugin.json                 manifest (trusted-worker, one panel, worker/main.mjs)
panel.html                       self-contained Orchestra panel (~2.3 MiB, unminified, inline font)
worker/main.mjs                  plugin.request handlers (orchestra.call, orchestra.targets)
worker/orchestra-gateway.mjs     method and target allowlist, bounded answers
worker/remote-targets.mjs        saved-server listing and remote request routing
worker/orchestra-remote.cjs      generated Orca remote client (E2EE WebSocket, environments store)
worker/runtime-endpoint.mjs      locates the local Orca runtime for this profile
worker/runtime-request.mjs       minimal local runtime RPC client
assets/                          icon, cover, screenshots declared by the manifest
docs/                            this file and SECURITY.md
source/                          reproducible build of both generated bundles (repository only)
README.md, README.zh-CN.md       the repository README in English and Simplified Chinese
LICENSE                          MIT
THIRD_PARTY_NOTICES.md           bundled UI, font and worker-bundle licenses
```

`source/` is copied into the folder after the zip is written, so it ships in the repository but
never inside `orca-plugin-0.2.1.zip`; an install from a Git URL still clones it and counts it
toward Orca's 2,000-file / 50 MiB limits (about 40 files and 400 KiB).

`docs/` and `README.zh-CN.md` ship with the plugin because the installed README links to them;
keeping the links valid in the package costs a few kilobytes and makes the offline copy complete.
They are documentation only and are never read at runtime.

## Reproducibility

`source/` pins the upstream Orca commit in `source/UPSTREAM` and holds `source/overlay/`: exactly
the build-input files that this branch adds or changes (the panel components, the remote-client
entry, the build tooling and the zh strings the panel renders), at their Orca paths. Every other
input is upstream Orca at that commit; third-party code comes from its frozen lockfile.

```sh
./source/build.sh
```

The script clones the pinned commit, copies `overlay/` on top, copies this repository's package
files into `examples/plugins/orchestra`, installs from the frozen lockfile, builds, prints the
sha256 of both bundles and exits non-zero unless they match the shipped bytes. It needs only git,
Node 24 and pnpm 12.14; see [`source/README.md`](../source/README.md).

The bundles are deterministic: Vite/Rollup and esbuild emit in input order with no timestamps or
absolute paths, and minification is off. The zip is deterministic too (sorted entries, fixed
1980-01-01 mtime, fixed mode), so its sha256 changes only when package bytes change.

## Validation

```sh
pnpm test config/scripts/orchestra-plugin src/renderer/src/components/orchestra/plugin-frame
pnpm tc:web
orca plugin validate path/to/orchestra-0.2.1
orca plugin inspect path/to/orchestra-0.2.1
```

`validate` is offline, never runs plugin code and never grants approval. It exits 0 when valid,
2 when invalid, and 1 on an I/O or usage error. Image limits: icon 256×256 PNG/WEBP ≤ 256 KB;
cover 1600×1000 PNG/JPEG/WEBP ≤ 1024 KB; screenshots 1600×1000, each ≤ 1536 KB, at most six,
8 MB total.

## Publishing

The install identity is derived from the Git URL owner exactly as Orca does it: lowercase the
owner, replace `.` and `_` with `-`, collapse repeated dashes and trim them. `JonesZeng` becomes
`joneszeng`, so a Git URL install of `github.com/JonesZeng/orca-orchestra` shows the key
**`joneszeng.orchestra`**. The manifest deliberately has no `publisher` field.

1. Bump `version` in `orca-plugin.json` (semver), then rebuild. The zip name follows it.
2. Commit the package as the repository root, including `worker/`, `assets/`, `docs/`,
   `source/` and both READMEs, and tag the release (`v0.2.1`).
3. Create a release and attach `orchestra-0.2.1.zip` and `orchestra-0.2.1.zip.sha256`. Users
   install with `https://github.com/JonesZeng/orca-orchestra.git#v0.2.1` or verify and unzip.
4. Optional catalog: a Git repository with `orca-catalog.json` at its root, added under
   **Settings → Plugins → ⋯ → Catalog sources…**. Run `orca plugin release-entry path/to/plugin`
   on the committed plugin to print the exact entry. Keep older releases listed when raising
   `engines.orca`.

```json
{
  "id": "joneszeng.orchestra",
  "source": {
    "kind": "git",
    "url": "https://github.com/JonesZeng/orca-orchestra.git",
    "ref": "main"
  },
  "categories": ["productivity"],
  "releases": [
    {
      "version": "0.2.1",
      "commit": "<full 40-character commit SHA>",
      "contentHash": "<content hash printed by release-entry>",
      "execution": "trusted-worker",
      "minimumOrca": "1.4.246",
      "name": "Orchestra",
      "license": "MIT",
      "repository": "https://github.com/JonesZeng/orca-orchestra"
    }
  ]
}
```

## Release checklist

- [ ] Version bumped; README badge and zip name agree.
- [ ] `source/build.sh` reproduces `panel.html` and `worker/orchestra-remote.cjs` byte for byte.
- [ ] `pnpm test …`, `pnpm tc:web`, `oxlint` and `oxfmt` clean on changed files.
- [ ] `orca plugin validate` and `orca plugin inspect` exit 0 on the folder **and** the extracted
      zip, on both the oldest supported host (1.4.246) and a current build.
- [ ] Image limits pass on both hosts; every `assets/` path resolves.
- [ ] Hidden-host smoke test: install from a folder, open the plugin detail page (icon, cover,
      screenshots, author, repository) and the panel; no external requests, no console errors.
- [ ] README rendered and checked; relative links resolve in the repository.
- [ ] Hash recorded, release tagged, zip and `.sha256` attached.
