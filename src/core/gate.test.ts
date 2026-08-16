/**
 * Purpose: hold the gate's verdict, and render the one message the agent gets
 * back from it.
 *
 * The gate itself is three subprocesses; what lives here is its shape and its
 * prose. Both matter: the verdict is what "done" means, and the message is the
 * only channel through which the agent learns it is not.
 */
import { describe, expect, it } from "vitest";
import { gateFeedback, gatePassed } from "./gate.ts";
import type { GateResult } from "./gate.ts";
import type { TestSummary } from "./types.ts";

const passing: TestSummary = { total: 3, passed: 3, failed: 0, failures: [], truncated: 0 };

const failing: TestSummary = {
  total: 3,
  passed: 1,
  failed: 2,
  truncated: 0,
  failures: [
    { file: "acceptance/adder.test.ts", name: "add sums", message: "expected -1 to be 5", line: 5 },
    { file: "acceptance/adder.test.ts", name: "add negates", message: "expected -5 to be 1" },
  ],
};

describe("the verdict", () => {
  it("passes only when every stage passed", () => {
    expect(gatePassed({ ok: true, tests: passing })).toBe(true);
    expect(gatePassed({ ok: false, stage: "tests", tests: failing })).toBe(false);
    expect(gatePassed({ ok: false, stage: "typecheck", tests: passing, diagnostics: ["x"] })).toBe(false);
    expect(gatePassed({ ok: false, stage: "build", tests: passing, diagnostics: ["x"] })).toBe(false);
  });
});

describe("the message the agent gets back", () => {
  it("names the failing tests, with where and why", () => {
    const message = gateFeedback({ ok: false, stage: "tests", tests: failing });
    expect(message).toContain("acceptance/adder.test.ts:5");
    expect(message).toContain("add sums");
    expect(message).toContain("expected -1 to be 5");
  });

  it("leads with the counts, so the agent knows the scale before the detail", () => {
    const message = gateFeedback({ ok: false, stage: "tests", tests: failing });
    expect(message).toMatch(/1\s*\/\s*3/);
  });

  it("says how many failures it did not list", () => {
    const message = gateFeedback({
      ok: false,
      stage: "tests",
      tests: { ...failing, failed: 60, truncated: 58 },
    });
    expect(message).toContain("58");
  });

  it("reports typecheck failures as diagnostics, not as test output", () => {
    const message = gateFeedback({
      ok: false,
      stage: "typecheck",
      tests: passing,
      diagnostics: ["src/index.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'."],
    });
    expect(message).toContain("TS2322");
    expect(message.toLowerCase()).toContain("typecheck");
  });

  it("says the suite passed when only the typecheck did not", () => {
    // Otherwise the agent re-reads tests that are already green.
    const message = gateFeedback({ ok: false, stage: "typecheck", tests: passing, diagnostics: ["x"] });
    expect(message).toContain("3/3");
  });

  it("distinguishes a build failure from a typecheck failure", () => {
    const message = gateFeedback({ ok: false, stage: "build", tests: passing, diagnostics: ["oops"] });
    expect(message.toLowerCase()).toContain("build");
  });

  it("never asks the agent to declare itself finished", () => {
    for (const result of [
      { ok: false, stage: "tests", tests: failing },
      { ok: false, stage: "typecheck", tests: passing, diagnostics: ["x"] },
    ] as GateResult[]) {
      expect(gateFeedback(result).toLowerCase()).not.toContain("let me know when");
    }
  });

  it("is bounded even when handed an unbounded diagnostic list", () => {
    const many = Array.from({ length: 200 }, (_, i) => `src/index.ts(${i},1): error TS0000: nope`);
    const message = gateFeedback({ ok: false, stage: "typecheck", tests: passing, diagnostics: many });
    expect(message.length).toBeLessThan(8000);
    expect(message).toContain("further");
  });
});
