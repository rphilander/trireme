#!/bin/bash
# stage-tip.sh <campaign-dir> <outdir> — materialize the history tip
# as a trunk-shaped tree: source checkout + platform kit + one full
# emit (js + d.ts), so sealed interface mounts (mount-dep.sh) work
# against it. Type errors at cross-contribution seams are tolerated
# (admission typechecked each side; emit still happens).
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; OUT=$2
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../../platform
bash "$PLATFORM/bin/mk-workspace.sh" "$OUT" > /dev/null
git -C "$CAMPAIGN/history" archive HEAD | tar -x -C "$OUT" 2>/dev/null || true
mkdir -p "$OUT/modules"
( cd "$OUT" && node node_modules/typescript/lib/tsc.js -p tsconfig.json ) > /dev/null 2>&1 || true
