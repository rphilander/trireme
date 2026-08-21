#!/bin/bash
# commit-plan.sh — kernel: fold a retro's plan revision into the canonical
# plan repo (~/control-runs/plan).
#
#   commit-plan.sh <retro-run-name>
#
# Copies the retro workspace's plan working tree (minus .git) over the
# canonical tree and commits with the retro's REVISION.md (workspace root)
# as the message — author = the retro run, committer = the kernel. The
# commit is the plan-of-record handoff; REVISION.md itself is not tracked.
set -euo pipefail
RN=$1
REPO=$HOME/control-runs/plan
W=$HOME/control-runs/$RN/workspace/plan
MSG=$HOME/control-runs/$RN/workspace/REVISION.md
[ -f "$MSG" ] || { echo "no REVISION.md in $RN workspace" >&2; exit 1; }
rsync -a --delete --exclude .git "$W/" "$REPO/"
cd "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "no plan changes from $RN — nothing to commit"
else
  git commit -q --author="$RN <agent@trireme.local>" -F "$MSG"
fi
git log --format="%h %an: %s" -1
