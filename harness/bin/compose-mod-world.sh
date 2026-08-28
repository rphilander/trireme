#!/bin/bash
# compose-mod-world.sh — harness: build a MODULAR code world from a
# module brief (modular-mode charter; CODE-CONTRACT).
#
#   compose-mod-world.sh <run-name> <goal-file> <brief-file> <campaign-dir> [cap-minutes]
#
# The brief's machine header declares the phase:
#   TYPE: code
#   MODULE: <name>
#   KIND: noun|verb|shell
#   DEPENDS: <name> <name> ...     (may be absent)
#
# World = platform payload (compiled facade+lint+ledger+CODE-CONTRACT,
# vendored tsc; offline) + own module (banked state if it exists, its
# banked .ts frozen at FILE level — emitted .js stays regenerable) +
# for each declared dep: its INTERFACE ONLY (.d.ts + compiled .js +
# doc tests). No corpus, no other modules: O(1) by construction.
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; CAPMIN=${5:-90}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform

hdr(){ grep -m1 -iE "^[#* ]*$1:" "$BRIEF" | sed -E "s/^[#* ]*$1:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
TYPE=$(hdr TYPE); MODULE=$(hdr MODULE); KIND=$(hdr KIND); DEPENDS=$(hdr DEPENDS)
# normalize DEPENDS: strip parentheticals; none/dash mean empty
DEPENDS=$(echo "$DEPENDS" | sed -E 's/\([^)]*\)//g' | tr ',' ' ' | xargs || true)
case "$DEPENDS" in none|None|NONE|-) DEPENDS="" ;; esac
[ "$TYPE" = "cycle" ] || { echo "compose-mod-world: brief TYPE must be cycle (got: ${TYPE:-none})"; exit 1; }
[ -n "$MODULE" ] || { echo "compose-mod-world: brief has no MODULE: header"; exit 1; }
case "$KIND" in noun|verb|shell) ;; *) echo "compose-mod-world: KIND must be noun|verb|shell (got: ${KIND:-none})"; exit 1;; esac

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null

TRUNK=$CAMPAIGN/trunk/current
FROZEN=()
# own module: banked starting state if present (reopen), else fresh
mkdir -p "$R/workspace/modules/$MODULE"
if [ -d "$TRUNK/modules/$MODULE" ]; then
  cp -a "$TRUNK/modules/$MODULE/." "$R/workspace/modules/$MODULE/"
  while IFS= read -r f; do FROZEN+=("$f"); done \
    < <(cd "$R/workspace" && find "modules/$MODULE" -name '*.ts' ! -name '*.d.ts' ! -path '*/test/*')
fi

# deps: interface surface only — .d.ts + compiled .js + doc tests
for D in $DEPENDS; do
  SRC=$TRUNK/modules/$D
  [ -d "$SRC" ] || { echo "compose-mod-world: dependency '$D' is not banked"; exit 1; }
  DST=$R/workspace/modules/$D
  mkdir -p "$DST"
  ( cd "$SRC" && find . -name '*.d.ts' -o \( -name '*.js' ! -path './test/*' \) ) | while IFS= read -r f; do
    mkdir -p "$DST/$(dirname "$f")"
    cp "$SRC/$f" "$DST/$f"
  done
  [ -d "$SRC/test/doc" ] && { mkdir -p "$DST/test"; cp -a "$SRC/test/doc" "$DST/test/doc"; }
done

{
cat <<'MD'
# Code phase — one module

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are a coding cohort building ONE module: **$MODULE** (kind: $KIND).
platform/CODE-CONTRACT.md is the language you write in — read it
first; the lint enforces it and the bank rejects violations. Your
module's own tests (modules/$MODULE/test/) are the QE estate's
deliverable: you make them pass; you never edit them. Dependencies you
declared are present as interfaces only (.d.ts + compiled .js + their
doc tests, which are executable documentation).

## This phase's brief (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<MD

The brief governs intent, scope, and acceptance emphasis. Where it and
the platform contracts disagree on layouts or invocations, the
platform contracts win.

## Deliverables

Everything lives in modules/$MODULE/ (source .ts per CODE-CONTRACT;
compiled .js + .d.ts via the toolchain). Banked source files, if any,
are frozen — accretion only: add functions, never edit; supersede with
f2 and note @superseded-by.

## Commands (run from the workspace root)

    node node_modules/typescript/lib/tsc.js -p tsconfig.json   # compile (must be clean)
    node platform/lint/check.js modules/$MODULE                # lint (must be clean)
    node --test "modules/$MODULE/test/**/*.test.js"            # the module suite
    node platform/ledger/ledger.js modules/*                   # definitions/nodes ledger

The platform verifies at the bank: compile-clean, lint-clean, ledger
accretion (additions + orphan deletions only), your suite, and the
global no-regression grade. Test all of it yourself before finishing.

Work only inside modules/$MODULE/. Everything else is read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this entire session; budget your work accordingly. Every tool"
  echo "result is stamped with elapsed time, time remaining, and spend."
  echo
  echo "Read MANDATE.md and platform/CODE-CONTRACT.md, then build the module."
} > $R/prompt.txt

python3 -c "
import json
d=json.load(open('$HOME/.pi/agent/models.json'))
d['providers']['deepseek'].pop('baseUrl',None)
open('$R/home/.pi/agent/models.json','w').write(json.dumps(d,indent=1))"

FROZEN_JSON=$(printf '%s\n' "${FROZEN[@]:-}" | python3 -c "import json,sys;print(json.dumps([l for l in sys.stdin.read().split('\n') if l]))")
python3 - <<PY
import json, os
H=os.path.expanduser("~")
R=f"{H}/control-runs/$NAME"
W=f"{R}/workspace"
frozen=[f"{W}/{p}" for p in json.loads('$FROZEN_JSON')]
deps="$DEPENDS".split()
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":[f"{W}/platform",f"{W}/node_modules",f"{W}/package.json",f"{W}/tsconfig.json",
                 f"{W}/MANDATE.md",f"{R}/settings.json",
                 f"{W}/modules/$MODULE/test"]
                +[f"{W}/modules/{d}" for d in deps]
                +frozen},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("mod world composed:", R, "| module=$MODULE kind=$KIND deps=[$DEPENDS] frozen:", len(frozen))
PY
