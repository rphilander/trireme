#!/bin/bash
# compose-code-retro.sh — harness: build the world for a CODE-phase retro.
#
#   compose-code-retro.sh <retro-name> <tests-dir> <goal-file> <brief-file> <campaign-dir> <code-run>...
#
# Decide-mode judgment over a cohort of code candidates. The world
# carries each candidate's product + BUILD.md, its transcript, and the
# platform's grade (GRADE.json + VALIDATION.txt FACTS, produced by the
# campaign's banked gate), plus that gate and the campaign plan so the
# retro can probe candidates and author the next phase's brief.
# Stamps TYPE=code for bank-phase dispatch.
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; BRIEF=$4; CAMPAIGN=$5; shift 5
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)

rm -rf $R && mkdir -p $R/workspace/candidates $R/workspace/platform $R/home/.pi/agent/extensions
echo code > $R/TYPE
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests
cp -al "$CAMPAIGN/gate/current/." $R/workspace/gate
[ -d "$CAMPAIGN/plan" ] && cp -a "$CAMPAIGN/plan" $R/workspace/plan
cp "$BINDIR/../PHASE-CONTRACT.md" "$BINDIR/../QE-CONTRACT.md" "$BINDIR/../GATE-CONTRACT.md" $R/workspace/platform/

CAND_LIST=""
for C in "$@"; do
  D=$R/workspace/candidates/$C
  mkdir -p $D
  # the whole workspace — exactly what banking would adopt — minus the
  # world artifacts
  find $HOME/control-runs/$C/workspace -mindepth 1 -maxdepth 1 \
       ! -name tests ! -name gate ! -name MANDATE.md -exec cp -a {} $D/ \;
  cat $(find $HOME/control-runs/$C/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl
  set +e
  bash $BINDIR/grade-code.sh "$CAMPAIGN" $HOME/control-runs/$C/workspace $D/GRADE.json > $D/VALIDATION.txt 2>&1
  set -e
  CAND_LIST="$CAND_LIST $C"
done

{
cat <<'MD'
# Code retrospective

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

A cohort of coding agents each worked the same phase brief
independently and delivered a product candidate. Their deliverables
are in candidates/<name>/ (product/ + BUILD.md), with each one's full
session transcript (transcript.jsonl) and the platform's grade —
produced by the campaign's banked gate — as FACTS: GRADE.json
(per-case verdicts over the in-scope tranche) and VALIDATION.txt (the
counts; a REJECT there is disqualifying).

Cohort:$CAND_LIST

## The brief this cohort worked (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<'MD'

You are the judgment of this platform, not one of its builders: you
read, run, and probe their deliverables to judge them, but you
never edit their deliverables — your output is prose and verdicts.
The banked gate is at gate/ (with the corpus at gate/tests/): re-grade
candidates, run targeted case sets, and read failing cases to judge
what the counts cannot — the honesty of BUILD.md, whether passes come
from real semantics or from shortcuts aimed at the tranche, regression
risk, and which candidate is the strongest foundation for the NEXT
phases of this campaign. The campaign plan (memory, not law) is at
plan/.

Deliver, in this order:
1. RETRO.md — your assessment of the cohort and of each candidate.
2. DECISION.md — the FIRST line must be a machine verdict, exactly one:

       BANK: <run-name>
       REDO: <one-line reason>

   BANK names the winning candidate; the platform banks its product as
   the campaign trunk (mechanical floor: it must turn >0 new in-scope
   cases green). REDO declares no candidate deserves that and a fresh
   cohort should run under a revised framing (state what must change).
   Everything after the first line is your rationale.
3. briefs/phase-<N>.md — the brief for the NEXT phase per plan/plan.md
   (first line exactly `TYPE: qe` or `TYPE: code`). A brief is the
   only channel to its cohort — self-contained, informed by what this
   cohort's work just taught you. The platform's fixed contracts are
   in platform/: a brief governs intent and scope and must never
   re-specify or alter the platform's deliverable layouts or
   invocations (quote them only exactly; where a brief disagrees, the
   platform wins). If the plan itself needs revising, say so in
   RETRO.md.

Work only inside this directory. tests/, gate/, plan/, and candidates/
are read-only.
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
    "denyWrite":[f"{R}/workspace/tests",f"{R}/workspace/gate",f"{R}/workspace/plan",f"{R}/workspace/candidates",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("code-retro world composed:", R)
PY
