#!/bin/bash
# validate-mod.sh <workspace> <module> <code|qe> [baseline-ledger.json]
# — mechanical floor for a modular cycle candidate, run in-world by
# agents and at the bank as the isolated recheck.
#
#   code: compile-clean + lint-clean + module suite green + accretion
#         vs baseline (when given). Facts: suite counts, ledger deltas.
#   qe:   lint-clean on the test tree + doc/opaque structure present.
#         (Bootstrap suites are born red/uncompiled by design; their
#         substance is the retro's judgment.)
set -euo pipefail
W=$1; MODULE=$2; MODE=$3; BASELINE=${4:-}
fail(){ echo "REJECT: $*"; exit 1; }
[ -d "$W/modules/$MODULE" ] || fail "missing module dir: modules/$MODULE"

if [ "$MODE" = "qe" ]; then
  ls "$W/modules/$MODULE/test/doc/"*.test.ts >/dev/null 2>&1 || fail "no doc tests (test/doc/*.test.ts)"
  ls "$W/modules/$MODULE/test/opaque/"*.test.ts >/dev/null 2>&1 || fail "no opaque tests (test/opaque/*.test.ts)"
  L=$(cd "$W" && node platform/lint/check.js "modules/$MODULE/test" 2>&1) || fail "lint: $L"
  NDOC=$(ls "$W/modules/$MODULE/test/doc/"*.test.ts | wc -l)
  NOP=$(ls "$W/modules/$MODULE/test/opaque/"*.test.ts | wc -l)
  echo "OK: qe candidate — $NDOC doc test file(s), $NOP opaque test file(s), lint clean"
  exit 0
fi
[ "$MODE" = "code" ] || fail "mode must be code|qe"

C=$(cd "$W" && node node_modules/typescript/lib/tsc.js -p tsconfig.json 2>&1) \
  || fail "compile: $(echo "$C" | head -5)"
L=$(cd "$W" && node platform/lint/check.js modules 2>&1) || fail "lint: $L"

SUITE="0 tests"
if ls "$W/modules/$MODULE/test/"*/*.test.js >/dev/null 2>&1; then
  set +e
  # env -u NODE_TEST_CONTEXT: a parent node:test runner poisons child
  # runners into silently skipping every file with exit 0
  OUT=$(cd "$W" && env -u NODE_TEST_CONTEXT -u NODE_OPTIONS node --test "modules/$MODULE/test/**/*.test.js" 2>&1)
  CODE=$?
  set -e
  PASS=$(echo "$OUT" | grep -oE '^ℹ pass [0-9]+' | grep -oE '[0-9]+' || echo 0)
  FAILN=$(echo "$OUT" | grep -oE '^ℹ fail [0-9]+' | grep -oE '[0-9]+' || echo 0)
  [ "$CODE" -eq 0 ] || fail "module suite red: $PASS pass, $FAILN fail"
  SUITE="$PASS tests pass"
fi

LEDGER=$(cd "$W" && node platform/ledger/ledger.js modules/*)
NODES=$(echo "$LEDGER" | python3 -c "import json,sys;print(json.load(sys.stdin)['totalNodes'])")
DEFS=$(echo "$LEDGER" | python3 -c "import json,sys;print(json.load(sys.stdin)['totalDefs'])")
DELTA=""
if [ -n "$BASELINE" ]; then
  set +e
  D=$(cd "$W" && node platform/ledger/ledger.js --diff "$BASELINE" modules/*)
  DCODE=$?
  set -e
  ADDED=$(echo "$D" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['diff']['added']))")
  DELETED=$(echo "$D" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['diff']['deleted']))")
  MODIFIED=$(echo "$D" | python3 -c "import json,sys;print(', '.join(json.load(sys.stdin)['diff']['modified']))")
  [ "$DCODE" -eq 0 ] || fail "accretion violation — banked definitions edited in place: $MODIFIED"
  DELTA=", +$ADDED/-$DELETED defs vs baseline"
fi
echo "OK: code candidate — compile clean, lint clean, $SUITE, $DEFS defs, $NODES nodes$DELTA"
