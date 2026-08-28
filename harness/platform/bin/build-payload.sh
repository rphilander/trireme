#!/bin/bash
# build-payload.sh — assemble the world-mountable platform payload:
# compiled values facade (+vendored backing), lint, ledger, the
# CODE-CONTRACT, and the vendored TypeScript package. Worlds hardlink
# this payload read-only; everything runs offline.
#
#   platform/bin/build-payload.sh          → platform/payload/
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd)
cd "$P"

[ -d node_modules/typescript ] || { echo "run npm ci in platform/ first"; exit 1; }
./node_modules/.bin/tsc
mkdir -p dist/values && cp -r values/vendor dist/values/ 2>/dev/null || true

rm -rf payload
mkdir -p payload/platform/values payload/platform/lint payload/platform/ledger payload/node_modules
# compiled facade + services (not the test files), with backing + types
for f in dist/values/*.js dist/values/*.d.ts; do
  case "$f" in *test*) ;; *) cp "$f" payload/platform/values/ ;; esac
done
cp -r values/vendor payload/platform/values/vendor
cp dist/lint/check.js payload/platform/lint/
cp dist/ledger/ledger.js payload/platform/ledger/
cp ../CODE-CONTRACT.md payload/platform/
# vendored toolchain (hardlink: large, immutable)
cp -al node_modules/typescript payload/node_modules/typescript

echo "payload built: $P/payload"
