/**
 * Purpose: turn a test runner's report into something an agent can act on.
 *
 * The constraint that shapes this module is that failure output is bounded. A
 * suite with sixty failures must come back as counts plus a sample, never as a
 * runner's stdout — the agent pays for every token of it, and the sixtieth
 * message rarely says anything the first twenty did not.
 */
import { describe, expect, it } from "vitest";
import { FAILURE_SAMPLE_LIMIT, summarizeTestRun } from "./results.ts";
import type { VitestReport } from "./results.ts";

const ROOT = "/runs/abc/workspace";

const assertion = (title: string, message?: string) => ({
  ancestorTitles: ["add"],
  fullName: `add ${title}`,
  title,
  status: message ? ("failed" as const) : ("passed" as const),
  failureMessages: message ? [message] : [],
});

const STACK = `\n    at ${ROOT}/acceptance/adder.test.ts:5:52\n    at /elsewhere/vitest/runner.js:302:11`;

function report(overrides: Partial<VitestReport> = {}): VitestReport {
  return {
    success: true,
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    testResults: [
      {
        name: `${ROOT}/acceptance/adder.test.ts`,
        status: "passed",
        assertionResults: [assertion("sums"), assertion("negates"), assertion("multiplies")],
      },
    ],
    ...overrides,
  };
}

describe("a passing suite", () => {
  it("reports every test passing and nothing to show", () => {
    const summary = summarizeTestRun(report(), { root: ROOT });
    expect(summary).toEqual({ total: 3, passed: 3, failed: 0, failures: [], truncated: 0 });
  });
});

describe("a failing test", () => {
  const failing = () =>
    report({
      success: false,
      numPassedTests: 2,
      numFailedTests: 1,
      testResults: [
        {
          name: `${ROOT}/acceptance/adder.test.ts`,
          status: "failed",
          assertionResults: [
            assertion("sums", `AssertionError: expected -1 to be 5 // Object.is equality${STACK}`),
            assertion("negates"),
            assertion("multiplies"),
          ],
        },
      ],
    });

  it("names the test and the file it is in", () => {
    const [failure] = summarizeTestRun(failing(), { root: ROOT }).failures;
    expect(failure!.name).toBe("add sums");
    expect(failure!.file).toBe("acceptance/adder.test.ts");
  });

  it("keeps the assertion and drops the runner's stack", () => {
    const [failure] = summarizeTestRun(failing(), { root: ROOT }).failures;
    expect(failure!.message).toBe("AssertionError: expected -1 to be 5 // Object.is equality");
    expect(failure!.message).not.toContain("at /elsewhere");
  });

  it("recovers the line in the test file, not in the runner", () => {
    const [failure] = summarizeTestRun(failing(), { root: ROOT }).failures;
    expect(failure!.line).toBe(5);
  });

  it("counts what passed alongside what did not", () => {
    const summary = summarizeTestRun(failing(), { root: ROOT });
    expect(summary).toMatchObject({ total: 3, passed: 2, failed: 1, truncated: 0 });
  });
});

describe("a suite with more failures than anyone can read", () => {
  const many = () => {
    const assertions = Array.from({ length: 60 }, (_, i) =>
      assertion(`case ${i}`, `AssertionError: expected 0 to be ${i}${STACK}`),
    );
    return report({
      success: false,
      numTotalTests: 60,
      numPassedTests: 0,
      numFailedTests: 60,
      testResults: [{ name: `${ROOT}/acceptance/many.test.ts`, status: "failed", assertionResults: assertions }],
    });
  };

  it("samples rather than dumps", () => {
    const summary = summarizeTestRun(many(), { root: ROOT });
    expect(summary.failed).toBe(60);
    expect(summary.failures).toHaveLength(FAILURE_SAMPLE_LIMIT);
  });

  it("says how many it did not show", () => {
    const summary = summarizeTestRun(many(), { root: ROOT });
    expect(summary.truncated).toBe(summary.failed - summary.failures.length);
  });

  it("honours a caller that wants a different bound", () => {
    const summary = summarizeTestRun(many(), { root: ROOT, limit: 3 });
    expect(summary.failures).toHaveLength(3);
    expect(summary.truncated).toBe(57);
  });
});

describe("a file that failed before any test could run", () => {
  const collectionError = () =>
    report({
      success: false,
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      testResults: [
        {
          name: `${ROOT}/acceptance/adder.test.ts`,
          status: "failed",
          message: "Error: Failed to resolve import \"adder\"",
          assertionResults: [],
        },
      ],
    });

  it("is a failure, not an empty pass", () => {
    // Reporting zero failures here would let a workspace that cannot even be
    // imported walk through the gate.
    const summary = summarizeTestRun(collectionError(), { root: ROOT });
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.failures[0]!.file).toBe("acceptance/adder.test.ts");
    expect(summary.failures[0]!.message).toContain("Failed to resolve import");
  });
});

describe("a bounded message", () => {
  it("truncates a single failure that is itself enormous", () => {
    const huge = `AssertionError: ${"x".repeat(5000)}`;
    const summary = summarizeTestRun(
      report({
        success: false,
        numPassedTests: 2,
        numFailedTests: 1,
        testResults: [
          {
            name: `${ROOT}/acceptance/adder.test.ts`,
            status: "failed",
            assertionResults: [assertion("sums", huge)],
          },
        ],
      }),
      { root: ROOT },
    );
    expect(summary.failures[0]!.message.length).toBeLessThanOrEqual(1024);
  });
});
