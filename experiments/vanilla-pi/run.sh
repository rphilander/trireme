#!/bin/bash
# run.sh — execute one vanilla-pi control run inside the srt sandbox.
#
#   experiments/vanilla-pi/run.sh <run-dir> [wall-clock-seconds]
#
# The wrapper owns what trireme's orchestrator owns for its runs: the wall
# clock (hard kill), workspace snapshots every 5 minutes (for offline
# trajectory grading), and the transcript/log capture. Cost is summed after
# the fact from pi's session file; the $3 manifest cap has never been the
# binding constraint at this scale, so it is checked post-hoc, not enforced
# live (noted in the experiment writeup).
#
# The agent sees only: the workspace (write), acceptance/spec/contract
# (read-only mounts), a clean pi home, and api.deepseek.com.
set -euo pipefail

RUN_DIR=$(cd "$1" && pwd)
WALL=${2:-5400}
HERE=$(cd "$(dirname "$0")" && pwd)
PROMPT_FILE=${3:-$HERE/prompt.txt}
SP_SRT=/tmp/claude-1000/-home-rodrigo/c7d6dba8-06f6-4760-a889-7fefd3cc2e6a/scratchpad/srt-install/node_modules/.bin/srt
NODE_BIN=$HOME/.local/lib/node/bin
WS=$RUN_DIR/workspace

# The key comes from the operator's environment, never from inside the sandbox.
source "$HOME/.bashrc" >/dev/null 2>&1 || true
: "${DEEPSEEK_API_KEY:?DEEPSEEK_API_KEY not set}"

# The prompt must be readable INSIDE the sandbox; the experiments dir is not
# (it lives under ~/src, which is deny-read). Copy it into the run dir.
cp "$PROMPT_FILE" "$RUN_DIR/prompt.txt"

# Snapshot loop: workspace state every 5 minutes, node_modules excluded.
(
  i=0
  while true; do
    sleep 300
    i=$((i + 1))
    rsync -a --exclude node_modules "$WS/" "$RUN_DIR/snapshots/t$(printf '%03d' $((i * 5)))/" 2>/dev/null || true
  done
) &
SNAP_PID=$!
trap 'kill $SNAP_PID 2>/dev/null || true' EXIT

START=$(date +%s)
echo "start $(date -u +%FT%TZ) wall-cap ${WALL}s" > "$RUN_DIR/run.log"

set +e
timeout --signal=TERM --kill-after=30 "$WALL" \
  env -i \
    HOME="$RUN_DIR/home" \
    PATH="$NODE_BIN:/usr/bin:/bin" \
    DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
    TERM=dumb \
  "$SP_SRT" -s "$RUN_DIR/settings.json" \
    -c "cd '$WS' && pi --provider deepseek --model deepseek-v4-flash --thinking high -p \"\$(cat '$RUN_DIR/prompt.txt')\"" \
  >> "$RUN_DIR/run.log" 2>&1
CODE=$?
set -e

END=$(date +%s)
echo "exit=$CODE elapsed=$((END - START))s" >> "$RUN_DIR/run.log"
# Final snapshot regardless of cadence.
rsync -a --exclude node_modules "$WS/" "$RUN_DIR/snapshots/final/" 2>/dev/null || true
echo "run finished: exit=$CODE elapsed=$((END - START))s"
