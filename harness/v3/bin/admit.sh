#!/bin/bash
# admit.sh <campaign-dir> <run> <kind> — the admission gate: mechanical
# floors over a session's delivery, then a kernel-authored commit into
# campaign/history. The commit IS publication; nothing else writes
# history. Green is NOT an admission requirement — reds are ledger
# content, not gate failures.
#
#   kind=tests    QE delivery: adds under modules/<M>/test/ only
#                 (+ an uncommitted stub vehicle at modules/<M>/index.ts
#                 when the module has no code). Floors: structure, lint,
#                 stub/interface typecheck, test-file accretion
#                 (banked test files never edited).
#   kind=code     code delivery: def-level accretion in modules/<M>
#                 source (adds only, ledger-verified) + optional
#                 challenges/*.md. Floors: compile, lint, accretion,
#                 undeclared-import, challenge shape. Suite verdicts
#                 are computed later by verdicts.sh, never here.
#   kind=decision retro delivery: adds under decisions/ only.
#
# Exit 0 admitted (prints commit), 1 refused (prints REFUSE reason).
set -euo pipefail
command -v node >/dev/null 2>&1 || export PATH="$HOME/.local/lib/node/bin:$PATH"
CAMPAIGN=$1; RUN=$2; KIND=$3
W=$HOME/control-runs/$RUN/workspace
HIST=$CAMPAIGN/history
BINDIR=$(cd "$(dirname "$0")" && pwd)
V2BIN=$BINDIR/../../bin
refuse(){ echo "REFUSE: $*"; exit 1; }
[ -d "$HIST/.git" ] || refuse "no history repo at $HIST"
[ -d "$W" ] || refuse "no workspace for run $RUN"

# serialize history mutations
exec 9>"$CAMPAIGN/.campaign.lock"; flock 9

# ---- classify the delivery: workspace tree vs history tip ----------
# The world's workspace holds a checkout of history's modules/ plus
# the platform kit; deliveries are the paths that differ. Sessions may
# only ADD (def-level adds within an existing file are verified by the
# ledger for kind=code; whole-file edits elsewhere are refusals).
TIP=$(mktemp -d)
git -C "$HIST" archive HEAD | tar -x -C "$TIP"
ADDED=(); MODIFIED=()
scan(){ # <relroot> — compare workspace vs tip under one root
  local root=$1
  # derived artifacts never publish: history holds source only
  ( cd "$W" 2>/dev/null && find "$root" -type f ! -name '*.js' ! -name '*.d.ts' ! -name '*.map' ! -name '.keep' 2>/dev/null ) | sort > /tmp/admit.w.$$ || true
  ( cd "$TIP" 2>/dev/null && find "$root" -type f ! -name '.keep' 2>/dev/null ) | sort > /tmp/admit.t.$$ || true
  while IFS= read -r f; do
    if [ ! -e "$TIP/$f" ]; then ADDED+=("$f");
    elif ! cmp -s "$W/$f" "$TIP/$f"; then MODIFIED+=("$f"); fi
  done < /tmp/admit.w.$$
  rm -f /tmp/admit.w.$$ /tmp/admit.t.$$
}
scan modules
scan challenges
scan decisions

# single-module discipline: all module-tree paths under one modules/<M>
MODULE=""
for f in ${ADDED[@]+"${ADDED[@]}"} ${MODIFIED[@]+"${MODIFIED[@]}"}; do
  case "$f" in
    modules/*)
      m=$(echo "$f" | cut -d/ -f2)
      [ -z "$MODULE" ] || [ "$MODULE" = "$m" ] || refuse "one module per contribution (saw $MODULE and $m)"
      MODULE=$m ;;
  esac
done

# deletion canary, scoped to what this kind of world actually carries:
# a code world holds its module's full tree; a qe world holds only the
# test estate (sources of its own module are sealed away from it).
# Everything else at tip is legitimately absent from a session world —
# worlds mount sealed interfaces, not checkouts of the whole history.
canary(){ # <tip-subtree>
  ( cd "$TIP" 2>/dev/null && { find "$1" -type f ! -name '*.js' ! -name '*.d.ts' ! -name '*.map' ! -name '.keep' 2>/dev/null || true; } ) | while IFS= read -r f; do [ -e "$W/$f" ] || echo "$f"; done
}
if [ -n "$MODULE" ]; then
  case "$KIND" in
    code) GONE=$(canary "modules/$MODULE") ;;
    tests) GONE=$(canary "modules/$MODULE/test") ;;
    *) GONE="" ;;
  esac
  [ -z "$GONE" ] || refuse "history is append-only; deleted: $(echo $GONE) (collections are adjudicated decisions the kernel executes)"
fi

# ---- per-kind floors ------------------------------------------------
case "$KIND" in
tests)
  [ -n "$MODULE" ] || refuse "tests delivery touches no module"
  for f in ${ADDED[@]+"${ADDED[@]}"}; do
    case "$f" in
      modules/$MODULE/test/doc/*.test.ts|modules/$MODULE/test/opaque/*.test.ts) ;;
      modules/$MODULE/index.ts) ;; # stub vehicle; excluded from the commit below
      *) refuse "tests may only add test files (got: $f)" ;;
    esac
  done
  for f in ${MODIFIED[@]+"${MODIFIED[@]}"}; do
    refuse "published test files are immutable (edited: $f); supersede via challenge/decision"
  done
  V=$(bash "$V2BIN/validate-mod.sh" "$W" "$MODULE" qe 2>&1) || refuse "floor: $V"
  ;;
code)
  # a challenge-only delivery (dispute without code change) is legal
  if [ -z "$MODULE" ]; then
    CH=0
    for f in ${ADDED[@]+"${ADDED[@]}"}; do case "$f" in challenges/*.md) CH=1 ;; *) refuse "code may add module source and challenges only (got: $f)" ;; esac; done
    [ "$CH" = 1 ] || refuse "code delivery touches no module and files no challenge"
  fi
  for f in ${ADDED[@]+"${ADDED[@]}"} ${MODIFIED[@]+"${MODIFIED[@]}"}; do
    case "$f" in
      modules/$MODULE/test/*) refuse "coders never touch tests (got: $f); dispute via challenges/" ;;
      modules/$MODULE/*) ;;
      challenges/*.md) ;;
      *) refuse "code may add module source and challenges only (got: $f)" ;;
    esac
  done
  # def-level accretion: file edits are legal iff the ledger sees adds only
  if [ -z "$MODULE" ]; then :; else
  BASE=$(mktemp)
  if [ -d "$TIP/modules/$MODULE" ] && ls "$TIP/modules/$MODULE"/*.ts >/dev/null 2>&1; then
    ( cd "$TIP" && node "$W/platform/ledger/ledger.js" "modules/$MODULE" > "$BASE" 2>/dev/null ) || BASE=""
  else BASE=""; fi
  V=$(bash "$V2BIN/validate-mod.sh" "$W" "$MODULE" code ${BASE:+"$BASE"} 2>&1) || {
    # a red suite is NOT a refusal in v3 — only shape floors are. But
    # validate-mod stops at the first failure, so on a tolerated red
    # the accretion floor it never reached must run here.
    echo "$V" | grep -q '^REJECT: module suite red' || refuse "floor: $V"
    if [ -n "$BASE" ]; then
      D=$(cd "$W" && node platform/ledger/ledger.js --diff "$BASE" "modules/$MODULE" 2>&1) \
        || refuse "accretion violation — published definitions edited in place: $(echo "$D" | tail -1)"
    fi
  }
  fi
  for f in ${ADDED[@]+"${ADDED[@]}"}; do
    case "$f" in challenges/*.md)
      [ -s "$W/$f" ] || refuse "empty challenge: $f"
      grep -q 'TEST:' "$W/$f" || refuse "challenge $f names no TEST: <path>" ;;
    esac
  done
  ;;
decision)
  [ -z "$MODULE" ] || refuse "decisions do not edit modules directly (kernel executes them)"
  for f in ${ADDED[@]+"${ADDED[@]}"}; do
    case "$f" in decisions/*.md) [ -s "$W/$f" ] || refuse "empty decision: $f" ;;
      *) refuse "decision may add decisions/*.md only (got: $f)" ;;
    esac
  done
  [ ${#ADDED[@]} -gt 0 ] || refuse "no decision delivered"
  ;;
*) refuse "unknown kind: $KIND" ;;
esac

# ---- publish: kernel-authored commit of exactly the delivery -------
N=0
for f in ${ADDED[@]+"${ADDED[@]}"} ${MODIFIED[@]+"${MODIFIED[@]}"}; do
  case "$KIND:$f" in tests:modules/$MODULE/index.ts) continue ;; esac # stub never publishes
  mkdir -p "$HIST/$(dirname "$f")"
  cp "$W/$f" "$HIST/$f"
  N=$((N+1))
done
[ "$N" -gt 0 ] || refuse "nothing to publish"
cd "$HIST"
git add -A
git -c user.name=kernel -c user.email=kernel@trireme.local commit -qm "$KIND from $RUN${MODULE:+ (module $MODULE)}: $N file(s)"
rm -rf "$TIP"
echo "ADMITTED: $KIND from $RUN${MODULE:+ module=$MODULE} files=$N commit=$(git rev-parse --short HEAD)"
