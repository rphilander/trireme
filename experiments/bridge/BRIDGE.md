# Bridge contract

This workspace contains a problem package: a specification (`spec.md`), a
public API contract (`contract.d.ts`), and a raw test corpus (`test262/`).

Your job is NOT to build the product. Your job is to build the **bridge**: the
machinery that turns the raw corpus into a runnable, queryable acceptance
suite for the product the spec describes.

Deliverables, all under `bridge/`:

1. **`bridge/cases.json`** — the case inventory: a JSON array of
   `{"id": "<stable unique id>"}`, one per corpus test case that is in scope
   for the product per `spec.md`. Regenerating it must be deterministic (same
   ids, same order).
2. **`bridge/run.mjs`** — the runner:
   `node bridge/run.mjs --subject <path> --cases <file> --out <path>`
   - `--subject`: a module (JS or TS) exporting the public API in
     `contract.d.ts`;
   - `--cases`: a file of case ids, one per line, or the literal `ALL`;
   - `--out`: where to write
     `{"results": [{"id": "...", "status": "pass" | "fail", "detail": "<short, optional>"}]}`.
   Pass/fail semantics must follow the corpus's own conventions — discovering
   those conventions is part of this job. The runner must be robust: a subject
   that throws, hangs (use a per-case timeout), or is incomplete produces
   `"fail"` results; the runner itself never crashes or hangs.
3. **`bridge/stub.mjs`** — a minimal do-almost-nothing subject proving the
   bridge runs end-to-end (it will fail most cases; that is expected).
4. **`bridge/README.md`** — how the corpus is organized, what you put in and
   out of scope and why, and every judgment call you made.

Constraints: `test262/`, `spec.md`, and `contract.d.ts` are read-only. The
bridge is self-contained: node standard library only, no installs, no network.

Done = `node bridge/run.mjs --subject bridge/stub.mjs --cases ALL --out
/tmp/r.json` completes with schema-valid output, and all deliverables exist.
