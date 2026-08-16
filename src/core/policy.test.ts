/**
 * Purpose: decide, from the run's own numbers, whether it should keep going.
 *
 * Two kinds of stop live here and they are not the same kind of thing. A budget
 * — money, time — being spent is an ordinary outcome. `maxIterations` and the
 * no-progress rule are pathology detectors: tripping one means something is
 * wrong, not that the job was merely expensive.
 */
import { describe, expect, it } from "vitest";
import { NO_PROGRESS_ITERATIONS, evaluateBudgets, evaluateIteration } from "./policy.ts";
import type { PolicyState } from "./policy.ts";

const BASE: PolicyState = {
  priced: true,
  costUsd: 0,
  costCapUsd: 1,
  elapsedMs: 0,
  wallClockCapMs: 5 * 60_000,
  iterations: 1,
  maxIterations: 10,
  idleIterations: 0,
};

const state = (overrides: Partial<PolicyState>): PolicyState => ({ ...BASE, ...overrides });

describe("a run inside every limit", () => {
  it("keeps going", () => {
    expect(evaluateIteration(state({}))).toEqual({ stop: false });
    expect(evaluateBudgets(state({}))).toEqual({ stop: false });
  });
});

describe("budgets", () => {
  it("stops at the cost cap", () => {
    const verdict = evaluateIteration(state({ costUsd: 1.5 }));
    expect(verdict).toMatchObject({ stop: true, outcome: "failed:cost_cap" });
    if (verdict.stop) expect(verdict.reason).toBeTruthy();
  });

  it("stops when cost lands exactly on the cap", () => {
    expect(evaluateIteration(state({ costUsd: 1 }))).toMatchObject({ outcome: "failed:cost_cap" });
  });

  it("stops at the wall-clock cap", () => {
    expect(evaluateIteration(state({ elapsedMs: 5 * 60_000 }))).toMatchObject({
      stop: true,
      outcome: "failed:wall_clock",
    });
  });

  it("checks budgets on their own, so an overrun is bounded by one message", () => {
    expect(evaluateBudgets(state({ costUsd: 2 }))).toMatchObject({ outcome: "failed:cost_cap" });
    expect(evaluateBudgets(state({ elapsedMs: 10 * 60_000 }))).toMatchObject({
      outcome: "failed:wall_clock",
    });
  });

  it("does not apply a cost cap that cannot be enforced", () => {
    const unpriced = state({ priced: false, costUsd: null, costCapUsd: 0.00001 });
    expect(evaluateIteration(unpriced)).toEqual({ stop: false });
    expect(evaluateBudgets(unpriced)).toEqual({ stop: false });
  });

  it("says in the reason that the cap was unenforceable, when asked at the end", () => {
    const verdict = evaluateIteration(
      state({ priced: false, costUsd: null, iterations: 10, maxIterations: 10 }),
    );
    expect(verdict).toMatchObject({ outcome: "failed:iteration_cap" });
  });
});

describe("pathology detectors", () => {
  it("stops after three iterations that changed nothing", () => {
    expect(evaluateIteration(state({ idleIterations: NO_PROGRESS_ITERATIONS }))).toMatchObject({
      stop: true,
      outcome: "failed:no_progress",
    });
  });

  it("tolerates two", () => {
    expect(evaluateIteration(state({ idleIterations: NO_PROGRESS_ITERATIONS - 1 }))).toEqual({
      stop: false,
    });
  });

  it("stops at the iteration cap", () => {
    expect(evaluateIteration(state({ iterations: 3, maxIterations: 3 }))).toMatchObject({
      stop: true,
      outcome: "failed:iteration_cap",
    });
  });

  it("is not consulted mid-message; only budgets are", () => {
    const pathological = state({ idleIterations: 9, iterations: 99, maxIterations: 3 });
    expect(evaluateBudgets(pathological)).toEqual({ stop: false });
  });
});

describe("messages cut off at the model's output limit", () => {
  // A reasoning model with too small an output ceiling thinks, gets truncated,
  // and never reaches a tool call. The outcome is still no progress — nothing
  // changed — but the reason must say why, or the run reads as a lazy model.
  const truncated = { messages: 3, maxTokens: 4096 };

  it("are named in a no-progress verdict, with the limit that cut them off", () => {
    const verdict = evaluateIteration(state({ idleIterations: NO_PROGRESS_ITERATIONS, truncated }));
    expect(verdict).toMatchObject({ outcome: "failed:no_progress" });
    if (verdict.stop) {
      expect(verdict.reason).toContain("3");
      expect(verdict.reason).toContain("output limit");
      expect(verdict.reason).toContain("4096");
    }
  });

  it("are named in an iteration-cap verdict too", () => {
    const verdict = evaluateIteration(state({ iterations: 10, maxIterations: 10, truncated }));
    expect(verdict).toMatchObject({ outcome: "failed:iteration_cap" });
    if (verdict.stop) expect(verdict.reason).toContain("output limit");
  });

  it("do not change the outcome", () => {
    expect(evaluateIteration(state({ truncated }))).toEqual({ stop: false });
    expect(evaluateIteration(state({ costUsd: 5, truncated }))).toMatchObject({ outcome: "failed:cost_cap" });
  });

  it("are not mentioned when none happened", () => {
    const verdict = evaluateIteration(
      state({ idleIterations: NO_PROGRESS_ITERATIONS, truncated: { messages: 0, maxTokens: 4096 } }),
    );
    if (verdict.stop) expect(verdict.reason).not.toContain("output limit");
  });
});

describe("when more than one limit is spent", () => {
  it("reports the budget before the pathology, because it explains the run", () => {
    const verdict = evaluateIteration(
      state({ costUsd: 5, elapsedMs: 10 * 60_000, iterations: 10, maxIterations: 10, idleIterations: 5 }),
    );
    expect(verdict).toMatchObject({ outcome: "failed:cost_cap" });
  });

  it("prefers wall clock to the iteration cap", () => {
    expect(
      evaluateIteration(state({ elapsedMs: 10 * 60_000, iterations: 10, maxIterations: 10 })),
    ).toMatchObject({ outcome: "failed:wall_clock" });
  });

  it("prefers no progress to the iteration cap", () => {
    // Both are pathologies, but "it stopped doing anything" is the diagnosis
    // and "it ran out of turns" is only the symptom.
    expect(
      evaluateIteration(state({ idleIterations: 3, iterations: 10, maxIterations: 10 })),
    ).toMatchObject({ outcome: "failed:no_progress" });
  });
});
