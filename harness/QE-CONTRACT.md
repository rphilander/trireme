# QE-CONTRACT v1 — the binding's requirements-corpus

The QE estate authors and owns the acceptance suite FOR the binding
machinery (the verdict runner + its subject contract). A QE suite
encodes what the binding MUST do — derived from the acceptance corpus's
own documentation and conventions — not what the current binding
happens to do. Tests red against the current binding are FINDINGS when
they claim a real defect.

## Suite invocation

    node suite/run.mjs --binding <binding-workspace-dir> --out <path>

- `--binding`: the binding under test (read-only): bridge/run.mjs,
  contract.d.ts, inventory/, budgets.json as delivered.
- Output: {"results":[{"id","status":"pass"|"fail","detail"?,"ms"?}]}
  — one result per test id; "fail" detail states what was expected vs
  observed.

## Hard requirements (mechanically verified)
1. Never crashes or hangs; per-test containment.
2. Deterministic: identical binding ⇒ identical verdicts.
3. Self-contained: the suite brings its own scripted subjects (conforming
   to the binding's contract.d.ts), case selections, and oracles.

## Deliverables
- `suite/run.mjs` + everything it needs (subjects/, fixtures/).
- `SUITE.md` — what each test family asserts and why the corpus's rules
  require it.
- `FINDINGS.md` — every test red against the CURRENT binding, with the
  claimed defect ("test <id>: the runner does X; the corpus rules
  require Y; evidence").
