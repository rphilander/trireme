#!/usr/bin/env node
/**
 * The command line.
 *
 * A thin wrapper: it parses arguments, calls the library, prints where the run
 * left its artifacts, and exits with the outcome's code. It adds no behaviour.
 */
import fs from "node:fs";
import path from "node:path";
import { exitCodeFor, run } from "./index.ts";
import type { Overrides, RunOptions, ThinkingLevel } from "./core/types.ts";

const USAGE = `trireme run <job-dir> [options]

Options:
  --runs-dir <path>            Where run directories are created. Default: ./runs
  --model <provider/model>     Override the manifest's model
  --thinking <level>           off|minimal|low|medium|high|xhigh|max
  --cost-usd <n>               Override the manifest's cost cap
  --wall-clock-minutes <n>     Override the manifest's wall-clock cap
  --max-iterations <n>         Override the manifest's iteration backstop
`;

class UsageError extends Error {}

function numeric(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new UsageError(`${flag} needs a positive number.`);
  return value;
}

export function parse(argv: string[]): { jobDir: string; options: RunOptions } {
  const [command, ...rest] = argv;
  if (command !== "run") throw new UsageError(`Unknown command "${command ?? ""}".`);

  const positional: string[] = [];
  const overrides: Overrides = {};
  let runsDir: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    if (!flag.startsWith("--")) {
      positional.push(flag);
      continue;
    }
    const value = rest[i + 1];
    i += 1;
    switch (flag) {
      case "--runs-dir":
        if (!value) throw new UsageError("--runs-dir needs a path.");
        runsDir = value;
        break;
      case "--model":
        if (!value) throw new UsageError("--model needs a provider/model reference.");
        overrides.model = value;
        break;
      case "--thinking":
        if (!value) throw new UsageError("--thinking needs a level.");
        overrides.thinking = value as ThinkingLevel;
        break;
      case "--cost-usd":
        overrides.costUsd = numeric(flag, value);
        break;
      case "--wall-clock-minutes":
        overrides.wallClockMinutes = numeric(flag, value);
        break;
      case "--max-iterations":
        overrides.maxIterations = numeric(flag, value);
        break;
      default:
        throw new UsageError(`Unknown option "${flag}".`);
    }
  }

  const jobDir = positional[0];
  if (!jobDir) throw new UsageError("A job directory is required.");

  const options: RunOptions = { jobDir };
  if (runsDir !== undefined) options.runsDir = runsDir;
  if (Object.keys(overrides).length > 0) options.overrides = overrides;
  return { jobDir, options };
}

/**
 * Announces the run directory as soon as it appears, so a long run can be
 * followed with `tail -f <run>/events.jsonl` while it is still going. The
 * library does not report this itself — the CLI knows the runs directory it
 * asked for, and watching it is presentation, not behaviour.
 */
function announceRunDir(runsDir: string, before: Set<string>, done: Promise<unknown>): void {
  let settled = false;
  void done.finally(() => {
    settled = true;
  });
  const poll = () => {
    if (settled) return;
    const fresh = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((e) => !before.has(e)) : [];
    if (fresh.length > 0) {
      const runDir = path.join(runsDir, fresh.sort()[fresh.length - 1]!);
      process.stderr.write(`run: ${runDir}\nfollow with: tail -f ${path.join(runDir, "events.jsonl")}\n`);
      return;
    }
    setTimeout(poll, 250).unref();
  };
  poll();
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return exitCodeFor("error:usage");
  }

  // Snapshot before calling run(): it creates the run directory synchronously,
  // ahead of its first await, so a snapshot taken afterwards would already
  // contain the entry we are waiting to see.
  const runsDir = path.resolve(parsed.options.runsDir ?? path.join(process.cwd(), "runs"));
  const before = new Set(fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []);
  const pending = run(parsed.options);
  announceRunDir(runsDir, before, pending);
  const result = await pending;

  process.stdout.write(`${result.outcome}\n`);
  if (result.reason) process.stdout.write(`${result.reason}\n`);
  for (const diagnostic of result.diagnostics ?? []) {
    process.stdout.write(`  ${diagnostic.field ? `${diagnostic.field}: ` : ""}${diagnostic.message}\n`);
  }
  if (result.tests) {
    process.stdout.write(
      `tests: ${result.tests.passed}/${result.tests.total} passing, ${result.tests.failed} failing\n`,
    );
  }
  const cost = result.ledger.costUsd === null ? "unpriced" : `$${result.ledger.costUsd.toFixed(4)}`;
  process.stdout.write(
    `cost: ${cost}  tokens: ${result.ledger.tokens.total}  iterations: ${result.ledger.iterations}\n`,
  );
  if (result.outcome !== "error:usage") process.stdout.write(`run: ${result.runDir}\n`);
  if (result.artifactPath) process.stdout.write(`artifact: ${result.artifactPath}\n`);

  return exitCodeFor(result.outcome);
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
