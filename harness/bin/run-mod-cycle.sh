#!/bin/bash
# run-mod-cycle.sh <campaign-dir> <cycle-N> [--from <step>] [--dry-run]
# — drive ONE full modular cycle unattended:
#   qe-cohort → qe-retro → qe-bank → code-cohort → code-retro →
#   code-bank → adopt-next-brief
# Any floor failure (validate REJECT propagates through retro FACTS;
# bank VOID/REDO; missing deliverables) stops the driver with a clear
# escalation line. Steps are resumable with --from. All progress is
# logged to <campaign>/driver-cycle-<N>.log.
#
# The framework holds no opinions: cohorts produce, retros judge,
# banks enforce. This script only sequences and waits.
set -euo pipefail
# systemd units do not source .bashrc; make the toolchain reachable
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; N=$2; shift 2
FROM="qe-cohort"; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done
BINDIR=$(cd "$(dirname "$0")" && pwd)
GOALF=$HOME/control-runs/goal-262.txt
BRIEF=$CAMPAIGN/plan/briefs/cycle-$N.md
LOG=$CAMPAIGN/driver-cycle-$N.log
[ -f "$BRIEF" ] || { echo "run-mod-cycle: no brief at $BRIEF"; exit 1; }
say(){ echo "$(date -u +%H:%M:%SZ) $*" | tee -a "$LOG"; }
run(){ if [ "$DRY" = 1 ]; then echo "DRY: $*"; else say "RUN: $*"; "$@" >> "$LOG" 2>&1; fi }

launch(){ # <name> <cap-seconds>
  if [ "$DRY" = 1 ]; then echo "DRY: launch $1 cap=$2"; return; fi
  say "LAUNCH: $1 (cap ${2}s)"
  systemd-run --user --unit="trireme-$1" --collect \
    --property=EnvironmentFile=$HOME/.trireme-env \
    bash $HOME/src/trireme/experiments/kernel/launch-world.sh "$1" "$2" >> "$LOG" 2>&1
}
wait_units(){ # <cap-seconds> <name>...
  [ "$DRY" = 1 ] && { echo "DRY: wait ${*:2}"; return; }
  local deadline=$(( $(date +%s) + $1 + 300 ))
  shift
  while :; do
    local live=0
    for u in "$@"; do systemctl --user is-active --quiet "trireme-$u" && live=1; done
    [ "$live" = 0 ] && break
    [ "$(date +%s)" -gt "$deadline" ] && { say "ESCALATE: wait timeout for $*"; exit 1; }
    sleep 30
  done
  say "DONE: $*"
}
step_wanted(){ # ordered gate: run steps at or after FROM
  local order="qe-cohort qe-retro qe-bank code-cohort code-retro code-bank adopt-next"
  local seen=0
  for s in $order; do
    [ "$s" = "$FROM" ] && seen=1
    [ "$s" = "$1" ] && { [ "$seen" = 1 ] && return 0 || return 1; }
  done
  return 1
}

MODULE=$(grep -m1 -iE '^[#* ]*MODULE:' "$BRIEF" | sed -E 's/^[#* ]*MODULE:[[:space:]]*//i; s/[*`]//g' | xargs)
say "=== cycle $N module=$MODULE from=$FROM dry=$DRY"

if step_wanted qe-cohort; then
  for i in 1 2 3; do run bash "$BINDIR/compose-qe-mod-world.sh" "mqe$N-$i" "$GOALF" "$BRIEF" "$CAMPAIGN" 45; done
  for i in 1 2 3; do launch "mqe$N-$i" 2700; done
  wait_units 2700 "mqe$N-1" "mqe$N-2" "mqe$N-3"
fi
if step_wanted qe-retro; then
  run bash "$BINDIR/compose-mod-retro.sh" "mretro$N-qe" "$GOALF" "$BRIEF" "$CAMPAIGN" qe "mqe$N-1" "mqe$N-2" "mqe$N-3"
  launch "mretro$N-qe" 3600
  wait_units 3600 "mretro$N-qe"
fi
if step_wanted qe-bank; then
  run bash "$BINDIR/bank-mod.sh" "$CAMPAIGN" "mretro$N-qe"
fi
if step_wanted code-cohort; then
  for i in 1 2 3; do run bash "$BINDIR/compose-mod-world.sh" "mcode$N-$i" "$GOALF" "$BRIEF" "$CAMPAIGN" 60; done
  for i in 1 2 3; do launch "mcode$N-$i" 3600; done
  wait_units 3600 "mcode$N-1" "mcode$N-2" "mcode$N-3"
fi
if step_wanted code-retro; then
  run bash "$BINDIR/compose-mod-retro.sh" "mretro$N-code" "$GOALF" "$BRIEF" "$CAMPAIGN" code "mcode$N-1" "mcode$N-2" "mcode$N-3"
  launch "mretro$N-code" 3600
  wait_units 3600 "mretro$N-code"
fi
if step_wanted code-bank; then
  run bash "$BINDIR/bank-mod.sh" "$CAMPAIGN" "mretro$N-code"
fi
if step_wanted adopt-next; then
  NEXT=$((N+1))
  if [ "$DRY" = 1 ]; then echo "DRY: adopt briefs/cycle-$NEXT.md"; else
    if [ -f "$HOME/control-runs/mretro$N-code/workspace/briefs/cycle-$NEXT.md" ]; then
      run bash "$BINDIR/adopt-brief.sh" "$CAMPAIGN" "mretro$N-code" "briefs/cycle-$NEXT.md"
    else
      say "ESCALATE: code retro delivered no briefs/cycle-$NEXT.md"
      exit 1
    fi
  fi
fi
say "=== cycle $N COMPLETE"
