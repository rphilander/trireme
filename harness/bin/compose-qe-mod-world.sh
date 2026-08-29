#!/bin/bash
# compose-qe-mod-world.sh — harness: build a MODULAR QE world from a
# module brief: the QE cohort authors the module's test suite (doc +
# opaque) from the brief alone — the perspective-separation half of the
# cycle. Writable surface = the module's test/ directory only.
#
#   compose-qe-mod-world.sh <run-name> <goal-file> <brief-file> <campaign-dir> [cap-minutes]
#
# Header: TYPE: qe / MODULE: <name> / KIND: noun|verb|shell / DEPENDS: ...
# Reopen: the module's banked INTERFACE (.d.ts + .js) is mounted (never
# its source); banked test files are frozen (test accretion). Bootstrap:
# the module does not exist yet — tests are born red and will first
# compile when the code cohort delivers (write them against the brief's
# interface exactly).
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; CAPMIN=${5:-60}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../platform

hdr(){ grep -m1 -iE "^[#* ]*$1:" "$BRIEF" | sed -E "s/^[#* ]*$1:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
TYPE=$(hdr TYPE); MODULE=$(hdr MODULE); KIND=$(hdr KIND); DEPENDS=$(hdr DEPENDS)
# normalize DEPENDS: strip parentheticals; none/dash mean empty
DEPENDS=$(echo "$DEPENDS" | sed -E 's/\([^)]*\)//g' | tr ',' ' ' | xargs || true)
case "$DEPENDS" in none|None|NONE|-) DEPENDS="" ;; esac
[ "$TYPE" = "cycle" ] || { echo "compose-qe-mod-world: brief TYPE must be cycle (got: ${TYPE:-none})"; exit 1; }
[ -n "$MODULE" ] || { echo "compose-qe-mod-world: brief has no MODULE: header"; exit 1; }
case "$KIND" in noun|verb|shell) ;; *) echo "compose-qe-mod-world: KIND must be noun|verb|shell (got: ${KIND:-none})"; exit 1;; esac

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
bash "$BINDIR/scope-tsconfig.sh" "$R/workspace" "$MODULE"

TRUNK=$CAMPAIGN/trunk/current
FROZEN=()
mkdir -p "$R/workspace/modules/$MODULE/test"
# reopen: own module's interface + existing tests (frozen at file level)
if [ -d "$TRUNK/modules/$MODULE" ]; then
  SRC=$TRUNK/modules/$MODULE
  ( cd "$SRC" && find . -name '*.d.ts' ! -path './test/*' ) | while IFS= read -r f; do
    mkdir -p "$R/workspace/modules/$MODULE/$(dirname "$f")"
    cp "$SRC/$f" "$R/workspace/modules/$MODULE/$f"
  done
  if [ -f "$TRUNK/modules/$MODULE/index.js" ]; then
    ( cd "$TRUNK" && "$PLATFORM/node_modules/.bin/esbuild" --bundle --format=esm --platform=node \
        --log-level=warning "--external:#platform/*" "modules/$MODULE/index.js" \
        --outfile="$R/workspace/modules/$MODULE/index.js" )
  fi
  [ -d "$SRC/test" ] && cp -a "$SRC/test/." "$R/workspace/modules/$MODULE/test/"
  while IFS= read -r f; do FROZEN+=("$f"); done \
    < <(cd "$R/workspace" && find "modules/$MODULE/test" -name '*.ts' ! -name '*.d.ts' 2>/dev/null)
fi

for D in $DEPENDS; do bash "$BINDIR/mount-dep.sh" "$TRUNK" "$D" "$R/workspace" compose-qe-mod-world; done


{
cat <<'MD'
# QE phase — one module's suite

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are the QE cohort for ONE module: **$MODULE** (kind: $KIND). You
author its test suite from the brief below — the same brief the coding
cohort builds from, independently. You never see their code; they
never edit your tests. What you encode is what the brief REQUIRES, not
what any implementation does.

## This phase's brief (from the plan, verbatim)

MD
cat "$BRIEF"
cat <<MD

The brief governs intent, scope, and acceptance emphasis. Where it and
the platform contracts disagree on layouts or invocations, the
platform contracts win.

## Deliverables (in modules/$MODULE/test/ — your writable surface)

- test/doc/*.test.ts — the DOC TESTS: executable documentation of the
  module's interface. These become part of the interface itself:
  dependents' worlds receive them, and changing one later is an
  interface event. Small in number, exemplary in style, covering the
  interface and how it composes.
- test/opaque/*.test.ts — the OPAQUE BATTERY: edge cases, failure
  modes, invariants — the majority of the suite. Coders see verdicts
  and failure messages, never these sources: every assertion's failure
  message must state expected vs observed clearly enough to guide a
  fix without revealing the check.

Both use node:test + node:assert/strict, import the module as
'#modules/$MODULE/index.js', and follow platform/CODE-CONTRACT.md
(the lint applies to test code too).
MD
if [ -d "$TRUNK/modules/$MODULE" ]; then cat <<'MD'

The module's banked interface (.d.ts) and existing tests are present.
Banked test files are FROZEN — test accretion mirrors code accretion:
add tests, never edit; a wrong banked test is a finding for the retro,
not something you repair silently.
MD
else cat <<'MD'

The module does not exist yet: your tests are born red and will first
compile and run when the coding cohort delivers. Write them against
the brief's interface EXACTLY — names, signatures, and behaviors as
the brief states them. Lint your files; compilation comes later:

    node platform/lint/check.js modules/$MODULE/test
MD
fi
cat <<MD

Work only inside modules/$MODULE/test/. Everything else is read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md and platform/CODE-CONTRACT.md, then author the suite."
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
    "allowWrite":[f"{W}/modules/$MODULE/test","/tmp",f"{R}/home"],
    "denyWrite":frozen,
   },
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("qe-mod world composed:", R, "| module=$MODULE kind=$KIND deps=[$DEPENDS] frozen tests:", len(frozen))
PY
