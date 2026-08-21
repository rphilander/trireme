#!/bin/bash
# launch-world.sh <run-name> [cap-seconds]  — sandboxed pi run over a composed world.
set -euo pipefail
NAME=$1; CAP=${2:-5400}
R=$HOME/control-runs/$NAME
SRT=/tmp/claude-1000/-home-rodrigo/c7d6dba8-06f6-4760-a889-7fefd3cc2e6a/scratchpad/srt-install/node_modules/.bin/srt
source $HOME/.bashrc >/dev/null 2>&1
timeout --signal=TERM --kill-after=30 $CAP \
  env -i HOME="$R/home" PATH="$HOME/.local/lib/node/bin:/usr/bin:/bin" DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" TERM=dumb \
    TRIREME_WALL_CAP_S="$CAP" TRIREME_STAMP="${TRIREME_STAMP:-0}" \
  $SRT -s $R/settings.json \
  -c "cd '$R/workspace' && pi --provider deepseek --model deepseek-v4-flash --thinking high -p \"\$(cat '$R/prompt.txt')\"" \
  > $R/run.log 2>&1
echo "exit=$?" >> $R/run.log
