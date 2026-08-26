#!/bin/bash
# bank-phase.sh <campaign-dir> <retro-run> — execute a retro's machine
# verdict under the mechanical floor (PHASE-CONTRACT.md). Dispatches on
# the phase TYPE stamped into the retro run dir. qe BANK: isolated
# recheck (validate-qe) then the winner's whole workspace becomes
# gate/entry-N and gate/current is repointed. All outcomes append to
# history.log.
#
# Exit: 0 banked · 2 BANK VOID (recheck failed) · 3 REDO ·
#       4 code banking not implemented · 1 mechanical error/escalation
set -euo pipefail
CAMPAIGN=$1; RETRO=$2
RD=$HOME/control-runs/$RETRO
BINDIR=$(cd "$(dirname "$0")" && pwd)
ts(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
hist(){ mkdir -p "$CAMPAIGN"; echo "$(ts) $*" >> "$CAMPAIGN/history.log"; }

[ -d "$RD" ] || { echo "bank-phase: retro run not found: $RETRO"; exit 1; }
[ -f "$RD/TYPE" ] || { echo "bank-phase: no TYPE stamp in $RETRO"; exit 1; }
TYPE=$(tr -d '[:space:]' < "$RD/TYPE")
DEC=$RD/workspace/DECISION.md
[ -f "$DEC" ] || { echo "bank-phase: no DECISION.md in $RETRO"; exit 1; }

LINE=$(grep -m1 -vE '^\s*$' "$DEC" | sed -E 's/[#*`]//g; s/^\s+|\s+$//g')
case "$LINE" in
  BANK:*) WINNER=$(echo "${LINE#BANK:}" | xargs) ;;
  REDO:*) REASON=$(echo "${LINE#REDO:}" | xargs)
          hist "REDO type=$TYPE retro=$RETRO reason: $REASON"
          echo "REDO: $REASON"
          exit 3 ;;
  *) echo "bank-phase: DECISION.md first line is not a machine verdict (BANK:/REDO:): $LINE"
     exit 1 ;;
esac

[[ "$WINNER" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bank-phase: verdict names an illegal run: $WINNER"; exit 1; }

if [ "$TYPE" = "code" ]; then
  echo "bank-phase: code banking not implemented in this increment (phase type=code)"
  exit 4
fi
[ "$TYPE" = "qe" ] || { echo "bank-phase: unknown phase type: $TYPE"; exit 1; }

WW=$HOME/control-runs/$WINNER/workspace
[ -d "$WW" ] || { echo "bank-phase: winner run not found: $WINNER"; exit 1; }

# isolated recheck before banking
set +e
bash "$BINDIR/validate-qe.sh" "$WW" > /tmp/bank-phase-validation.$$ 2>&1
VCODE=$?
set -e
if [ "$VCODE" -ne 0 ]; then
  V="$CAMPAIGN/void/$RETRO.$(date -u +%Y%m%dT%H%M%S)"
  while [ -e "$V" ]; do V="$V.x"; done
  mkdir -p "$V"
  mv /tmp/bank-phase-validation.$$ "$V/VALIDATION.txt"
  hist "VOID type=qe retro=$RETRO winner=$WINNER (recheck failed; see $V)"
  echo "BANK VOID: winner $WINNER fails mechanical validation — nothing banked; record at $V"
  exit 2
fi
rm -f /tmp/bank-phase-validation.$$

mkdir -p "$CAMPAIGN/gate"
M=1
while [ -e "$CAMPAIGN/gate/entry-$M" ]; do M=$((M+1)); done
cp -a "$WW" "$CAMPAIGN/gate/entry-$M"
ln -sfn "entry-$M" "$CAMPAIGN/gate/current"
hist "BANK qe retro=$RETRO winner=$WINNER gate/entry-$M"
echo "BANKED: $WINNER -> $CAMPAIGN/gate/entry-$M (current)"
