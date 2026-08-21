#!/bin/bash
# compose-entry-world.sh — kernel prototype: build a hard-scoped builder world.
#
#   compose-entry-world.sh <run-name> <plan-workspace> <entry-dir-name>
#   e.g. compose-entry-world.sh entry1-1 ~/control-runs/planner-2/workspace entry-1
#
# World = BRIEF at root + only the entry's case files (+ full test262/harness)
# + bridge (run.mjs, stub, inventory FILTERED to the entry, kernel-minimal
# README) + contract.d.ts + PRODUCT.md. Greenfield form (no trunk yet); the
# overlay/trunk variant is specced in wiki harness/pipeline.md but not yet
# scripted. Verify after composing:
#   cd <world> && node bridge/run.mjs --subject bridge/stub.mjs \
#     --cases plan/<entry>/cases.txt --out /tmp/check.json
set -euo pipefail
NAME=$1; P=$2; E=$3
R=$HOME/control-runs/$NAME
rm -rf $R && mkdir -p $R/workspace/bridge $R/workspace/plan/$E $R/home/.pi/agent
mkdir -p $R/workspace/test262
cp -a $P/test262/harness $R/workspace/test262/harness
while read -r id; do
  [ -z "$id" ] && continue
  mkdir -p "$R/workspace/test262/$(dirname "$id")"
  cp "$P/test262/$id" "$R/workspace/test262/$id"
done < $P/plan/$E/cases.txt
cp $P/bridge/run.mjs $P/bridge/stub.mjs $R/workspace/bridge/
python3 -c "
import json
ids=set(l.strip() for l in open('$P/plan/$E/cases.txt') if l.strip())
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
cp $P/plan/$E/cases.txt $R/workspace/plan/$E/cases.txt
cp $P/plan/$E/BRIEF.md $R/workspace/BRIEF.md
cp ~/src/trireme/experiments/bridge/PRODUCT.md $R/workspace/PRODUCT.md
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
                 f"{R}/workspace/BRIEF.md",f"{R}/workspace/contract.d.ts",f"{R}/workspace/PRODUCT.md",
                 f"{R}/settings.json"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("world composed:", R)
PY
