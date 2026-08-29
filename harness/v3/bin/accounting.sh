#!/bin/bash
# accounting.sh <campaign-dir> — the live-green view: each live test's
# recorded verdict against the tip closure. Pure arithmetic over
# recorded facts; nothing runs. Regression can only appear here as
# adjudicated collection, never as a flipped verdict.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1
HIST=$CAMPAIGN/history
LEDGER=$CAMPAIGN/verdicts.jsonl
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../../platform
RW=$(mktemp -d)
trap 'rm -rf "$RW"' EXIT
bash "$PLATFORM/bin/mk-workspace.sh" "$RW" > /dev/null
git -C "$HIST" archive HEAD | tar -x -C "$RW" 2>/dev/null || true
mkdir -p "$RW/modules"
python3 "$BINDIR/pairs.py" "$RW" > "$RW/.pairs.json"
python3 - "$RW" "$LEDGER" <<'PY'
import glob, json, os, sys
RW, LEDGER = sys.argv[1], sys.argv[2]
facts = {}
if os.path.exists(LEDGER):
    for line in open(LEDGER):
        line = line.strip()
        if not line: continue
        d = json.loads(line)
        facts[(d["testHash"], d["closure"])] = d
challenged_tests = set()
for c in glob.glob(f"{RW}/challenges/*.md"):
    for ln in open(c):
        if ln.startswith("TEST:"):
            challenged_tests.add(ln.split(":", 1)[1].strip())
rows = json.load(open(f"{RW}/.pairs.json"))
report = {"modules": {}, "totals": {"tests": 0, "green": 0, "red": 0, "pending": 0, "challenged": 0}}
for r in rows:
    m = r["module"]
    row = report["modules"].setdefault(m, {"tests": 0, "green": 0, "red": 0, "pending": 0, "challenged": 0})
    row["tests"] += 1
    fact = facts.get((r["testHash"], r["closure"])) if r["closure"] else None
    if fact is None:
        row["pending"] += 1
    elif fact["verdict"] == "pass":
        row["green"] += 1
    else:
        row["red"] += 1
        if r["test"] in challenged_tests: row["challenged"] += 1
for row in report["modules"].values():
    for k in ("tests", "green", "red", "pending", "challenged"):
        report["totals"][k] += row[k]
print(json.dumps(report, indent=1))
PY
