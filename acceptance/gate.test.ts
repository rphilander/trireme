import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { run } from "trireme";
import {
  INCOMPLETE_IMPLEMENTATION,
  WRONG_IMPLEMENTATION,
  makeJob,
  readIfPresent,
  type TempJob,
} from "./support/job.ts";
import { buildsOnceThenIdles } from "./support/agents.ts";

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

async function buildWith(implementation: string, maxIterations = 3) {
  job = makeJob({ manifest: { safety: { maxIterations } } });
  const agent = buildsOnceThenIdles(implementation);
  const result = await run({
    jobDir: job.dir,
    runsDir: job.runsDir,
    extensions: [agent.extension],
    overrides: { model: agent.modelRef },
  });
  return result;
}

describe("the gate, not the agent, decides", () => {
  it("does not succeed when the acceptance suite fails", async () => {
    const result = await buildWith(WRONG_IMPLEMENTATION);
    expect(result.outcome).not.toBe("success");
    expect(result.artifactPath).toBeUndefined();
  });

  it("reports which acceptance tests failed and how many", async () => {
    const result = await buildWith(WRONG_IMPLEMENTATION);
    expect(result.tests?.failed).toBeGreaterThan(0);
    expect(result.tests?.failures.length).toBeGreaterThan(0);
    const failure = result.tests!.failures[0]!;
    expect(failure.file).toBeTruthy();
    expect(failure.name).toBeTruthy();
    expect(failure.message).toBeTruthy();
  });

  it("does not succeed when the implementation omits a contract export", async () => {
    // add/mul arithmetic is right, but `mul` is missing entirely: the suite
    // cannot even import it, and conformance must fail regardless.
    const result = await buildWith(INCOMPLETE_IMPLEMENTATION);
    expect(result.outcome).not.toBe("success");
  });

  it("ignores an agent that claims to be finished", async () => {
    // The scripted agent says "Nothing further." after one wrong write. There
    // is no tool by which it could assert completion, and saying so changes
    // nothing.
    const result = await buildWith(WRONG_IMPLEMENTATION);
    expect(result.outcome).not.toBe("success");
  });

  it("bounds the failure detail handed back, rather than dumping the runner", async () => {
    job = makeJob({
      manifest: { safety: { maxIterations: 2 } },
      acceptance: {
        "many.test.ts": `import { describe, expect, it } from "vitest";
import { add } from "adder";

describe("many", () => {
${Array.from({ length: 60 }, (_, i) => `  it("case ${i}", () => { expect(add(1, 1)).toBe(${i + 100}); });`).join("\n")}
});
`,
      },
    });
    const agent = buildsOnceThenIdles(WRONG_IMPLEMENTATION);
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.tests!.failed).toBeGreaterThan(20);
    expect(result.tests!.failures.length).toBeLessThanOrEqual(20);
    expect(result.tests!.truncated).toBe(result.tests!.failed - result.tests!.failures.length);
  });
});

describe("the acceptance suite is not the agent's to change", () => {
  it("leaves the job's acceptance files byte-identical after a run", async () => {
    job = makeJob();
    const file = path.join(job.dir, "acceptance", "adder.test.ts");
    const before = fs.readFileSync(file, "utf8");
    const agent = buildsOnceThenIdles(WRONG_IMPLEMENTATION);
    await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("copies the acceptance suite into the workspace unchanged", async () => {
    job = makeJob();
    const agent = buildsOnceThenIdles(WRONG_IMPLEMENTATION);
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });
    const original = fs.readFileSync(path.join(job.dir, "acceptance", "adder.test.ts"), "utf8");
    const copied = readIfPresent(
      path.join(result.runDir, "workspace", "acceptance", "adder.test.ts"),
    );
    expect(copied).toBe(original);
  });
});
