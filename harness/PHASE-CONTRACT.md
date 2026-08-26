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
  isolated recheck; then the module (workspace minus tests/ and
  MANDATE.md) is copied to gate/entry-N, the corpus is re-linked at
  <entry>/tests as HARDLINKS (from the corpus path the retro composer
  stamped into the retro run dir as CORPUS), and gate/current is
  repointed. A recheck failure is BANK VOID: nothing changes, a void
  record is written, the operator is escalated to.
- **code BANK**: the winner is regraded in isolation by the CAMPAIGN's
  banked gate (grade-code.sh — never any gate copy from a candidate
  workspace) over the banked scope; strict progress requires >0
  newly-passing non-internal ids versus the trunk baseline
  (trunk/current/GRADE.json). Then the winner's workspace (minus
  tests/, gate/, MANDATE.md) becomes trunk/entry-N with its
  GRADE.json, and trunk/current is repointed. A failed regrade or
  zero new passes is BANK VOID.
- **REDO**: recorded; nothing changes; the orchestrator escalates or
  reruns per the retro's reason.

## Deliverable conventions

- A code candidate delivers `product/` (a Node package directory the
  gate's --subject convention loads) and `BUILD.md`. The banked gate
  ships read-only in code worlds at gate/, corpus included
  (gate/tests/).
- Every retro also authors the NEXT phase's brief (briefs/phase-N.md,
  first line TYPE marker) as a deliverable; adopt-brief.sh commits it
  into the campaign plan repo mechanically. compose-brief-world.sh
  covers gaps (a needed brief no session has written). [The qe retro
  composer does not carry the plan yet; its next-brief deliverable
  lands when it does.]

## Bootstrap rule

Phase 1 of every campaign is a qe phase: coding candidates are graded
by the last-banked gate, so nothing can be graded before a gate
exists. validate-plan.sh enforces the marker on plan v1.
