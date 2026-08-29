#!/bin/bash
# run-ledger.sh <campaign-dir> <brief-file> [--max-sessions N] [--dry-run]
# — the EVENT LOOP: drive one brief's conversation under the bankless
# ledger. contribution → admission → verdicts → governor → next
# session. The governor (ratified, deliberately dumb): adjudicate when
# a session leaves reds or challenges; check DONE when accounting is
# all green. The kernel holds no opinions about content — floors
# refuse shape, adjudicators decide meaning.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; BRIEF=$2; shift 2
MAX=12; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --max-sessions) MAX=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done
BINDIR=$(cd "$(dirname "$0")" && pwd)
MODULE=$(grep -m1 -iE '^[#* ]*MODULE:' "$BRIEF" | sed -E 's/^[#* ]*MODULE:[[:space:]]*//i; s/[*`]//g' | xargs)
SLUG=$(basename "$BRIEF" .md)
LOG=$CAMPAIGN/ledger-driver-$SLUG.log
GOALF=$HOME/control-runs/goal-262.txt
say(){ echo "$(date -u +%H:%M:%SZ) $*" | tee -a "$LOG"; }
run(){ if [ "$DRY" = 1 ]; then echo "DRY: $*"; else say "RUN: $*"; "$@" >> "$LOG" 2>&1; fi }
launch(){
  if [ "$DRY" = 1 ]; then echo "DRY: launch $1 cap=$2"; return; fi
  say "LAUNCH: $1 (cap ${2}s)"
  systemd-run --user --unit="trireme-$1" --collect \
    --property=EnvironmentFile=$HOME/.trireme-env \
    bash $HOME/src/trireme/experiments/kernel/launch-world.sh "$1" "$2" >> "$LOG" 2>&1
  local deadline=$(( $(date +%s) + $2 + 300 ))
  while systemctl --user is-active --quiet "trireme-$1"; do
    [ "$(date +%s)" -gt "$deadline" ] && { say "ESCALATE: wait timeout for $1"; exit 1; }
    sleep 30
  done
  say "DONE: $1"
}
acct(){ [ "$DRY" = 1 ] && { echo '{"totals":{"tests":0,"green":0,"red":0,"pending":0,"challenged":0}}'; return; }
        bash "$BINDIR/accounting.sh" "$CAMPAIGN"; }
tot(){ echo "$1" | python3 -c "import json,sys;print(json.load(sys.stdin)['totals']['$2'])"; }

say "=== ledger conversation: brief=$SLUG module=$MODULE max=$MAX dry=$DRY"
N=0
for d in $HOME/control-runs/v3q-$SLUG-* $HOME/control-runs/v3c-$SLUG-* $HOME/control-runs/v3adj-$SLUG-*; do
  [ -d "$d" ] || continue
  i=${d##*-}
  case "$i" in *[!0-9]*) ;; *) [ "$i" -gt "$N" ] && N=$i ;; esac
done
[ "$N" -gt 0 ] && say "resuming session numbering at $((N+1)) (existing runs preserved)"
next_session(){ N=$((N+1)); [ "$N" -le "$MAX" ] || { say "ESCALATE: session cap $MAX reached"; exit 1; }; }

# 1. the estate opens the conversation if the module has none
A=$(acct)
HAVE_TESTS=$([ "$DRY" = 1 ] && echo 0 || (git -C "$CAMPAIGN/history" ls-files "modules/$MODULE/test/" | grep -c . || true))
if [ "${HAVE_TESTS:-0}" = 0 ]; then
  next_session
  run bash "$BINDIR/compose-v3-qe-world.sh" "v3q-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 45
  launch "v3q-$SLUG-$N" 2700
  run bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3q-$SLUG-$N" tests
  run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
fi

while :; do
  # 2. code contributes
  next_session
  run bash "$BINDIR/compose-v3-code-world.sh" "v3c-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 60
  launch "v3c-$SLUG-$N" 3600
  run bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3c-$SLUG-$N" code
  run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
  A=$(acct)
  say "ACCOUNTING: green=$(tot "$A" green) red=$(tot "$A" red) pending=$(tot "$A" pending) challenged=$(tot "$A" challenged)"
  [ "$DRY" = 1 ] && { say "=== dry sequence complete"; exit 0; }

  # 3. governor: reds/challenges/pending → adjudicate; all green → DONE check
  next_session
  run bash "$BINDIR/compose-v3-adj-world.sh" "v3adj-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 45
  launch "v3adj-$SLUG-$N" 2700
  run bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3adj-$SLUG-$N" decision
  DEC=$(git -C "$CAMPAIGN/history" show --name-only --pretty=format: HEAD | grep '^decisions/' | head -1 || true)
  [ -n "$DEC" ] || { say "ESCALATE: adjudication admitted no decision"; exit 1; }
  say "DECISION: $DEC"
  if grep -qE '^(COLLECT|COLLECT-DEF):' "$CAMPAIGN/history/$DEC"; then
    run bash "$BINDIR/execute-decision.sh" "$CAMPAIGN" "$DEC"
    run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
  fi
  if grep -q '^DONE:' "$CAMPAIGN/history/$DEC"; then
    A=$(acct)
    say "=== conversation CLOSED (DONE): green=$(tot "$A" green) red=$(tot "$A" red)"
    exit 0
  fi
  NEXT=$(grep -m1 '^NEXT:' "$CAMPAIGN/history/$DEC" | sed 's/^NEXT:[[:space:]]*//' || true)
  case "$NEXT" in
    qe*) next_session
         run bash "$BINDIR/compose-v3-qe-world.sh" "v3q-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 45
         launch "v3q-$SLUG-$N" 2700
         run bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3q-$SLUG-$N" tests
         run bash "$BINDIR/verdicts.sh" "$CAMPAIGN" ;;
    code*|"") : ;; # loop continues with a code session
    *) say "NOTE: unrecognized NEXT '$NEXT'; continuing with code" ;;
  esac
done
