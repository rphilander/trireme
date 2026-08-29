#!/bin/bash
# bank-mod.sh <campaign-dir> <retro-run> — execute a modular retro's
# machine verdict. The retro run dir carries TYPE (code|qe) and MODULE
# stamps. On BANK: new trunk entry = previous entry (hardlinked) with
# the winner's module overlaid (code: the whole module dir; qe: its
# test/ only), then the isolated recheck (validate-mod) and the ledger
# needles line. VOID on any floor failure; REDO recorded.
# Exit: 0 banked · 2 VOID · 3 REDO · 1 mechanical error
set -euo pipefail
# serialize campaign mutations (parallel cycles bank concurrently)
_LOCK_DIR=${CAMPAIGN:-$1}
mkdir -p "$_LOCK_DIR" 2>/dev/null || true
exec 9>"$_LOCK_DIR/.campaign.lock"
flock 9
# systemd units do not source .bashrc; make the toolchain reachable
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; RETRO=$2
RD=$HOME/control-runs/$RETRO
BINDIR=$(cd "$(dirname "$0")" && pwd)
ts(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
hist(){ mkdir -p "$CAMPAIGN"; echo "$(ts) $*" >> "$CAMPAIGN/history.log"; }

[ -f "$RD/TYPE" ] || { echo "bank-mod: no TYPE stamp in $RETRO"; exit 1; }
[ -f "$RD/MODULE" ] || { echo "bank-mod: no MODULE stamp in $RETRO"; exit 1; }
TYPE=$(tr -d '[:space:]' < "$RD/TYPE")
MODULE=$(tr -d '[:space:]' < "$RD/MODULE")
DEC=$RD/workspace/DECISION.md
[ -f "$DEC" ] || { echo "bank-mod: no DECISION.md in $RETRO"; exit 1; }

LINE=$(grep -m1 -vE '^\s*$' "$DEC" | sed -E 's/[#*`]//g; s/^\s+|\s+$//g')
case "$LINE" in
  BANK:*) WINNER=$(echo "${LINE#BANK:}" | sed -E "s/^[[:space:]]+|[[:space:]]+$//g") ;;
  REDO:*) REASON=$(echo "${LINE#REDO:}" | sed -E "s/^[[:space:]]+|[[:space:]]+$//g")
          hist "REDO type=$TYPE module=$MODULE retro=$RETRO reason: $REASON"
          echo "REDO: $REASON"; exit 3 ;;
  *) echo "bank-mod: DECISION.md first line is not a machine verdict: $LINE"; exit 1 ;;
esac
[[ "$WINNER" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bank-mod: illegal winner name: $WINNER"; exit 1; }
WW=$HOME/control-runs/$WINNER/workspace
[ -d "$WW/modules/$MODULE" ] || { echo "bank-mod: winner has no modules/$MODULE"; exit 1; }

mkdir -p "$CAMPAIGN/trunk"
M=1
while [ -e "$CAMPAIGN/trunk/entry-$M" ]; do M=$((M+1)); done
E=$CAMPAIGN/trunk/entry-$M

if [ -d "$CAMPAIGN/trunk/current" ]; then
  cp -al "$CAMPAIGN/trunk/current/." "$E"
  rm -rf "$E/platform" "$E/node_modules"
  cp -al "$BINDIR/../platform/payload/platform" "$E/platform"
  cp -al "$BINDIR/../platform/payload/node_modules" "$E/node_modules"
  # module-scoped ledger baseline of the previous entry for the accretion check
  BASE=""
  if [ -d "$CAMPAIGN/trunk/current/modules/$MODULE" ]; then
    BASE=$(mktemp)
    ( cd "$CAMPAIGN/trunk/current" && node platform/ledger/ledger.js "modules/$MODULE" ) > "$BASE" 2>/dev/null || BASE=""
  fi
else
  mkdir -p "$E"
  # first entry: a workspace skeleton from the platform payload
  bash "$BINDIR/../platform/bin/mk-workspace.sh" "$E" > /dev/null
  BASE=""
fi

if [ "$TYPE" = "code" ]; then
  rm -rf "$E/modules/$MODULE"
  mkdir -p "$E/modules"
  cp -a "$WW/modules/$MODULE" "$E/modules/$MODULE"
elif [ "$TYPE" = "qe" ]; then
  rm -rf "$E/modules/$MODULE/test"
  mkdir -p "$E/modules/$MODULE"
  cp -a "$WW/modules/$MODULE/test" "$E/modules/$MODULE/test"
else
  echo "bank-mod: unknown TYPE: $TYPE"; exit 1
fi

# WORLD-EQUIVALENT recheck: floors must be checkable in the world the
# work was done in. The winner is validated in a fresh sealed-interface
# workspace (own sources + deps as bundles+d.ts from the previous
# trunk), never against the merged source tree — declaration-vs-source
# inference can differ (the eval-stmt seam), and no cohort can see or
# fix the merged context.
RW=$(mktemp -d)
bash "$BINDIR/../platform/bin/mk-workspace.sh" "$RW" > /dev/null
bash "$BINDIR/scope-tsconfig.sh" "$RW" "$MODULE"
cat "$RD/DEPENDS" 2>/dev/null > "$RW/.depends" || true
cp -a "$WW/modules/$MODULE" "$RW/modules/$MODULE"
DEPS=$(cat "$RD/DEPENDS" 2>/dev/null || true)
if [ -n "$DEPS" ] && [ -d "$CAMPAIGN/trunk/current" ]; then
  for D in $DEPS; do bash "$BINDIR/mount-dep.sh" "$CAMPAIGN/trunk/current" "$D" "$RW" bank-recheck; done
fi
set +e
V=$(bash "$BINDIR/validate-mod.sh" "$RW" "$MODULE" "$TYPE" ${BASE:+"$BASE"} 2>&1)
VCODE=$?
set -e
rm -rf "$RW"
if [ "$VCODE" -ne 0 ]; then
  VD="$CAMPAIGN/void/$RETRO.$(date -u +%Y%m%dT%H%M%S)"
  while [ -e "$VD" ]; do VD="$VD.x"; done
  mkdir -p "$VD"; echo "$V" > "$VD/VALIDATION.txt"
  rm -rf "$E"
  hist "VOID type=$TYPE module=$MODULE retro=$RETRO winner=$WINNER (recheck failed; see $VD)"
  echo "BANK VOID: $V"
  exit 2
fi
ln -sfn "entry-$M" "$CAMPAIGN/trunk/current"
hist "BANK $TYPE module=$MODULE retro=$RETRO winner=$WINNER trunk/entry-$M ($V)"
echo "BANKED: $WINNER modules/$MODULE -> $CAMPAIGN/trunk/entry-$M (current) | $V"
