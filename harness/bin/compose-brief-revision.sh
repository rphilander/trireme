#!/bin/bash
# compose-brief-revision.sh — harness: build the world for a REDO
# recovery: a non-coding session that revises a cycle brief per the
# retro's stated framing changes.
#
#   compose-brief-revision.sh <run-name> <goal-file> <campaign-dir> <cycle-N> <redo-retro-run> [cap-minutes]
#
# World = platform contracts + plan (RO) + the ORIGINAL brief + the
# REDO retro's RETRO.md and DECISION.md (RO). Deliverable = the
# revised briefs/cycle-<N>.md.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
NAME=$1; GOALF=$2; CAMPAIGN=$3; N=$4; RETRO=$5; CAPMIN=${6:-30}; EXTRA=${7:-}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions $R/workspace/redo
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
cp "$BINDIR/../PHASE-CONTRACT.md" "$R/workspace/platform/"
cp -a "$CAMPAIGN/plan" $R/workspace/plan
cp "$CAMPAIGN/plan/briefs/cycle-$N.md" $R/workspace/redo/original-brief.md
cp "$HOME/control-runs/$RETRO/workspace/RETRO.md" $R/workspace/redo/RETRO.md
cp "$HOME/control-runs/$RETRO/workspace/DECISION.md" $R/workspace/redo/DECISION.md
[ -n "$EXTRA" ] && cp "$EXTRA" $R/workspace/redo/VALIDATION.txt

{
cat <<'MD'
# Brief revision (REDO recovery)

GOAL (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are this campaign's planning judgment. A QE cohort ran cycle $N
from redo/original-brief.md, and the retrospective declared REDO —
its full assessment is redo/RETRO.md and its verdict redo/DECISION.md
(when redo/VALIDATION.txt exists, it is the PLATFORM's mechanical
refusal of the verdict's winner — the revised brief must make that
class of failure impossible, typically by describing banked interfaces
EXACTLY as their .d.ts declares them and declaring DEPENDS
completely).
Your job: deliver **briefs/cycle-$N.md** — the REVISED brief a fresh
cohort pair (QE and code, independently) will build from.

- Make exactly the changes the retro's framing calls for; keep
  everything it did not fault. Keep the machine header (TYPE: cycle,
  MODULE, KIND, DEPENDS) intact unless the retro says otherwise.
- A brief is the ONLY channel to its cohorts: self-contained, exact
  names/signatures/behaviors, no reliance on this REDO context.
- Never re-specify platform layouts or invocations (platform/
  contracts win); where the retro flagged a convention burn (e.g.
  file paths), state the exact required path VERBATIM in the brief.

Work only inside this directory. plan/, redo/, and platform/ are
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md, redo/RETRO.md, and redo/original-brief.md, then"
  echo "deliver the revised brief."
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
W=f"{R}/workspace"
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{W}/plan",f"{W}/redo",f"{W}/platform",f"{W}/node_modules",
                 f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("brief-revision world composed:", R)
PY
