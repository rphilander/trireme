/**
 * How a run ended, and what a caller should do about it.
 *
 * Seven terminal states in three groups: the job converged, the job did not,
 * or the problem was never the job's. Exit codes expose that grouping to a
 * shell without it having to parse a report.
 */
import type { ExitCode, Outcome } from "./types.ts";

export const OUTCOMES: readonly Outcome[] = [
  "success",
  "failed:cost_cap",
  "failed:wall_clock",
  "failed:no_progress",
  "failed:iteration_cap",
  "aborted:infra",
  "error:usage",
];

export function exitCodeFor(outcome: Outcome): ExitCode {
  switch (outcome) {
    case "success":
      return 0;
    case "failed:cost_cap":
    case "failed:wall_clock":
    case "failed:no_progress":
    case "failed:iteration_cap":
      return 1;
    case "aborted:infra":
      return 2;
    case "error:usage":
      return 3;
  }
}

/** The job ran and did not converge. Another job may still be worth attempting. */
export function isFailure(outcome: Outcome): boolean {
  return outcome.startsWith("failed:");
}

/** The provider or the network is the problem; a caller running many jobs should stop. */
export function isTerminalForCampaign(outcome: Outcome): boolean {
  return outcome === "aborted:infra";
}
