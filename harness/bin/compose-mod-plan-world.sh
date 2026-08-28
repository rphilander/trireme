#!/bin/bash
# compose-mod-plan-world.sh — harness: build the planner world for a
# MODULAR campaign (modular-mode charter). The planner studies the
# acceptance context and the platform language, and delivers the module
# map plus the first cycle's brief.
#
#   compose-mod-plan-world.sh <run-name> <goal-file> <campaign-dir> <gate-dir> [cap-minutes]
#
# gate-dir = the banked acceptance instrument (its contract, docs, and
# in-scope case list are mounted as acceptance context — never the
# corpus itself; module worlds are corpus-free and so is planning).
set -euo pipefail
NAME=$1; GOALF=$2; CAMPAIGN=$3; GATE=$4; CAPMIN=${5:-60}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
cp "$BINDIR/../PHASE-CONTRACT.md" "$R/workspace/platform/"

mkdir -p $R/workspace/acceptance
for f in contract.d.ts SUITE.md FINDINGS.md; do
  [ -f "$GATE/$f" ] && cp "$GATE/$f" $R/workspace/acceptance/
done
[ -f "$GATE/scope/cases.txt" ] && cp "$GATE/scope/cases.txt" $R/workspace/acceptance/scope-cases.txt

{
cat <<'MD'
# Modular campaign plan

GOAL (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<'MD'

You are this campaign's planner. The campaign builds the product as a
graph of MODULES in the platform language (platform/CODE-CONTRACT.md —
read it first): pure functions over immutable platform values, in
three kinds — **noun** (value shapes: branded tagged records),
**verb** (pure functions; the bulk), **shell** (exactly one thin
adapter module at the end, holding the single state cell and
implementing the acceptance contract).

Work proceeds in CYCLES, one module each: from ONE brief, a QE cohort
authors the module's test suite (doc + opaque) and, independently, a
coding cohort implements the module against the banked suite. A retro
judges each half; banking is mechanical. Cohorts see ONLY: the goal,
the brief, the platform, and the declared dependencies' interfaces
(.d.ts + doc tests). They never see the acceptance corpus, the plan,
or other modules — a brief must therefore be fully self-contained:
exact exported names, signatures over platform Value types, and
behaviors, precise enough that two independent teams derive compatible
artifacts from it.

## Acceptance context (acceptance/, read-only)

The finished product must implement acceptance/contract.d.ts (the
subject contract of the banked grading gate) via its shell adapter,
and will be graded on the case list in acceptance/scope-cases.txt.
acceptance/SUITE.md and FINDINGS.md document the gate. Plan the module
graph so the final cycles assemble exactly that surface.

## Brief header (machine-read; exact)

Every cycle brief begins:

    TYPE: cycle
    MODULE: <kebab-case-name>
    KIND: noun|verb|shell
    DEPENDS: <space-separated banked module names, or omit the line>

The composer builds both cohorts' worlds from these lines. A brief
never re-specifies platform layouts, invocations, or the value system
— the platform supplies those; where a brief disagrees, the platform
wins.

## Deliverables (in this workspace)

1. plan/plan.md — the MODULE MAP and cycle sequence: every module you
   foresee (name, kind, dependencies, one-line responsibility), the
   order cycles should run, and your rationale — risks, where the
   design might need revisiting, what each cycle should bank. Later
   retros revise this; write it as the campaign's memory.
2. plan/briefs/cycle-1.md — the first cycle's brief. Cycle 1 must be a
   LEAF module (no DEPENDS): the foundation the rest of the graph
   builds on.

Work only inside this directory. acceptance/ and platform/ are
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md, platform/CODE-CONTRACT.md, and acceptance/, then"
  echo "deliver the module map and cycle-1 brief."
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
    "denyWrite":[f"{W}/acceptance",f"{W}/platform",f"{W}/node_modules",f"{W}/package.json",
                 f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("mod-plan world composed:", R)
PY
