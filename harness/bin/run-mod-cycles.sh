#!/bin/bash
# run-mod-cycles.sh <campaign-dir> <start-cycle> <count> — chain cycles;
# stop on the first escalation.
set -euo pipefail
CAMPAIGN=$1; START=$2; COUNT=$3
BINDIR=$(cd "$(dirname "$0")" && pwd)
for ((n=START; n<START+COUNT; n++)); do
  bash "$BINDIR/run-mod-cycle.sh" "$CAMPAIGN" "$n"
done
echo "CHAIN COMPLETE: cycles $START..$((START+COUNT-1))"
