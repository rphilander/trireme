#!/bin/bash
# run-lineage.sh — kernel: drive ONE lineage of a multi-layer phase.
#
#   run-lineage.sh <lineage-name> <pristine-home> <phase> [cap-seconds-per-layer]
#   e.g. run-lineage.sh entry6-1 ~/control-runs/planner-2/workspace entry-6 5400
#
# Layer declaration contract (authored by the retro in the plan repo):
#   plan/<phase>/cases.txt              the stack's delta (lights at the top)
#   plan/<phase>/layer-1/BRIEF.md       per-layer brief
#   plan/<phase>/layer-1/editable.txt   editable paths, one per line
#   plan/<phase>/layer-2/...            (layers run in order)
# Single-layer phases (BRIEF.md at the phase root, no layer-* dirs) are not
# driven by this script — they use the ordinary compose+launch flow.
#
# Semantics (wiki harness/pipeline.md, settled 2026-08-22): fresh agent per
# layer; between layers the kernel validates mechanically — the FULL
# accepted suite (trunk/ACCEPTED.txt) must stay green — then stacks the
# next layer on this lineage's own result. Red gate or cap-out HALTS the
# lineage (v1: no retries). Judgment happens only at the phase retro.
set -euo pipefail
NAME=$1; P=$2; E=$3; CAP=${4:-5400}
PLANREPO=$HOME/control-runs/plan
ACCEPTED=$HOME/control-runs/trunk/ACCEPTED.txt
BASE=$HOME/control-runs/trunk/current
LOG=$HOME/control-runs/$NAME.lineage.md
echo "# Lineage $NAME — phase $E, started $(date -u +%FT%TZ)" > $LOG

i=0
while true; do
  i=$((i+1)); LDIR=$PLANREPO/$E/layer-$i
  [ -d "$LDIR" ] || break
  RUN=$NAME-L$i
  EDITABLE=$(grep -v '^\s*$' $LDIR/editable.txt | tr '\n' ' ')
  echo "## layer $i ($RUN): editable = $EDITABLE" >> $LOG
  TRIREME_BASE="$BASE" TRIREME_BRIEF="$LDIR/BRIEF.md" \
    $HOME/src/trireme/experiments/kernel/compose-module-world.sh $RUN "$P" "$E" $EDITABLE >> $LOG 2>&1
  $HOME/src/trireme/experiments/kernel/launch-world.sh $RUN $CAP || true
  EXIT=$(grep '^exit=' $HOME/control-runs/$RUN/run.log | tail -1)
  echo "- session ended: $EXIT" >> $LOG
  # mechanical validation: full accepted suite green on the layer's result
  set +e
  ( cd "$P" && timeout 1800 node bridge/run.mjs \
      --subject $HOME/control-runs/$RUN/workspace/src/engine/index.ts \
      --cases "$ACCEPTED" --out $HOME/control-runs/$RUN/layer-gate.json ) >> $LOG 2>&1
  GATE=$?
  set -e
  FAILS=$(python3 -c "
import json
try: r=json.load(open('$HOME/control-runs/$RUN/layer-gate.json'))['results']
except Exception: print(-1); raise SystemExit
print(sum(1 for x in r if x['status']!='pass'))")
  if [ "$GATE" -ne 0 ] || [ "$FAILS" != "0" ]; then
    echo "- **LINEAGE HALTED at layer $i**: gate exit=$GATE, non-pass=$FAILS" >> $LOG
    echo "HALTED layer=$i" > $HOME/control-runs/$NAME.lineage-status
    exit 1
  fi
  echo "- layer $i VALIDATED: accepted suite green" >> $LOG
  BASE=$HOME/control-runs/$RUN/workspace
done

if [ $i -eq 1 ]; then echo "no layer-* dirs under plan/$E — not a driven phase" >&2; exit 2; fi
echo "COMPLETE layers=$((i-1)) final=$BASE" > $HOME/control-runs/$NAME.lineage-status
echo "## lineage complete: $((i-1)) layers, final workspace $BASE" >> $LOG
