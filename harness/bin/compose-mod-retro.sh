#!/bin/bash
# compose-mod-retro.sh — harness: build the world for a MODULE-CYCLE
# retro (one half of a cycle: the qe half judges candidate suites, the
# code half judges candidate implementations).
#
#   compose-mod-retro.sh <retro-name> <goal-file> <brief-file> <campaign-dir> <qe|code> <run>...
#
# Stamps TYPE=<half> and MODULE for bank-mod dispatch. The world gets
# the platform toolchain (probing power), the current trunk modules
# read-only, each candidate's module tree + transcript + the
# platform's validate-mod verdict as FACTS, the plan (memory), and the
# platform contracts. Deliverables: RETRO.md, DECISION.md (machine
# verdict), briefs/<next>.md (the next cycle's brief).
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; HALF=$5; shift 5
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform
case "$HALF" in qe|code) ;; *) echo "compose-mod-retro: half must be qe|code"; exit 1;; esac

hdr(){ grep -m1 -iE "^[#* ]*$1:" "$BRIEF" | sed -E "s/^[#* ]*$1:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
MODULE=$(hdr MODULE); KIND=$(hdr KIND); DEPENDS=$(hdr DEPENDS)
DEPENDS=$(echo "$DEPENDS" | sed -E 's/\([^)]*\)//g' | tr ',' ' ' | xargs || true)
case "$DEPENDS" in none|None|NONE|-) DEPENDS="" ;; esac
[ -n "$MODULE" ] || { echo "compose-mod-retro: brief has no MODULE: header"; exit 1; }

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
echo "$HALF" > $R/TYPE
echo "$MODULE" > $R/MODULE
echo "$DEPENDS" > $R/DEPENDS
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
cp "$BINDIR/../PHASE-CONTRACT.md" "$R/workspace/platform/"

# trunk modules for context/probing (read-only)
if [ -d "$CAMPAIGN/trunk/current/modules" ]; then
  cp -al "$CAMPAIGN/trunk/current/modules/." "$R/workspace/modules/"
fi
[ -d "$CAMPAIGN/plan" ] && cp -a "$CAMPAIGN/plan" "$R/workspace/plan"

# ledger baseline for code-half validation facts
BASE=""
if [ "$HALF" = "code" ] && [ -d "$CAMPAIGN/trunk/current/modules/$MODULE" ]; then
  BASE=$R/.baseline-ledger.json
  ( cd "$CAMPAIGN/trunk/current" && node platform/ledger/ledger.js "modules/$MODULE" ) > "$BASE" 2>/dev/null || BASE=""
fi

CAND_LIST=""
mkdir -p $R/workspace/candidates
for C in "$@"; do
  D=$R/workspace/candidates/$C
  mkdir -p $D/modules
  cp -a $HOME/control-runs/$C/workspace/modules/$MODULE $D/modules/$MODULE
  cat $(find $HOME/control-runs/$C/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl 2>/dev/null || true
  set +e
  bash $BINDIR/validate-mod.sh "$HOME/control-runs/$C/workspace" "$MODULE" "$HALF" ${BASE:+"$BASE"} > $D/VALIDATION.txt 2>&1
  set -e
  CAND_LIST="$CAND_LIST $C"
done

{
cat <<'MD'
# Module-cycle retrospective

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
if [ "$HALF" = "qe" ]; then cat <<MD

A QE cohort each independently authored the test suite for module
**$MODULE** (kind: $KIND) from the cycle brief below. Their suites are
in candidates/<name>/modules/$MODULE/test/ with each one's transcript
and the platform's mechanical verdict (VALIDATION.txt — facts; REJECT
is disqualifying). The coding cohort will build the module against the
SAME brief and must make the banked suite pass without ever editing
it — so the suite you bank becomes the module's requirements corpus.

Judge what the validator cannot: fidelity to the brief's interface
(names, signatures, behaviors EXACTLY — the coding cohort builds from
the brief; a suite that diverges from it manufactures failure);
doc-test quality as executable documentation (dependents will read
them as the interface); the opaque battery's substance (edge cases,
failure modes, invariants — not restatements of the doc tests);
failure-message clarity (each assertion must guide a fix without
revealing the check); and CODE-CONTRACT adherence in style.
MD
else cat <<MD

A coding cohort each independently built module **$MODULE** (kind:
$KIND) from the cycle brief below, against the banked suite (which
none of them could edit). Candidates are in
candidates/<name>/modules/$MODULE/ with transcripts and the platform's
mechanical verdict (VALIDATION.txt — compile, lint, suite, accretion;
REJECT is disqualifying).

A green suite is the floor, not the ceiling: probe BEYOND it. Write
scratch programs against each candidate under /tmp (copy the
workspace, overlay a candidate, run node) — hidden defects behind a
green suite have decided cohorts before. Judge design quality as a
foundation for future dependents (this module's interface and doc
tests are what they will see), CODE-CONTRACT spirit beyond what the
lint can check, and honesty of any notes left in the module docs.
MD
fi
cat <<MD

## The cycle brief (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<'MD'

You are the judgment of this platform, not one of its builders: you
read, run, and probe their deliverables to judge them, but you
never edit their deliverables — your output is prose and verdicts.
The current trunk is at modules/ (read-only); the plan (memory, not
law) is at plan/; the platform contracts are in platform/.

Deliver, in this order:
1. RETRO.md — your assessment of the cohort and of each candidate.
2. DECISION.md — the FIRST line must be a machine verdict, exactly one:

       BANK: <run-name>
       REDO: <one-line reason>

   BANK names the winner; the platform overlays its module half onto
   the trunk under the mechanical floor (isolated recheck; VOID if it
   fails). REDO declares no candidate deserves banking and a fresh
   cohort should run under a revised framing (state what must change).
MD
if [ "$HALF" = "code" ] && [ "${NO_NEXT_BRIEF:-0}" != 1 ]; then
echo "3. briefs/cycle-${NEXT_CYCLE:-<next>}.md — EXACTLY that filename —"
cat <<'MD'
   the brief for the NEXT cycle per plan/plan.md
   (first lines `TYPE: cycle`, `MODULE: <name>`,
   `KIND: noun|verb|shell`, `DEPENDS: <banked modules>` — then a
   self-contained body both cohorts can build from). You close this
   cycle, so you carry its full lessons into the next brief. If the
   plan itself needs revising, say so in RETRO.md.
MD
fi
cat <<'MD'

Work only inside this directory. candidates/, modules/, plan/, and
platform/ are read-only.
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
W=f"{R}/workspace"
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{W}/candidates",f"{W}/modules",f"{W}/plan",f"{W}/platform",f"{W}/node_modules",
                 f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("mod-retro world composed:", R, "| half=$HALF module=$MODULE candidates:$CAND_LIST")
PY
