# RETRO-CONTRACT v1 — step D: retrospective / replan

The retrospective closes a pipeline cycle: a cohort has executed one plan
entry in hard-scoped worlds, and the kernel has graded every survivor against
the pristine gate. The retro is a fresh-context agent (the "EM identity"
lives entirely in artifacts — the plan, prior RETRO/DECISION files — never in
a persistent session) that assesses the entry, banks a trunk, revises the
plan, and authors the next entry's brief.

## Settled design decisions (2026-08-21)

1. **The retro DECIDES the bank; the kernel verifies.** No human approval
   step. Rationale: it is true to the target harness (autonomous outer loop);
   it is safe because the decision is mechanically gate-checked (a banked
   trunk that fails the pristine gate on the accepted case set voids the
   bank), a wrong-but-green choice is recoverable (modules are reopenable and
   the losers are archived), and early cycles are human-observed anyway.
2. **The rationale is a deliverable.** DECISION.md must say which codebase
   was banked and why. Auditability of retro quality depends on the written
   reasoning, not just the pick.
3. **Banking never discards.** Non-chosen builder runs are retained untouched
   in their run dirs — forensics, later idea-stealing (DECISION.md flags
   anything worth stealing), and outcome-distribution data.

## The world (compose-retro-world.sh)

| path | content | mutability |
|---|---|---|
| `MANDATE.md` | the assignment (this contract's agent-facing form) | read-only |
| `plan/` | the plan of record, verbatim (PLAN.md + every entry dir so far) | **writable** — becomes the next plan of record |
| `trunk/` | empty | **writable** — the retro banks the chosen codebase here |
| `runs/<builder>/transcript.jsonl` | the builder's full pi session | read-only |
| `runs/<builder>/src/`, `package.json` | the code as shipped | read-only |
| `runs/<builder>/gate.json` | the kernel's pristine-gate verdicts for that builder | read-only |
| `bridge/` | UNFILTERED: run.mjs, stub, full cases.json, real README, generate.mjs | read-only |
| `test262/` | the full corpus + harness | read-only |

Same sandbox profile as builder worlds (deny-read of operator secrets and all
sibling run dirs; network = api.deepseek.com only; 90-minute cap). Unlike
builders, the retro sees everything the planner saw — scoping applies to
builders, not to the roles that steer them.

## Deliverables (in the workspace)

1. `RETRO.md` — assessment of the entry: what the runs reveal about the plan,
   the brief, the process, the platform.
2. `DECISION.md` + `trunk/` — the bank, with rationale; notes anything worth
   stealing from the losers; states the trunk's gate subject path; records
   whether any plan-scheduled boundary revision was performed now or
   deferred (and why).
3. Revised `plan/PLAN.md` — reconciled with what was actually built; the plan
   is a living document and the retro owns it for this cycle.
4. `plan/<next-entry>/cases.txt` + `plan/<next-entry>/BRIEF.md` — the next
   entry, derived per the plan's conventions, sized for one capped session,
   written for a builder who sees only its own world.

## Kernel enforcement (after the session)

- **Pristine gate over the banked trunk**: from a clean home, every
  previously-accepted case id must be `pass` against the trunk's stated
  subject path. A failing trunk voids the bank; the cycle re-runs or
  escalates to the operator.
- **Archive**: builder run dirs are never deleted or modified.
- **Handoff**: the retro workspace's `plan/` + `trunk/` become the compose
  source for the next entry's builder worlds (overlay/trunk compose variant).
- The next-entry `cases.txt` ids must all exist in `bridge/cases.json` and be
  disjoint from already-accepted ids only in the sense the plan's monotone
  gate defines (previously accepted cases stay in the gate forever).
