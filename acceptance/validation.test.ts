import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { readManifest, run } from "trireme";
import { DEFAULT_SPEC, listDir, makeJob, type TempJob } from "./support/job.ts";
import { buildsCorrectly } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

async function runJob(t: TempJob) {
  const agent = buildsCorrectly();
  return run({
    jobDir: t.dir,
    runsDir: t.runsDir,
    extensions: [agent.extension],
    overrides: { model: agent.modelRef },
  });
}

describe("a malformed job is refused before anything is executed", () => {
  it("reports error:usage when the manifest is missing", async () => {
    job = makeJob({ manifest: null });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /trireme\.json/.test(d.message))).toBe(true);
  });

  it("reports error:usage when the spec is missing", async () => {
    job = makeJob({ spec: null });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /spec\.md/.test(d.message))).toBe(true);
  });

  it("reports error:usage when the contract is missing", async () => {
    job = makeJob({ contract: null });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /contract\.d\.ts/.test(d.message))).toBe(true);
  });

  it("reports error:usage when the acceptance directory is empty", async () => {
    job = makeJob({ acceptance: {} });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /acceptance/.test(d.message))).toBe(true);
  });

  it("names the missing spec section rather than saying the spec is bad", async () => {
    job = makeJob({ spec: DEFAULT_SPEC.replace(/## Constraints[\s\S]*?(?=## Non-goals)/, "") });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /Constraints/.test(d.message))).toBe(true);
  });

  it("rejects a spec section that is present but empty", async () => {
    job = makeJob({
      spec: DEFAULT_SPEC.replace(
        /## Constraints[\s\S]*?(?=## Non-goals)/,
        "## Constraints\n\n",
      ),
    });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /Constraints/.test(d.message))).toBe(true);
  });

  it("rejects declared dependencies, which v1 does not support", async () => {
    job = makeJob({ manifest: { dependencies: { lodash: "^4" } } });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.some((d) => /dependenc/i.test(d.message))).toBe(true);
  });

  it("reports every problem at once, not just the first", async () => {
    // A generator fixing one field at a time would need one run per mistake.
    job = makeJob({ manifest: { name: undefined, model: undefined, limits: undefined } });
    const result = await runJob(job);
    expect(result.outcome).toBe("error:usage");
    expect(result.diagnostics?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("creates no run directory when validation fails", async () => {
    job = makeJob({ manifest: null });
    await runJob(job);
    expect(listDir(job.runsDir)).toEqual([]);
  });

  it("charges nothing when validation fails", async () => {
    job = makeJob({ manifest: null });
    const result = await runJob(job);
    expect(result.ledger.tokens.total).toBe(0);
    expect(result.ledger.costUsd).toBe(0);
  });
});

describe("readManifest inspects a job without running it", () => {
  it("resolves a valid manifest", () => {
    job = makeJob();
    const result = readManifest(job.dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe("adder");
      expect(result.manifest.limits.costUsd).toBe(1);
      expect(result.manifest.safety.maxIterations).toBe(10);
    }
  });

  it("returns diagnostics for an invalid manifest", () => {
    job = makeJob({ manifest: { model: undefined } });
    const result = readManifest(job.dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.field === "model")).toBe(true);
    }
  });

  it("does not create anything", () => {
    job = makeJob();
    const before = fs.readdirSync(job.dir).sort();
    readManifest(job.dir);
    expect(fs.readdirSync(job.dir).sort()).toEqual(before);
    expect(listDir(job.runsDir)).toEqual([]);
  });
});
