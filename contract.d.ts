/**
 * trireme — public API contract.
 *
 * This file fixes the shape of the library. `spec.md` fixes its meaning, and
 * `acceptance/` decides whether an implementation is finished.
 */

import type { InlineExtension } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * How a run ended. Grouped by what a caller running many jobs should do:
 * `success` and every `failed:*` mean continue; `aborted:infra` means stop,
 * because the provider or network is the problem, not the job.
 */
export type Outcome =
  | "success"
  | "failed:cost_cap"
  | "failed:wall_clock"
  | "failed:no_progress"
  | "failed:iteration_cap"
  | "aborted:infra"
  | "error:usage";

/** Process exit code corresponding to an outcome: 0, 1, 2 or 3. */
export type ExitCode = 0 | 1 | 2 | 3;

export declare function exitCodeFor(outcome: Outcome): ExitCode;

// ---------------------------------------------------------------------------
// The job manifest
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Budgets. Reaching one is an ordinary outcome, not a defect. */
export interface Limits {
  costUsd: number;
  wallClockMinutes: number;
}

/** Backstop against a loop that turns without converging. Tripping it is a defect. */
export interface Safety {
  maxIterations: number;
}

export interface Manifest {
  name: string;
  version: string;
  description?: string;
  /** Provider-qualified, as the agent runtime resolves it, e.g. "openrouter/anthropic/claude-sonnet-5". */
  model: string;
  thinking?: ThinkingLevel;
  limits: Limits;
  safety: Safety;
  /** Must be empty in v1; the package under construction has no dependencies. */
  dependencies: Record<string, string>;
}

/** One problem with a job or with the options. `field` is a dotted path where one applies. */
export interface Diagnostic {
  field?: string;
  message: string;
}

export type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; diagnostics: Diagnostic[] };

/** Reads and validates a job's manifest without running anything. */
export declare function readManifest(jobDir: string): ManifestResult;

// ---------------------------------------------------------------------------
// Running a job
// ---------------------------------------------------------------------------

/** Per-run values that take precedence over the manifest. */
export interface Overrides {
  model?: string;
  thinking?: ThinkingLevel;
  costUsd?: number;
  wallClockMinutes?: number;
  maxIterations?: number;
}

/**
 * Source of the current time, in epoch milliseconds. Injected so wall-clock
 * behaviour is testable without waiting. Limits are evaluated at message
 * boundaries, so no timer is required.
 */
export interface Clock {
  now(): number;
}

export interface RunOptions {
  /** Directory containing trireme.json, spec.md, contract.d.ts and acceptance/. */
  jobDir: string;
  /** Where run directories are created. Default: "runs" under the current working directory. */
  runsDir?: string;
  overrides?: Overrides;
  /**
   * Extensions passed to the agent session. The seam the acceptance suite uses:
   * an extension registers a scripted provider, and `overrides.model` selects it,
   * so the loop can be driven with no model and no network.
   */
  extensions?: InlineExtension[];
  /** Default: system time. */
  clock?: Clock;
  /** Aborts the run. The outcome is whichever limit or failure applied at the time. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// What a run reports
// ---------------------------------------------------------------------------

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/**
 * Consumption for the run. `costUsd` is null when the provider publishes no
 * per-token prices — a flat-rate plan reports zero, which is not the same as
 * a free run, and a cost cap cannot be enforced against it.
 */
export interface Ledger {
  tokens: TokenCounts;
  costUsd: number | null;
  priced: boolean;
  iterations: number;
  wallClockMs: number;
  /** Time spent waiting on provider backoff, included in wallClockMs. */
  stalledMs: number;
}

export interface TestFailure {
  file: string;
  name: string;
  message: string;
  line?: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  /** Bounded: a representative sample, not every failure. */
  failures: TestFailure[];
  /** How many failures exist beyond those listed. */
  truncated: number;
}

/** Enough to tell whether two runs are comparable. */
export interface Provenance {
  triremeVersion: string;
  systemPromptHash: string;
  model: string;
  thinking: ThinkingLevel;
  jobHash: string;
}

export interface RunResult {
  outcome: Outcome;
  /** Human-readable detail. Always present when the outcome is not `success`. */
  reason?: string;
  runId: string;
  runDir: string;
  ledger: Ledger;
  provenance: Provenance;
  /** Present once the gate has run at least once. */
  tests?: TestSummary;
  /** Present only on `success`. */
  artifactPath?: string;
  /** Present only on `error:usage`, listing every problem found. */
  diagnostics?: Diagnostic[];
}

/**
 * Runs one job to a terminal outcome.
 *
 * Does not throw for job failure — a failing job is a RunResult carrying a
 * failure outcome. Throws only when the host environment makes the attempt
 * impossible, such as an unwritable runs directory.
 */
export declare function run(options: RunOptions): Promise<RunResult>;
