#!/bin/bash
# compose-brief-batch.sh — harness: build the world for BATCH brief
# authorship: one planning-judgment session writes the briefs for a set
# of dependency-ready cycles (the prerequisite for running them in
# parallel).
#
#   compose-brief-batch.sh <run-name> <goal-file> <campaign-dir> <cap-minutes> <cycle-N>...
#
# World = plan (RO) + platform contracts + the INTERFACE VIEW of every
# banked module (.d.ts + doc tests; no implementations).
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
NAME=$1; GOALF=$2; CAMPAIGN=$3; CAPMIN=$4; shift 4
CYCLES="$*"
[ -n "$CYCLES" ] || { echo "no cycles given"; exit 1; }
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
cp "$BINDIR/../PHASE-CONTRACT.md" "$R/workspace/platform/"
cp -a "$CAMPAIGN/plan" $R/workspace/plan

TRUNK=$CAMPAIGN/trunk/current
if [ -d "$TRUNK/modules" ]; then
  for M in "$TRUNK"/modules/*/; do
    B=$(basename "$M")
    DST=$R/workspace/modules/$B
    mkdir -p "$DST"
    ( cd "$M" && find . -name '*.d.ts' ! -path './test/*' ) | while IFS= read -r f; do
      mkdir -p "$DST/$(dirname "$f")"
      cp "$M/$f" "$DST/$f"
    done
    [ -d "$M/test/doc" ] && { mkdir -p "$DST/test"; cp -a "$M/test/doc" "$DST/test/doc"; }
  done
fi

{
cat <<'MD'
# Batch brief authorship

GOAL (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are this campaign's planning judgment. The following cycles are
DEPENDENCY-READY and will run CONCURRENTLY, so their briefs must all
exist now. Author, per plan/plan.md's module map:

    $(for n in $CYCLES; do echo "briefs/cycle-$n.md"; done)

For each: the machine header first (TYPE: cycle, MODULE, KIND,
DEPENDS — dependencies must already be banked; they are mounted under
modules/ as interfaces: .d.ts + doc tests), then a fully
self-contained body — exact exported names, signatures over platform
Value types, and behaviors, precise enough that a QE cohort and a
coding cohort derive compatible artifacts independently. Ground each
brief in what is actually banked (read the real interfaces), not what
the plan predicted. Never re-specify platform layouts or invocations
(platform/ contracts win). Because these cycles run concurrently, no
brief may depend on another brief's module.

Work only inside this directory. plan/, modules/, and platform/ are
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md, plan/plan.md, and the module interfaces, then"
  echo "deliver every brief listed."
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
    "denyWrite":[f"{W}/plan",f"{W}/modules",f"{W}/platform",f"{W}/node_modules",
                 f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("brief-batch world composed:", R, "| cycles: $CYCLES")
PY
