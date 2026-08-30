#!/bin/bash
# execute-decision.sh <campaign-dir> <decision-relpath> — the kernel
# executes an ADMITTED decision's collection directives against the
# history. The only deletions history ever sees, and they carry their
# referential-integrity proof: nothing live may still reference a
# collected definition or test unless collected by the same decision.
#
# Directive lines inside the decision file:
#   COLLECT: <relpath>            (test file or challenge file)
#   COLLECT-DEF: <module> <name>  (one top-level definition)
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; DEC=$2
HIST=$CAMPAIGN/history
BINDIR=$(cd "$(dirname "$0")" && pwd)
PLATFORM=$BINDIR/../../platform
refuse(){ echo "REFUSE: $*"; exit 1; }
[ -f "$HIST/$DEC" ] || refuse "decision not in history: $DEC"
exec 9>"$CAMPAIGN/.campaign.lock"; flock 9

FILES=(); DEFS=()
norm(){ echo "$1" | xargs | sed -E 's/^\(none\)$|^none$|^-$//'; }
while IFS= read -r ln; do
  case "$ln" in
    COLLECT:*) T=$(norm "${ln#COLLECT:}"); [ -n "$T" ] && FILES+=("$T") ;;
    COLLECT-DEF:*) T=$(norm "${ln#COLLECT-DEF:}"); [ -n "$T" ] && DEFS+=("$T") ;;
  esac
done < "$HIST/$DEC"
# a decision whose collection lines all normalize away is a no-op, not a refusal
[ $((${#FILES[@]} + ${#DEFS[@]})) -gt 0 ] || { echo "COLLECTED: nothing (no-op decision $DEC)"; exit 0; }

# staged execution in a tip checkout; floors before history mutates
RW=$(mktemp -d)
trap 'rm -rf "$RW"' EXIT
bash "$PLATFORM/bin/mk-workspace.sh" "$RW" > /dev/null
git -C "$HIST" archive HEAD | tar -x -C "$RW"

for f in ${FILES[@]+"${FILES[@]}"}; do
  [ -f "$RW/$f" ] || refuse "COLLECT target not at tip: $f"
done
# auto-collect challenges pointing at collected tests
for c in "$RW"/challenges/*.md; do
  [ -f "$c" ] || continue
  T=$(grep -m1 '^TEST:' "$c" | cut -d: -f2- | xargs || true)
  for f in ${FILES[@]+"${FILES[@]}"}; do
    if [ "$T" = "$f" ]; then FILES+=("challenges/$(basename "$c")"); fi
  done
done
# dedupe
mapfile -t FILES < <(printf '%s\n' ${FILES[@]+"${FILES[@]}"} | sort -u)

# absent targets first: a COLLECT-DEF naming a def not at tip (already
# collected, or never a top-level def) refuses with a legible list so
# the corrected decision simply drops those lines
ABSENT=""
for d in ${DEFS[@]+"${DEFS[@]}"}; do
  M=${d%% *}; NAME=${d#* }
  FOUND=0
  for f in "$RW/modules/$M"/*.ts; do
    [ -f "$f" ] || continue
    case "$f" in *.d.ts) continue ;; esac
    grep -qE "(^|[[:space:]])(const|function|type|interface)[[:space:]]+$NAME\b" "$f" && FOUND=1
  done
  [ "$FOUND" = 1 ] || ABSENT="$ABSENT $M#$NAME"
done
[ -z "$ABSENT" ] || refuse "COLLECT-DEF target(s) not at tip (already collected, or never top-level):$ABSENT — drop these lines from the corrected decision"

# referential integrity for defs: no surviving def or test references;
# ALL violations reported at once so one corrected decision suffices
RI_BAD=""
LEDGER_JSON=$(cd "$RW" && node platform/ledger/ledger.js modules/* 2>/dev/null || echo '{}')
for d in ${DEFS[@]+"${DEFS[@]}"}; do
  M=${d%% *}; NAME=${d#* }
  REFHITS=$(echo "$LEDGER_JSON" | python3 -c "
import json,sys
led=json.load(sys.stdin).get('modules',{})
tgt='$M#$NAME'
out=[]
for m,info in led.items():
    for n,v in info.get('definitions',{}).items():
        refs=[r.split('#')[0]+'#'+r.split('#')[1] if r.count('#') else r for r in v.get('refs',[])]
        if tgt in v.get('refs',[]) and not (m=='$M' and n=='$NAME'):
            out.append(f'{m}#{n}')
print(' '.join(out))")
  SURVIVE=""
  for h in $REFHITS; do
    hm=${h%%#*}; hn=${h#*#}
    ok=0
    for d2 in ${DEFS[@]+"${DEFS[@]}"}; do [ "$d2" = "$hm $hn" ] && ok=1; done
    [ "$ok" = 1 ] || SURVIVE="$SURVIVE $h"
  done
  [ -z "$SURVIVE" ] || RI_BAD="$RI_BAD | $M#$NAME still referenced by:$SURVIVE"
  while IFS= read -r t; do
    rel=${t#"$RW/"}
    keep=1
    for f in ${FILES[@]+"${FILES[@]}"}; do [ "$f" = "$rel" ] && keep=0; done
    if [ "$keep" = 1 ] && grep -qE "import[^;]*\{[^}]*\b$NAME\b[^}]*\}[^;]*from[[:space:]]*['\"]#modules/$M/" "$t"; then
      refuse "referential integrity: $M#$NAME still imported by live test $rel (collect it in the same decision)"
    fi
  done < <(find "$RW/modules" -path '*/test/*' -name '*.test.ts' 2>/dev/null)
done

[ -z "$RI_BAD" ] || refuse "referential integrity: ${RI_BAD# | } (collect them in the same decision)"

# stage: remove files, excise defs; then no-new-compile-errors floor
ERRS_BEFORE=$( (cd "$RW" && node node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit 2>&1 || true) | grep -c 'error TS' || true)
for f in ${FILES[@]+"${FILES[@]}"}; do rm -f "$RW/$f"; done
for d in ${DEFS[@]+"${DEFS[@]}"}; do
  M=${d%% *}; NAME=${d#* }
  ( cd "$RW" && node "$BINDIR/collect-def.js" "modules/$M" "$NAME" ) > /dev/null || refuse "collect-def failed for $M#$NAME"
done
ERRS_AFTER=$( (cd "$RW" && node node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit 2>&1 || true) | grep -c 'error TS' || true)
[ "$ERRS_AFTER" -le "$ERRS_BEFORE" ] || refuse "collection introduces compile errors ($ERRS_BEFORE -> $ERRS_AFTER)"

# apply to history: same operations, kernel commit citing the decision
for f in ${FILES[@]+"${FILES[@]}"}; do git -C "$HIST" rm -q "$f"; done
for d in ${DEFS[@]+"${DEFS[@]}"}; do
  M=${d%% *}; NAME=${d#* }
  cp "$RW/modules/$M/"*.ts "$HIST/modules/$M/" 2>/dev/null || true
done
cd "$HIST"
git add -A
git -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "collection per $DEC: ${#FILES[@]} file(s), ${#DEFS[@]} def(s)"
echo "COLLECTED: ${#FILES[@]} file(s), ${#DEFS[@]} def(s) per $DEC commit=$(git rev-parse --short HEAD)"
