// machine.mjs — the cycle driver's state machine. PURE: no I/O, no clock,
// no randomness. The driver loop (driver.mjs) alternates
//     action = nextAction(state)   → run the effect →
//     state  = reduce(state, action, result)
// so every decision this pipeline makes is unit-testable by scripting
// results — the same seam the scripted-provider tests use for the LLM.
//
// One cycle = one plan phase end-to-end:
//   VALIDATE → COHORT → [ASSEMBLE per lineage] → GATE(+RECHECK) per run →
//   KLOG → COMPOSE_RETRO → RETRO → DELIVERABLES(+verdict) → FOLD → BANK →
//   CHECK_NEXT → (next cycle | DONE)
// Mechanical failures ESCALATE: the driver stops and writes an escalation
// record for the operator. v1.1 (settled 2026-08-22): THE FRAMEWORK FORMS
// NO OPINION about banking — grading produces facts (gate results,
// isolated-recheck outcomes, challenge-file presence); the retro alone
// judges; bank-trunk.sh alone enforces (green + strict progress). No
// intervention capability — wall caps only — and no retries.

import { parseVerdict } from "./verdict.mjs";

export function entryNum(entry) {
  return Number(String(entry).replace(/^entry-/, ""));
}
export function nextEntry(entry) {
  return `entry-${entryNum(entry) + 1}`;
}
export function cohortRunNames(entry, size) {
  const n = entryNum(entry);
  return Array.from({ length: size }, (_, i) => `entry${n}-${i + 1}`);
}
export function retroName(entry) {
  return `retro-e${entryNum(entry)}`;
}

export function initialState(config) {
  const cfg = {
    cohortSize: 3,
    capS: 5400,
    retroCapS: 5400,
    maxWallS: null, // null = no wall budget
    subjectRel: "src/engine/index.ts",
    cycles: 1,
    ...config,
  };
  if (!cfg.entry) throw new Error("config.entry is required");
  return {
    config: cfg,
    cycle: 1,
    entry: cfg.entry,
    step: "VALIDATE",
    reuseCohort: !!cfg.fromGrading,
    layered: null,
    layers: 0,
    runs: [], // {name, exit, capOut, spend, startedAt, endedAt, lineage, included, grade, hasChallenges} — facts only
    idx: 0,
    retro: null,
    verdict: null,
    winner: null,
    banked: [], // [{entry, winner}]
    escalation: null,
    wallUsedS: 0,
    facts: [], // append-only cycle facts for the kernel log (platform facts ONLY)
  };
}

function escalate(state, reason, detail) {
  return {
    ...state,
    step: "ESCALATED",
    escalation: { reason, detail: detail ?? null, entry: state.entry, cycle: state.cycle },
  };
}

const EXPENSIVE = new Set(["RUN_COHORT", "LAUNCH_RETRO"]);

export function nextAction(state) {
  const { step, config } = state;
  if (step === "DONE" || step === "ESCALATED") return null;

  const budgetLeft =
    config.maxWallS == null || state.wallUsedS < config.maxWallS;

  const act = (a) => {
    if (!budgetLeft && EXPENSIVE.has(a.type)) {
      return { type: "HALT_BUDGET", internal: true };
    }
    return a;
  };

  switch (step) {
    case "VALIDATE":
      return { type: "VALIDATE_PHASE", entry: state.entry };
    case "COHORT":
      return act({
        type: state.reuseCohort ? "REUSE_COHORT" : "RUN_COHORT",
        entry: state.entry,
        layered: state.layered,
        layers: state.layers,
        runs: cohortRunNames(state.entry, config.cohortSize),
        capS: config.capS,
      });
    case "ASSEMBLE": {
      const run = state.runs[state.idx];
      return {
        type: "ASSEMBLE_LINEAGE",
        run: run.name,
        finalWorkspace: run.lineage?.finalWorkspace ?? null,
        layers: state.layers,
      };
    }
    case "GATE":
      return {
        type: "GATE_RUN",
        run: state.runs[state.idx].name,
        entry: state.entry,
        subjectRel: config.subjectRel,
      };
    case "RECHECK":
      return {
        type: "RECHECK_RUN",
        run: state.runs[state.idx].name,
        entry: state.entry,
        ids: state.runs[state.idx].grade.nonPassIds,
        subjectRel: config.subjectRel,
      };
    case "KLOG":
      return {
        type: "WRITE_KERNEL_LOG",
        entry: state.entry,
        content: renderKernelLog(state),
      };
    case "COMPOSE_RETRO":
      return {
        type: "COMPOSE_RETRO",
        entry: state.entry,
        retro: retroName(state.entry),
        runs: state.runs.filter((r) => r.included).map((r) => r.name),
      };
    case "RETRO":
      return act({
        type: "LAUNCH_RETRO",
        retro: retroName(state.entry),
        capS: config.retroCapS,
      });
    case "DELIVERABLES":
      return {
        type: "CHECK_DELIVERABLES",
        retro: retroName(state.entry),
        nextEntry: nextEntry(state.entry),
      };
    case "FOLD":
      return { type: "FOLD_PLAN", retro: retroName(state.entry) };
    case "BANK":
      return {
        type: "BANK",
        entry: state.entry,
        winner: state.winner,
        retro: retroName(state.entry),
        subjectRel: config.subjectRel,
      };
    case "CHECK_NEXT":
      return { type: "CHECK_NEXT", nextEntry: nextEntry(state.entry) };
    default:
      throw new Error(`nextAction: unknown step ${step}`);
  }
}

// ---- reduce ---------------------------------------------------------------

export function reduce(state0, action, result) {
  let state = {
    ...state0,
    wallUsedS: state0.wallUsedS + (result?.elapsedS ?? 0),
    runs: state0.runs.map((r) => ({ ...r })),
    facts: [...state0.facts],
  };

  switch (action.type) {
    case "HALT_BUDGET":
      return escalate(state, "budget", {
        wallUsedS: state.wallUsedS,
        maxWallS: state.config.maxWallS,
      });

    case "VALIDATE_PHASE": {
      if (!result.ok) return escalate(state, "phase-invalid", result.error);
      state.layered = result.layered;
      state.layers = result.layers ?? (result.layered ? 0 : 1);
      state.step = "COHORT";
      return state;
    }

    case "RUN_COHORT":
    case "REUSE_COHORT": {
      state.runs = result.runs.map((r) => ({
        included: r.error == null && (state.layered ? r.lineage?.status != null : true),
        grade: null,
        hasChallenges: false,
        ...r,
      }));
      for (const r of state.runs) {
        if (r.error != null) {
          r.included = false;
          state.facts.push(`${r.name}: world/launch error (${r.error}); excluded from the retro world`);
        }
        if (r.capOut) state.facts.push(`${r.name}: hit the wall cap (${state.config.capS}s) and was terminated by the platform`);
        if (state.layered && r.lineage) {
          if (r.lineage.status === "HALTED") {
            r.included = true; // evidence for the retro, but never bankable
            state.facts.push(`${r.name}: lineage HALTED at layer ${r.lineage.haltedLayer} (accepted suite red after that layer)`);
          } else if (r.lineage.status === "COMPLETE") {
            state.facts.push(`${r.name}: ${r.lineage.layers} layers, all inter-layer validations green`);
          }
        }
      }
      if (state.runs.filter((r) => r.included).length === 0) {
        return escalate(state, "no-runs", "no cohort run produced a judgeable workspace");
      }
      state.idx = 0;
      state.step = state.layered ? "ASSEMBLE" : "GATE";
      return advancePastExcluded(state);
    }

    case "ASSEMBLE_LINEAGE": {
      const run = state.runs[state.idx];
      if (!result.ok) {
        run.included = false;
        state.facts.push(`${run.name}: lineage assembly failed (${result.error}); excluded from the retro world`);
      }
      state.idx += 1;
      if (state.idx >= state.runs.length) {
        if (state.runs.filter((r) => r.included).length === 0) {
          return escalate(state, "no-runs", "no lineage could be assembled");
        }
        state.idx = 0;
        state.step = "GATE";
      }
      return advancePastExcluded(state);
    }

    case "GATE_RUN": {
      const run = state.runs[state.idx];
      run.hasChallenges = !!result.hasChallenges;
      if (run.hasChallenges) {
        state.facts.push(`${run.name}: CHALLENGES.md filed (contents not interpreted by the platform)`);
      }
      if (!result.ok) {
        run.grade = { gateError: true, nonPassIds: [], total: 0 };
        state.facts.push(`${run.name}: pristine gate errored (exit=${result.gateExit})`);
        return afterRunGraded(state);
      }
      run.grade = { nonPassIds: result.nonPassIds, total: result.total };
      if (result.nonPassIds.length === 0) {
        return afterRunGraded(state);
      }
      state.step = "RECHECK";
      return state;
    }

    case "RECHECK_RUN": {
      const run = state.runs[state.idx];
      run.grade = {
        ...run.grade,
        recheck: { passedIds: result.passedIds, failedIds: result.failedIds },
      };
      state.facts.push(
        `${run.name}: ${action.ids.length} gate non-pass(es) re-run in isolation — ` +
          `${result.passedIds.length} passed (load flake), ${result.failedIds.length} still red` +
          (result.failedIds.length ? ` (${result.failedIds.join(", ")})` : "")
      );
      return afterRunGraded(state);
    }

    case "WRITE_KERNEL_LOG":
      if (!result.ok) return escalate(state, "kernel-log-write-failed", result.error);
      state.step = "COMPOSE_RETRO";
      return state;

    case "COMPOSE_RETRO":
      if (!result.ok) return escalate(state, "retro-compose-failed", result.error);
      state.step = "RETRO";
      return state;

    case "LAUNCH_RETRO":
      state.retro = {
        name: action.retro,
        exit: result.exit,
        capOut: result.capOut ?? false,
        spend: result.spend ?? null,
      };
      // deliverables are checked regardless of exit — a capped-out retro
      // that still wrote its verdict is judged by its artifacts.
      state.step = "DELIVERABLES";
      return state;

    case "CHECK_DELIVERABLES": {
      // ORDER MATTERS (v1.1): core deliverables → verdict → next-phase.
      // A REDO retro may legitimately declare no next phase (it revises
      // the current one); only a BANK requires the next-phase declaration.
      if (result.missingCore.length > 0) {
        return escalate(state, "missing-deliverables", {
          retro: action.retro,
          missing: result.missingCore,
          retroCapOut: state.retro?.capOut ?? false,
        });
      }
      const v = parseVerdict(result.decisionText);
      state.verdict = v;
      if (v.kind === "INVALID") {
        return escalate(state, "invalid-verdict", { line: v.line });
      }
      if (v.kind === "REDO") {
        return escalate(state, "redo", {
          reason: v.reason,
          note: "redo verdict recorded; execution is held until the operator triggers it (wiki harness/pipeline.md)",
        });
      }
      if (!result.nextDeclared) {
        return escalate(state, "missing-deliverables", {
          retro: action.retro,
          missing: [`plan/${action.nextEntry}/ declaration`],
          retroCapOut: state.retro?.capOut ?? false,
        });
      }
      const run = state.runs.find((r) => r.name === v.run);
      if (!run || !run.included) {
        return escalate(state, "winner-unknown", { named: v.run });
      }
      // No opinion beyond existence: the retro judged; bank-trunk enforces.
      state.winner = v.run;
      state.step = "FOLD";
      return state;
    }

    case "FOLD_PLAN":
      if (!result.ok) return escalate(state, "plan-rejected", result.output);
      state.step = "BANK";
      return state;

    case "BANK":
      if (!result.ok) return escalate(state, "bank-void", result.output);
      state.banked = [...state.banked, { entry: state.entry, winner: state.winner }];
      if (state.cycle >= state.config.cycles) {
        state.step = "DONE";
        return state;
      }
      state.step = "CHECK_NEXT";
      return state;

    case "CHECK_NEXT": {
      if (!result.declared) {
        return escalate(state, "next-phase-missing", { expected: action.nextEntry });
      }
      // fresh cycle
      state.reuseCohort = false;
      state.cycle += 1;
      state.entry = action.nextEntry;
      state.step = "VALIDATE";
      state.layered = null;
      state.layers = 0;
      state.runs = [];
      state.idx = 0;
      state.retro = null;
      state.verdict = null;
      state.winner = null;
      state.facts = [];
      return state;
    }

    default:
      throw new Error(`reduce: unknown action ${action.type}`);
  }
}

function advancePastExcluded(state) {
  // ASSEMBLE and GATE iterate runs by idx; excluded runs are skipped.
  while (
    (state.step === "ASSEMBLE" || state.step === "GATE") &&
    state.idx < state.runs.length &&
    !state.runs[state.idx].included
  ) {
    state.idx += 1;
    if (state.idx >= state.runs.length) {
      if (state.step === "ASSEMBLE") {
        state.idx = 0;
        state.step = "GATE";
      } else {
        return finishGrading(state);
      }
    }
  }
  return state;
}

function afterRunGraded(state) {
  state.idx += 1;
  state.step = "GATE";
  if (state.idx >= state.runs.length) return finishGrading(state);
  return advancePastExcluded(state);
}

function finishGrading(state) {
  // v1.1: grading ends with facts, never an opinion — the retro judges
  // every cohort that produced at least one judgeable world (the no-runs
  // check already happened at cohort time).
  state.idx = 0;
  state.step = "KLOG";
  return state;
}

// ---- kernel log (platform facts ONLY — charter: no analysis, ever) --------

export function renderKernelLog(state) {
  const L = [];
  L.push(`# Kernel log — ${state.entry} cohort (unattended cycle driver)`);
  L.push("");
  L.push(
    `The cycle driver ran this cohort unattended. It has no intervention capability;` +
      ` the only enforcement is the per-session wall cap (${state.config.capS}s` +
      `${state.layered ? " per layer" : ""}). Facts below are mechanical observations.`
  );
  L.push("");
  L.push(`| run | wall | exit | spend |`);
  L.push(`|---|---|---|---|`);
  for (const r of state.runs) {
    const wall =
      r.startedAt && r.endedAt ? `${r.startedAt} → ${r.endedAt}` : "—";
    L.push(
      `| ${r.name} | ${wall} | ${r.exit ?? "—"} | ${r.spend != null ? "$" + r.spend : "—"} |`
    );
  }
  if (state.facts.length) {
    L.push("");
    for (const f of state.facts) L.push(`- ${f}`);
  }
  L.push("");
  return L.join("\n");
}
