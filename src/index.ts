/**
 * trireme — a non-interactive harness that builds a Node package from a
 * specification and an acceptance suite.
 *
 * `contract.d.ts` fixes the shape of what follows, `spec.md` fixes its meaning,
 * and `acceptance/` decides whether it is finished.
 */
import path from "node:path";
import { MANIFEST_FILE, parseManifest } from "./core/manifest.ts";
import { readIfPresent } from "./shell/store.ts";
import { runJob } from "./shell/orchestrator.ts";
import type { ManifestResult, RunOptions, RunResult } from "./core/types.ts";

export { exitCodeFor } from "./core/outcome.ts";

export type {
  Clock,
  Diagnostic,
  ExitCode,
  Ledger,
  Limits,
  Manifest,
  ManifestResult,
  Outcome,
  Overrides,
  Provenance,
  RunOptions,
  RunResult,
  Safety,
  TestFailure,
  TestSummary,
  ThinkingLevel,
  TokenCounts,
} from "./core/types.ts";

/**
 * Reads and validates a job's manifest without running anything.
 *
 * Exposed because a caller — a campaign runner, a job generator — needs to
 * inspect a job cheaply. It creates nothing and charges nothing.
 */
export function readManifest(jobDir: string): ManifestResult {
  return parseManifest(readIfPresent(path.join(jobDir, MANIFEST_FILE)));
}

/**
 * Runs one job to a terminal outcome.
 *
 * Does not throw for job failure — a failing job is a RunResult carrying a
 * failure outcome. Throws only when the host environment makes the attempt
 * impossible, such as an unwritable runs directory.
 */
export function run(options: RunOptions): Promise<RunResult> {
  return runJob(options);
}
