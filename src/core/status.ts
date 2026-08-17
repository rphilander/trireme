/**
 * The status footer appended to every mutating tool result.
 *
 * The harness runs the cheap checks itself the moment the workspace changes,
 * so the agent sees where it stands without spending a turn to ask. Bounded and
 * informational: it reports, it never instructs. A workspace mid-change is
 * expected to be red, and the footer must not read as a demand to stop and fix.
 */
import type { TestSummary } from "./types.ts";

/** Diagnostics shown in full before collapsing to a count and file list. */
export const STATUS_INLINE_LIMIT = 3;

export interface StatusInput {
  typecheck: { ok: boolean; diagnostics: string[] };
  acceptance: TestSummary;
  /** Present when the mutation touched a module. */
  module?: { name: string; tests: TestSummary };
}

/** `src/a.ts(3,1): error TS2322: …` → `src/a.ts` */
function fileOf(diagnostic: string): string {
  const match = /^(.+?)\(\d+,\d+\)/.exec(diagnostic);
  return match ? match[1]! : diagnostic.split(":")[0]!;
}

function typecheckLine(check: StatusInput["typecheck"]): string[] {
  if (check.ok) return ["typecheck: ok"];
  const count = check.diagnostics.length;
  const noun = count === 1 ? "error" : "errors";
  if (count <= STATUS_INLINE_LIMIT) {
    return [`typecheck: ${count} ${noun}`, ...check.diagnostics.map((d) => `  ${d}`)];
  }
  const files = [...new Set(check.diagnostics.map(fileOf))];
  // The count and file list summarise; the first diagnostic in full is the one
  // line that usually tells the agent what to do (a missing export, a bad
  // import) without a round-trip to the detail tool.
  return [
    `typecheck: ${count} ${noun} in ${files.join(", ")} (call typecheck for detail)`,
    `  first: ${check.diagnostics[0]}`,
  ];
}

function testsLine(label: string, summary: TestSummary, detailTool: string | undefined): string {
  if (summary.total === 0 && summary.failed > 0) {
    return `${label}: did not run (${summary.failures[0]?.message.split("\n")[0] ?? "no report"})`;
  }
  if (summary.total === 0) return `${label}: none yet`;
  const line = `${label}: ${summary.passed}/${summary.total} passing`;
  if (summary.failed === 0 || detailTool === undefined) return line;
  const detail = `(call ${detailTool} for detail)`;
  // When nothing passes yet there is no gradient to read, and a flat "0/N
  // passing" reads the same whether the implementation is wrong or the suite
  // could not run at all (an unwired entry, a module that throws on load). The
  // first failure's message names which, so the agent fixes the blocker rather
  // than grinding on code the suite never reached. Once anything passes, the
  // fraction is the signal and the detail tool carries the specifics.
  if (summary.passed === 0) {
    const why = summary.failures[0]?.message.split("\n")[0];
    if (why) return `${line} — ${why} ${detail}`;
  }
  return `${line} ${detail}`;
}

export function renderStatus(input: StatusInput): string {
  const lines = ["---", ...typecheckLine(input.typecheck)];
  if (input.module) {
    lines.push(testsLine(`${input.module.name} tests`, input.module.tests, "run_module_tests"));
  }
  lines.push(testsLine("acceptance", input.acceptance, "run_acceptance_tests"));
  return lines.join("\n");
}
