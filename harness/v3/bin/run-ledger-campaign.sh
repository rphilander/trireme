#!/bin/bash
# run-ledger-campaign.sh <campaign-dir> <first-cycle> <last-cycle>
# — drive brief conversations SEQUENTIALLY under the bankless ledger
# (dependency order; each brief must close DONE before the next).
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; FIRST=$2; LAST=$3
BINDIR=$(cd "$(dirname "$0")" && pwd)
for n in $(seq "$FIRST" "$LAST"); do
  BRIEF=$CAMPAIGN/history/briefs/cycle-$n.md
  [ -f "$BRIEF" ] || { echo "campaign: no brief cycle-$n.md"; exit 1; }
  echo "$(date -u +%H:%M:%SZ) campaign: conversation cycle-$n opening"
  bash "$BINDIR/run-ledger.sh" "$CAMPAIGN" "$BRIEF" || { echo "campaign: cycle-$n did not close (see ledger-driver-cycle-$n.log)"; exit 1; }
  echo "$(date -u +%H:%M:%SZ) campaign: cycle-$n CLOSED"
done
echo "campaign: cycles $FIRST-$LAST all closed"
