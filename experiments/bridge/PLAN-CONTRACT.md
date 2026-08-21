# Plan contract

This workspace contains a problem package — a product statement (`PRODUCT.md`),
a public API contract (`contract.d.ts`), the raw test corpus (`test262/`) —
and a completed **bridge** (`bridge/`): a mechanical inventory of every corpus
case with its metadata (`bridge/cases.json`), a runner that grades any subject
against any case list (`bridge/run.mjs`, see `bridge/README.md`), and a stub
subject.

Your job is NOT to build the product and NOT to modify the bridge. Your job is
to **plan the project**: the product will be built over many separate efforts,
and each effort needs a bounded, verifiable scope.

Deliverables:

1. **`plan/PLAN.md`** — the whole-project plan: a sequence of phases from
   nothing to maximal conformance with the corpus. For each phase: its scope,
   its rationale, roughly how its case set will be derived from the inventory,
   and its verifiable gate. The plan is a living document — later phases may
   be revised as the project learns — so invest most of your precision in the
   earliest phases.
2. **`plan/phase-1/cases.txt`** — phase one, concretely: the case ids (one per
   line, ids exactly as in `bridge/cases.json`) that constitute phase one's
   acceptance set. Phase one should be a coherent, contained vertical slice:
   achievable by a single focused effort, verifiable end-to-end through the
   bridge, and a sound foundation for everything after it.
3. **`plan/phase-1/BRIEF.md`** — the assignment document for whoever executes
   phase one. IMPORTANT: it will be that builder's **entire world** — they
   will see only this brief, the contract, and phase one's cases. Write it as
   a complete, self-contained product assignment: what to build, how it is
   judged (all phase-one cases pass via the bridge runner), and whatever
   corpus knowledge they need. Do not mention this plan, later phases, or the
   wider corpus.

Constraints: `test262/`, `bridge/`, `PRODUCT.md`, and `contract.d.ts` are
read-only. Every id in `cases.txt` must exist in `bridge/cases.json`.

Done = the three deliverables exist; `plan/phase-1/cases.txt` is non-empty and
every id resolves; `PLAN.md` covers the road from phase one to maximal
conformance.
