/**
 * The gate's verdict, and the message it sends back.
 *
 * Three checks in order, stopping at the first failure: the acceptance suite,
 * then the typecheck across implementation and contract, then the build. The
 * agent has no tool that reports this verdict and no way to declare itself
 * finished — it only ever learns that it is not.
 */
import type { TestSummary } from "./types.ts";

export type GateStage = "tests" | "typecheck" | "build";

export type GateResult =
  | { ok: true; tests: TestSummary }
  | { ok: false; stage: "tests"; tests: TestSummary }
  | { ok: false; stage: "typecheck"; tests: TestSummary; diagnostics: string[] }
  | { ok: false; stage: "build"; tests: TestSummary; diagnostics: string[] };

const DIAGNOSTIC_SAMPLE_LIMIT = 20;

export function gatePassed(result: GateResult): boolean {
  return result.ok;
}

function testLines(tests: TestSummary): string[] {
  const lines = [`Acceptance suite: ${tests.passed}/${tests.total} passing, ${tests.failed} failing.`];
  if (tests.failures.length > 0) {
    lines.push("");
    for (const failure of tests.failures) {
      const where = failure.line === undefined ? failure.file : `${failure.file}:${failure.line}`;
      lines.push(`- ${where} — ${failure.name}`);
      for (const line of failure.message.split("\n")) lines.push(`    ${line}`);
    }
  }
  if (tests.truncated > 0) {
    lines.push("", `${tests.truncated} further failures were not listed; fix these first.`);
  }
  return lines;
}

function diagnosticLines(diagnostics: string[]): string[] {
  const shown = diagnostics.slice(0, DIAGNOSTIC_SAMPLE_LIMIT);
  const lines = shown.map((d) => `- ${d}`);
  const hidden = diagnostics.length - shown.length;
  if (hidden > 0) lines.push("", `${hidden} further diagnostics were not listed.`);
  return lines;
}

/** The whole of what the agent is told after an iteration that did not converge. */
export function gateFeedback(result: GateResult): string {
  if (result.ok) {
    return "The gate passed.";
  }

  if (result.stage === "tests") {
    return [
      "The acceptance suite does not pass yet.",
      "",
      ...testLines(result.tests),
      "",
      "Keep working. Only the acceptance suite decides when this job is finished.",
    ].join("\n");
  }

  const what =
    result.stage === "typecheck"
      ? "The acceptance suite passes, but the typecheck fails."
      : "The acceptance suite and the typecheck pass, but the package does not build.";

  return [
    what,
    "",
    ...testLines(result.tests),
    "",
    result.stage === "typecheck" ? "Typecheck diagnostics:" : "Build diagnostics:",
    ...diagnosticLines(result.diagnostics),
    "",
    "The implementation must match contract.d.ts exactly: no missing exports, no extra ones.",
  ].join("\n");
}
