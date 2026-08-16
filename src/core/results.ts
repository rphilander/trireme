/**
 * The test runner's report, reduced to what the agent and the caller need.
 *
 * Bounded by construction: counts, then a sample of individual failures with
 * their messages and locations, then how many were left out. Never a runner's
 * stdout — the agent pays per token for whatever it is shown.
 */
import type { TestFailure, TestSummary } from "./types.ts";

export const FAILURE_SAMPLE_LIMIT = 20;
const MESSAGE_LIMIT = 1024;

/** The subset of vitest's JSON report that trireme reads. */
export interface VitestAssertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status: string;
  failureMessages?: string[];
}

export interface VitestFile {
  name: string;
  status?: string;
  message?: string;
  assertionResults?: VitestAssertion[];
}

export interface VitestReport {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: VitestFile[];
}

function relativize(file: string, root: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MESSAGE_LIMIT ? trimmed : `${trimmed.slice(0, MESSAGE_LIMIT - 1)}…`;
}

/** Everything before the stack. A diff spanning several lines is still the message. */
function messageOf(raw: string): string {
  const stackAt = raw.search(/\n\s+at\s/);
  return clamp(stackAt === -1 ? raw : raw.slice(0, stackAt));
}

/** The first stack frame that points into the test file itself. */
function lineOf(raw: string, file: string): number | undefined {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}:(\\d+):\\d+`).exec(raw);
  return match ? Number(match[1]) : undefined;
}

export function summarizeTestRun(
  report: VitestReport,
  options: { root: string; limit?: number },
): TestSummary {
  const limit = options.limit ?? FAILURE_SAMPLE_LIMIT;
  const failures: TestFailure[] = [];

  for (const file of report.testResults ?? []) {
    const relative = relativize(file.name, options.root);
    const assertions = file.assertionResults ?? [];
    let failedHere = 0;

    for (const assertion of assertions) {
      if (assertion.status !== "failed") continue;
      failedHere += 1;
      const raw = assertion.failureMessages?.[0] ?? "Test failed without a message.";
      const failure: TestFailure = {
        file: relative,
        name: assertion.fullName ?? assertion.title ?? "(unnamed test)",
        message: messageOf(raw),
      };
      const line = lineOf(raw, file.name);
      if (line !== undefined) failure.line = line;
      failures.push(failure);
    }

    // A file that failed before collecting anything reports no failing tests at
    // all. Left alone it would read as a clean pass.
    if (failedHere === 0 && file.status === "failed") {
      failures.push({
        file: relative,
        name: "(file failed to run)",
        message: clamp(file.message ?? "The test file could not be run."),
      });
    }
  }

  const passed = report.numPassedTests ?? 0;
  const failed = Math.max(report.numFailedTests ?? 0, failures.length);
  const total = Math.max(report.numTotalTests ?? 0, passed + failed);

  return {
    total,
    passed,
    failed,
    failures: failures.slice(0, limit),
    truncated: Math.max(0, failed - Math.min(failures.length, limit)),
  };
}

/** An empty summary, for a gate that could not run at all. */
export function emptySummary(): TestSummary {
  return { total: 0, passed: 0, failed: 0, failures: [], truncated: 0 };
}
