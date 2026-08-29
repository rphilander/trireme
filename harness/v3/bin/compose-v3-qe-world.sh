#!/bin/bash
# compose-v3-qe-world.sh — QE session world under the bankless ledger:
# author test contributions for ONE module from the brief. Published
# tests are immutable history; delivery is adds only, admitted by
# admit.sh (structure, lint, stub/interface typecheck floors).
#
#   compose-v3-qe-world.sh <run-name> <goal-file> <brief-file> <campaign-dir> [cap-minutes]
set -euo pipefail
NAME=$1; GOALF=$2; BRIEF=$3; CAMPAIGN=$4; CAPMIN=${5:-45}
R=$HOME/control-runs/$NAME
BINDIR=$(cd "$(dirname "$0")" && pwd)
V2BIN=$BINDIR/../../bin
PLATFORM=$BINDIR/../../platform

hdr(){ grep -m1 -iE "^[#* ]*$1:" "$BRIEF" | sed -E "s/^[#* ]*$1:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
TYPE=$(hdr TYPE); MODULE=$(hdr MODULE); KIND=$(hdr KIND); DEPENDS=$(hdr DEPENDS)
DEPENDS=$(echo "$DEPENDS" | sed -E 's/\([^)]*\)//g' | tr ',' ' ' | xargs || true)
case "$DEPENDS" in none|None|NONE|-) DEPENDS="" ;; esac
[ "$TYPE" = "cycle" ] || { echo "compose-v3-qe-world: brief TYPE must be cycle (got: ${TYPE:-none})"; exit 1; }
[ -n "$MODULE" ] || { echo "compose-v3-qe-world: brief has no MODULE: header"; exit 1; }

rm -rf $R && mkdir -p $R/home/.pi/agent/extensions
cp ~/src/trireme/experiments/kernel/extensions/trireme-shell.ts $R/home/.pi/agent/extensions/
bash "$PLATFORM/bin/mk-workspace.sh" "$R/workspace" > /dev/null
bash "$V2BIN/scope-tsconfig.sh" "$R/workspace" "$MODULE"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
bash "$BINDIR/stage-tip.sh" "$CAMPAIGN" "$STAGE"

FROZEN=()
mkdir -p "$R/workspace/modules/$MODULE/test"
REOPEN=0
if ls "$STAGE/modules/$MODULE/"*.ts >/dev/null 2>&1 && ! ls "$STAGE/modules/$MODULE/"*.ts 2>/dev/null | grep -qv '\.d\.ts$' ; then :; fi
if ls "$STAGE/modules/$MODULE/index.ts" >/dev/null 2>&1; then REOPEN=1; fi
if [ "$REOPEN" = 1 ]; then
  # perspective separation: interface only, never source
  bash "$V2BIN/mount-dep.sh" "$STAGE" "$MODULE" "$R/workspace" compose-v3-qe-world 2>/dev/null || true
  rm -f "$R/workspace/modules/$MODULE/.iface-refs"
fi
if [ -d "$STAGE/modules/$MODULE/test" ]; then
  cp -a "$STAGE/modules/$MODULE/test/." "$R/workspace/modules/$MODULE/test/"
  # strip staged emit; published sources are the frozen surface
  find "$R/workspace/modules/$MODULE/test" \( -name '*.js' -o -name '*.d.ts' -o -name '*.map' \) -delete
  while IFS= read -r f; do FROZEN+=("$f"); done \
    < <(cd "$R/workspace" && find "modules/$MODULE/test" -name '*.ts' 2>/dev/null)
fi
if [ "$REOPEN" = 1 ]; then
  while IFS= read -r f; do FROZEN+=("$f"); done \
    < <(cd "$R/workspace" && find "modules/$MODULE" -maxdepth 1 \( -name '*.d.ts' -o -name 'index.js' \) 2>/dev/null)
  FROZEN+=("modules/$MODULE/index.ts")
fi

for D in $DEPENDS; do bash "$V2BIN/mount-dep.sh" "$STAGE" "$D" "$R/workspace" compose-v3-qe-world; done
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

for d in decisions challenges; do
  if ls "$STAGE/$d"/*.md >/dev/null 2>&1; then
    mkdir -p "$R/workspace/$d"; cp "$STAGE/$d"/*.md "$R/workspace/$d/"
  fi
done

{
cat <<'MD'
# QE contribution — one module's claims

GOAL of the overall effort (the operator's words, verbatim):

MD
sed 's/^/> /' "$GOALF"
cat <<MD

You are QE for ONE module: **$MODULE** (kind: ${KIND:-verb}), under the
BANKLESS LEDGER: development is an append-only conversation in code.
You CONTRIBUTE tests — claims about required behavior. Published test
files (mounted read-only) are immutable history: never edit one; a
wrong published test is a matter for a CHALLENGE (coders) or a
DECISION (adjudication), never silent repair. Superseded functions
get MIGRATION tests as ordinary new files.

## This brief (verbatim)

MD
cat "$BRIEF"
cat <<MD

## Deliverables (new files under modules/$MODULE/test/ only)

- test/doc/*.test.ts — executable documentation, part of the
  interface; exemplary, small in number.
- test/*.ts helpers and fixtures are welcome estate files (shared
  builders, tables); immutable once published, like tests.
- test/opaque/*.test.ts — edge cases, failure modes, invariants; the
  majority. Failure messages must state expected vs observed clearly
  enough to guide a fix without revealing the check.

node:test + node:assert/strict; import '#modules/$MODULE/index.js';
platform/CODE-CONTRACT.md applies to test code.

decisions/ (read-only), when present, is the adjudication record: a
decision directing migration claims or new coverage for $MODULE
directs your additions; challenges/ holds published disputes against
tests (immutable — adjudication resolves them, never you).
MD
if [ "$REOPEN" = 1 ]; then cat <<MD

The module's interface (.d.ts) and its published tests are mounted
read-only. Your additions must TYPECHECK against that interface:

    node node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit
    node platform/lint/check.js modules/$MODULE/test
MD
else cat <<MD

The module has no code yet. First author **modules/$MODULE/index.ts**
as a TYPED STUB of the brief's interface: ambient declarations only
(\`export declare const f: (…) => …;\`), types from #platform and the
mounted dependency interfaces. The stub is your compile target, never
published — the real module supersedes it. Both must be clean before
you finish:

    node node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit
    node platform/lint/check.js modules/$MODULE/test

A suite that does not compile is noise, not a claim.
MD
fi
cat <<MD

Work only inside modules/$MODULE/. Everything else is read-only.
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
    "denyWrite":frozen+deny_mods+[f"{W}/platform",f"{W}/node_modules",f"{W}/package.json",f"{W}/tsconfig.json",f"{W}/MANDATE.md",f"{R}/settings.json",f"{W}/challenges",f"{W}/decisions"]},
   "network":{"allowedDomains":["api.deepseek.com"],"deniedDomains":[]}}
open(f"{R}/settings.json","w").write(json.dumps(s,indent=1))
print("v3 qe world composed:", R, "| module=$MODULE reopen=$REOPEN")
PY
