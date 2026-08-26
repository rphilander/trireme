#!/bin/bash
# compose-brief-world.sh — harness: build the world for a brief-writer
# session: the campaign's planning judgment authoring the brief for one
# phase, from the plan (memory) and the banked gate. Used when a needed
# brief does not exist yet (retros author the next phase's brief as part
# of their deliverables; this covers gaps).
#
#   compose-brief-world.sh <run-name> <goal-file> <campaign-dir> <phase-N> [cap-minutes]
set -euo pipefail
NAME=$1; GOALF=$2; CAMPAIGN=$3; N=$4; CAPMIN=${5:-30}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)

[ -d "$CAMPAIGN/plan" ] || { echo "compose-brief-world: no plan at $CAMPAIGN/plan"; exit 1; }

rm -rf $R && mkdir -p $R/workspace/platform $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -a "$CAMPAIGN/plan" $R/workspace/plan
[ -d "$CAMPAIGN/gate/current" ] && cp -al "$CAMPAIGN/gate/current/." $R/workspace/gate
cp "$BINDIR/../PHASE-CONTRACT.md" "$BINDIR/../QE-CONTRACT.md" "$BINDIR/../GATE-CONTRACT.md" $R/workspace/platform/

{
cat <<'MD'
# Brief authorship

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are this campaign's planning judgment. The campaign plan — its
memory — is at plan/ (plan.md and the briefs written so far). The
campaign's banked gate module is at gate/: its contract, verdict
runner, inventory, budgets, the in-scope tranche (gate/scope/), the
self-suite, its docs, and the acceptance corpus (gate/tests/). Probe
freely; everything is read-only.

The platform's fixed contracts are in platform/ — deliverable layouts,
invocations, and bank rules for each phase type. A brief governs
intent, scope, and acceptance emphasis; NEVER re-specify or alter the
platform's layouts or invocations (the cohort receives those verbatim
from the platform, and where a brief disagrees, the platform wins).
Quote them only exactly.

Deliver exactly one file: **briefs/phase-$N.md** — the brief the
phase-$N cohort will work from. Its FIRST line must be exactly
\`TYPE: qe\` or \`TYPE: code\`, matching the plan's type for phase $N.
A brief is the ONLY channel to a cohort: they see the goal, the brief,
and their world — never plan.md — so make it self-contained. Ground it
in what is actually banked (the real contract, the real tranche), not
in what the plan predicted.

Work only inside this directory. plan/, gate/, and platform/ are
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and deliver the brief."
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
    "denyWrite":[f"{R}/workspace/plan",f"{R}/workspace/gate",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("brief world composed:", R)
PY
