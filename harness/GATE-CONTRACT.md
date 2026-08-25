# GATE-CONTRACT v1 — the verdict runner (target-free)

Every campaign is driven through one interface: a verdict runner the
binding phase authors, conforming exactly to this contract. The
platform's grading, banking, relay validation, and timing ledger all
speak only this shape — they never know the target domain.

## Invocation

    node bridge/run.mjs --subject <path> --cases <file|ALL> --out <path>
         [--workers N] [--timeout-ms N]

- `--subject`: path to the candidate product (module/file; the subject
  contract is campaign-specific and defined by the binding's
  contract.d.ts).
- `--cases`: a file of case ids, one per line (# and blank lines
  ignored), or the literal `ALL` for the full inventory.
- `--out`: where to write the verdicts JSON.

## Output

    { "results": [ { "id": string,
                     "status": "pass" | "fail" | "unsupported",
                     "detail"?: string,        // one-phrase reason
                     "ms"?: number } ] }       // per-case wall millis

- One result per requested id, same id strings as the inventory.
- `unsupported` = the case cannot be evaluated through the subject
  interface (with a one-phrase reason) — never used for ordinary
  failures.
- `ms` is the timing ledger the platform's gate-SLO machinery reads.

## Hard requirements (mechanically verified)

1. NEVER crashes, never hangs: a missing, empty, malformed, throwing,
   or looping subject yields per-case `fail`/`unsupported` verdicts and
   exit 0. Per-case timeouts kill stuck cases.
2. DETERMINISTIC: identical subject + cases ⇒ identical (id, status)
   sets, run to run. Timing may vary; verdicts may not.
3. Complete: every requested id appears exactly once in the output.
