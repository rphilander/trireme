/**
 * The three checks that make up the gate, each a subprocess.
 *
 * Subprocesses rather than in-process calls for one reason: a run has a
 * wall-clock budget, and a child can be killed. Trireme owns vitest and tsc —
 * jobs do not carry them — so both are invoked out of trireme's own toolchain
 * against the workspace.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeTestRun } from "../core/results.ts";
import type { VitestReport } from "../core/results.ts";
import type { TestSummary } from "../core/types.ts";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const OUTPUT_LIMIT = 200_000;

function run(
  command: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, CI: "true", NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut });
    };

    const kill = () => {
      child.kill("SIGKILL");
    };
    const onAbort = () => {
      timedOut = true;
      kill();
    };

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            kill();
          }, options.timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += `\n${error instanceof Error ? error.message : String(error)}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export type TestScope = { kind: "acceptance" } | { kind: "module"; module: string };

export interface TestRun {
  ok: boolean;
  summary: TestSummary;
  /** Present when the runner itself failed rather than the tests. */
  error?: string;
}

export interface CheckRun {
  ok: boolean;
  diagnostics: string[];
}

export interface RunnerOptions {
  workspace: string;
  triremeRoot: string;
  scratchDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DIAGNOSTIC_LIMIT = 50;

export class Runner {
  private counter = 0;
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.options = options;
    fs.mkdirSync(options.scratchDir, { recursive: true });
  }

  private get vitestCli(): string {
    return path.join(this.options.triremeRoot, "node_modules", "vitest", "vitest.mjs");
  }

  private get tscCli(): string {
    return path.join(this.options.triremeRoot, "node_modules", "typescript", "bin", "tsc");
  }

  async runTests(scope: TestScope): Promise<TestRun> {
    this.counter += 1;
    const outputFile = path.join(this.options.scratchDir, `vitest-${this.counter}.json`);
    fs.rmSync(outputFile, { force: true });

    const filter = scope.kind === "acceptance" ? "acceptance/" : `src/modules/${scope.module}/`;
    const result = await run(
      process.execPath,
      [
        this.vitestCli,
        "run",
        "--root",
        this.options.workspace,
        "--reporter=json",
        `--outputFile=${outputFile}`,
        "--passWithNoTests",
        filter,
      ],
      {
        cwd: this.options.workspace,
        ...(this.options.signal ? { signal: this.options.signal } : {}),
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      },
    );

    let report: VitestReport | undefined;
    try {
      report = JSON.parse(fs.readFileSync(outputFile, "utf8")) as VitestReport;
    } catch {
      report = undefined;
    }

    if (!report) {
      const detail = (result.stderr || result.stdout).trim().split("\n").slice(-20).join("\n");
      return {
        ok: false,
        summary: {
          total: 0,
          passed: 0,
          failed: 1,
          truncated: 0,
          failures: [
            {
              file: scope.kind === "acceptance" ? "acceptance" : `src/modules/${scope.module}`,
              name: "(the test runner did not produce a report)",
              message: detail || "The test runner produced no output.",
            },
          ],
        },
        error: result.timedOut ? "The test run was killed after exceeding its time budget." : detail,
      };
    }

    const summary = summarizeTestRun(report, { root: this.options.workspace });
    const ok = result.code === 0 && summary.failed === 0;
    return { ok, summary };
  }

  private async typescript(project: string): Promise<CheckRun> {
    const result = await run(
      process.execPath,
      [this.tscCli, "--project", project, "--pretty", "false"],
      {
        cwd: this.options.workspace,
        ...(this.options.signal ? { signal: this.options.signal } : {}),
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      },
    );

    const lines = `${result.stdout}\n${result.stderr}`
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0 && !/^Found \d+ error/.test(line) && !/^\s*Visit https:/.test(line));

    if (result.code === 0) return { ok: true, diagnostics: [] };
    if (lines.length === 0) {
      return {
        ok: false,
        diagnostics: [
          result.timedOut
            ? "The typechecker was killed after exceeding its time budget."
            : `The typechecker exited with code ${result.code} and said nothing.`,
        ],
      };
    }
    return { ok: false, diagnostics: lines.slice(0, DIAGNOSTIC_LIMIT) };
  }

  typecheck(): Promise<CheckRun> {
    return this.typescript("tsconfig.json");
  }

  build(): Promise<CheckRun> {
    return this.typescript("tsconfig.build.json");
  }
}
