#!/bin/bash
# run-ledger.sh <campaign-dir> <brief-file> [--max-sessions N] [--dry-run]
# — the EVENT LOOP: drive one brief's conversation under the bankless
# ledger. Opening contributions (estate, then first code) are followed
# by a strictly DECISION-DRIVEN rhythm: every session is followed by
# adjudication, and the decision names what runs next (NEXT: qe|code,
# or DONE). A directed session that finds nothing to contribute is a
# NULL CONTRIBUTION (recorded, not fatal); any other admission refusal
# escalates. The kernel holds no opinions about content.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; BRIEF=$2; shift 2
MAX=14; DRY=0
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
# admit with null-contribution tolerance for DIRECTED sessions
admit_tolerant(){ # <run> <kind>
  [ "$DRY" = 1 ] && { echo "DRY: admit $1 $2"; return 0; }
  local out
  if out=$(bash "$BINDIR/admit.sh" "$CAMPAIGN" "$1" "$2" 2>&1); then
    say "$out"; return 0
  fi
  echo "$out" >> "$LOG"
  case "$out" in
    *"touches no module and files no challenge"*|*"nothing to publish"*|*"tests delivery touches no module"*)
      say "NULL CONTRIBUTION: $1 ($2) delivered nothing — proceeding to adjudication"; return 0 ;;
    *) say "ESCALATE: admission refused $1 ($2): $(echo "$out" | head -1)"; exit 1 ;;
  esac
}
N=0
for d in $HOME/control-runs/v3q-$SLUG-* $HOME/control-runs/v3c-$SLUG-* $HOME/control-runs/v3adj-$SLUG-*; do
  [ -d "$d" ] || continue
  i=${d##*-}
  case "$i" in *[!0-9]*) ;; *) [ "$i" -gt "$N" ] && N=$i ;; esac
done
[ "$DRY" = 1 ] || run bash "$BINDIR/close-depends.sh" "$CAMPAIGN" "briefs/$SLUG.md"
say "=== ledger conversation: brief=$SLUG module=$MODULE max=$MAX dry=$DRY start=$((N+1))"
next_session(){ N=$((N+1)); [ "$N" -le "$MAX" ] || { say "ESCALATE: session cap $MAX reached"; exit 1; }; }

qe_session(){ # one auto-retry on an opening refusal: agent slips are
  # cheaper to re-derive than to escalate
  local tries=0
  while :; do
    next_session
    run bash "$BINDIR/compose-v3-qe-world.sh" "v3q-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 45
    launch "v3q-$SLUG-$N" 2700
    local out
    if out=$(bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3q-$SLUG-$N" tests 2>&1); then
      say "$out"; break
    fi
    echo "$out" >> "$LOG"; tries=$((tries+1))
    if [ "$tries" -ge 2 ]; then say "ESCALATE: admission refused $(echo "$out" | head -1)"; exit 1; fi
    mv "$HOME/control-runs/v3q-$SLUG-$N" "$HOME/control-runs/v3q-$SLUG-$N-refused" 2>/dev/null || true
    say "RETRY: qe delivery refused ($(echo "$out" | head -1 | head -c 120)) — fresh cohort"
  done
  run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
}
code_session(){
  next_session
  run bash "$BINDIR/compose-v3-code-world.sh" "v3c-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 60
  launch "v3c-$SLUG-$N" 3600
  admit_tolerant "v3c-$SLUG-$N" code
  run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
}

# opening contributions: estate if none, first code if none
HAVE_TESTS=$([ "$DRY" = 1 ] && echo 1 || (git -C "$CAMPAIGN/history" ls-files "modules/$MODULE/test/" | grep -c . || true))
[ "${HAVE_TESTS:-0}" = 0 ] && qe_session
HAVE_CODE=$([ "$DRY" = 1 ] && echo 0 || (git -C "$CAMPAIGN/history" ls-files "modules/$MODULE/" | grep -v "^modules/$MODULE/test/" | grep -c '\.ts$' || true))
[ "${HAVE_CODE:-0}" = 0 ] && code_session

while :; do
  # governor: every session is followed by adjudication; the decision drives
  next_session
  run bash "$BINDIR/compose-v3-adj-world.sh" "v3adj-$SLUG-$N" "$GOALF" "$BRIEF" "$CAMPAIGN" 45
  launch "v3adj-$SLUG-$N" 2700
  [ "$DRY" = 1 ] && { say "=== dry sequence complete"; exit 0; }
  bash "$BINDIR/admit.sh" "$CAMPAIGN" "v3adj-$SLUG-$N" decision >> "$LOG" 2>&1 \
    || { say "ESCALATE: adjudication delivered no admissible decision"; exit 1; }
  DEC=$(git -C "$CAMPAIGN/history" show --name-only --pretty=format: HEAD | grep '^decisions/' | head -1 || true)
  [ -n "$DEC" ] || { say "ESCALATE: adjudication admitted no decision"; exit 1; }
  say "DECISION: $DEC"
  if grep -qE '^(COLLECT|COLLECT-DEF):' "$CAMPAIGN/history/$DEC"; then
    EXOUT=""
    if EXOUT=$(bash "$BINDIR/execute-decision.sh" "$CAMPAIGN" "$DEC" 2>&1); then
      echo "$EXOUT" >> "$LOG"; say "$(echo "$EXOUT" | tail -1)"
      rm -f "$CAMPAIGN/refusals/"*.txt 2>/dev/null || true
      run bash "$BINDIR/verdicts.sh" "$CAMPAIGN"
    else
      echo "$EXOUT" >> "$LOG"
      mkdir -p "$CAMPAIGN/refusals"
      { echo "DECISION: $DEC"; echo "$EXOUT"; } > "$CAMPAIGN/refusals/$(basename "$DEC" .md).txt"
      say "COLLECTION REFUSED for $DEC — reconvening adjudication with the refusal"
      continue
    fi
  fi
  if grep -q '^DONE:' "$CAMPAIGN/history/$DEC"; then
    A=$(bash "$BINDIR/accounting.sh" "$CAMPAIGN")
    G=$(echo "$A" | python3 -c "import json,sys;t=json.load(sys.stdin)['totals'];print(t['green'],t['red'])")
    say "=== conversation CLOSED (DONE): green/red = $G"
    exit 0
  fi
  NEXT=$(grep -m1 '^NEXT:' "$CAMPAIGN/history/$DEC" | sed 's/^NEXT:[[:space:]]*//' || true)
  case "$NEXT" in
    qe*) qe_session ;;
    code*|"") code_session ;;
    *) say "NOTE: unrecognized NEXT '$NEXT'; running code"; code_session ;;
  esac
done
