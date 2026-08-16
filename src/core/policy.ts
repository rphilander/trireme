/**
 * When a run should stop, and which failure it is.
 *
 * Budgets are checked after every assistant message so an overrun is bounded by
 * one message; the pathology detectors are checked once per iteration, because
 * "made no progress" is only meaningful across whole iterations.
 */
import type { Outcome } from "./types.ts";

export const NO_PROGRESS_ITERATIONS = 3;

export interface PolicyState {
  priced: boolean;
  costUsd: number | null;
  costCapUsd: number;
  elapsedMs: number;
  wallClockCapMs: number;
  iterations: number;
  maxIterations: number;
  /** Consecutive iterations that ended with no mutating tool call. */
  idleIterations: number;
  /**
   * Assistant messages the provider cut off at the model's output limit. A
   * reasoning model with too small a ceiling never reaches a tool call, and a
   * run that stalls for that reason must say so rather than read as idle.
   */
  truncated?: { messages: number; maxTokens: number };
}

export type Verdict = { stop: false } | { stop: true; outcome: Outcome; reason: string };

const CONTINUE: Verdict = { stop: false };

const usd = (value: number) => `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;

/** Budgets only. Safe to consult mid-iteration, after every assistant message. */
export function evaluateBudgets(state: PolicyState): Verdict {
  if (state.priced && state.costUsd !== null && state.costUsd >= state.costCapUsd) {
    return {
      stop: true,
      outcome: "failed:cost_cap",
      reason: `Cost reached the cap: ${usd(state.costUsd)} of ${usd(state.costCapUsd)}.`,
    };
  }
  if (state.elapsedMs >= state.wallClockCapMs) {
    return {
      stop: true,
      outcome: "failed:wall_clock",
      reason: `Wall clock reached the cap: ${minutes(state.elapsedMs)} of ${minutes(state.wallClockCapMs)}.`,
    };
  }
  return CONTINUE;
}

function truncationNote(state: PolicyState): string {
  const t = state.truncated;
  if (!t || t.messages === 0) return "";
  const noun = t.messages === 1 ? "message was" : "messages were";
  return (
    ` ${t.messages} assistant ${noun} cut off at the model's output limit` +
    ` (maxTokens=${t.maxTokens}) before finishing; the model may need more room to reason.`
  );
}

/** Everything, consulted once per iteration once the gate has failed. */
export function evaluateIteration(state: PolicyState): Verdict {
  const budget = evaluateBudgets(state);
  if (budget.stop) return budget;

  if (state.idleIterations >= NO_PROGRESS_ITERATIONS) {
    return {
      stop: true,
      outcome: "failed:no_progress",
      reason:
        `${state.idleIterations} consecutive iterations changed nothing while the gate was still failing.` +
        truncationNote(state),
    };
  }
  if (state.iterations >= state.maxIterations) {
    return {
      stop: true,
      outcome: "failed:iteration_cap",
      reason:
        `Reached the iteration backstop after ${state.iterations} iterations without converging.` +
        truncationNote(state),
    };
  }
  return CONTINUE;
}
