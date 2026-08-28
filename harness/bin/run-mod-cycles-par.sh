#!/bin/bash
# run-mod-cycles-par.sh <campaign-dir> [--cohort N] <cycle> <cycle>...
# — run several dependency-ready cycles CONCURRENTLY, each as its own
# unit. Briefs must be pre-authored (batch session); cycles run
# --no-adopt. Banks serialize on the campaign lock. Exits nonzero if
# any cycle failed to complete.
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; shift
COHORT=""; CYCLES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --cohort) COHORT=$2; shift 2 ;;
    *) CYCLES+=("$1"); shift ;;
  esac
done
[ ${#CYCLES[@]} -gt 0 ] || { echo "no cycles given"; exit 1; }

for n in "${CYCLES[@]}"; do
  [ -f "$CAMPAIGN/plan/briefs/cycle-$n.md" ] || { echo "missing brief for cycle $n"; exit 1; }
done
for n in "${CYCLES[@]}"; do
  systemd-run --user --unit="trireme-mcycle-$n" --collect \
    --property=EnvironmentFile=$HOME/.trireme-env \
    bash $HOME/src/trireme/harness/bin/run-mod-cycle.sh "$CAMPAIGN" "$n" --no-adopt ${COHORT:+--cohort "$COHORT"}
  echo "launched cycle $n"
done

while :; do
  live=0
  for n in "${CYCLES[@]}"; do
    systemctl --user is-active --quiet "trireme-mcycle-$n" && live=1
  done
  [ "$live" = 0 ] && break
  sleep 60
done

fail=0
for n in "${CYCLES[@]}"; do
  if grep -q "cycle $n COMPLETE" "$CAMPAIGN/driver-cycle-$n.log" 2>/dev/null; then
    echo "cycle $n: COMPLETE"
  else
    echo "cycle $n: DID NOT COMPLETE — $(tail -1 "$CAMPAIGN/driver-cycle-$n.log" 2>/dev/null)"
    fail=1
  fi
done
exit $fail
