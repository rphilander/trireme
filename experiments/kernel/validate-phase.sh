#!/bin/bash
# validate-phase.sh — kernel: mechanically validate a phase declaration.
#
#   validate-phase.sh <plan-dir> <phase>     (plan-dir = repo or a checkout)
#
# Enforces the scope rule (settled 2026-08-22): a single agent session's
# editable surface is ONE module plus wiring-scale seams. editable.txt
# lines are "<path>" (a module) or "<path> wiring" (a wiring seam).
# A phase is either single-layer (root BRIEF.md + editable.txt) or a
# multi-layer stack (contiguous layer-1..N dirs, each with BRIEF.md +
# editable.txt) — multi-module work WITHOUT layer dirs is REJECTED.
set -euo pipefail
P=$1; E=$2; D=$P/$E
fail(){ echo "REJECT [$E]: $*" >&2; exit 1; }
[ -f "$D/cases.txt" ] || fail "missing cases.txt"
check_ed(){
  local f=$1 lbl=$2 mods=0
  [ -f "$f" ] || fail "$lbl: missing editable.txt"
  while read -r path tag; do
    [ -z "$path" ] && continue
    if [ -n "$tag" ] && [ "$tag" != "wiring" ]; then fail "$lbl: unknown editable.txt annotation '$tag'"; fi
    [ "$tag" = "wiring" ] && continue
    mods=$((mods+1))
  done < "$f"
  [ "$mods" -eq 1 ] || fail "$lbl: $mods non-wiring (module) paths in editable.txt — one module per agent session; multi-module work must be declared as layer-* dirs and run as a lineage"
}
layers=$(ls -d $D/layer-* 2>/dev/null | sort -V || true)
if [ -n "$layers" ]; then
  [ ! -f "$D/BRIEF.md" ] && [ ! -f "$D/editable.txt" ] || fail "root BRIEF.md/editable.txt must not coexist with layer-* dirs"
  i=0
  for L in $layers; do
    i=$((i+1))
    [ "$(basename $L)" = "layer-$i" ] || fail "layer dirs must be contiguous layer-1..N (found $(basename $L))"
    [ -f "$L/BRIEF.md" ] || fail "layer-$i: missing BRIEF.md"
    check_ed "$L/editable.txt" "layer-$i"
  done
  echo "OK [$E]: multi-layer stack, $i layers, one module per layer"
else
  [ -f "$D/BRIEF.md" ] || fail "single-layer phase missing BRIEF.md"
  check_ed "$D/editable.txt" "root"
  echo "OK [$E]: single-layer phase, one module"
fi
