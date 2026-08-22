#!/bin/bash
# compose-retro-world.sh — kernel prototype: build a step-D retrospective world.
#
#   compose-retro-world.sh <run-name> <pristine-home> <entry-name> <builder-run>...
#   e.g. compose-retro-world.sh retro-e1 ~/control-runs/planner-2/workspace entry-1 entry1-1 entry1-2 entry1-3
#
# Spec: experiments/bridge/RETRO-CONTRACT.md (v1.2: the retro names the
# winner, never touches code — banking is kernel work, see bank-trunk.sh).
# <pristine-home> supplies the UNFILTERED bridge + full corpus; plan/ is a
# git clone (full history, --no-hardlinks) of the canonical plan repo
# ~/control-runs/plan — the retro may read how the plan evolved; the kernel
# commits its revision back afterwards (commit-plan.sh, message =
# workspace/REVISION.md). The retro sees everything the planner saw plus
# the cohort's runs; plan/ is its writable deliverable surface. Each
# <builder-run> dir must contain gate.json (the kernel's pristine-gate
# verdicts, persisted there after grading). test262 and cases.json are
# hardlinked (cp -al) for speed; srt denies writes to them.
set -euo pipefail
NAME=$1; P=$2; E=$3; shift 3
NEXT="entry-$(( ${E#entry-} + 1 ))"
R=$HOME/control-runs/$NAME

rm -rf $R && mkdir -p $R/workspace/runs $R/workspace/bridge $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
git clone -q --no-hardlinks $HOME/control-runs/plan $R/workspace/plan
cp -al $P/test262 $R/workspace/test262
cp -a $P/bridge/run.mjs $P/bridge/stub.mjs $P/bridge/README.md $P/bridge/generate.mjs $R/workspace/bridge/
cp -al $P/bridge/cases.json $R/workspace/bridge/cases.json

for B in "$@"; do
  D=$R/workspace/runs/$B
  mkdir -p $D
  cp -a $HOME/control-runs/$B/workspace/src $D/src
  cp -a $HOME/control-runs/$B/workspace/package.json $D/package.json
  cp -a $HOME/control-runs/$B/gate.json $D/gate.json
  cat $(find $HOME/control-runs/$B/home/.pi/agent/sessions -name '*.jsonl' | sort) > $D/transcript.jsonl
done

if [ -d $HOME/control-runs/trunk/current ]; then
  mkdir -p $R/workspace/trunk-before
  cp -a $HOME/control-runs/trunk/current/src $R/workspace/trunk-before/src
fi
KLOG=$HOME/control-runs/kernel-logs/$E.md
if [ -f "$KLOG" ]; then cp "$KLOG" $R/workspace/KERNEL-LOG.md
else echo "# Kernel intervention log — $E cohort: no interventions." > $R/workspace/KERNEL-LOG.md; fi

cat > $R/workspace/MANDATE.md <<'MD'
# Retrospective — @ENTRY@

You are the retrospective for @ENTRY@ of the plan of record (plan/PLAN.md).
A cohort of builders each executed plan/@ENTRY@/BRIEF.md independently, in
isolated worlds, from scratch. Everything about those runs is in runs/:

    runs/<builder>/transcript.jsonl    the builder's full session, as it ran
    runs/<builder>/src/, package.json  the code it shipped
    runs/<builder>/gate.json           its pristine-gate verdicts

KERNEL-LOG.md records the platform's interventions during the runs (killed
wedged processes show up in transcripts as tool calls returning no output) —
read it before attributing those events. trunk-before/ is the trunk the
builders started from, as banked after the previous entry.

The grading bridge and the full corpus are in bridge/ and test262/ (see
bridge/README.md). The corpus is the requirement; the plan is how we intend
to conquer it. plan/ is a git clone of the plan's repository: its history
(git log -p) is the plan's evolution across every planning and retro cycle
so far — consult it if useful.

You are the engineering judgment of this project, not one of its builders:
you read code to judge it, but you never write, copy, or restructure code —
your deliverables are prose and the plan. Deliver, in this order:

1. RETRO.md — your assessment of @ENTRY@: what the runs reveal about the
   plan, the brief, the process, the platform. Direct and specific.

2. DECISION.md — name exactly ONE of the builder runs as the winner. Its
   codebase will be banked verbatim, by the platform, as the trunk that
   everything later builds on. Record which run and why — the rationale is
   as much a deliverable as the pick. The other runs stay archived; if one
   contains something specifically worth stealing later, say so.
   If the plan schedules a boundary revision at this retrospective (see
   PLAN.md), whether and when it happens is your call — but it happens as
   work you schedule in the revised plan (an entry's scope), never as work
   you perform. Record the call and its reasoning.

3. A revised plan/PLAN.md — the plan is a living document and you own it
   this cycle. Reconcile it with what actually got built; fold in whatever
   @ENTRY@ taught you. Alongside it, write REVISION.md (at the workspace
   root, next to RETRO.md): a short summary of what you changed in the plan
   and why — the platform commits your revision to the plan's repository
   with your note as the commit message, under your name. Leave committing
   to the platform; the canonical repository is not yours to push to.

4. The next phase, plan/@NEXT@/ — derived per the plan's conventions:
   cases.txt (the phase's delta) at the phase root, always. A single-layer
   phase adds BRIEF.md and editable.txt (the editable paths, one per line)
   at the phase root. A multi-layer phase instead adds layer-1/BRIEF.md +
   layer-1/editable.txt, layer-2/..., in build order (see the vocabulary
   section below). Every brief is sized for one capped session and written
   for a builder who sees only that world; editable.txt is the machine
   contract the platform composes the world from — the brief's prose and
   editable.txt must agree.

Work only inside this directory.

## Change vocabulary (platform contract)

The platform models work in these terms; use them in your assessment, the
revised plan, and the next brief:

- A **phase** of the plan contains one **stack**: an ordered sequence of
  **layers**. A layer is atomic work in one module (create or reopen),
  plus thin **wiring** (single-line-scale edits: a registry line, a
  barrel import, a hook call).
- Every layer must keep the full accepted suite green; a layer need not
  light new acceptance cases — **the stack as a whole must light the
  phase's delta**. Interior layers may be delta-neutral.
- Any edit to a non-owned module thicker than wiring is a **layer** — a
  reopen, named as such, with a declared **interface delta** (what its
  exported surface gains).
- Multi-layer phases run as **racing lineages**: each of the cohort's
  builds is a whole stack, assembled by a relay of fresh agents (one per
  layer, mechanically gate-checked between layers). You judge the
  completed stacks. Single-layer phases are the ordinary case.
- **Declaring a multi-layer phase** (so the platform can run it): put the
  stack's delta in plan/<phase>/cases.txt as usual, and give each layer a
  directory — plan/<phase>/layer-1/BRIEF.md + layer-1/editable.txt (the
  layer's editable paths, one per line), layer-2/..., in build order.
  Each layer's brief is that agent's entire assignment; write it for a
  builder who sees only that layer's world. A single-layer phase keeps
  BRIEF.md at the phase root and declares its editable paths in a root
  editable.txt the same way.
MD
sed -i "s/@ENTRY@/$E/g; s/@NEXT@/$NEXT/g" $R/workspace/MANDATE.md
echo "MANDATE.md is your assignment." > $R/prompt.txt

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
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{R}/workspace/test262",f"{R}/workspace/bridge",f"{R}/workspace/runs",
                 f"{R}/workspace/MANDATE.md",f"{R}/workspace/KERNEL-LOG.md",f"{R}/workspace/trunk-before",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("retro world composed:", R)
PY
