#!/bin/bash
# init-history.sh <campaign-dir> — create the campaign's append-only
# history: a git repo whose commits are the publication acts. Only the
# kernel holds the pen; sessions deliver, admission commits.
set -euo pipefail
CAMPAIGN=$1
H=$CAMPAIGN/history
[ ! -e "$H" ] || { echo "init-history: $H already exists"; exit 1; }
mkdir -p "$H"/{modules,challenges,decisions,briefs}
touch "$H"/{modules,challenges,decisions,briefs}/.keep
cd "$H"
git init -q
git add -A
git -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "history v0 (empty)"
echo "history initialized: $H"
