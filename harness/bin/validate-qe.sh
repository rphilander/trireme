#!/bin/bash
# validate-qe.sh <qe-workspace> — mechanical validation of a QE module
# per QE-CONTRACT.md: deliverables, inventory/scope sanity, gate-runner
# probes (never-crash, shape, coverage, same-path determinism), and the
# self-suite (runs, shape, determinism; red count reported as FACT).
# Prints OK or REJECT; exit 0 only if fully conformant. Target-free.
set -euo pipefail
W=$1
fail(){ echo "REJECT: $*"; exit 1; }

for f in bridge/run.mjs inventory/cases.txt inventory/derive.mjs contract.d.ts \
         budgets.json scope/cases.txt suite/self/run.mjs SUITE.md FINDINGS.md; do
  [ -f "$W/$f" ] || fail "missing deliverable: $f"
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# inventory sanity (temp-file pattern; no pipes into head at volume)
grep -vE '^\s*(#|$)' "$W/inventory/cases.txt" > "$TMP/inv.txt" || true
TOTAL=$(wc -l < "$TMP/inv.txt")
[ "$TOTAL" -gt 0 ] || fail "inventory is empty (must be non-empty)"
sort "$TMP/inv.txt" > "$TMP/inv.sorted"
sort -u "$TMP/inv.txt" > "$TMP/inv.uniq"
if ! cmp -s "$TMP/inv.sorted" "$TMP/inv.uniq"; then
  comm -23 "$TMP/inv.sorted" "$TMP/inv.uniq" > "$TMP/dups" || true
  fail "duplicate inventory ids: $(head -3 "$TMP/dups" | tr '\n' ' ')"
fi

# scope sanity: non-empty, no duplicates, subset of the inventory
grep -vE '^\s*(#|$)' "$W/scope/cases.txt" > "$TMP/scope.txt" || true
NSCOPE=$(wc -l < "$TMP/scope.txt")
[ "$NSCOPE" -gt 0 ] || fail "scope is empty (must bring a non-empty tranche into scope)"
sort "$TMP/scope.txt" > "$TMP/scope.sorted"
sort -u "$TMP/scope.txt" > "$TMP/scope.uniq"
cmp -s "$TMP/scope.sorted" "$TMP/scope.uniq" || fail "duplicate scope ids"
comm -23 "$TMP/scope.uniq" "$TMP/inv.uniq" > "$TMP/stray" || true
if [ -s "$TMP/stray" ]; then
  fail "scope ids not in the inventory: $(head -3 "$TMP/stray" | tr '\n' ' ')"
fi

# budgets.json parses
python3 -c "import json; d=json.load(open('$W/budgets.json')); assert 'defaultTimeoutMs' in d" 2>/dev/null \
  || fail "budgets.json unparseable or missing defaultTimeoutMs"

head -20 "$TMP/inv.txt" > "$TMP/sample.txt"
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

python3 - "$TMP/out-empty-first.json" "$TMP/out-empty.json" <<'PY' || fail "determinism: runner verdicts differ between identical runs"
import json, sys
a = sorted((r["id"], r["status"]) for r in json.load(open(sys.argv[1]))["results"])
b = sorted((r["id"], r["status"]) for r in json.load(open(sys.argv[2]))["results"])
raise SystemExit(0 if a == b else 1)
PY

# self-suite: runs from the module root, valid shape, same-path determinism
run_self(){ # <out>
  set +e
  ( cd "$W" && timeout 900 node suite/self/run.mjs --out "$1" ) > "$TMP/self.log" 2>&1
  local code=$?
  set -e
  [ "$code" -eq 0 ] || fail "self-suite crashed or hung (exit=$code): $(tail -c 200 "$TMP/self.log")"
  python3 - "$1" <<'PY' || exit 1
import json, sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print(f"REJECT: self-suite output not valid JSON ({e})"); raise SystemExit(1)
rs=d.get("results")
if not isinstance(rs,list) or not rs:
    print("REJECT: self-suite results must be a non-empty list"); raise SystemExit(1)
seen=set()
for r in rs:
    if not isinstance(r,dict) or "id" not in r or r.get("status") not in ("pass","fail"):
        print("REJECT: each self-suite result needs id and status pass|fail"); raise SystemExit(1)
    if r["id"] in seen: print(f"REJECT: duplicate self-test id {r['id']}"); raise SystemExit(1)
    seen.add(r["id"])
PY
}
run_self "$TMP/self.json"
cp "$TMP/self.json" "$TMP/self-first.json"
run_self "$TMP/self.json"
python3 - "$TMP/self-first.json" "$TMP/self.json" <<'PY' || fail "determinism: self-suite verdicts differ between identical runs"
import json,sys
a=sorted((r["id"],r["status"]) for r in json.load(open(sys.argv[1]))["results"])
b=sorted((r["id"],r["status"]) for r in json.load(open(sys.argv[2]))["results"])
raise SystemExit(0 if a==b else 1)
PY

NSELF=$(python3 -c "import json;print(len(json.load(open('$TMP/self.json'))['results']))")
NRED=$(python3 -c "import json;print(sum(1 for r in json.load(open('$TMP/self.json'))['results'] if r['status']=='fail'))")
echo "OK: QE module conformant — $TOTAL inventory ids, $NSCOPE in scope, runner survived probes, deterministic; $NSELF self-tests, $NRED currently red"
