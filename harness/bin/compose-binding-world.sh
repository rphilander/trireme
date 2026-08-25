#!/bin/bash
# compose-binding-world.sh — harness: build a BINDING world.
#
#   compose-binding-world.sh <run-name> <tests-dir> <goal-file> [cap-minutes]
#
# The binding agent's world: the operator's goal (verbatim), the
# acceptance-test directory exactly as it ships (read-only), an otherwise
# empty workspace, and the two platform contracts. NO domain vocabulary:
# rediscovering the domain's structure is the binding agent's job
# (BINDING-CONTRACT.md).
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; CAPMIN=${4:-90}
R=$HOME/control-runs/$NAME
HARNESS=$HOME/src/trireme/harness

rm -rf $R && mkdir -p $R/workspace $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests

GOAL=$(cat "$GOALF")
cat > $R/workspace/MANDATE.md <<MD
# Binding

GOAL (the operator's words, verbatim):

> $GOAL

The acceptance tests for this goal are in tests/ (read-only, exactly as
they ship — including any docs or harness files they contain). Your job
is NOT to build the product. Your job is to BIND this problem to the
platform: study the acceptance suite and deliver the artifacts below.
The platform will use them to drive many future build sessions by other
agents who will see your contract and your inventory, not the raw suite.

Deliverables, in this workspace:

1. bridge/run.mjs — the verdict runner (exact contract below).
2. inventory/cases.txt — the full case-id space of the acceptance
   suite, one id per line; plus inventory/derive.mjs (re-runnable,
   regenerates cases.txt from tests/).
3. contract.d.ts — the subject contract: the minimal public interface a
   candidate product must expose for run.mjs to evaluate it. Future
   builders code against exactly this; keep it small and honest.
4. budgets.json — {"defaultTimeoutMs": N, "perCase": {"<id>": ms, ...}}
   — from measurements you make, not guesses.
5. BINDING.md — your rationale: how the suite is organized; which cases
   run.mjs reports "unsupported" and the one-phrase reason each class
   carries; determinism hazards you found; and how a planner should
   think about conquering this suite incrementally.

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

The platform verifies mechanically before accepting your binding:
missing-subject probe, empty-file-subject probe, double-run determinism
on a sample, output-shape and coverage checks. Test all of these
yourself before finishing.

Work only inside this directory. tests/ is read-only.
MD

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this entire session; budget your work accordingly. Every tool"
  echo "result is stamped with elapsed time, time remaining, and spend."
  echo
  echo "Read MANDATE.md in the workspace root and deliver the binding."
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
print("binding world composed:", R)
PY
