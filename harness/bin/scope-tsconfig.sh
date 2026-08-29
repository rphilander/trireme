#!/bin/bash
# scope-tsconfig.sh <workspace> <module> — the compilation unit is the
# module's own sources (+ product/ for shell assembly). Dep doc tests
# are documentation and compiled artifacts, never recompiled by
# dependents (their type closure is theirs, not yours).
set -euo pipefail
W=$1; M=$2
python3 - "$W" "$M" <<'PY'
import json, sys
p=f"{sys.argv[1]}/tsconfig.json"
d=json.load(open(p))
d["include"]=[f"modules/{sys.argv[2]}/**/*.ts","product/**/*.ts"]
json.dump(d,open(p,"w"),indent=2)
PY
