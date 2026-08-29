#!/bin/bash
# verdicts.sh <campaign-dir> — record verdicts for every NEW
# (test, closure) pair at the history tip. Both sides immutable ⇒ each
# pair runs EXACTLY ONCE, ever. Cost O(new pairs); CI does not exist.
# Pairing is def-granular (see pairs.py): unrelated accretion re-pairs
# nothing; a test importing a not-yet-existing name is PENDING.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1
HIST=$CAMPAIGN/history
LEDGER=$CAMPAIGN/verdicts.jsonl
VLOGS=$CAMPAIGN/verdict-logs
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../../platform
[ -d "$HIST/.git" ] || { echo "verdicts: no history at $HIST"; exit 1; }
exec 9>"$CAMPAIGN/.campaign.lock"; flock 9
touch "$LEDGER"
RUNID="$(date -u +%Y%m%dT%H%M%SZ).$$"

# sealed world at tip: source checkout + platform kit; emit js (type
# errors at cross-contribution seams are expected mid-conversation —
# admission floors already typechecked each side; noEmitOnError is
# off, so compilable files still emit)
RW=$(mktemp -d)
trap 'rm -rf "$RW"' EXIT
bash "$PLATFORM/bin/mk-workspace.sh" "$RW" > /dev/null
git -C "$HIST" archive HEAD modules | tar -x -C "$RW" 2>/dev/null || true
mkdir -p "$RW/modules"
( cd "$RW" && node node_modules/typescript/lib/tsc.js -p tsconfig.json ) > /dev/null 2>&1 || true

python3 "$BINDIR/pairs.py" "$RW" > "$RW/.pairs.json"
mkdir -p "$VLOGS"
python3 - "$RW" "$LEDGER" "$RUNID" "$VLOGS" <<'PY'
import json, os, subprocess, sys
RW, LEDGER, RUNID, VLOGS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
seen = set()
for line in open(LEDGER):
    line = line.strip()
    if not line: continue
    d = json.loads(line)
    seen.add((d["testHash"], d["closure"]))
rows = json.load(open(f"{RW}/.pairs.json"))
new = green = red = pending = 0
entries = []
for r in rows:
    if r["closure"] is None:
        pending += 1
        continue
    if (r["testHash"], r["closure"]) in seen: continue
    js = r["test"][:-3] + ".js"
    if not os.path.exists(f"{RW}/{js}"):
        verdict, p, f = "error", 0, 0
    else:
        env = {k: v for k, v in os.environ.items() if k not in ("NODE_TEST_CONTEXT", "NODE_OPTIONS")}
        rr = subprocess.run(["node", "--test", js], cwd=RW, capture_output=True, text=True, env=env)
        p = f = 0
        for ln in rr.stdout.splitlines():
            s = ln.strip()
            if s.startswith("# pass") or s.startswith("ℹ pass"): p = int(s.split()[-1])
            if s.startswith("# fail") or s.startswith("ℹ fail"): f = int(s.split()[-1])
        verdict = "pass" if rr.returncode == 0 and f == 0 and p > 0 else "fail"
        if verdict != "pass":
            # failure text is what the adjudicator and coders read;
            # opaque sources stay hidden, their messages do not
            lp = os.path.join(VLOGS, r["testHash"][:16] + "." + r["closure"][:16] + ".txt")
            with open(lp, "w") as lf:
                lf.write(f"TEST: {r['test']}\nRUN: {RUNID}\n\n" + rr.stdout[-8000:] + rr.stderr[-2000:])
    entries.append({"test": r["test"], "testHash": r["testHash"], "module": r["module"],
                    "closure": r["closure"], "verdict": verdict, "pass": p, "fail": f, "runId": RUNID})
    seen.add((r["testHash"], r["closure"]))
    new += 1
    if verdict == "pass": green += 1
    else: red += 1
with open(LEDGER, "a") as out:
    for e in entries: out.write(json.dumps(e) + "\n")
print(f"verdicts: {new} new pair(s) — {green} green, {red} red; {pending} pending (unpaired)")
PY
