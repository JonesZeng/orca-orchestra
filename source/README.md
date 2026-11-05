# Reproducible build

`panel.html` and `worker/orchestra-remote.cjs` are bundled from
[Orca](https://github.com/stablyai/orca) at the commit pinned in [UPSTREAM](UPSTREAM), plus the
files in [overlay/](overlay/). The overlay holds only the plugin's own sources (at their Orca
paths), the build tooling and the zh strings the panel renders. Every other input is upstream
Orca at that commit; dependencies come from its frozen lockfile.

```sh
./source/build.sh
```

The script clones the pinned commit into a temporary folder, copies `overlay/` on top, copies this
repository's package files into `examples/plugins/orchestra`, runs
`pnpm install --frozen-lockfile`, runs the plugin build, and prints the sha256 of both bundles. It
exits non-zero unless they are byte-identical to the shipped files. `--keep` keeps the clone;
`--release <folder>` checks another release folder; `ORCA_UPSTREAM_URL` clones from a mirror (the
pinned commit check still applies). It needs git, Node 24 and pnpm 12.14.

`source/` is published in this repository but not in `orca-plugin-<version>.zip`: the zip is the
package Orca installs, and it is written before `source/` is copied into the output folder.
