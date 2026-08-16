import { afterEach, describe, expect, it } from "vitest";
import { exitCodeFor, run } from "trireme";
import { fakeClock, makeJob, type TempJob } from "./support/job.ts";
import { buildsCorrectly, churnsForever, neverActs } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

describe("budgets end a run that will not converge", () => {
  it("stops at the cost cap", async () => {
    // Each turn bills 200 output tokens at $15/M; the cap is reached long
    // before the iteration cap.
    job = makeJob({
      manifest: {
        limits: { costUsd: 0.00005, wallClockMinutes: 60 },
        safety: { maxIterations: 500 },
      },
    });
    const agent = churnsForever();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("failed:cost_cap");
    expect(result.ledger.costUsd).toBeGreaterThan(0);
    expect(result.reason).toBeTruthy();
  });

  it("overruns the cost cap by at most one message", async () => {
    job = makeJob({
      manifest: {
        limits: { costUsd: 0.00005, wallClockMinutes: 60 },
        safety: { maxIterations: 500 },
      },
    });
    const agent = churnsForever({ usagePerTurn: 200 });
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    const oneMessage = (200 / 1_000_000) * 15 + (1000 / 1_000_000) * 3;
    expect(result.ledger.costUsd!).toBeLessThanOrEqual(0.00005 + oneMessage);
  });

  it("stops at the wall-clock cap", async () => {
    job = makeJob({
      manifest: {
        limits: { costUsd: 1000, wallClockMinutes: 2 },
        safety: { maxIterations: 500 },
      },
    });
    const clock = fakeClock();
    const agent = scriptedChurnAdvancing(clock);
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
      clock,
    });

    expect(result.outcome).toBe("failed:wall_clock");
    expect(result.ledger.wallClockMs).toBeGreaterThanOrEqual(2 * 60_000);
  });

  it("stops at the iteration cap when nothing else binds first", async () => {
    job = makeJob({
      manifest: {
        limits: { costUsd: 1000, wallClockMinutes: 1000 },
        safety: { maxIterations: 3 },
      },
    });
    const agent = churnsForever();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("failed:iteration_cap");
    expect(result.ledger.iterations).toBe(3);
  });

  it("stops when three iterations pass with nothing changed", async () => {
    job = makeJob({
      manifest: {
        limits: { costUsd: 1000, wallClockMinutes: 1000 },
        safety: { maxIterations: 500 },
      },
    });
    const agent = neverActs();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("failed:no_progress");
    expect(result.ledger.iterations).toBe(3);
  });
});

describe("a failed run still reports", () => {
  it("keeps the workspace and writes a report", async () => {
    job = makeJob({ manifest: { safety: { maxIterations: 2 } } });
    const agent = churnsForever();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.runDir).toBeTruthy();
    expect(result.tests).toBeDefined();
    expect(result.provenance.model).toContain("scripted");
  });
});

describe("overrides take precedence over the manifest", () => {
  it("uses the overridden iteration cap", async () => {
    job = makeJob({ manifest: { safety: { maxIterations: 100 } } });
    const agent = churnsForever();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef, maxIterations: 2 },
    });

    expect(result.outcome).toBe("failed:iteration_cap");
    expect(result.ledger.iterations).toBe(2);
  });

  it("uses the overridden model", async () => {
    job = makeJob({ manifest: { model: "openrouter/anthropic/claude-sonnet-5" } });
    const agent = buildsCorrectly();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.provenance.model).toBe(agent.modelRef);
  });
});

describe("outcomes map to exit codes", () => {
  it("distinguishes success, failure, abort and misuse", () => {
    expect(exitCodeFor("success")).toBe(0);
    expect(exitCodeFor("failed:cost_cap")).toBe(1);
    expect(exitCodeFor("failed:wall_clock")).toBe(1);
    expect(exitCodeFor("failed:no_progress")).toBe(1);
    expect(exitCodeFor("failed:iteration_cap")).toBe(1);
    expect(exitCodeFor("aborted:infra")).toBe(2);
    expect(exitCodeFor("error:usage")).toBe(3);
  });
});

/** Churns, and moves the clock a minute for every model request. */
function scriptedChurnAdvancing(clock: ReturnType<typeof fakeClock>) {
  const agent = churnsForever();
  const inner = agent.extension.factory;
  return {
    ...agent,
    extension: {
      name: agent.extension.name,
      factory: (pi: unknown) => {
        inner(pi);
        const api = pi as { on: (event: string, handler: () => void) => void };
        api.on("turn_start", () => clock.advanceMinutes(1));
      },
    },
  };
}
