#!/bin/bash
# validate-binding.sh <binding-workspace> — mechanical validation of a
# binding's deliverables per BINDING-CONTRACT.md. Prints OK or REJECT
# lines; exit 0 only if fully conformant. Target-free: knows the gate
# contract, never the domain.
set -euo pipefail
W=$1
fail(){ echo "REJECT: $*"; exit 1; }

for f in bridge/run.mjs inventory/cases.txt inventory/derive.mjs contract.d.ts budgets.json BINDING.md; do
  [ -f "$W/$f" ] || fail "missing deliverable: $f"
done

# inventory sanity
TOTAL=$(grep -cvE '^\s*(#|$)' "$W/inventory/cases.txt" || true)
[ "$TOTAL" -gt 0 ] || fail "inventory is empty (must be non-empty)"
DUPS=$(grep -vE '^\s*(#|$)' "$W/inventory/cases.txt" | sort | uniq -d | head -3)
[ -z "$DUPS" ] || fail "duplicate inventory ids: $DUPS"

# budgets.json parses
python3 -c "import json; d=json.load(open('$W/budgets.json')); assert 'defaultTimeoutMs' in d" 2>/dev/null \
  || fail "budgets.json unparseable or missing defaultTimeoutMs"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
grep -vE '^\s*(#|$)' "$W/inventory/cases.txt" | head -20 > "$TMP/sample.txt"
: > "$TMP/empty-subject.js"

run_probe(){ # <label> <subject-path> <out>
  local label=$1 subject=$2 out=$3
  set +e
  ( cd "$W" && timeout 300 node bridge/run.mjs --subject "$subject" --cases "$TMP/sample.txt" --out "$out" ) > "$TMP/$label.log" 2>&1
  local code=$?
  set -e
  [ "$code" -eq 0 ] || fail "$label probe: runner crashed or hung (exit=$code) — the runner must never crash: $(tail -c 200 "$TMP/$label.log")"
  python3 - "$out" "$TMP/sample.txt" <<'PY' || exit 1
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"REJECT: output is not valid JSON ({e})"); raise SystemExit(1)
if not isinstance(d, dict) or not isinstance(d.get("results"), list):
    print('REJECT: output shape — top-level {"results": [...]} required'); raise SystemExit(1)
want = [l.strip() for l in open(sys.argv[2]) if l.strip()]
got = {}
for r in d["results"]:
    if not isinstance(r, dict) or "id" not in r or "status" not in r:
        print("REJECT: output shape — each result needs id and status"); raise SystemExit(1)
    if r["status"] not in ("pass", "fail", "unsupported"):
        print(f"REJECT: illegal status '{r['status']}' (pass|fail|unsupported)"); raise SystemExit(1)
    if "ms" in r and not isinstance(r["ms"], (int, float)):
        print("REJECT: ms must be numeric when present"); raise SystemExit(1)
    got[r["id"]] = r["status"]
missing = [w for w in want if w not in got]
if missing:
    print(f"REJECT: missing ids in output (complete coverage required): {missing[:3]}"); raise SystemExit(1)
PY
}

run_probe "missing-subject" "$TMP/does-not-exist.js" "$TMP/out-missing.json"
# determinism double-run uses the SAME --out path (the stronger probe:
# state keyed on any invocation-stable value still gets caught)
run_probe "empty-subject"   "$TMP/empty-subject.js"  "$TMP/out-empty.json"
cp "$TMP/out-empty.json" "$TMP/out-empty-first.json"
run_probe "empty-subject-2" "$TMP/empty-subject.js"  "$TMP/out-empty.json"

# determinism: identical (id,status) across the double run
python3 - "$TMP/out-empty-first.json" "$TMP/out-empty.json" <<'PY' || fail "determinism: verdicts differ between identical runs"
import json, sys
a = sorted((r["id"], r["status"]) for r in json.load(open(sys.argv[1]))["results"])
b = sorted((r["id"], r["status"]) for r in json.load(open(sys.argv[2]))["results"])
raise SystemExit(0 if a == b else 1)
PY

echo "OK: binding conformant — $TOTAL inventory ids, runner survived probes, deterministic"
