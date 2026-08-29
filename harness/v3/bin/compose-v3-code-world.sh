#!/bin/bash
# compose-v3-code-world.sh — coding session world under the bankless
# ledger: contribute functions (def-level accretion; supersede, never
# edit) and challenges (disputes against tests, left red with
# rationale). Admission floors are shape-only; red is ledger content.
#
#   compose-v3-code-world.sh <run-name> <goal-file> <brief-file> <campaign-dir> [cap-minutes]
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; CAPMIN=${5:-60}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
V2BIN=$BINDIR/../../bin
PLATFORM=$BINDIR/../../platform

hdr(){ grep -m1 -iE "^[#* ]*$1:" "$BRIEF" | sed -E "s/^[#* ]*$1:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
TYPE=$(hdr TYPE); MODULE=$(hdr MODULE); KIND=$(hdr KIND); DEPENDS=$(hdr DEPENDS)
DEPENDS=$(echo "$DEPENDS" | sed -E 's/\([^)]*\)//g' | tr ',' ' ' | xargs || true)
case "$DEPENDS" in none|None|NONE|-) DEPENDS="" ;; esac
[ "$TYPE" = "cycle" ] || { echo "compose-v3-code-world: brief TYPE must be cycle (got: ${TYPE:-none})"; exit 1; }
[ -n "$MODULE" ] || { echo "compose-v3-code-world: brief has no MODULE: header"; exit 1; }

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
bash "$V2BIN/scope-tsconfig.sh" "$R/workspace" "$MODULE"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
bash "$BINDIR/stage-tip.sh" "$CAMPAIGN" "$STAGE"

FROZEN=()
mkdir -p "$R/workspace/modules/$MODULE" "$R/workspace/challenges"
# own module: full published source + tests (published tests frozen)
if [ -d "$STAGE/modules/$MODULE" ]; then
  cp -a "$STAGE/modules/$MODULE/." "$R/workspace/modules/$MODULE/"
  find "$R/workspace/modules/$MODULE" \( -name '*.js' -o -name '*.d.ts' -o -name '*.map' \) -delete
  while IFS= read -r f; do FROZEN+=("$f"); done \
    < <(cd "$R/workspace" && find "modules/$MODULE/test" -name '*.ts' 2>/dev/null)
fi

# the conversation record: adjudication decisions and published
# challenges, read-only (published challenge files are frozen even
# though the challenges/ drop-box stays writable for NEW disputes)
for d in decisions challenges; do
  if ls "$STAGE/$d"/*.md >/dev/null 2>&1; then
    mkdir -p "$R/workspace/$d"; cp "$STAGE/$d"/*.md "$R/workspace/$d/"
  fi
done
while IFS= read -r f; do FROZEN+=("$f"); done \
  < <(cd "$R/workspace" && find challenges -name '*.md' 2>/dev/null)

for D in $DEPENDS; do bash "$V2BIN/mount-dep.sh" "$STAGE" "$D" "$R/workspace" compose-v3-code-world; done
IFACE_BAD=0
for D in $DEPENDS; do
  if [ -f "$R/workspace/modules/$D/.iface-refs" ]; then
    while IFS= read -r X; do
      [ -z "$X" ] && continue
      case " $DEPENDS " in *" $X "*) ;; *)
        echo "compose: dep '$D' interface references '#modules/$X' — '$X' is an interface dependency and DEPENDS must include it"; IFACE_BAD=1 ;;
      esac
    done < "$R/workspace/modules/$D/.iface-refs"
    rm -f "$R/workspace/modules/$D/.iface-refs"
  fi
done
[ "$IFACE_BAD" = 0 ] || exit 1

{
cat <<'MD'
# Coding contribution — one module

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are the coder for ONE module: **$MODULE** (kind: ${KIND:-verb}),
under the BANKLESS LEDGER: development is an append-only conversation
in code. Published definitions are IMMUTABLE from birth — including
anything you publish in this session. You never edit a published def.
To change one, run a SUPERSESSION WAVE:

1. Author the successor(s) by hand (\`isVecV\` → \`isVecV2\`; any
   shape, changed signatures welcome).
2. Declare: modules/$MODULE/supersessions/<slug>.md — rationale prose
   plus one \`SUPERSEDE: <old> -> <new>\` line per hand successor.
3. \`node platform/wave/wave.js plan $MODULE modules/$MODULE/supersessions/<slug>.md\`
   — the machine computes every published caller upstream and checks
   it can generate their successors mechanically (same code, callee
   names swapped). A clean plan VALIDATES your scope: all interface
   changes are accounted for. An INCOMPLETE plan names the defs whose
   call sites need your hand (a callee's signature changed) — author
   those successors too and re-plan.
4. \`... wave.js apply ...\` — mechanical successors and the migrated
   test estate land in your workspace. Run the suite. Reds among
   MIGRATED tests are the semantic delta of your change: intended →
   file a challenge against that migrated test; unintended → keep
   working.
5. Deliver. Admission re-derives the wave and refuses any hand-edit
   disguised as mechanical output.

The module's published test estate is read-only (wave-migrated copies
are the machine's, listed in the wave manifest); the tests are
claims, not obstacles.

## This brief (verbatim)

MD
cat "$BRIEF"
cat <<MD

## Deliverables

- modules/$MODULE/*.ts — new definitions (or appended defs in
  existing files; the ledger verifies adds-only at def level).
- decisions/ (read-only) is the ADJUDICATION RECORD of this
  conversation. If its most recent decision directs work on your
  module (\`NEXT: code $MODULE\`, usually naming a defect and the
  expected successor definition), THAT DIRECTIVE IS YOUR ASSIGNMENT —
  carry it out precisely: add the successor, migrate the module's own
  callers, leave the orphan for adjudicated collection.
- challenges/<slug>.md — OPTIONAL: when you judge a test WRONG
  (contradicts the brief, internally inconsistent, unsatisfiable),
  leave it red and file a challenge. First line exactly
  \`TEST: modules/$MODULE/test/<...>.test.ts\`, then your rationale.
  Never hack around a test you dispute; never silently fail it.

A red suite does NOT block your contribution — admission checks
shape, not verdicts. But every red you leave must be either
challenged (you dispute the claim) or explicitly noted as future
work in a code comment on the relevant def. Run the loop before
finishing:

    node node_modules/typescript/lib/tsc.js -p tsconfig.json
    node platform/lint/check.js modules/$MODULE
    node --test "modules/$MODULE/test/**/*.test.js"

Compile-clean and lint-clean are ADMISSION FLOORS — a delivery that
fails them is refused outright. If the adjudication record shows your
half is complete and you genuinely find nothing to add, ending the
session with NO delivery is legal — it is recorded as a null
contribution and adjudication convenes next.

Work only inside modules/$MODULE/ and challenges/. Everything else is
read-only.
MD
} > $R/workspace/MANDATE.md

{
  echo "You have a total time budget of $CAPMIN minutes of wall-clock time"
  echo "for this session; budget accordingly. Every tool result is stamped"
  echo "with elapsed time, remaining time, and spend."
  echo
  echo "Read MANDATE.md and platform/CODE-CONTRACT.md, then contribute."
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
deny_mods=[f"{W}/modules/{d}" for d in os.listdir(f"{W}/modules") if d!="$MODULE"] if os.path.isdir(f"{W}/modules") else []
s={"filesystem":{
    "denyRead":[f"{H}/src",f"{H}/.ssh",f"{H}/.pi",f"{H}/.bashrc",f"{H}/.trireme-env",f"{H}/.profile",f"{H}/.npmrc",
                f"{H}/.gitconfig",f"{H}/.git-credentials",f"{H}/.claude",f"{H}/.claude.json",f"{H}/.config"]
                +[f"{H}/control-runs/{d}" for d in os.listdir(f"{H}/control-runs") if d!="$NAME"],
    "allowWrite":[R,"/tmp"],
    "denyWrite":frozen+deny_mods+[f"{W}/platform",f"{W}/node_modules",f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json",f"{W}/decisions"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("v3 code world composed:", R, "| module=$MODULE")
PY
