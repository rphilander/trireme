import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { run } from "trireme";
import { makeJob, readIfPresent, type TempJob } from "./support/job.ts";
import { buildsCorrectly, churnsForever } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

describe("a metered provider", () => {
  it("accumulates tokens by kind and a total cost", async () => {
    job = makeJob();
    const agent = buildsCorrectly();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    const { tokens } = result.ledger;
    expect(tokens.input).toBeGreaterThan(0);
    expect(tokens.output).toBeGreaterThan(0);
    expect(tokens.total).toBe(tokens.input + tokens.output);
    expect(result.ledger.priced).toBe(true);
    expect(result.ledger.costUsd).toBeGreaterThan(0);
  });

  it("counts every model request, not just the last", async () => {
    job = makeJob({ manifest: { safety: { maxIterations: 3 } } });
    const agent = churnsForever();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(agent.requests()).toBeGreaterThan(1);
    expect(result.ledger.tokens.output).toBeGreaterThanOrEqual(200 * agent.requests());
  });
});

describe("a flat-rate provider reports no price", () => {
  // A coding-plan subscription bills nothing per token, so every message
  // reports zero. Recording that as $0.00 would be indistinguishable from a
  // free run and would quietly turn a cost cap into no cap at all.
  it("records cost as unpriced rather than as zero", async () => {
    job = makeJob({ manifest: { safety: { maxIterations: 2 } } });
    const agent = churnsForever({ priced: false });
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.ledger.priced).toBe(false);
    expect(result.ledger.costUsd).toBeNull();
  });

  it("still counts tokens", async () => {
    job = makeJob({ manifest: { safety: { maxIterations: 2 } } });
    const agent = churnsForever({ priced: false });
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.ledger.tokens.total).toBeGreaterThan(0);
  });

  it("remains bounded by the limits that can still be enforced", async () => {
    // The cost cap cannot bind here, so the run must still end — by iterations.
    job = makeJob({
      manifest: {
        limits: { costUsd: 0.00001, wallClockMinutes: 1000 },
        safety: { maxIterations: 2 },
      },
    });
    const agent = churnsForever({ priced: false });
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("failed:iteration_cap");
  });

  it("says in the report that the cost cap could not be enforced", async () => {
    job = makeJob({
      manifest: {
        limits: { costUsd: 0.00001, wallClockMinutes: 1000 },
        safety: { maxIterations: 2 },
      },
    });
    const agent = churnsForever({ priced: false });
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    const report = readIfPresent(path.join(result.runDir, "report.md")) ?? "";
    expect(report.toLowerCase()).toContain("unpriced");
  });
});
