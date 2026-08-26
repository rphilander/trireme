# PHASE-CONTRACT v1 — phases, briefs, banking

A campaign is a sequence of phases. Every phase has a type — `qe` or
`code` — declared by the FIRST line of its brief:

    TYPE: qe

The marker flows mechanically, end to end:

- **brief → composition**: the world composer for a phase is selected
  by the brief's TYPE line (compose-qe-world / compose-code-world);
  the brief itself is included in the cohort's mandate verbatim. A
  composer refuses a brief of the wrong type.
- **composition → retro**: the retro composer stamps the phase type
  into the retro run dir (a `TYPE` file).
- **retro → bank**: bank-phase.sh dispatches on that stamp. Only qe
  phases can change gate/; code phases can only change trunk/.

## Campaign layout

    <campaign>/plan/        agent-authored git repo (plan.md, briefs/phase-N.md)
    <campaign>/gate/        banked QE modules: entry-N/ + current -> entry-N
    <campaign>/trunk/       banked product states (code phases)
    <campaign>/history.log  append-only bank/void record

## Bank rules (mechanical floor — the framework holds no opinions
beyond these)

- The retro's DECISION.md first line is the machine verdict, exactly
  one of `BANK: <run-name>` or `REDO: <one-line reason>` (markdown
  decoration tolerated, substance strict).
- **qe BANK**: the winner's workspace must pass validate-qe.sh in an
  isolated recheck; then the whole workspace is copied to
  gate/entry-N and gate/current is repointed. A recheck failure is
  BANK VOID: nothing changes, a void record is written, the operator
  is escalated to.
- **code BANK**: candidates are graded by the CURRENT banked gate;
  green rule plus strict progress (>0 newly-passing non-internal
  ids). Lands with the first code cycle; until then bank-phase
  refuses code banks explicitly.
- **REDO**: recorded; nothing changes; the orchestrator escalates or
  reruns per the retro's reason.

## Bootstrap rule

Phase 1 of every campaign is a qe phase: coding candidates are graded
by the last-banked gate, so nothing can be graded before a gate
exists. validate-plan.sh enforces the marker on plan v1.
