#!/bin/bash
# validate-plan.sh <plan-workspace> — mechanical validation of a plan
# per PHASE-CONTRACT.md. Prints OK or REJECT; exit 0 only if conformant.
set -euo pipefail
W=$1
fail(){ echo "REJECT: $*"; exit 1; }

[ -s "$W/plan/plan.md" ] || fail "missing or empty deliverable: plan/plan.md"

# modular form: cycle briefs with MODULE/KIND headers; cycle 1 is a leaf
if [ -f "$W/plan/briefs/cycle-1.md" ]; then
  hdr(){ grep -m1 -iE "^[#* ]*$2:" "$1" | sed -E "s/^[#* ]*$2:[[:space:]]*//i; s/[*\`]//g; s/[[:space:]]+$//" || true; }
  N=0
  for B in "$W"/plan/briefs/cycle-*.md; do
    T=$(hdr "$B" TYPE); M=$(hdr "$B" MODULE); K=$(hdr "$B" KIND)
    [ "$T" = "cycle" ] || fail "brief $(basename "$B"): TYPE must be cycle (got: ${T:-none})"
    [ -n "$M" ] || fail "brief $(basename "$B"): missing MODULE header"
    case "$K" in noun|verb|shell) ;; *) fail "brief $(basename "$B"): KIND must be noun|verb|shell (got: ${K:-none})" ;; esac
    N=$((N+1))
  done
  D1=$(hdr "$W/plan/briefs/cycle-1.md" DEPENDS)
  [ -z "$D1" ] || fail "cycle-1 must be a leaf module (DEPENDS present: $D1)"
  echo "OK: modular plan conformant — $N cycle brief(s), cycle 1 is a leaf"
  exit 0
fi

[ -f "$W/plan/briefs/phase-1.md" ] || fail "missing deliverable: plan/briefs/phase-1.md"

first_type(){ # <brief-file> → prints stripped first substantive line
  grep -m1 -vE '^\s*$' "$1" | sed -E 's/[#*_`]//g; s/^\s+|\s+$//g'
}

N=0
for B in "$W"/plan/briefs/*.md; do
  T=$(first_type "$B")
  case "$T" in
    "TYPE: qe"|"TYPE: code") N=$((N+1)) ;;
    *) fail "brief $(basename "$B") first line must be 'TYPE: qe' or 'TYPE: code' (got: $T)" ;;
  esac
done

T1=$(first_type "$W/plan/briefs/phase-1.md")
[ "$T1" = "TYPE: qe" ] || fail "phase 1 must be a qe phase (bootstrap rule; got: $T1)"

echo "OK: plan conformant — $N phase brief(s), phase 1 is qe"
