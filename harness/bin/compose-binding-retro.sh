#!/bin/bash
# compose-binding-retro.sh — harness: build the world for a BINDING retro.
#
#   compose-binding-retro.sh <retro-name> <tests-dir> <goal-file> <binding-run>...
#
# Decide-mode judgment over a cohort of bindings (BINDING-CONTRACT.md).
# The world carries each binding's full deliverables, its transcript, and
# the mechanical validator's verdict as platform FACTS, plus the
# acceptance tests for probe-based judgment.
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; shift 3
R=$HOME/control-runs/$NAME
HARNESS=$HOME/src/trireme/harness

rm -rf $R && mkdir -p $R/workspace/bindings $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests

BINDING_LIST=""
for B in "$@"; do
  D=$R/workspace/bindings/$B
  mkdir -p $D
  # full deliverable surface (never the binding's own tests hardlink)
  for item in bridge inventory contract.d.ts budgets.json BINDING.md; do
    [ -e $HOME/control-runs/$B/workspace/$item ] && cp -a $HOME/control-runs/$B/workspace/$item $D/ || true
  done
  cat $(find $HOME/control-runs/$B/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl
  set +e
  bash $HARNESS/bin/validate-binding.sh $HOME/control-runs/$B/workspace > $D/VALIDATION.txt 2>&1
  set -e
  BINDING_LIST="$BINDING_LIST $B"
done

GOAL=$(cat "$GOALF")
cat > $R/workspace/MANDATE.md <<MD
# Binding retrospective

GOAL (the operator's words, verbatim):

> $GOAL

A cohort of binding agents each studied the acceptance suite (tests/,
read-only) independently and delivered a binding: the verdict runner,
case inventory, subject contract, budgets, and rationale that all future
build sessions for this goal will run on. Their deliverables are in
bindings/<name>/, with each one's full session transcript
(transcript.jsonl) and the platform's mechanical validation verdict
(VALIDATION.txt — facts; a REJECT there is disqualifying).

Cohort:$BINDING_LIST

You are the judgment of this platform, not one of its binders: you read,
run, and probe their deliverables to judge them, but you never edit
their deliverables — your output is prose and a verdict. Judge what the
validator cannot: inventory honesty, contract quality (future builders
code against it — is it minimal, honest, implementable?), runner
correctness (probe it: run each runner against subjects you write —
trivial, adversarial, partially-correct; disagreements between runners
on the SAME subject are the sharpest evidence), budget realism, the
unsupported taxonomy, and the rationale's understanding of the suite.

Deliver, in this order:
1. RETRO.md — your assessment of the cohort and of each binding.
2. DECISION.md — the FIRST line must be a machine verdict, exactly one:

       BANK: <binding-run-name>
       REDO: <one-line reason>

   BANK names the winning binding; the platform adopts it verbatim as
   this goal's gate machinery. REDO declares no binding deserves that
   and a fresh binding cohort should run under a revised framing (state
   what must change). Everything after the first line is your rationale
   — it is as much a deliverable as the pick.

Work only inside this directory. tests/ and bindings/ are read-only.
MD

{
  echo "You have a total time budget of 60 minutes of wall-clock time for"
  echo "this session; budget accordingly. Every tool result is stamped with"
  echo "elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and judge the bindings."
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
    "denyWrite":[f"{R}/workspace/tests",f"{R}/workspace/bindings",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("binding-retro world composed:", R)
PY
