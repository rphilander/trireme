# BINDING-CONTRACT v1 — bootstrapping a campaign

The harness's input is a goal prompt and a directory of acceptance
tests. The binding phase turns that into the artifacts every later
phase runs on. Binding is agent work: worlds, caps, cohorts, and a
retro, like all agent work. The binding is banked and remains revisable
through the plan.

## Inputs
- The operator's goal prompt (verbatim, in the mandate).
- `tests/` — the acceptance-test directory, read-only, exactly as it
  ships (docs and harnesses included). Nothing else.

## Deliverables (in the binding workspace)
1. `bridge/run.mjs` — the verdict runner per GATE-CONTRACT.md.
2. `inventory/cases.txt` — the full case-id space, one id per line;
   plus `inventory/derive.mjs`, re-runnable, regenerating it from
   `tests/`.
3. `contract.d.ts` — the subject contract: the minimal public interface
   a product must expose for run.mjs to evaluate it. Future builders
   code against this.
4. `budgets.json` — `{"defaultTimeoutMs": N, "perCase": {id: ms, ...}}`
   from measurements, not guesses.
5. `BINDING.md` — rationale: suite organization, the unsupported
   classes and why, determinism hazards, and how a planner should think
   about conquering the suite incrementally.

## Mechanical validation (validate-binding.sh; REJECT on any failure)
- Deliverables present.
- Runner survives: missing-subject probe, empty-file-subject probe —
  exit 0, valid shape, all requested ids present.
- Output shape: statuses from the allowed set; ids match requests; ms
  numeric when present.
- Determinism: double-run on a sample, identical (id, status) sets.
- Inventory: non-empty, no duplicate ids.

## Judgment (the binding retro)
A decide-mode retro judges the cohort's bindings — coverage honesty,
contract quality, unsupported taxonomy, budget realism — names a winner,
and may schedule binding revisions in the plan. The mandate carries no
domain vocabulary: rediscovery of the domain's structure is the
binding agent's job, and the quality of that rediscovery is exactly
what the retro judges.
