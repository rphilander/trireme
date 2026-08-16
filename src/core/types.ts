/**
 * The public types, mirroring `contract.d.ts`.
 *
 * `contract.d.ts` is the obligation; this file is how the implementation meets
 * it. `src/conformance.ts` asserts the two are mutually assignable, so drift
 * between them is a typecheck failure rather than a surprise.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export type Outcome =
  | "success"
  | "failed:cost_cap"
  | "failed:wall_clock"
  | "failed:no_progress"
  | "failed:iteration_cap"
  | "aborted:infra"
  | "error:usage";

export type ExitCode = 0 | 1 | 2 | 3;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Limits {
  costUsd: number;
  wallClockMinutes: number;
}

export interface Safety {
  maxIterations: number;
}

export interface Manifest {
  name: string;
  version: string;
  description?: string;
  model: string;
  thinking?: ThinkingLevel;
  limits: Limits;
  safety: Safety;
  dependencies: Record<string, string>;
}

export interface Diagnostic {
  field?: string;
  message: string;
}

export type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; diagnostics: Diagnostic[] };

export interface Overrides {
  model?: string;
  thinking?: ThinkingLevel;
  costUsd?: number;
  wallClockMinutes?: number;
  maxIterations?: number;
}

export interface Clock {
  now(): number;
}

export interface RunOptions {
  jobDir: string;
  runsDir?: string;
  overrides?: Overrides;
  extensions?: InlineExtension[];
  clock?: Clock;
  signal?: AbortSignal;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface Ledger {
  tokens: TokenCounts;
  costUsd: number | null;
  priced: boolean;
  iterations: number;
  wallClockMs: number;
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
  failures: TestFailure[];
  truncated: number;
}

export interface Provenance {
  triremeVersion: string;
  systemPromptHash: string;
  model: string;
  /** Requested. */
  thinking: ThinkingLevel;
  /** What the model actually receives after the runtime clamps to what it supports. */
  thinkingEffective: ThinkingLevel;
  jobHash: string;
}

export interface RunResult {
  outcome: Outcome;
  reason?: string;
  runId: string;
  runDir: string;
  ledger: Ledger;
  provenance: Provenance;
  tests?: TestSummary;
  artifactPath?: string;
  diagnostics?: Diagnostic[];
}
