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
  BANK:*) WINNER=$(echo "${LINE#BANK:}" | sed -E "s/^[[:space:]]+|[[:space:]]+$//g") ;;
  REDO:*) REASON=$(echo "${LINE#REDO:}" | sed -E "s/^[[:space:]]+|[[:space:]]+$//g")
          hist "REDO type=$TYPE retro=$RETRO reason: $REASON"
          echo "REDO: $REASON"
          exit 3 ;;
  *) echo "bank-phase: DECISION.md first line is not a machine verdict (BANK:/REDO:): $LINE"
     exit 1 ;;
esac

[[ "$WINNER" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bank-phase: verdict names an illegal run: $WINNER"; exit 1; }

WW=$HOME/control-runs/$WINNER/workspace
[ -d "$WW" ] || { echo "bank-phase: winner run not found: $WINNER"; exit 1; }

# bank_module <src-workspace> <dest-entry> <exclude>... — the module is the
# workspace minus world artifacts
bank_module(){
  local SRC=$1 DEST=$2; shift 2
  mkdir -p "$DEST"
  local EX=(! -name MANDATE.md)
  for e in "$@"; do EX+=(! -name "$e"); done
  find "$SRC" -mindepth 1 -maxdepth 1 "${EX[@]}" -exec cp -a {} "$DEST/" \;
}

if [ "$TYPE" = "code" ]; then
  # isolated regrade by the CAMPAIGN's banked gate (never the candidate's copy)
  GLOG=$(mktemp) GOUT=$(mktemp)
  set +e
  bash "$BINDIR/grade-code.sh" "$CAMPAIGN" "$WW" "$GOUT" > "$GLOG" 2>&1
  VCODE=$?
  set -e
  if [ "$VCODE" -ne 0 ]; then
    V="$CAMPAIGN/void/$RETRO.$(date -u +%Y%m%dT%H%M%S)"
    while [ -e "$V" ]; do V="$V.x"; done
    mkdir -p "$V"; mv "$GLOG" "$V/VALIDATION.txt"
    hist "VOID type=code retro=$RETRO winner=$WINNER (regrade failed; see $V)"
    echo "BANK VOID: winner $WINNER fails isolated regrade — nothing banked; record at $V"
    exit 2
  fi
  # strict progress: >0 newly-passing non-internal ids vs the trunk baseline
  NEWN=$(python3 - "$GOUT" "$CAMPAIGN/trunk/current/GRADE.json" <<'PY'
import json, sys, os
g = json.load(open(sys.argv[1]))
passed = {r["id"] for r in g["results"] if r["status"] == "pass" and not r["id"].startswith("internal/")}
base = set()
if os.path.exists(sys.argv[2]):
    base = {r["id"] for r in json.load(open(sys.argv[2]))["results"]
            if r["status"] == "pass" and not r["id"].startswith("internal/")}
print(len(passed - base))
PY
)
  if [ "$NEWN" -eq 0 ]; then
    hist "VOID type=code retro=$RETRO winner=$WINNER (no newly-passing cases)"
    echo "BANK VOID: no newly-passing cases — nothing banked"
    rm -f "$GLOG" "$GOUT"
    exit 2
  fi
  mkdir -p "$CAMPAIGN/trunk"
  M=1
  while [ -e "$CAMPAIGN/trunk/entry-$M" ]; do M=$((M+1)); done
  bank_module "$WW" "$CAMPAIGN/trunk/entry-$M" tests gate
  cp "$GOUT" "$CAMPAIGN/trunk/entry-$M/GRADE.json"
  ln -sfn "entry-$M" "$CAMPAIGN/trunk/current"
  hist "BANK code retro=$RETRO winner=$WINNER trunk/entry-$M ($NEWN new)"
  echo "BANKED: $WINNER -> $CAMPAIGN/trunk/entry-$M (current; $NEWN newly-passing)"
  rm -f "$GLOG" "$GOUT"
  exit 0
fi
[ "$TYPE" = "qe" ] || { echo "bank-phase: unknown phase type: $TYPE"; exit 1; }

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
bank_module "$WW" "$CAMPAIGN/gate/entry-$M" tests
# the gate resolves the corpus at <module-root>/tests — re-link it from the
# retro's CORPUS stamp (hardlinks; falls back to the winner's own tests)
CORPUS=$(tr -d '\n' < "$RD/CORPUS" 2>/dev/null || true)
if [ -n "$CORPUS" ] && [ -d "$CORPUS" ]; then
  cp -al "$CORPUS" "$CAMPAIGN/gate/entry-$M/tests"
elif [ -d "$WW/tests" ]; then
  cp -al "$WW/tests" "$CAMPAIGN/gate/entry-$M/tests"
fi
ln -sfn "entry-$M" "$CAMPAIGN/gate/current"
hist "BANK qe retro=$RETRO winner=$WINNER gate/entry-$M"
echo "BANKED: $WINNER -> $CAMPAIGN/gate/entry-$M (current)"
