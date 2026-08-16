/**
 * Purpose: render the status footer that rides on every mutating tool result.
 *
 * The footer exists so the agent learns the state of the workspace at the
 * moment it changes it, rather than a turn later after asking. It must stay
 * short — it lands in context on every write — and it must never look like a
 * demand: a workspace mid-change is expected to be red.
 */
import { describe, expect, it } from "vitest";
import { STATUS_INLINE_LIMIT, renderStatus } from "./status.ts";
import type { StatusInput } from "./status.ts";
import type { TestSummary } from "./types.ts";

const green: TestSummary = { total: 82, passed: 82, failed: 0, failures: [], truncated: 0 };
const red: TestSummary = {
  total: 82,
  passed: 6,
  failed: 76,
  truncated: 56,
  failures: Array.from({ length: 20 }, (_, i) => ({
    file: "acceptance/parse.test.ts",
    name: `case ${i}`,
    message: "TypeError: parse is not a function",
    line: 6 + i,
  })),
};

const ok = (): StatusInput => ({ typecheck: { ok: true, diagnostics: [] }, acceptance: green });

describe("a green workspace", () => {
  it("says so in one line per check", () => {
    const status = renderStatus(ok());
    expect(status).toContain("typecheck: ok");
    expect(status).toContain("acceptance: 82/82 passing");
  });

  it("is short", () => {
    expect(renderStatus(ok()).length).toBeLessThan(200);
  });
});

describe("typecheck problems", () => {
  it("shows a few diagnostics inline, so no round-trip is needed for the common case", () => {
    const status = renderStatus({
      ...ok(),
      typecheck: {
        ok: false,
        diagnostics: [
          "src/index.ts(1,56): error TS2307: Cannot find module './semver-core/index.js'.",
          "src/index.ts(2,29): error TS2307: Cannot find module './semver-core/index.js'.",
        ],
      },
    });
    expect(status).toContain("typecheck: 2 errors");
    expect(status).toContain("TS2307");
    expect(status).toContain("src/index.ts(1,56)");
  });

  it("collapses to a count and the files involved past the inline limit", () => {
    const many = Array.from(
      { length: STATUS_INLINE_LIMIT + 5 },
      (_, i) => `src/modules/arith/index.ts(${i + 1},1): error TS2322: nope`,
    );
    const status = renderStatus({ ...ok(), typecheck: { ok: false, diagnostics: many } });
    expect(status).toContain(`typecheck: ${STATUS_INLINE_LIMIT + 5} errors`);
    expect(status).toContain("src/modules/arith/index.ts");
    expect(status).not.toContain("TS2322: nope\n".repeat(2));
    expect(status).toContain("typecheck for detail");
  });

  it("names distinct files once each", () => {
    const status = renderStatus({
      ...ok(),
      typecheck: {
        ok: false,
        diagnostics: Array.from({ length: 10 }, (_, i) => `src/a.ts(${i},1): error TS1: x`).concat(
          Array.from({ length: 10 }, (_, i) => `src/b.ts(${i},1): error TS1: y`),
        ),
      },
    });
    expect(status.match(/src\/a\.ts/g)?.length).toBe(1);
    expect(status).toContain("src/b.ts");
  });
});

describe("the acceptance score", () => {
  it("is a fraction, not a dump", () => {
    const status = renderStatus({ ...ok(), acceptance: red });
    expect(status).toContain("acceptance: 6/82 passing");
    expect(status).not.toContain("parse is not a function");
    expect(status.length).toBeLessThan(400);
  });

  it("points at run_acceptance_tests for the detail", () => {
    expect(renderStatus({ ...ok(), acceptance: red })).toContain("run_acceptance_tests");
  });
});

describe("module tests, when a module was touched", () => {
  it("reports the touched module's own suite", () => {
    const status = renderStatus({
      ...ok(),
      module: { name: "arith", tests: { total: 4, passed: 3, failed: 1, failures: [], truncated: 0 } },
    });
    expect(status).toContain("arith tests: 3/4 passing");
  });

  it("says when the module has no tests yet, once, without nagging", () => {
    const status = renderStatus({
      ...ok(),
      module: { name: "arith", tests: { total: 0, passed: 0, failed: 0, failures: [], truncated: 0 } },
    });
    expect(status).toContain("arith tests: none yet");
    expect(status.toLowerCase()).not.toContain("you should");
  });

  it("is omitted when no module was touched", () => {
    expect(renderStatus(ok())).not.toContain("tests:");
  });
});

describe("a check that could not run", () => {
  it("says so rather than reporting green", () => {
    const status = renderStatus({
      ...ok(),
      acceptance: { total: 0, passed: 0, failed: 1, truncated: 0, failures: [{ file: "acceptance", name: "(no report)", message: "runner died" }] },
    });
    expect(status).not.toContain("0/0 passing");
    expect(status).toContain("acceptance:");
    expect(status.toLowerCase()).toContain("did not run");
  });
});

describe("shape", () => {
  it("is set off from the tool's own message by a rule, and is informational in tone", () => {
    const status = renderStatus(ok());
    expect(status.startsWith("---")).toBe(true);
    expect(status).not.toMatch(/fix|must|should/i);
  });
});
