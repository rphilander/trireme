#!/bin/bash
# close-depends.sh <campaign-dir> <brief-relpath> — interface-close a
# brief's DEPENDS against the CURRENT tip (mechanical fixed point over
# banked .d.ts references; v2 precedent 4182c97/f7e3b32). Briefs are
# kernel-managed intent artifacts; the correction is a kernel commit.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; REL=$2
HIST=$CAMPAIGN/history
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
bash "$(dirname "$0")/stage-tip.sh" "$CAMPAIGN" "$STAGE"
python3 - "$STAGE" "$HIST/$REL" <<'PY'
import re, sys, glob, os
STAGE, BRIEF = sys.argv[1], sys.argv[2]
refs = {}
for m in os.listdir(f"{STAGE}/modules"):
    if not os.path.isdir(f"{STAGE}/modules/{m}"): continue
    rs = set()
    for f in glob.glob(f"{STAGE}/modules/{m}/**/*.d.ts", recursive=True):
        if "/test/" in f: continue
        rs |= set(re.findall(r"(?:import|export)[^;]*from\s*['\"]#modules/([a-z0-9-]+)", open(f).read()))
    refs[m] = rs - {m}
b = open(BRIEF).read()
line = re.search(r"^DEPENDS:\s*(.*)$", b, re.M)
if not line: sys.exit(0)
d = set(re.sub(r"\([^)]*\)", "", line.group(1)).replace(",", " ").split()) - {"none", "None", "-"}
S = set(d)
while True:
    add = set().union(*(refs.get(m, set()) for m in S)) - S if S else set()
    if not add: break
    S |= add
extra = sorted(S - d)
if extra:
    open(BRIEF, "w").write(b.replace(line.group(0), "DEPENDS: " + ", ".join(sorted(S)), 1))
    print(f"closed: +{', '.join(extra)}")
PY
if ! git -C "$HIST" diff --quiet -- "$REL"; then
  git -C "$HIST" add "$REL"
  git -C "$HIST" -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "$(basename "$REL" .md) DEPENDS interface-closed against tip — kernel mechanical closure per compose floor"
  echo "DEPENDS closed for $REL"
fi
