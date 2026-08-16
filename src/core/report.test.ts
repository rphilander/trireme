/**
 * Purpose: say what happened, twice — once for a program and once for a person.
 *
 * The machine-readable half has to agree with the returned result, because a
 * benchmark reads the file and a caller reads the value. The human-readable
 * half has to volunteer the things a number cannot carry: that a cost cap could
 * not be enforced, that failures were sampled rather than listed.
 */
import { describe, expect, it } from "vitest";
import { renderReportJson, renderReportMarkdown } from "./report.ts";
import type { ReportInput } from "./report.ts";
import type { RunResult } from "./types.ts";

const RESULT: RunResult = {
  outcome: "success",
  runId: "20260816T000000-abcdef",
  runDir: "/runs/20260816T000000-abcdef",
  ledger: {
    tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, total: 1200 },
    costUsd: 0.006,
    priced: true,
    iterations: 2,
    wallClockMs: 4321,
    stalledMs: 0,
  },
  provenance: {
    triremeVersion: "0.0.0",
    systemPromptHash: "abc123def456",
    model: "scripted/scripted-1",
    thinking: "off",
    jobHash: "0123456789abcdef",
  },
  tests: { total: 3, passed: 3, failed: 0, failures: [], truncated: 0 },
  artifactPath: "/runs/20260816T000000-abcdef/artifact/adder-0.1.0.tgz",
};

const INPUT: ReportInput = {
  result: RESULT,
  jobDir: "/jobs/adder",
  startedAt: "2026-08-16T00:00:00.000Z",
  finishedAt: "2026-08-16T00:00:04.321Z",
  modules: [],
};

describe("the machine-readable report", () => {
  it("agrees with the result the caller was handed", () => {
    const report = JSON.parse(renderReportJson(INPUT));
    expect(report.outcome).toBe(RESULT.outcome);
    expect(report.runId).toBe(RESULT.runId);
    expect(report.ledger.tokens.total).toBe(RESULT.ledger.tokens.total);
    expect(report.tests.passed).toBe(3);
    expect(report.artifactPath).toBe(RESULT.artifactPath);
  });

  it("carries the provenance that makes two runs comparable", () => {
    const report = JSON.parse(renderReportJson(INPUT));
    expect(report.provenance).toEqual(RESULT.provenance);
  });

  it("records when the run happened, which the result does not", () => {
    const report = JSON.parse(renderReportJson(INPUT));
    expect(report.startedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(report.finishedAt).toBe("2026-08-16T00:00:04.321Z");
  });

  it("ends with a newline, so the file is a well-behaved text file", () => {
    expect(renderReportJson(INPUT).endsWith("\n")).toBe(true);
  });
});

describe("the human-readable report", () => {
  it("leads with the outcome", () => {
    expect(renderReportMarkdown(INPUT)).toContain("success");
  });

  it("gives the reason when there is one", () => {
    const failed: ReportInput = {
      ...INPUT,
      result: { ...RESULT, outcome: "failed:cost_cap", reason: "Cost reached the cap." },
    };
    expect(renderReportMarkdown(failed)).toContain("Cost reached the cap.");
  });

  it("says the cost cap could not be enforced when the provider is unpriced", () => {
    const unpriced: ReportInput = {
      ...INPUT,
      result: {
        ...RESULT,
        outcome: "failed:iteration_cap",
        reason: "Backstop.",
        ledger: { ...RESULT.ledger, costUsd: null, priced: false },
      },
    };
    const markdown = renderReportMarkdown(unpriced).toLowerCase();
    expect(markdown).toContain("unpriced");
    expect(markdown).toContain("could not be enforced");
  });

  it("shows a dollar figure when there is one", () => {
    expect(renderReportMarkdown(INPUT)).toMatch(/\$0\.006/);
  });

  it("lists sampled failures and says how many were left out", () => {
    const failing: ReportInput = {
      ...INPUT,
      result: {
        ...RESULT,
        outcome: "failed:iteration_cap",
        reason: "Backstop.",
        artifactPath: undefined,
        tests: {
          total: 60,
          passed: 0,
          failed: 60,
          truncated: 59,
          failures: [{ file: "acceptance/many.test.ts", name: "case 0", message: "expected 0 to be 100", line: 7 }],
        },
      },
    };
    const markdown = renderReportMarkdown(failing);
    expect(markdown).toContain("acceptance/many.test.ts");
    expect(markdown).toContain("expected 0 to be 100");
    expect(markdown).toContain("59");
  });

  it("lists the modules the agent declared", () => {
    const withModules: ReportInput = {
      ...INPUT,
      modules: [{ name: "arith", purpose: "Arithmetic helpers.", files: ["index.ts"], tests: [] }],
    };
    const markdown = renderReportMarkdown(withModules);
    expect(markdown).toContain("arith");
    expect(markdown).toContain("Arithmetic helpers.");
  });

  it("lists the diagnostics when the job itself was the problem", () => {
    const misuse: ReportInput = {
      ...INPUT,
      result: {
        ...RESULT,
        outcome: "error:usage",
        reason: "The job is not valid.",
        tests: undefined,
        artifactPath: undefined,
        diagnostics: [{ field: "model", message: "trireme.json is missing \"model\"." }],
      },
    };
    expect(renderReportMarkdown(misuse)).toContain('trireme.json is missing "model".');
  });
});
