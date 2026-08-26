#!/bin/bash
# compose-plan-world.sh — harness: build the world for a planner session.
#
#   compose-plan-world.sh <run-name> <tests-dir> <goal-file> [cap-minutes]
#
# The planner is the campaign's first judgment session: goal + raw
# acceptance corpus in, plan v1 out — a phase sequence plus the brief
# for phase 1. Non-coding: its deliverable is the plan, nothing else.
# PHASE-CONTRACT.md: phase 1 of every campaign is a qe phase.
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; CAPMIN=${4:-60}
R=$HOME/control-runs/$NAME

rm -rf $R && mkdir -p $R/workspace $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests

{
cat <<'MD'
# Campaign plan

GOAL (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<'MD'

The acceptance tests for this goal are in tests/ (read-only, exactly
as they ship — docs and harness files included). Your job is NOT to
build the product and NOT to build machinery: you are this campaign's
planner. Study the corpus and deliver plan v1.

How the platform executes a plan: work proceeds in PHASES. Each phase
is worked by a cohort of independent agents from a BRIEF you write; a
retrospective agent judges their candidates and banks a winner. There
are two phase types:

- **qe** — the cohort builds/evolves the campaign's gate machinery and
  internal test suite: the verdict runner that judges candidate
  products against the corpus, the subject contract products must
  implement, the full case-id inventory, measured per-case time
  budgets, the tranche of cases in scope for the next coding phase,
  and a self-suite that tests the gate machinery itself.
- **code** — the cohort builds the product against the current gate:
  candidates are graded by it, and banking requires newly-passing
  cases.

Because coding candidates are graded by the last-banked gate, PHASE 1
IS ALWAYS A qe PHASE: nothing can be graded before a gate exists.

## Platform interfaces (fixed — supplied to every cohort verbatim)

The platform hands every cohort the exact machinery contracts along
with your brief; briefs govern intent, scope, and acceptance emphasis,
and must NEVER re-specify or alter file layouts, invocations, or
output shapes — where a brief and the platform contracts disagree, the
platform contracts win. So you can aim your briefs correctly, the
fixed surfaces are:

- The gate a qe cohort delivers is this exact layout in its workspace
  root: bridge/run.mjs (the verdict runner), contract.d.ts (the
  subject contract), inventory/cases.txt + inventory/derive.mjs,
  budgets.json, scope/cases.txt (the tranche for the next coding
  phase), suite/self/run.mjs (the self-suite), SUITE.md, FINDINGS.md.
- The runner is invoked as:
      node bridge/run.mjs --subject <path> --cases <file|ALL> --out <path>
  and writes {"results":[{"id","status":"pass"|"fail"|"unsupported",
  "detail"?,"ms"?}]} — one result per requested case id.
- The self-suite is invoked as:
      node suite/self/run.mjs --out <path>
  with the same results shape (statuses pass|fail).

Deliverables, in this workspace:

1. plan/plan.md — the campaign plan: the phase sequence (one line per
   phase: `phase-N (qe|code): <one-line intent>`), then your
   rationale — how the corpus is organized, how to conquer it
   incrementally, risks. Later retrospectives will revise this plan;
   write it as the campaign's memory.
2. plan/briefs/phase-1.md — the brief the first cohort works from.
   Its FIRST line must be exactly:

       TYPE: qe

   followed by what phase 1 must accomplish. A brief is the ONLY
   channel to a cohort: they see the goal, the brief, and tests/ —
   never plan.md — so make it self-contained. Briefs for later phases
   are written when their turn comes (normally by the retrospective);
   write only phase 1's now, unless writing another sharpens the plan.

Work only inside this directory. tests/ is read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and deliver plan v1."
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
    "denyWrite":[f"{R}/workspace/tests",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("plan world composed:", R)
PY
