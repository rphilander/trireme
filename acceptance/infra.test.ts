import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { run } from "trireme";
import { makeJob, type TempJob } from "./support/job.ts";
import { providerOutage } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

describe("a provider that keeps failing is not a job failure", () => {
  it("aborts rather than reporting the job as failed", async () => {
    job = makeJob();
    const agent = providerOutage();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("aborted:infra");
    expect(result.reason).toBeTruthy();
  });

  it("keeps its artifacts so the failure can be inspected", async () => {
    job = makeJob();
    const agent = providerOutage();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(fs.existsSync(result.runDir)).toBe(true);
    expect(fs.existsSync(`${result.runDir}/report.json`)).toBe(true);
  });

  it("takes precedence over a budget that was also spent", async () => {
    // The caller running many jobs needs to stop for an outage even when the
    // job happened to be out of money at the same moment.
    job = makeJob({
      manifest: {
        limits: { costUsd: 0.0000001, wallClockMinutes: 1000 },
        safety: { maxIterations: 500 },
      },
    });
    const agent = providerOutage();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("aborted:infra");
  });

  it("does not write an artifact", async () => {
    job = makeJob();
    const agent = providerOutage();
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.artifactPath).toBeUndefined();
  });
});
