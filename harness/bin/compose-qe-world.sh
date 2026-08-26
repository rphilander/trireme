#!/bin/bash
# compose-qe-world.sh — harness: build a QE world (QE-CONTRACT.md).
#
#   compose-qe-world.sh <run-name> <tests-dir> <goal-file> <brief-file> [cap-minutes] [gate-entry-dir]
#
# Brief-driven: the plan's brief (first line `TYPE: qe`) says what this
# phase must accomplish; the composer adds only platform framing — no
# domain vocabulary of its own. With no gate-entry-dir this is a
# bootstrap (empty workspace: the cohort builds the gate module from
# the bare corpus); with one, the banked module is copied in EDITABLE
# as the starting state.
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; BRIEF=$4; CAPMIN=${5:-90}; GATE=${6:-}
R=$HOME/control-runs/$NAME

TYPE=$(grep -m1 -vE '^\s*$' "$BRIEF" | sed -E 's/[#*_`]//g; s/^\s+|\s+$//g')
[ "$TYPE" = "TYPE: qe" ] || { echo "compose-qe-world: brief is not a qe brief (first line: $TYPE)"; exit 1; }

rm -rf $R && mkdir -p $R/workspace $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests
[ -n "$GATE" ] && cp -a "$GATE"/. $R/workspace/

{
cat <<'MD'
# QE phase — the internal suite & gate machinery

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<'MD'

Two estates build this campaign: coding cohorts build the product;
your QE cohort builds and owns the campaign's internal test suite and
gate machinery — the instrument every product candidate is measured
by. Many future build sessions depend on the gate judging FAITHFULLY —
per the acceptance corpus's own documented rules, not per what any
current implementation happens to do.

tests/ is the external acceptance corpus, read-only, exactly as it
ships (docs and harness files included). It is bedrock: never edited,
never reinterpreted to match current behavior. Your work brings it
gradually into scope for the coding estate.

## This phase's brief (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<'MD'

The brief governs intent, scope, and acceptance emphasis. If the brief
and this document disagree about file layouts, invocations, or output
shapes, the platform contract below wins — it is what the platform
verifies mechanically.
MD
[ -n "$GATE" ] && cat <<'MD'

## Starting state

This workspace already contains the current banked gate module — the
full deliverable layout below, as banked. It is yours to evolve per the
brief; leave the same layout behind.
MD
cat <<'MD'

## Deliverables (this exact layout, in this workspace)

1. bridge/run.mjs — the verdict runner (exact contract below).
2. contract.d.ts — the subject contract: the minimal public interface
   a candidate product must expose for run.mjs to evaluate it. Future
   builders code against exactly this; keep it small and honest.
3. inventory/cases.txt — the full case-id space of the acceptance
   corpus, one id per line; plus inventory/derive.mjs (re-runnable,
   regenerates cases.txt from tests/).
4. budgets.json — {"defaultTimeoutMs": N, "perCase": {"<id>": ms, ...}}
   — from measurements you make, not guesses.
5. scope/cases.txt — the tranche of inventory ids in scope for the
   NEXT coding phase (subset of the inventory, per the brief).
6. suite/self/run.mjs — the self-suite: tests OF your gate machinery
   itself (exact contract below). Craft scripted subjects conforming
   to your contract.d.ts with known properties (correct, subtly wrong,
   adversarial, slow, crashing, error-swallowing ...) and check the
   runner's verdicts against what the corpus rules REQUIRE. Probe
   content and structure, not just counts.
7. SUITE.md — each self-test family: what it asserts and which
   documented rule of the corpus requires it; plus your scope
   rationale and how a planner should think about conquering the
   corpus incrementally.
8. FINDINGS.md — every currently-red self-test with the claimed defect
   and evidence (may be empty if all green). A red test that claims a
   real defect is a FINDING: keep it red, document it. Never weaken a
   test to match current behavior.

## The gate contract (platform interface — exact)

    node bridge/run.mjs --subject <path> --cases <file|ALL> --out <path>
         [--workers N] [--timeout-ms N]

- reads case ids (one per line; # and blank lines ignored) from --cases,
  or the full inventory for ALL
- evaluates the subject (a file/module path; its required interface is
  whatever YOUR contract.d.ts declares) against each case
- writes {"results":[{"id","status","detail"?,"ms"?}]} to --out
- status is exactly one of: pass | fail | unsupported
- "unsupported" = the case cannot be evaluated through the subject
  interface, with a one-phrase reason in detail — never an ordinary
  failure
- ms = per-case wall milliseconds (the platform's timing ledger)
- NEVER crashes or hangs: a missing, empty, malformed, throwing, or
  looping subject yields per-case verdicts and exit 0; per-case
  timeouts kill stuck cases
- deterministic: same subject + cases ⇒ identical verdicts, run to run

## The self-suite contract (platform interface — exact)

    node suite/self/run.mjs --out <path>        (run from the workspace root)

- writes {"results":[{"id","status":"pass"|"fail","detail"?,"ms"?}]}
  — one result per self-test; "fail" detail states expected vs observed
- self-contained: scripted subjects and fixtures live under suite/
- never crashes or hangs; deterministic

The platform verifies mechanically before accepting your module:
missing-subject probe, empty-file-subject probe, double-run determinism
(same output path), output-shape and coverage checks, scope ⊆ inventory,
and a self-suite double run. Test all of these yourself before
finishing.

Work only inside this directory. tests/ is read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this entire session; budget your work accordingly. Every tool"
  echo "result is stamped with elapsed time, time remaining, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and deliver the QE module."
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
print("QE world composed:", R)
PY
