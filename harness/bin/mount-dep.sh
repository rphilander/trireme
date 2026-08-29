#!/bin/bash
# mount-dep.sh <trunk-entry> <dep-name> <workspace> <who> — mount one
# declared dependency as a sealed interface artifact: .d.ts surface +
# doc tests + ONE esbuild bundle as index.js (#platform external).
# Shared by the world composers and the bank's world-equivalent recheck.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
TRUNK=$1; D=$2; W=$3; WHO=${4:-mount-dep}
PLATFORM=$(cd "$(dirname "$0")/.." && pwd)/platform
SRC=$TRUNK/modules/$D
[ -d "$SRC" ] || { echo "$WHO: dependency '$D' is not banked"; exit 1; }
DST=$W/modules/$D
mkdir -p "$DST"
( cd "$SRC" && find . -name '*.d.ts' ! -path './test/*' ) | while IFS= read -r f; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
done
( cd "$TRUNK" && "$PLATFORM/node_modules/.bin/esbuild" --bundle --format=esm --platform=node \
    --log-level=warning "--external:#platform/*" "modules/$D/index.js" --outfile="$DST/index.js" )
[ -d "$SRC/test/doc" ] && { mkdir -p "$DST/test"; cp -a "$SRC/test/doc" "$DST/test/doc"; }
# interface closure: a declared dep whose .d.ts references another
# module makes that module an INTERFACE dependency of the consumer —
# it must be declared too, or the world would typecheck against holes
# (skipLibCheck masks them; verdicts flip in full context)
REFS=$(grep -rhoE "(import|export)[^;]*from[[:space:]]*['\"]#modules/[a-z0-9-]+" "$DST" --include='*.d.ts' 2>/dev/null | grep -oE '#modules/[a-z0-9-]+' | sed 's|#modules/||' | sort -u || true)
for X in $REFS; do
  [ "$X" = "$D" ] && continue
  echo "$X"
done > "$DST/.iface-refs"
exit 0
