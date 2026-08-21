#!/bin/bash
# compose-retro-world.sh — kernel prototype: build a step-D retrospective world.
#
#   compose-retro-world.sh <run-name> <plan-workspace> <entry-name> <builder-run>...
#   e.g. compose-retro-world.sh retro-e1 ~/control-runs/planner-2/workspace entry-1 entry1-1 entry1-2 entry1-3
#
# Spec: experiments/bridge/RETRO-CONTRACT.md. The retro sees everything the
# planner saw (unfiltered bridge + full corpus) plus the cohort's runs;
# plan/ and trunk/ are its writable deliverable surfaces. Each <builder-run>
# dir must contain gate.json (the kernel's pristine-gate verdicts, persisted
# there after grading). test262 and cases.json are hardlinked (cp -al) for
# speed; srt denies writes to them.
set -euo pipefail
NAME=$1; P=$2; E=$3; shift 3
NEXT="entry-$(( ${E#entry-} + 1 ))"
R=$HOME/control-runs/$NAME

rm -rf $R && mkdir -p $R/workspace/runs $R/workspace/trunk $R/workspace/bridge $R/home/.pi/agent
cp -a $P/plan $R/workspace/plan
cp -al $P/test262 $R/workspace/test262
cp -a $P/bridge/run.mjs $P/bridge/stub.mjs $P/bridge/README.md $P/bridge/generate.mjs $R/workspace/bridge/
cp -al $P/bridge/cases.json $R/workspace/bridge/cases.json

for B in "$@"; do
  D=$R/workspace/runs/$B
  mkdir -p $D
  cp -a $HOME/control-runs/$B/workspace/src $D/src
  cp -a $HOME/control-runs/$B/workspace/package.json $D/package.json
  cp -a $HOME/control-runs/$B/gate.json $D/gate.json
  cat $(find $HOME/control-runs/$B/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl
done

cat > $R/workspace/MANDATE.md <<'MD'
# Retrospective — @ENTRY@

You are the retrospective for @ENTRY@ of the plan of record (plan/PLAN.md).
A cohort of builders each executed plan/@ENTRY@/BRIEF.md independently, in
isolated worlds, from scratch. Everything about those runs is in runs/:

    runs/<builder>/transcript.jsonl    the builder's full session, as it ran
    runs/<builder>/src/, package.json  the code it shipped
    runs/<builder>/gate.json           its pristine-gate verdicts

The grading bridge and the full corpus are in bridge/ and test262/ (see
bridge/README.md). The corpus is the requirement; the plan is how we intend
to conquer it. Deliver, in this order:

1. RETRO.md — your assessment of @ENTRY@: what the runs reveal about the
   plan, the brief, the process, the platform. Direct and specific.

2. DECISION.md and trunk/ — pick exactly ONE of the codebases to become the
   trunk that everything later builds on; copy it into trunk/ (src/ plus
   package.json). DECISION.md records which one and why — the rationale is
   as much a deliverable as the pick. The other runs stay archived; if one
   contains something specifically worth stealing later, say so.
   The plan may schedule a boundary revision at this retrospective (see
   PLAN.md); performing it now (editing trunk/) or deferring it is your
   call — record the reasoning. Either way the trunk must stay green:

       node bridge/run.mjs --subject trunk/<entry point> \
           --cases plan/@ENTRY@/cases.txt --out /tmp/trunk-gate.json

   must report every id "pass". Run it yourself before finishing, and state
   the exact subject path in DECISION.md — the kernel re-runs this check.

3. A revised plan/PLAN.md — the plan is a living document and you own it
   this cycle. Reconcile it with what was actually built; fold in whatever
   @ENTRY@ taught you.

4. plan/@NEXT@/cases.txt and plan/@NEXT@/BRIEF.md — the next entry, derived
   per the plan's conventions, sized for one capped session, written for a
   builder who will see the trunk, the brief, and nothing else.

Work only inside this directory.
MD
sed -i "s/@ENTRY@/$E/g; s/@NEXT@/$NEXT/g" $R/workspace/MANDATE.md
echo "MANDATE.md is your assignment." > $R/prompt.txt

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
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{R}/workspace/test262",f"{R}/workspace/bridge",f"{R}/workspace/runs",
                 f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("retro world composed:", R)
PY
