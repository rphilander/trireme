import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { run } from "trireme";
import { listDir, makeJob, readIfPresent, type TempJob } from "./support/job.ts";
import { buildsCorrectly } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

async function build() {
  job = makeJob();
  const agent = buildsCorrectly();
  const result = await run({
    jobDir: job.dir,
    runsDir: job.runsDir,
    extensions: [agent.extension],
    overrides: { model: agent.modelRef },
  });
  return { result, agent, job };
}

describe("a job whose agent writes a working implementation", () => {
  it("succeeds", async () => {
    const { result } = await build();
    expect(result.outcome).toBe("success");
  });

  it("reports the acceptance suite as fully passing", async () => {
    const { result } = await build();
    expect(result.tests).toBeDefined();
    expect(result.tests?.failed).toBe(0);
    expect(result.tests?.passed).toBe(result.tests?.total);
    expect(result.tests?.total).toBeGreaterThan(0);
  });

  it("writes a packable artifact that exists on disk", async () => {
    const { result } = await build();
    expect(result.artifactPath).toBeDefined();
    expect(fs.existsSync(result.artifactPath!)).toBe(true);
    expect(result.artifactPath!.endsWith(".tgz")).toBe(true);
  });

  it("consumed a budget it can account for", async () => {
    const { result } = await build();
    expect(result.ledger.tokens.total).toBeGreaterThan(0);
    expect(result.ledger.priced).toBe(true);
    expect(result.ledger.costUsd).toBeGreaterThan(0);
    expect(result.ledger.iterations).toBeGreaterThanOrEqual(1);
  });
});

describe("what a run leaves behind", () => {
  it("writes a run directory containing the workspace, transcript, log and report", async () => {
    const { result } = await build();
    const entries = listDir(result.runDir);
    expect(entries).toEqual(
      expect.arrayContaining([
        "artifact",
        "config.resolved.json",
        "events.jsonl",
        "report.json",
        "report.md",
        "sessions",
        "workspace",
      ]),
    );
  });

  it("keeps the workspace as the agent left it", async () => {
    const { result } = await build();
    const entry = readIfPresent(path.join(result.runDir, "workspace", "src", "index.ts"));
    expect(entry).toContain("export function add");
    expect(entry).toContain("export function mul");
  });

  it("records a transcript of the session", async () => {
    const { result } = await build();
    const transcript = readIfPresent(path.join(result.runDir, "sessions", "main.jsonl"));
    expect(transcript).toBeDefined();
    expect(transcript!.trim().split("\n").length).toBeGreaterThan(0);
  });

  it("logs harness events as one JSON object per line", async () => {
    const { result } = await build();
    const log = readIfPresent(path.join(result.runDir, "events.jsonl"));
    expect(log).toBeDefined();
    const lines = log!.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("writes a machine-readable report that agrees with the returned result", async () => {
    const { result } = await build();
    const report = JSON.parse(readIfPresent(path.join(result.runDir, "report.json"))!);
    expect(report.outcome).toBe(result.outcome);
    expect(report.ledger.tokens.total).toBe(result.ledger.tokens.total);
    expect(report.runId).toBe(result.runId);
  });

  it("carries the provenance that makes two runs comparable", async () => {
    const { result } = await build();
    expect(result.provenance.triremeVersion).toMatch(/\d+\.\d+\.\d+/);
    expect(result.provenance.systemPromptHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(result.provenance.jobHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(result.provenance.model).toContain("scripted");
  });

  it("gives the same job the same hash and different jobs different hashes", async () => {
    const first = await build();
    const firstHash = first.result.provenance.jobHash;
    first.job.cleanup();

    job = makeJob();
    const agent = buildsCorrectly();
    const same = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });
    expect(same.provenance.jobHash).toBe(firstHash);
    job.cleanup();

    job = makeJob({ spec: `${readIfPresent(path.join(job.dir, "spec.md")) ?? ""}\n` });
    const agent2 = buildsCorrectly();
    const different = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent2.extension],
      overrides: { model: agent2.modelRef },
    });
    expect(different.provenance.jobHash).not.toBe(firstHash);
  });
});

describe("generation is deterministic", () => {
  it("produces byte-identical generated files for the same job", async () => {
    const first = await build();
    const generated = (dir: string) =>
      ["package.json", "tsconfig.json", "vitest.config.ts"].map((f) =>
        readIfPresent(path.join(dir, "workspace", f)),
      );
    const firstFiles = generated(first.result.runDir);
    first.job.cleanup();

    job = makeJob();
    const agent = buildsCorrectly();
    const second = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });
    expect(generated(second.runDir)).toEqual(firstFiles);
  });
});
