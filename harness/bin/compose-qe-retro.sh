#!/bin/bash
# compose-qe-retro.sh — harness: build the world for a QE-phase retro.
#
#   compose-qe-retro.sh <retro-name> <tests-dir> <goal-file> <brief-file> <qe-run>...
#
# Decide-mode judgment over a cohort of QE modules (QE-CONTRACT.md).
# The world carries each candidate's full module, its transcript, and
# the mechanical validator's verdict as platform FACTS, plus the
# acceptance corpus and the phase brief for probe-based judgment.
# Stamps the phase TYPE into the run dir for bank-phase dispatch.
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; BRIEF=$4; shift 4
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)

rm -rf $R && mkdir -p $R/workspace/candidates $R/home/.pi/agent/extensions
echo qe > $R/TYPE
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests

CAND_LIST=""
for C in "$@"; do
  D=$R/workspace/candidates/$C
  mkdir -p $D
  # the whole workspace — exactly what banking would adopt — minus the
  # corpus hardlink and the mandate
  find $HOME/control-runs/$C/workspace -mindepth 1 -maxdepth 1 \
       ! -name tests ! -name MANDATE.md -exec cp -a {} $D/ \;
  cat $(find $HOME/control-runs/$C/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl
  set +e
  bash $BINDIR/validate-qe.sh $HOME/control-runs/$C/workspace > $D/VALIDATION.txt 2>&1
  set -e
  CAND_LIST="$CAND_LIST $C"
done

{
cat <<'MD'
# QE retrospective

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

A cohort of QE agents each worked the same phase brief independently
and delivered a candidate gate module: the verdict runner, subject
contract, case inventory, budgets, scope tranche, self-suite, and
rationale that the coding estate will run on. Their deliverables are in
candidates/<name>/, with each one's full session transcript
(transcript.jsonl) and the platform's mechanical validation verdict
(VALIDATION.txt — facts; a REJECT there is disqualifying).

Cohort:$CAND_LIST

## The brief this cohort worked (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<'MD'

You are the judgment of this platform, not one of its builders: you
read, run, and probe their deliverables to judge them, but you
never edit their deliverables — your output is prose and a verdict. Judge
what the validator cannot: inventory honesty, contract quality (future
builders code against it — is it minimal, honest, implementable?),
runner correctness (probe it: run each runner against subjects you
write — trivial, adversarial, partially-correct; disagreements between
runners on the SAME subject are the sharpest evidence), scope sanity
against the brief, self-suite substance (does it encode what the
corpus REQUIRES, or just what the runner does?), budget realism, and
the rationale's understanding of the corpus.

Deliver, in this order:
1. RETRO.md — your assessment of the cohort and of each candidate.
2. DECISION.md — the FIRST line must be a machine verdict, exactly one:

       BANK: <run-name>
       REDO: <one-line reason>

   BANK names the winning candidate; the platform adopts its module
   verbatim as this campaign's gate machinery. REDO declares no
   candidate deserves that and a fresh cohort should run under a
   revised framing (state what must change). Everything after the
   first line is your rationale — it is as much a deliverable as the
   pick.

Work only inside this directory. tests/ and candidates/ are read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of 60 minutes of wall-clock time for"
  echo "this session; budget accordingly. Every tool result is stamped with"
  echo "elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and judge the candidates."
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
    "denyWrite":[f"{R}/workspace/tests",f"{R}/workspace/candidates",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("QE-retro world composed:", R)
PY
