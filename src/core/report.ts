/**
 * What a run leaves behind for a program and for a person.
 *
 * `report.json` is the benchmark's input and must agree with the value the
 * caller was handed. `report.md` is for whoever opens the run directory
 * afterwards, and its job is to volunteer what a number cannot say — chiefly
 * that an unpriced provider left the cost cap unenforceable.
 */
import type { ModuleRecord } from "./graph.ts";
import type { RunResult } from "./types.ts";

export interface ReportInput {
  result: RunResult;
  jobDir: string;
  startedAt: string;
  finishedAt: string;
  modules: ModuleRecord[];
}

export function renderReportJson(input: ReportInput): string {
  const { result } = input;
  const report = {
    outcome: result.outcome,
    reason: result.reason,
    runId: result.runId,
    runDir: result.runDir,
    jobDir: input.jobDir,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    provenance: result.provenance,
    ledger: result.ledger,
    tests: result.tests,
    artifactPath: result.artifactPath,
    diagnostics: result.diagnostics,
    modules: input.modules,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function costLine(result: RunResult): string {
  const { ledger } = result;
  if (!ledger.priced || ledger.costUsd === null) {
    return (
      "- Cost: **unpriced** — this provider publishes no per-token prices, so the cost cap " +
      "could not be enforced. Token counts below are still exact."
    );
  }
  return `- Cost: **$${ledger.costUsd.toFixed(6)}**`;
}

export function renderReportMarkdown(input: ReportInput): string {
  const { result } = input;
  const { ledger, provenance, tests } = result;
  const lines: string[] = [];

  lines.push(`# ${result.outcome}`, "");
  if (result.reason) lines.push(result.reason, "");

  lines.push("## Run", "");
  lines.push(`- Run id: \`${result.runId}\``);
  lines.push(`- Job: \`${input.jobDir}\``);
  lines.push(`- Started: ${input.startedAt}`);
  lines.push(`- Finished: ${input.finishedAt}`);
  if (result.artifactPath) lines.push(`- Artifact: \`${result.artifactPath}\``);
  lines.push("");

  lines.push("## Consumption", "");
  lines.push(costLine(result));
  lines.push(
    `- Tokens: ${ledger.tokens.total} total ` +
      `(${ledger.tokens.input} in, ${ledger.tokens.output} out, ` +
      `${ledger.tokens.cacheRead} cache read, ${ledger.tokens.cacheWrite} cache write)`,
  );
  lines.push(`- Iterations: ${ledger.iterations}`);
  lines.push(`- Wall clock: ${(ledger.wallClockMs / 1000).toFixed(1)}s (${(ledger.stalledMs / 1000).toFixed(1)}s stalled)`);
  lines.push("");

  if (tests) {
    lines.push("## Acceptance suite", "");
    lines.push(`- ${tests.passed}/${tests.total} passing, ${tests.failed} failing`);
    if (tests.failures.length > 0) {
      lines.push("");
      for (const failure of tests.failures) {
        const where = failure.line === undefined ? failure.file : `${failure.file}:${failure.line}`;
        lines.push(`- \`${where}\` — **${failure.name}**: ${failure.message.split("\n")[0]}`);
      }
    }
    if (tests.truncated > 0) {
      lines.push("", `${tests.truncated} further failures were not listed.`);
    }
    lines.push("");
  }

  if (result.diagnostics && result.diagnostics.length > 0) {
    lines.push("## Diagnostics", "");
    for (const diagnostic of result.diagnostics) {
      lines.push(`- ${diagnostic.field ? `\`${diagnostic.field}\`: ` : ""}${diagnostic.message}`);
    }
    lines.push("");
  }

  if (input.modules.length > 0) {
    lines.push("## Modules", "");
    for (const module of input.modules) {
      lines.push(`- **${module.name}** — ${module.purpose}`);
      lines.push(`  - files: ${module.files.join(", ") || "none"}`);
      lines.push(`  - tests: ${module.tests.join(", ") || "none"}`);
    }
    lines.push("");
  }

  lines.push("## Provenance", "");
  lines.push(`- trireme: ${provenance.triremeVersion}`);
  const thinking =
    provenance.thinkingEffective === provenance.thinking
      ? `thinking: ${provenance.thinking}`
      : `thinking: ${provenance.thinking}, received as ${provenance.thinkingEffective}`;
  lines.push(`- model: ${provenance.model} (${thinking})`);
  lines.push(`- system prompt: \`${provenance.systemPromptHash}\``);
  lines.push(`- job: \`${provenance.jobHash}\``);
  lines.push("");

  return lines.join("\n");
}
