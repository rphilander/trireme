#!/bin/bash
# adopt-plan.sh <campaign-dir> <plan-run> — adopt a planner session's
# plan v1 into the campaign as an agent-authored git repo. Validates
# first; refuses if the campaign already has a plan (later revisions
# are committed by retrospectives, not adopted).
set -euo pipefail
CAMPAIGN=$1; RUN=$2
W=$HOME/control-runs/$RUN/workspace
BINDIR=$(cd "$(dirname "$0")" && pwd)

[ ! -e "$CAMPAIGN/plan" ] || { echo "adopt-plan: $CAMPAIGN/plan already exists"; exit 1; }
bash "$BINDIR/validate-plan.sh" "$W"

mkdir -p "$CAMPAIGN"
cp -a "$W/plan" "$CAMPAIGN/plan"
cd "$CAMPAIGN/plan"
git init -q
git add -A
git -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "plan v1 (adopted from $RUN)"
echo "plan adopted: $CAMPAIGN/plan (from $RUN)"
