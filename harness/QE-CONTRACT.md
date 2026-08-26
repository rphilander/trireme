# QE-CONTRACT v2 — the internal suite & gate machinery

A campaign has two worker estates. Coding cohorts build the product.
QE cohorts build and own the campaign's INTERNAL test suite and gate
machinery — the instrument everything else is measured by. One
non-coding retro judges both. QE work is brief-driven: the plan says
what a QE phase must accomplish; this contract says what shape the
result must have.

The external corpus (tests/) is bedrock: read-only, never edited,
never reinterpreted to match current behavior. QE work brings it
gradually into scope and encodes what the corpus's own rules REQUIRE —
not what any current implementation happens to do. A test red against
current machinery is a FINDING when it claims a real defect: keep it
red, document it, never weaken it.

## Deliverable layout (banked as one unit — the gate module)

    bridge/run.mjs        verdict runner per GATE-CONTRACT.md (platform-fixed)
    contract.d.ts         subject contract candidate products implement
    inventory/cases.txt   full external case-id space, one id per line
    inventory/derive.mjs  re-runnable; regenerates cases.txt from tests/
    budgets.json          {"defaultTimeoutMs": N, "perCase": {id: ms}} — measured
    scope/cases.txt       the tranche in scope for the next coding phase (⊆ inventory)
    suite/self/run.mjs    self-suite: tests OF the gate machinery itself
    SUITE.md              internal test families + scope rationale
    FINDINGS.md           currently-red internal tests, each with the claimed defect

The module is the WHOLE workspace (everything except tests/ and
MANDATE.md): supporting code outside the fixed layout (lib/, tools/,
...) is legal, is carried into the retro world, and is banked with the
module. A later QE phase receives the whole banked module as its
editable starting state and must leave the same layout behind.

## The self-suite

    node suite/self/run.mjs --out <path>        (cwd = the module root)

writes `{"results":[{"id","status":"pass"|"fail","detail"?,"ms"?}]}` —
one result per self-test. Self-contained (its scripted subjects and
fixtures live under suite/), never crashes or hangs, deterministic.
Red results are findings, not failures of the QE phase.

## Internal case ids (forward provision)

`inventory/cases.txt` MAY grow `internal/...` ids — disambiguation or
performance cases the corpus does not provide, evaluated by
bridge/run.mjs like any other case. Strict progress for code banks
counts only non-internal ids.

## Mechanical validation (validate-qe.sh; REJECT on any failure)

- All deliverables present; inventory non-empty, no duplicate ids.
- scope/cases.txt non-empty, no duplicates, every id in the inventory.
- Runner survives missing-subject and empty-subject probes: exit 0,
  valid output shape, complete coverage of requested ids, statuses
  from pass|fail|unsupported, ms numeric when present.
- Runner determinism: double run to the SAME --out path, identical
  (id, status) sets.
- Self-suite: exit 0, valid shape, non-empty, same-path double-run
  determinism; its red count is reported as a platform FACT.
