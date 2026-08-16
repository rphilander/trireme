/**
 * The run loop.
 *
 * Prompt the agent, run the gate, and either finish or say what is still wrong.
 * Everything that decides anything lives in `core/`; this file's job is to hold
 * the run's state, apply those decisions in order, and make sure that whatever
 * happens, the run directory still explains itself afterwards.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BuildGraph } from "../core/graph.ts";
import { gateFeedback } from "../core/gate.ts";
import type { GateResult } from "../core/gate.ts";
import { RunLedger } from "../core/ledger.ts";
import { applyOverrides } from "../core/manifest.ts";
import { evaluateBudgets, evaluateIteration } from "../core/policy.ts";
import type { PolicyState } from "../core/policy.ts";
import { SYSTEM_PROMPT, firstMessage } from "../core/prompt.ts";
import { renderReportJson, renderReportMarkdown } from "../core/report.ts";
import { workspacePackageJson } from "../core/scaffold.ts";
import { sha256 } from "../core/hash.ts";
import { validateJob } from "../core/job.ts";
import type {
  Ledger,
  Manifest,
  Outcome,
  Provenance,
  RunOptions,
  RunResult,
  TestSummary,
  ThinkingLevel,
} from "../core/types.ts";
import { InfrastructureError, createHarnessSession } from "./agent.ts";
import { packWorkspace } from "./packer.ts";
import { Runner } from "./runner.ts";
import { MUTATING_TOOLS, createTools } from "./tools.ts";
import {
  EventLog,
  ensureRunDir,
  findTriremeRoot,
  hashJob,
  materializeWorkspace,
  readJob,
  readTriremeVersion,
} from "./store.ts";

const DEFAULT_THINKING: ThinkingLevel = "medium";
const LOG_STRING_LIMIT = 1000;

/** Deep-truncates strings so the event log stays readable and bounded. */
function bounded(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length <= LOG_STRING_LIMIT ? value : `${value.slice(0, LOG_STRING_LIMIT)}…`;
  }
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => bounded(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, bounded(item, depth + 1)]),
    );
  }
  return value;
}

function runIdFrom(nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function emptyLedger(wallClockMs: number): Ledger {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUsd: 0,
    priced: true,
    iterations: 0,
    wallClockMs,
    stalledMs: 0,
  };
}

async function runGate(runner: Runner): Promise<GateResult> {
  const tests = await runner.runTests({ kind: "acceptance" });
  if (!tests.ok) return { ok: false, stage: "tests", tests: tests.summary };
  if (tests.summary.total === 0) {
    // A run of zero tests is not a pass; it means the suite did not execute.
    const summary: TestSummary = {
      total: 0,
      passed: 0,
      failed: 1,
      truncated: 0,
      failures: [
        {
          file: "acceptance",
          name: "(no tests ran)",
          message: "The acceptance suite produced no tests. The workspace cannot be verified.",
        },
      ],
    };
    return { ok: false, stage: "tests", tests: summary };
  }

  const typecheck = await runner.typecheck();
  if (!typecheck.ok) {
    return { ok: false, stage: "typecheck", tests: tests.summary, diagnostics: typecheck.diagnostics };
  }

  const build = await runner.build();
  if (!build.ok) {
    return { ok: false, stage: "build", tests: tests.summary, diagnostics: build.diagnostics };
  }
  return { ok: true, tests: tests.summary };
}

export async function runJob(options: RunOptions): Promise<RunResult> {
  const clock = options.clock ?? { now: () => Date.now() };
  const startedMs = clock.now();
  const startedAt = new Date(startedMs).toISOString();
  const elapsed = () => clock.now() - startedMs;

  const jobDir = path.resolve(options.jobDir);
  const runsDir = path.resolve(options.runsDir ?? path.join(process.cwd(), "runs"));
  const triremeRoot = findTriremeRoot();
  const triremeVersion = readTriremeVersion(triremeRoot);
  const runId = runIdFrom(startedMs);

  const jobFiles = readJob(jobDir);
  const validation = validateJob(jobFiles);
  const declared = validation.ok ? validation.manifest : undefined;

  const provenance: Provenance = {
    triremeVersion,
    systemPromptHash: sha256(SYSTEM_PROMPT),
    model: options.overrides?.model ?? declared?.model ?? "(unresolved)",
    thinking: options.overrides?.thinking ?? declared?.thinking ?? DEFAULT_THINKING,
    // Refined to what the model actually receives once it is resolved.
    thinkingEffective: options.overrides?.thinking ?? declared?.thinking ?? DEFAULT_THINKING,
    jobHash: hashJob(jobDir),
  };

  if (!validation.ok) {
    // Nothing has been created and nothing has been charged, so nothing is kept.
    return {
      outcome: "error:usage",
      reason: `The job at ${jobDir} is not valid: ${validation.diagnostics.length} problem(s).`,
      runId,
      runDir: path.join(runsDir, runId),
      ledger: emptyLedger(elapsed()),
      provenance,
      diagnostics: validation.diagnostics,
    };
  }

  const manifest: Manifest = applyOverrides(declared!, options.overrides);
  provenance.model = manifest.model;
  provenance.thinking = manifest.thinking ?? DEFAULT_THINKING;
  provenance.thinkingEffective = provenance.thinking;

  const runDir = ensureRunDir(runsDir, runId);
  const log = new EventLog(path.join(runDir, "events.jsonl"));
  const graph = new BuildGraph();

  fs.writeFileSync(
    path.join(runDir, "config.resolved.json"),
    `${JSON.stringify(
      { runId, jobDir, runsDir, manifest, overrides: options.overrides ?? {}, triremeVersion },
      null,
      2,
    )}\n`,
  );

  const workspace = materializeWorkspace({ runDir, jobDir, manifest, triremeRoot });
  log.write({
    type: "run_start",
    runId,
    jobDir,
    model: manifest.model,
    thinking: provenance.thinking,
    acceptanceFiles: workspace.acceptanceFiles,
  });

  const runner = new Runner({
    workspace: workspace.root,
    triremeRoot,
    scratchDir: path.join(runDir, "gate"),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  let outcome: Outcome = "failed:iteration_cap";
  let reason = "";
  let tests: TestSummary | undefined;
  let artifactPath: string | undefined;
  let iterations = 0;
  let stalledMs = 0;
  let ledger = new RunLedger({ priced: true });
  let mutated = false;
  let infraError: string | undefined;
  /** Assistant messages cut off by the model's output limit before finishing. */
  let truncated = 0;
  let budgetTripped = false;
  let wallClockTimer: NodeJS.Timeout | undefined;

  try {
    const session = await createHarnessSession({
      workspace: workspace.root,
      model: manifest.model,
      thinking: provenance.thinking,
      systemPrompt: SYSTEM_PROMPT,
      tools: createTools({
        workspace: workspace.root,
        spec: jobFiles.specText ?? "",
        contract: jobFiles.contractText ?? "",
        acceptanceFiles: workspace.acceptanceFiles,
        graph,
        checker: runner,
        onMutation: () => {
          mutated = true;
        },
        // The workspace's package.json maps every `#module` import to its
        // index; it follows the graph so the agent never learns a path.
        onGraphChange: () => {
          fs.writeFileSync(
            path.join(workspace.root, "package.json"),
            workspacePackageJson(
              manifest,
              graph.list().map((m) => m.name),
            ),
          );
        },
      }),
      extensions: options.extensions ?? [],
    });

    ledger = new RunLedger({ priced: session.priced });
    provenance.thinkingEffective = session.thinkingEffective;
    log.write({
      type: "model_resolved",
      model: session.modelRef,
      priced: session.priced,
      thinking: provenance.thinking,
      thinkingEffective: session.thinkingEffective,
      ...session.limits,
    });

    const wallClockCapMs = manifest.limits.wallClockMinutes * 60_000;

    const policyState = (idleIterations: number): PolicyState => ({
      priced: ledger.priced,
      costUsd: ledger.costUsd,
      costCapUsd: manifest.limits.costUsd,
      elapsedMs: elapsed(),
      wallClockCapMs,
      iterations,
      maxIterations: manifest.safety.maxIterations,
      idleIterations,
      truncated: { messages: truncated, maxTokens: session.limits.maxTokens },
    });

    // The wall clock is a hard cap. Checking only at message boundaries would
    // let a single long generation overrun it by minutes, so a timer aborts the
    // session the moment the budget is spent. It defers to the injected clock:
    // if that says time has not actually elapsed, it re-arms and the
    // message-boundary check remains the mechanism.
    const armWallClock = (): void => {
      const remaining = wallClockCapMs - elapsed();
      wallClockTimer = setTimeout(() => {
        wallClockTimer = undefined;
        if (elapsed() < wallClockCapMs) {
          armWallClock();
          return;
        }
        if (budgetTripped) return;
        budgetTripped = true;
        log.write({
          type: "limit",
          outcome: "failed:wall_clock",
          reason: `Wall clock reached the cap: ${(elapsed() / 60_000).toFixed(1)} min of ${manifest.limits.wallClockMinutes} min.`,
          source: "timer",
        });
        void session.session.abort().catch(() => {});
      }, Math.max(0, remaining));
      wallClockTimer.unref();
    };
    armWallClock();

    session.session.subscribe((event) => {
      switch (event.type) {
        case "message_end": {
          const message = event.message as {
            role?: string;
            stopReason?: string;
            errorMessage?: string;
            usage?: Parameters<RunLedger["add"]>[0];
          };
          if (message.role !== "assistant") return;
          ledger.add(message.usage);
          // A message the provider cut off at max output tokens is a distinct
          // pathology — usually reasoning that never reached a tool call — and
          // a run that fails to progress because of it should say so.
          if (message.stopReason === "length") {
            truncated += 1;
            log.write({ type: "output_limit", maxTokens: session.limits.maxTokens, usage: bounded(message.usage) });
          }
          log.write({
            type: "assistant_message",
            stopReason: message.stopReason,
            errorMessage: message.errorMessage,
            usage: bounded(message.usage),
          });
          // Once trireme has pulled the plug, the runtime reports the abort as
          // a provider error too. Only errors that arrive while the run is
          // still trying to proceed say anything about the infrastructure, and
          // only a message that actually succeeded clears one.
          const aborting = budgetTripped || options.signal?.aborted === true;
          if (message.stopReason === "error") {
            if (!aborting) infraError = message.errorMessage ?? "provider error";
          } else if (!aborting) {
            infraError = undefined;
          }

          // Budgets are checked here, after every assistant message, so that an
          // overrun costs at most one more message rather than one more turn.
          if (!budgetTripped) {
            const verdict = evaluateBudgets(policyState(0));
            if (verdict.stop) {
              budgetTripped = true;
              log.write({ type: "limit", outcome: verdict.outcome, reason: verdict.reason });
              void session.session.abort().catch(() => {});
            }
          }
          return;
        }
        case "tool_execution_start":
          log.write({ type: "tool_call", tool: event.toolName, args: bounded(event.args) });
          return;
        case "tool_execution_end":
          log.write({
            type: "tool_result",
            tool: event.toolName,
            ok: !event.isError,
            text: bounded(textOf(event.result)),
          });
          return;
        case "auto_retry_start":
          stalledMs += event.delayMs;
          log.write({ type: "provider_retry", attempt: event.attempt, delayMs: event.delayMs });
          return;
        case "auto_retry_end":
          log.write({
            type: "provider_retry_end",
            success: event.success,
            attempt: event.attempt,
            finalError: event.finalError,
          });
          return;
        // Compaction rewrites what the model can see. A long run is where it
        // first happens, and a run that changes behaviour afterwards needs the
        // log to say so.
        case "compaction_start":
          log.write({ type: "compaction_start", reason: event.reason });
          return;
        case "compaction_end":
          // The summary is its own model call and is billed; it never passes
          // through message_end, so the ledger has to be told here.
          if (event.result?.usage) ledger.add(event.result.usage);
          log.write({
            type: "compaction_end",
            reason: event.reason,
            aborted: event.aborted,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage,
            tokensBefore: event.result?.tokensBefore,
            estimatedTokensAfter: event.result?.estimatedTokensAfter,
            summaryLength: event.result?.summary?.length,
            usage: bounded(event.result?.usage),
          });
          return;
        default:
          return;
      }
    });

    let message = firstMessage({
      spec: jobFiles.specText ?? "",
      contract: jobFiles.contractText ?? "",
      acceptanceFiles: workspace.acceptanceFiles,
    });
    let idleIterations = 0;

    for (;;) {
      iterations += 1;
      mutated = false;
      log.write({ type: "iteration_start", iteration: iterations });

      await session.session.prompt(message, { expandPromptTemplates: false });

      if (infraError !== undefined) {
        outcome = "aborted:infra";
        reason = `The model provider failed and the failure survived retries: ${infraError}`;
        log.write({ type: "run_end", outcome, reason });
        break;
      }

      if (options.signal?.aborted) {
        const verdict = evaluateIteration(policyState(idleIterations));
        outcome = verdict.stop ? verdict.outcome : "failed:wall_clock";
        reason = verdict.stop
          ? `${verdict.reason} The run was also aborted by its caller.`
          : "The run was aborted by its caller.";
        log.write({ type: "run_end", outcome, reason });
        break;
      }

      const gate = await runGate(runner);
      tests = gate.tests;
      log.write({
        type: "gate",
        ok: gate.ok,
        stage: gate.ok ? "passed" : gate.stage,
        tests: { total: gate.tests.total, passed: gate.tests.passed, failed: gate.tests.failed },
      });

      if (gate.ok) {
        artifactPath = packWorkspace({
          workspace: workspace.root,
          outDir: path.join(runDir, "artifact"),
          manifest,
          modules: graph.list().map((m) => m.name),
        });
        outcome = "success";
        reason = "";
        log.write({ type: "run_end", outcome, artifactPath });
        break;
      }

      idleIterations = mutated ? 0 : idleIterations + 1;
      const verdict = evaluateIteration(policyState(idleIterations));
      if (verdict.stop) {
        outcome = verdict.outcome;
        reason = verdict.reason;
        log.write({ type: "run_end", outcome, reason });
        break;
      }

      message = gateFeedback(gate);
    }

    try {
      session.session.exportToJsonl(path.join(runDir, "sessions", "main.jsonl"));
    } catch {
      // A missing transcript must not turn a finished run into a failed one.
    }
    session.session.dispose();
  } catch (error) {
    outcome = "aborted:infra";
    reason =
      error instanceof InfrastructureError
        ? error.message
        : `The run could not be carried out: ${error instanceof Error ? error.message : String(error)}`;
    log.write({ type: "run_end", outcome, reason });
  } finally {
    if (wallClockTimer) clearTimeout(wallClockTimer);
  }

  const result: RunResult = {
    outcome,
    runId,
    runDir,
    ledger: ledger.snapshot({ iterations, wallClockMs: elapsed(), stalledMs }),
    provenance,
  };
  if (outcome !== "success") result.reason = reason;
  if (tests) result.tests = tests;
  if (artifactPath) result.artifactPath = artifactPath;

  const reportInput = {
    result,
    jobDir,
    startedAt,
    finishedAt: new Date(clock.now()).toISOString(),
    modules: graph.list(),
  };
  fs.writeFileSync(path.join(runDir, "report.json"), renderReportJson(reportInput));
  fs.writeFileSync(path.join(runDir, "report.md"), renderReportMarkdown(reportInput));
  fs.writeFileSync(path.join(runDir, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
  await log.close();

  return result;
}
