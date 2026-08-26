#!/bin/bash
# validate-qe.sh <qe-workspace> <binding-workspace> — mechanical validation
# of a QE suite per QE-CONTRACT.md.
set -euo pipefail
W=$1; B=$2
fail(){ echo "REJECT: $*"; exit 1; }
for f in suite/run.mjs SUITE.md FINDINGS.md; do
  [ -f "$W/$f" ] || fail "missing deliverable: $f"
done
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
run_suite(){
  set +e
  ( cd "$W" && timeout 900 node suite/run.mjs --binding "$B" --out "$1" ) > "$TMP/log" 2>&1
  local code=$?
  set -e
  [ "$code" -eq 0 ] || fail "suite crashed or hung (exit=$code): $(tail -c 200 "$TMP/log")"
  python3 - "$1" <<'PY' || exit 1
import json, sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print(f"REJECT: output not valid JSON ({e})"); raise SystemExit(1)
rs=d.get("results")
if not isinstance(rs,list) or not rs:
    print("REJECT: results must be a non-empty list"); raise SystemExit(1)
seen=set()
for r in rs:
    if not isinstance(r,dict) or "id" not in r or r.get("status") not in ("pass","fail"):
        print("REJECT: each result needs id and status pass|fail"); raise SystemExit(1)
    if r["id"] in seen: print(f"REJECT: duplicate test id {r['id']}"); raise SystemExit(1)
    seen.add(r["id"])
PY
}
# same-path double run: state keyed on any invocation-stable value is caught
run_suite "$TMP/a.json"
cp "$TMP/a.json" "$TMP/first.json"
run_suite "$TMP/a.json"
python3 - "$TMP/first.json" "$TMP/a.json" <<'PY' || fail "determinism: verdicts differ between identical runs"
import json,sys
a=sorted((r["id"],r["status"]) for r in json.load(open(sys.argv[1]))["results"])
b=sorted((r["id"],r["status"]) for r in json.load(open(sys.argv[2]))["results"])
raise SystemExit(0 if a==b else 1)
PY
N=$(python3 -c "import json;print(len(json.load(open('$TMP/a.json'))['results']))")
R=$(python3 -c "import json;print(sum(1 for r in json.load(open('$TMP/a.json'))['results'] if r['status']=='fail'))")
echo "OK: QE suite conformant — $N tests, $R currently red against the binding, deterministic"
