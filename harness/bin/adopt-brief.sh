#!/bin/bash
# adopt-brief.sh <campaign-dir> <run> <brief-relpath> — mechanically adopt
# an agent-authored brief into the campaign plan repo (kernel-authored
# commit citing the run). Refuses an illegal TYPE line or an overwrite.
set -euo pipefail
CAMPAIGN=$1; RUN=$2; REL=$3; DEST_NAME=${4:-}
F=$HOME/control-runs/$RUN/workspace/$REL

[ -f "$F" ] || { echo "adopt-brief: not found: $F"; exit 1; }
# header grep, same tolerance as the composers: a TYPE: line anywhere
# in the header block (briefs conventionally open with a title)
T=$(grep -m1 -iE '^[#* ]*TYPE:' "$F" | sed -E 's/^[#* ]*TYPE:[[:space:]]*//i; s/[*`]//g; s/[[:space:]]+$//' || true)
case "$T" in
  qe|code|cycle) ;;
  *) echo "adopt-brief: brief needs a 'TYPE: qe|code|cycle' header line (got: ${T:-none})"; exit 1 ;;
esac
DEST=$CAMPAIGN/plan/briefs/${DEST_NAME:-$(basename "$F")}
[ ! -e "$DEST" ] || { echo "adopt-brief: $DEST already exists"; exit 1; }

mkdir -p "$CAMPAIGN/plan/briefs"
cp "$F" "$DEST"
cd "$CAMPAIGN/plan"
git add -A
git -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "$(basename "$F") (adopted from $RUN)"
echo "brief adopted: $DEST (from $RUN)"
