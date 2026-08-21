#!/bin/bash
# compose-trunk-world.sh — kernel: build a whole-trunk-editable builder world
# (the lifecycle-transition form used by entry 2's boundary revision; the
# module-scoped overlay form arrives with entry 3).
#
#   compose-trunk-world.sh <run-name> <pristine-home> <entry> <accepted-entry>...
#   e.g. compose-trunk-world.sh entry2-1 ~/control-runs/planner-2/workspace entry-2 entry-1
#
# World = the banked trunk (~/control-runs/trunk/current, EDITABLE src/) +
# the entry's BRIEF at root + this entry's and every accepted entry's case
# files and cases.txt (monotone checkpoint) + bridge (filtered inventory,
# kernel-minimal README) + contract. Plan content comes from the canonical
# plan repo (~/control-runs/plan). Write surface = src/engine/ + workspace
# scratch; package.json and all gate-defining files are write-denied.
set -euo pipefail
NAME=$1; P=$2; E=$3; shift 3
R=$HOME/control-runs/$NAME
PLANREPO=$HOME/control-runs/plan
TRUNK=$HOME/control-runs/trunk/current

rm -rf $R && mkdir -p $R/workspace/bridge $R/workspace/plan/$E $R/home/.pi/agent
mkdir -p $R/workspace/test262
cp -a $P/test262/harness $R/workspace/test262/harness

# trunk (editable) + its package.json (read-only)
cp -a $TRUNK/src $R/workspace/src
cp -a $TRUNK/package.json $R/workspace/package.json

# plan content from the canonical repo: this entry + accepted entries
cp $PLANREPO/$E/cases.txt $R/workspace/plan/$E/cases.txt
cp $PLANREPO/$E/BRIEF.md $R/workspace/BRIEF.md
ALL_IDS=$R/.all-ids
cp $PLANREPO/$E/cases.txt $ALL_IDS
for A in "$@"; do
  mkdir -p $R/workspace/plan/$A
  cp $PLANREPO/$A/cases.txt $R/workspace/plan/$A/cases.txt
  cp $PLANREPO/$A/BRIEF.md $R/workspace/plan/$A/BRIEF.md
  cat $PLANREPO/$A/cases.txt >> $ALL_IDS
done

# case files + filtered inventory over the union
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
echo "BRIEF.md is your assignment. Build the product." > $R/prompt.txt

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
    "denyWrite":[f"{R}/workspace/test262",f"{R}/workspace/bridge",f"{R}/workspace/plan",
                 f"{R}/workspace/BRIEF.md",f"{R}/workspace/contract.d.ts",
                 f"{R}/workspace/package.json",f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("trunk world composed:", R)
PY
