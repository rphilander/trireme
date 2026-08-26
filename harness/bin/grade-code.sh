#!/bin/bash
# grade-code.sh <campaign-dir> <candidate-workspace> <out-json> — grade a
# code candidate's product/ with the CAMPAIGN's banked gate (never any
# gate copy inside the candidate workspace — invariant 2) over the banked
# scope. Prints counts as platform FACTS; exit 0 only if the grade run
# completed with a conformant report.
set -euo pipefail
CAMPAIGN=$1; W=$2; OUT=$3
fail(){ echo "REJECT: $*"; exit 1; }

GATE=$CAMPAIGN/gate/current
[ -d "$GATE" ] || fail "campaign has no banked gate at $GATE"
[ -d "$W/product" ] || fail "missing deliverable: product/"

LOG=$(mktemp)
set +e
timeout 1800 node "$GATE/bridge/run.mjs" --subject "$W/product" \
  --cases "$GATE/scope/cases.txt" --out "$OUT" > "$LOG" 2>&1
code=$?
set -e
[ "$code" -eq 0 ] || fail "gate run failed (exit=$code): $(tail -c 200 "$LOG")"
rm -f "$LOG"

python3 - "$OUT" "$GATE/scope/cases.txt" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"REJECT: grade output is not valid JSON ({e})"); raise SystemExit(1)
rs = d.get("results")
if not isinstance(rs, list):
    print('REJECT: grade output shape — {"results": [...]} required'); raise SystemExit(1)
want = [l.strip() for l in open(sys.argv[2]) if l.strip() and not l.startswith("#")]
got = {}
for r in rs:
    if not isinstance(r, dict) or "id" not in r or r.get("status") not in ("pass", "fail", "unsupported"):
        print("REJECT: grade output shape — id + legal status required"); raise SystemExit(1)
    got[r["id"]] = r["status"]
missing = [w for w in want if w not in got]
if missing:
    print(f"REJECT: grade output missing scope ids: {missing[:3]}"); raise SystemExit(1)
n = {"pass": 0, "fail": 0, "unsupported": 0}
for s in got.values(): n[s] += 1
print(f"GRADE: {n['pass']} pass, {n['fail']} fail, {n['unsupported']} unsupported ({len(want)} scope cases)")
PY
