#!/bin/bash
# compose-module-world.sh — kernel: build a module-scoped brownfield builder
# world (the steady-state form: whole trunk present and RUNNABLE, but only
# the entry's declared module files are writable — freeze-not-hide; the
# .d.ts hiding variant can replace freezing when codebase scale demands it).
#
#   compose-module-world.sh <run-name> <pristine-home> <entry> <editable-rel-path>...
#   e.g. compose-module-world.sh entry3a-1 ~/control-runs/planner-2/workspace entry-3 \
#          src/engine/evaluator.ts src/engine/environment.ts
#
# World = trunk/current (full copy; only <editable> writable) + entry BRIEF
# at root + this entry's and every prior entry's cases.txt + case files +
# bridge (filtered inventory) + contract + trireme-shell extension in the
# run home. Prompt states the total wall budget (settled 2026-08-21).
set -euo pipefail
NAME=$1; P=$2; E=$3; shift 3
R=$HOME/control-runs/$NAME
PLANREPO=$HOME/control-runs/plan
# Base for the world's src: the banked trunk by default; a lineage driver
# overrides via TRIREME_BASE to stack a layer on the lineage's own result.
TRUNK=${TRIREME_BASE:-$HOME/control-runs/trunk/current}

rm -rf $R && mkdir -p $R/workspace/bridge $R/home/.pi/agent/extensions
mkdir -p $R/workspace/test262
cp -a $P/test262/harness $R/workspace/test262/harness
cp -a $TRUNK/src $R/workspace/src
cp -a $TRUNK/package.json $R/workspace/package.json

# plan content: this entry + every prior entry (monotone gate)
N=${E#entry-}
ALL_IDS=$R/.all-ids; : > $ALL_IDS
for i in $(seq 1 $N); do
  A=entry-$i
  mkdir -p $R/workspace/plan/$A
  cp $PLANREPO/$A/cases.txt $R/workspace/plan/$A/cases.txt
  cat $PLANREPO/$A/cases.txt >> $ALL_IDS
done
cp ${TRIREME_BRIEF:-$PLANREPO/$E/BRIEF.md} $R/workspace/BRIEF.md
sort -u $ALL_IDS > $ALL_IDS.u && mv $ALL_IDS.u $ALL_IDS
while read -r id; do
  [ -z "$id" ] && continue
  mkdir -p "$R/workspace/test262/$(dirname "$id")"
  cp "$P/test262/$id" "$R/workspace/test262/$id"
done < $ALL_IDS
cp $P/bridge/run.mjs $P/bridge/stub.mjs $R/workspace/bridge/
python3 -c "
import json
ids=set(l.strip() for l in open('$ALL_IDS') if l.strip())
d=[e for e in json.load(open('$P/bridge/cases.json')) if e['id'] in ids]
json.dump(d, open('$R/workspace/bridge/cases.json','w'))
print('filtered inventory:', len(d))"
cat > $R/workspace/bridge/README.md <<'RM'
# Bridge
The grading harness. Usage:
    node bridge/run.mjs --subject <module-exporting-run> --cases <id-file|ALL> --out <results.json>
bridge/cases.json is the case inventory with per-case metadata. Case files
live under test262/ at the path given by their id; the runner splices required
harness files (test262/harness/) per the corpus conventions and judges the
outcome. bridge/stub.mjs is a minimal example subject. See run.mjs header
comments for convention details.
RM
cp ~/src/trireme/experiments/bridge/contract.d.ts $R/workspace/contract.d.ts
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
{ printf 'BRIEF.md is your assignment. Build the product. You have %d minutes of wall clock for this session.\n' $(( ${CAP_S:-5400} / 60 ))
  printf 'Platform contract: if you conclude a listed case cannot pass within your editable surface, keep it red and file it in CHALLENGES.md at the workspace root (case ids, your claim, your evidence) — never implement around your surface. The retrospective adjudicates challenges; honest reds with correct challenges outrank workarounds.\n'
} > $R/prompt.txt

python3 -c "
import json
d=json.load(open('$HOME/.pi/agent/models.json'))
d['providers']['deepseek'].pop('baseUrl',None)
open('$R/home/.pi/agent/models.json','w').write(json.dumps(d,indent=1))"
EDITABLE_JSON=$(printf '%s\n' "$@" | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")
python3 - <<PY
import json, os
H=os.path.expanduser("~")
R=f"{H}/control-runs/$NAME"
editable=set(json.loads('$EDITABLE_JSON'))
# freeze every trunk src file that is not declared editable
frozen=[]
for root,_,files in os.walk(f"{R}/workspace/src"):
    for f in files:
        p=os.path.join(root,f)
        rel=os.path.relpath(p, f"{R}/workspace")
        if rel not in editable: frozen.append(p)
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{R}/workspace/test262",f"{R}/workspace/bridge",f"{R}/workspace/plan",
                 f"{R}/workspace/BRIEF.md",f"{R}/workspace/contract.d.ts",
                 f"{R}/workspace/package.json",f"{R}/settings.json"]+sorted(frozen)},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("module world composed:", R, "| frozen src files:", len(frozen), "| editable:", sorted(editable))
PY
