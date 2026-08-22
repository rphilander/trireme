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
# reject the fold if the newest phase declaration violates the scope rule
NEWEST=$(ls -d "$REPO"/entry-* 2>/dev/null | sed 's/.*entry-//' | sort -n | tail -1)
if [ -n "$NEWEST" ] && { [ -f "$REPO/entry-$NEWEST/BRIEF.md" ] || [ -d "$REPO/entry-$NEWEST/layer-1" ]; }; then
  if ! $HOME/src/trireme/experiments/kernel/validate-phase.sh "$REPO" "entry-$NEWEST"; then
    cd "$REPO" && git checkout -q -- . && git clean -qfd
    echo "commit-plan REJECTED: phase entry-$NEWEST violates the scope rule; canonical plan restored" >&2
    exit 1
  fi
fi
cd "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "no plan changes from $RN — nothing to commit"
else
  git commit -q --author="$RN <agent@trireme.local>" -F "$MSG"
fi
git log --format="%h %an: %s" -1
