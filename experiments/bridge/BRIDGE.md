# Bridge contract (v2)

This workspace contains a problem package: a product statement (`PRODUCT.md`),
a public API contract (`contract.d.ts`), and a raw test corpus (`test262/`).
The corpus defines the requirement — there is no further specification.

Your job is NOT to build the product. Your job is to build the **bridge**: the
machinery that turns the raw corpus into a runnable, queryable acceptance
suite.

Deliverables, all under `bridge/`:

1. **`bridge/cases.json`** — the complete mechanical inventory: one entry per
   test case in the corpus (excluding only files the corpus's own conventions
   mark as non-tests, e.g. fixtures). Each entry:
   `{"id": "<stable unique id>", "meta": {...}}` where `meta` records the
   case's own labels verbatim as found in the corpus (its declared flags,
   feature tags, required includes, expected-failure declarations, and
   anything else the corpus's metadata conventions define). No selection, no
   judgment: the inventory is the whole corpus, with its structure made
   machine-readable. Regeneration must be deterministic.
2. **`bridge/run.mjs`** — the runner:
   `node bridge/run.mjs --subject <path> --cases <file> --out <path>`
   - `--subject`: a module (JS or TS) exporting the public API in
     `contract.d.ts`;
   - `--cases`: a file of case ids, one per line, or the literal `ALL`;
   - `--out`: where to write
     `{"results": [{"id": "...", "status": "pass" | "fail" | "unsupported", "detail": "<short, optional>"}]}`.
   Pass/fail semantics must follow the corpus's own conventions — discovering
   those conventions is part of this job. A case whose conventions cannot be
   exercised through the subject interface in `contract.d.ts` (for example, a
   case requiring interactions the interface does not provide) is reported
   `"unsupported"`, with a one-phrase reason. The runner must be robust: a
   subject that throws, hangs (use a per-case timeout), or is incomplete
   produces `"fail"` results; the runner itself never crashes or hangs.
3. **`bridge/stub.mjs`** — a minimal do-almost-nothing subject proving the
   bridge runs end-to-end (it will fail most cases; that is expected).
4. **`bridge/README.md`** — how the corpus is organized, what its metadata
   conventions mean, how the runner maps a case onto the subject interface,
   which case categories are `"unsupported"` and why, and any judgment calls.

Constraints: `test262/`, `PRODUCT.md`, and `contract.d.ts` are read-only. The
bridge is self-contained: node standard library only, no installs, no network.

Done = `node bridge/run.mjs --subject bridge/stub.mjs --cases ALL --out
/tmp/r.json` completes with schema-valid output covering the full inventory,
and all deliverables exist.
