# RETRO-CONTRACT v1.4 — step D: retrospective / replan

The retrospective closes a pipeline cycle: a cohort has executed one plan
entry in hard-scoped worlds, and the kernel has graded every survivor against
the pristine gate. The retro is a fresh-context agent (the "EM identity"
lives entirely in artifacts — the plan, prior RETRO/DECISION files — never in
a persistent session) that assesses the entry, names the winner, revises the
plan, and authors the next entry's brief.

## Settled design decisions (2026-08-21)

1. **The retro DECIDES the bank; the kernel executes and verifies it.** No
   human approval step. Rationale: it is true to the target harness
   (autonomous outer loop); it is safe because the decision is mechanically
   gate-checked (a banked trunk that fails the pristine gate on the accepted
   case set voids the bank), a wrong-but-green choice is recoverable
   (modules are reopenable and the losers are archived), and early cycles
   are human-observed anyway.
2. **The rationale is a deliverable.** DECISION.md must say which codebase
   was banked and why. Auditability of retro quality depends on the written
   reasoning, not just the pick.
3. **Banking never discards.** Non-chosen builder runs are retained untouched
   in their run dirs — forensics, later idea-stealing (DECISION.md flags
   anything worth stealing), and outcome-distribution data.
4. **The retro never writes or manipulates code** (v1.1 correction, operator
   review 2026-08-21; v1 had the retro copying the winner into trunk/ and
   optionally performing plan-scheduled refactors itself). The retro reads
   the cohort's code — that is how it judges the runs and reconciles the
   module map — but its deliverables are prose and plan artifacts only.
   Banking is *mechanism*: the kernel copies the named winner verbatim and
   re-gates it. Boundary revisions are *scheduled work*: the retro decides
   whether/when they happen by writing them into the plan as entry scope,
   never by performing them.

## The world (compose-retro-world.sh)

| path | content | mutability |
|---|---|---|
| `MANDATE.md` | the assignment (this contract's agent-facing form) | read-only |
| `KERNEL-LOG.md` | the kernel's intervention log for the cohort (killed wedged processes, isolation notes) — so transcript anomalies are attributable | read-only |
| `plan/` | full-history git clone of the canonical plan repo (PLAN.md + every entry dir so far) | **writable** working tree — the kernel commits it back as the next revision |
| `runs/<builder>/transcript.jsonl` | the builder's full pi session | read-only |
| `runs/<builder>/src/`, `package.json` | the code as shipped | read-only |
| `runs/<builder>/gate.json` | the kernel's pristine-gate verdicts for that builder | read-only |
| `bridge/` | UNFILTERED: run.mjs, stub, full cases.json, real README, generate.mjs | read-only |
| `test262/` | the full corpus + harness | read-only |
| `trunk-before/` | the trunk the builders started from (absent on greenfield cycles) | read-only |

Same sandbox profile as builder worlds (deny-read of operator secrets and all
sibling run dirs; network = api.deepseek.com only; 90-minute cap). Unlike
builders, the retro sees everything the planner saw — scoping applies to
builders, not to the roles that steer them.

## Deliverables (in the workspace; all prose/plan — no code artifacts)

1. `RETRO.md` — assessment of the entry: what the runs reveal about the plan,
   the brief, the process, the platform.
2. `DECISION.md` — names exactly ONE builder run as the winner, with the
   rationale; notes anything worth stealing from the losers; records any
   boundary-revision scheduling call and its reasoning.
3. Revised `plan/PLAN.md` — reconciled with what was actually built; the plan
   is a living document and the retro owns it for this cycle — plus
   `REVISION.md` at the workspace root: a short note of what changed in the
   plan and why, which becomes the canonical commit message.
4. `plan/<next-phase>/cases.txt` + brief(s) — the next phase, derived per
   the plan's conventions, written for builders who see only their own
   worlds. Single-layer phase: `BRIEF.md` at the phase root. Multi-layer
   phase: `layer-<i>/BRIEF.md` + `layer-<i>/editable.txt` per layer, in
   build order; the kernel's lineage driver (`run-lineage.sh`) relays fresh
   agents through the layers, validating the full accepted suite between
   layers; the stack's delta lights at the top. Briefs may describe trunk
   internals (what to reopen, where things live) — that is the retro's
   descriptive, not operative, relationship to code.

## Kernel enforcement (after the session)

- **Bank** (mechanism, `bank-trunk.sh`): copy the named winner's `src/` +
  `package.json` verbatim into the trunk location, then re-run the pristine
  gate from a clean home over every previously-accepted case id. All must be
  `pass`; a red trunk voids the bank and the cycle re-runs or escalates to
  the operator.
- **Archive**: builder run dirs are never deleted or modified.
- **Handoff** (`commit-plan.sh`): the revised plan working tree is committed
  to the canonical repo (message = REVISION.md, author = the retro run);
  the canonical repo + the banked trunk become the compose source for the
  next entry's builder worlds (overlay/trunk compose variant).
- The next-entry `cases.txt` ids must all exist in `bridge/cases.json`;
  previously accepted cases stay in the gate forever (monotone gate).
