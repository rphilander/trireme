#!/bin/bash
# bank-trunk.sh — kernel: execute a retro's bank decision mechanically.
#
#   bank-trunk.sh <entry-name> <winner-run> <plan-workspace> <subject-rel-path>
#   e.g. bank-trunk.sh entry-1 entry1-2 ~/control-runs/planner-2/workspace src/engine/index.ts
#
# Spec: RETRO-CONTRACT v1.1 kernel enforcement. The retro only NAMES the
# winner (DECISION.md); this script does the banking: copy the winner's
# src/ + package.json verbatim into ~/control-runs/trunk/<entry>/, then
# re-run the pristine gate (bridge + corpus from <plan-workspace>) over
# every previously-accepted case id plus this entry's — all must pass, or
# the bank is VOID. STRICT PROGRESS (settled 2026-08-22): the entry must
# add a non-zero number of NEW case ids beyond the previous ACCEPTED set,
# or the bank is VOID — banking must move the ball forward. Append-only:
# an existing trunk/<entry> is never overwritten; losers' run dirs are
# never touched. <plan-workspace> must carry the POST-FOLD plan (in the
# driven flow: the retro's workspace).
set -euo pipefail
E=$1; W=$2; P=$3; SUBJ=$4
TR=$HOME/control-runs/trunk; T=$TR/$E
[ -e "$T" ] && { echo "trunk/$E already exists — banking is append-only" >&2; exit 1; }
mkdir -p "$T"
cp -a $HOME/control-runs/$W/workspace/src "$T/src"
cp -a $HOME/control-runs/$W/workspace/package.json "$T/package.json"

cat "$P/plan/$E/cases.txt" $( [ -f "$TR/ACCEPTED.txt" ] && echo "$TR/ACCEPTED.txt" ) | sort -u > "$T/gate-cases.txt"

# strict progress: the union must be larger than the previous ACCEPTED set
PREV=$( [ -f "$TR/ACCEPTED.txt" ] && sort -u "$TR/ACCEPTED.txt" | wc -l || echo 0 )
NEWN=$(( $(wc -l < "$T/gate-cases.txt") - PREV ))
if [ "$NEWN" -le 0 ]; then
  mv "$T" "$TR/$E.VOID"
  echo "BANK VOID: no new accepted cases ($NEWN new beyond the previous $PREV) — banking must move the ball forward"
  exit 1
fi
set +e
( cd "$P" && timeout 1800 node bridge/run.mjs --subject "$T/$SUBJ" --cases "$T/gate-cases.txt" --out "$T/gate.json" )
CODE=$?
set -e
FAILS=$(python3 -c "
import json
try: r=json.load(open('$T/gate.json'))['results']
except Exception: print('unreadable'); raise SystemExit
bad=[x['id'] for x in r if x['status']!='pass']
print(len(bad))
for b in bad[:10]: print(' ', b)" 2>/dev/null | head -12)
if [ "$CODE" -ne 0 ] || [ "$(echo "$FAILS" | head -1)" != "0" ]; then
  mv "$T" "$TR/$E.VOID"
  echo "BANK VOID: gate exit=$CODE, failures:"; echo "$FAILS"
  exit 1
fi
cp "$T/gate-cases.txt" "$TR/ACCEPTED.txt"
ln -sfn "$T" "$TR/current"
cat > "$T/BANKED.md" <<EOF
banked: $E
winner: $W (copied verbatim from ~/control-runs/$W/workspace)
subject: $SUBJ
gate: $(wc -l < "$T/gate-cases.txt") cases, all pass (gate.json)
date: $(date -u +%FT%TZ)
decision: see the retro workspace DECISION.md for this cycle
EOF
echo "BANKED trunk/$E from $W: $(wc -l < "$T/gate-cases.txt") accepted cases, all pass"
