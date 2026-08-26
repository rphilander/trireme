#!/bin/bash
# compose-code-world.sh — harness: build a CODE world (PHASE-CONTRACT.md).
#
#   compose-code-world.sh <run-name> <goal-file> <brief-file> <gate-dir> [cap-minutes]
#
# Brief-driven (first line `TYPE: code`). The banked gate ships in the
# world read-only (hardlinked; the corpus rides inside it at gate/tests)
# — the cohort implements the product against gate/contract.d.ts and
# self-grades with the gate. Candidates are ultimately graded by the
# platform's own copy of the same gate.
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; GATE=$4; CAPMIN=${5:-90}
R=$HOME/control-runs/$NAME

TYPE=$(grep -m1 -vE '^\s*$' "$BRIEF" | sed -E 's/[#*_`]//g; s/^\s+|\s+$//g')
[ "$TYPE" = "TYPE: code" ] || { echo "compose-code-world: brief is not a code brief (first line: $TYPE)"; exit 1; }
[ -d "$GATE" ] || { echo "compose-code-world: gate dir not found: $GATE"; exit 1; }

rm -rf $R && mkdir -p $R/workspace $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
mkdir -p $R/workspace/gate && cp -al "$GATE/." $R/workspace/gate

{
cat <<'MD'
# Code phase — build the product

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<'MD'

Two estates build this campaign: QE cohorts build and own the gate —
the instrument every product candidate is measured by — and your
coding cohort builds the product. The campaign's banked gate ships in
this workspace at gate/ (read-only): its contract, verdict runner,
case inventory, budgets, the in-scope tranche, and the acceptance
corpus itself (gate/tests/). Read gate/SUITE.md and gate/contract.d.ts
first — they are the authoritative interface you build against.

## This phase's brief (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<'MD'

The brief governs intent, scope, and acceptance emphasis. If the brief
and this document disagree about file layouts, invocations, or output
shapes, the platform contract below wins.

## Deliverables (in this workspace)

1. product/ — the product as a Node package directory, loadable by the
   gate's --subject convention (see gate/SUITE.md; typically
   product/index.mjs as the entry), implementing gate/contract.d.ts.
   Everything the product needs lives under product/.
2. BUILD.md — what you built, its current status against the in-scope
   tranche, known gaps, and what you would do next.

## Grading (platform-fixed)

Self-grade at any time with the shipped gate:

    node gate/bridge/run.mjs --subject product \
         --cases gate/scope/cases.txt --out /tmp/grade.json

The platform grades your candidate the same way, using ITS OWN copy of
this same gate — the gate in your workspace is read-only and gate
changes never come from code phases. Banking requires newly-passing
in-scope cases: a candidate that turns no new case green cannot be
banked, however elegant. Regressions on already-passing cases weigh
against you in judgment.

Work only inside this directory. gate/ (including gate/tests/) is
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this entire session; budget your work accordingly. Every tool"
  echo "result is stamped with elapsed time, time remaining, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and deliver the product."
} > $R/prompt.txt

python3 -c "
import json
d=json.load(open('$HOME/.pi/agent/models.json'))
d['providers']['deepseek'].pop('baseUrl',None)
open('$R/home/.pi/agent/models.json','w').write(json.dumps(d,indent=1))"

python3 - <<PY
import json, os
H=os.path.expanduser("~")
R=f"{H}/control-runs/$NAME"
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{R}/workspace/gate",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("code world composed:", R)
PY
