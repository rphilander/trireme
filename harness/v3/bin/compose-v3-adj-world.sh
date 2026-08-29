#!/bin/bash
# compose-v3-adj-world.sh — adjudication session world: the arbiter of
# the conversation. Full visibility (tip source, estates, challenges,
# verdict facts, failure logs); contributes DECISIONS — immutable
# directives the kernel executes. Convened by the governor, never a
# merge gate.
#
#   compose-v3-adj-world.sh <run-name> <goal-file> <brief-file> <campaign-dir> [cap-minutes]
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; CAPMIN=${5:-45}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../../platform

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions $R/workspace/frontier
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
git -C "$CAMPAIGN/history" archive HEAD | tar -x -C "$R/workspace" 2>/dev/null || true
mkdir -p "$R/workspace/decisions"
cp "$BRIEF" "$R/workspace/frontier/brief.md"
bash "$BINDIR/accounting.sh" "$CAMPAIGN" > "$R/workspace/frontier/ACCOUNTING.json"
[ -f "$CAMPAIGN/verdicts.jsonl" ] && cp "$CAMPAIGN/verdicts.jsonl" "$R/workspace/frontier/verdicts.jsonl"
[ -d "$CAMPAIGN/verdict-logs" ] && cp -a "$CAMPAIGN/verdict-logs" "$R/workspace/frontier/verdict-logs"
NEXTNUM=$(printf '%04d' $(( $(ls "$R/workspace/decisions"/*.md 2>/dev/null | wc -l) + 1 )))

{
cat <<'MD'
# Adjudication — the conversation's arbiter

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are the ADJUDICATOR under the bankless ledger. The append-only
history is mounted (modules/ = published source and tests;
challenges/; decisions/), plus the frontier: frontier/ACCOUNTING.json
(live green/red/pending/challenged), frontier/verdicts.jsonl
(immutable verdict facts), frontier/verdict-logs/ (failure output of
red pairs), frontier/brief.md (the intent being pursued).

Judge the frontier and DECIDE. Your deliverable is exactly one file:

    decisions/$NEXTNUM-<short-slug>.md

Prose first — your reasoning, standards applied, what you verified —
then directive lines the kernel executes mechanically, each on its
own line:

    COLLECT: <relpath>              retire a test or challenge file
    COLLECT-DEF: <module> <name>    retire one definition (everything
                                    still referencing it must be
                                    collected in the SAME decision)
    NEXT: qe <module>               the next session to convene
    NEXT: code <module>
    DONE: <brief-slug>              the brief's criteria hold; the
                                    conversation for it is closed

Principles you enforce:
- A red test is either a code defect (direct NEXT: code), a wrong
  claim (COLLECT it, with reasoning), or a standing dispute you
  resolve now. Rule on every open challenge: side with the coder →
  COLLECT the test; side with the test → say so (the coder must
  satisfy it) and leave the challenge for collection with a note.
- Supersessions: when f2 replaces f, direct the migration (NEXT: qe
  for migration tests) and, once nothing references f, COLLECT-DEF it
  with its retired tests in one decision.
- The green suite is a floor, not a ceiling: probe BEYOND the estate
  before DONE — read the code, try the interfaces, hunt defects the
  claims missed. DONE only when you would stake the campaign on it.
- When your probing finds a GENUINE defect in published code, do not
  close DONE on a disclosure or a doc note: direct the fix — NEXT:
  code, naming the defect and the successor definition expected —
  and see the supersession through (migration claims, then the
  orphan's collection) in later convenings.
- PLAN FRICTION IS A FINDING: if this module's carving or its brief's
  framing is fighting the conversation (a boundary in the wrong
  place, a pin the platform cannot honor, scope that belongs
  elsewhere), say so explicitly in your decision prose — the plan is
  a prior, not a law, and your notes are how it improves.
- TYPES CARRY SEMANTICS: when reviewing a wave, check whether any
  successor changed a value's MEANING under an unchanged type (same
  scalar, new interpretation). That is a finding — demand a branded
  type (platform Brand) so the checker, and therefore the wave's
  frontier, sees the semantic change. Mechanical migration past a
  semantic break is the failure mode this standard exists to stop.
- Immutability is absolute: never direct anyone to edit a published
  artifact; every correction is supersede-and-collect.

Work only inside this directory; everything except decisions/ is
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md, frontier/ACCOUNTING.json, and the failure logs,"
  echo "then deliver your decision."
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
    "denyWrite":[f"{W}/modules",f"{W}/challenges",f"{W}/frontier",f"{W}/platform",f"{W}/node_modules",
                 f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("v3 adjudication world composed:", R)
PY
