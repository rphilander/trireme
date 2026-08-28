#!/bin/bash
# mk-workspace.sh <dir> — assemble a bare modular-era workspace: the
# platform payload mounted (hardlinks), vendored toolchain, fixed
# package.json (subpath imports #platform/* and #modules/*) and the
# fixed world tsconfig (strict; in-place emit; declarations — banked
# modules ship their .d.ts, which is what dependent worlds see).
set -euo pipefail
W=$1
P=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$P/payload/platform" ] || { echo "payload missing — run platform/bin/build-payload.sh"; exit 1; }

mkdir -p "$W/modules"
cp -al "$P/payload/platform" "$W/platform"
cp -al "$P/payload/node_modules" "$W/node_modules"

cat > "$W/package.json" <<'JSON'
{
  "name": "product",
  "private": true,
  "type": "module",
  "imports": {
    "#platform/*": "./platform/*",
    "#modules/*": "./modules/*"
  }
}
JSON

cat > "$W/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["modules/**/*.ts", "product/**/*.ts"]
}
JSON

echo "workspace ready: $W"
