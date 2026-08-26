#!/bin/bash
# compose-qe-world.sh — harness: build a QE world (author the binding's
# acceptance suite). QE-CONTRACT.md.
#
#   compose-qe-world.sh <run-name> <tests-dir> <goal-file> <binding-run> [cap-minutes]
set -euo pipefail
NAME=$1; TESTS=$2; GOALF=$3; BINDING=$4; CAPMIN=${5:-90}
R=$HOME/control-runs/$NAME

rm -rf $R && mkdir -p $R/workspace/binding $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
cp -al "$TESTS" $R/workspace/tests
for item in bridge inventory contract.d.ts budgets.json BINDING.md; do
  [ -e $HOME/control-runs/$BINDING/workspace/$item ] && cp -a $HOME/control-runs/$BINDING/workspace/$item $R/workspace/binding/ || true
done

GOAL=$(cat "$GOALF")
cat > $R/workspace/MANDATE.md <<MD
# QE — the binding's acceptance suite

GOAL of the overall effort (the operator's words, verbatim):

> $GOAL

The platform drives that goal through a BINDING: the verdict runner and
subject contract in binding/ (read-only), which judges candidate
products against the acceptance tests in tests/ (read-only). Many
future build sessions depend on the binding judging FAITHFULLY — per
the acceptance suite's own documented rules, not per what the current
binding happens to do.

Your estate owns the binding's requirements-corpus. Author the
acceptance suite FOR the binding machinery itself:

- **Scripted subjects**: implementations of binding/contract.d.ts you
  craft with known properties (correct, subtly wrong, adversarial,
  slow, crashing, nondeterministic, error-swallowing ...). Running the
  binding's runner over a scripted subject and checking its verdicts
  against what the corpus rules REQUIRE is your sharpest instrument.
  Probe content and structure, not just counts.
- **Structural probes**: inventory fidelity, determinism, timeout
  containment, output shape, per-mode/per-phase behavior — whatever
  tests/'s own documentation obligates.

A test that is RED against the current binding is a FINDING when it
claims a real defect: keep it red, document it in FINDINGS.md with
evidence. Never weaken a test to match current behavior.

Deliverables (in this workspace):
1. suite/run.mjs — invocation contract:
       node suite/run.mjs --binding <binding-dir> --out <path>
   writing {"results":[{"id","status":"pass"|"fail","detail"?,"ms"?}]}
   — one result per test, deterministic, never crashes or hangs, fully
   self-contained (bring your own subjects/fixtures under suite/).
2. SUITE.md — each test family: what it asserts, and which documented
   rule of the acceptance corpus requires it.
3. FINDINGS.md — every currently-red test with the claimed defect and
   evidence (may be empty if all green).

Work only inside this directory. tests/ and binding/ are read-only.
MD

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped."
  echo
  echo "Read MANDATE.md in the workspace root and deliver the suite."
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
    "denyWrite":[f"{R}/workspace/tests",f"{R}/workspace/binding",f"{R}/workspace/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("QE world composed:", R)
PY
