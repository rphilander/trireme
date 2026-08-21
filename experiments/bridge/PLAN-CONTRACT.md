# Plan contract (v3)

This workspace contains a problem package — a product statement (`PRODUCT.md`),
a public API contract (`contract.d.ts`), the raw test corpus (`test262/`) —
and a completed **bridge** (`bridge/`): the full mechanical case inventory with
metadata (`bridge/cases.json`) and a runner that grades any subject against
any case list (`bridge/run.mjs`; see `bridge/README.md`).

Your job is NOT to build the product. Your job is to **plan the project**.

## Platform facts to plan around

- The product is built by a long sequence of separate, narrowly scoped efforts
  (**entries**). Each entry is executed by a single agent, alone, in one
  session under a fixed wall-clock cap (90 minutes). An entry that does not
  complete is re-planned after a retrospective; over-ambitious entries waste a
  cycle, so size them for one focused effort.
- The product is one npm package structured internally as **ES modules**. A
  module is the **unit of work visibility**: the agent executing an entry sees,
  in full, only the module that entry creates or reopens — plus the declared
  public interfaces (never the implementations) of all other modules, plus any
  **integration seams** the entry names. This is how effort scope stays
  constant as the codebase grows, which is the central design requirement of
  the whole project. Design module boundaries as real abstractions: an
  interface should hide its module's decisions, and prefer extension points so
  that wiring a new module into the product collapses to the composition root.
- After each entry the platform banks the winning workspace by overlaying its
  editable paths onto the product trunk. The gate is monotone: **every
  previously accepted case must still pass, plus the entry's new cases.**
  Every entry must light up a nonzero set of new cases — construction the
  scoreboard cannot see is not a valid entry.
- Modules may be reopened and expanded by later entries; boundaries may be
  revised by retrospectives. The plan is a living document: invest precision
  in the earliest entries; later entries are re-derived as the project learns.

## Deliverables

1. **`plan/PLAN.md`** — the plan of record:
   - **The module map**: every module the product will need as far as you can
     see — name, purpose, a sketch of its public interface, dependencies.
   - **The entry sequence**: an ordered list. Each entry: the module it
     creates or reopens; its integration seams (files outside the module it
     may edit — keep minimal); a one-paragraph brief; and the recipe by which
     its case-delta derives from the inventory.
2. **`plan/entry-1/cases.txt`** — entry one's case ids, one per line, exactly
   as in `bridge/cases.json`.
3. **`plan/entry-1/BRIEF.md`** — the assignment for entry one's builder. It
   will be that builder's **entire world**: write it complete and
   self-contained; pin the module's public interface precisely; name the
   seams; state the gate (a bridge run over `cases.txt` — give the command).
   Reference only files that will exist in the builder's scoped world. Do not
   mention this plan, later entries, or the wider corpus.

Constraints: `test262/`, `bridge/`, `PRODUCT.md`, and `contract.d.ts` are
read-only. Every id in `cases.txt` must exist in `bridge/cases.json`.

Done = the three deliverables exist and are consistent.
