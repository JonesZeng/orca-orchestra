#!/usr/bin/env bash
# Rebuild the published Orchestra bundles from the pinned Orca commit plus source/overlay.
#
#   source/build.sh [--release <folder>] [--keep]
#
# --release  folder holding the shipped panel.html and worker/orchestra-remote.cjs
#            (default: the published repository containing this source/ directory)
# --keep     keep the temporary upstream clone instead of deleting it
#
# Needs git, Node 24 and pnpm 12.14 (the upstream packageManager).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE="$(cd "$HERE/.." && pwd)"
KEEP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --release)
      RELEASE="$(cd "$2" && pwd)"
      shift 2
      ;;
    --keep)
      KEEP=1
      shift
      ;;
    -h | --help)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# shellcheck source=UPSTREAM
. "$HERE/UPSTREAM"
: "${repository:?UPSTREAM has no repository}" "${tag:?UPSTREAM has no tag}"
: "${commit:?UPSTREAM has no commit}"
# ORCA_UPSTREAM_URL clones from a mirror; the commit check still pins the bytes.
REPOSITORY="${ORCA_UPSTREAM_URL:-$repository}"

for file in panel.html worker/orchestra-remote.cjs; do
  if [ ! -f "$RELEASE/$file" ]; then
    echo "missing shipped file: $RELEASE/$file" >&2
    exit 2
  fi
done

CLONE="$(mktemp -d "${TMPDIR:-/tmp}/orca-orchestra-build.XXXXXX")"
cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "kept $CLONE"
  else
    rm -rf "$CLONE"
  fi
}
trap cleanup EXIT

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

echo "cloning $REPOSITORY at $tag ($commit)"
git init -q "$CLONE"
git -C "$CLONE" remote add origin "$REPOSITORY"
git -C "$CLONE" fetch -q --depth 1 origin "refs/tags/$tag"
git -C "$CLONE" checkout -q --detach FETCH_HEAD
if [ "$(git -C "$CLONE" rev-parse HEAD)" != "$commit" ]; then
  echo "upstream $tag is not $commit; refusing to build a different commit" >&2
  exit 1
fi

# The plugin sources, the build tooling and the zh strings the panel renders.
cp -R "$HERE/overlay/." "$CLONE/"

# build.mjs reads the package template from examples/plugins/orchestra. The published repository
# root is that template: its generated bundles are replaced by the build.
TEMPLATE="$CLONE/examples/plugins/orchestra"
mkdir -p "$TEMPLATE"
for entry in orca-plugin.json README.md README.zh-CN.md LICENSE THIRD_PARTY_NOTICES.md \
  assets docs worker; do
  if [ ! -e "$RELEASE/$entry" ]; then
    echo "missing shipped file: $RELEASE/$entry" >&2
    exit 2
  fi
  cp -R "$RELEASE/$entry" "$TEMPLATE/"
done
cp -R "$HERE" "$TEMPLATE/source"

cd "$CLONE"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  pnpm install --frozen-lockfile --ignore-scripts
node config/scripts/orchestra-plugin/build.mjs --out "$CLONE/out/plugins/orchestra"

echo
hash_file "$CLONE/out/plugins/orchestra/panel.html"
hash_file "$CLONE/out/plugins/orchestra/worker/orchestra-remote.cjs"
echo

status=0
for file in panel.html worker/orchestra-remote.cjs; do
  if cmp -s "$CLONE/out/plugins/orchestra/$file" "$RELEASE/$file"; then
    echo "identical: $file"
  else
    echo "DIFFERS: $file" >&2
    status=1
  fi
done
exit "$status"
