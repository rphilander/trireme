/**
 * The tool surface, observed from outside.
 *
 * These assert through run() rather than by calling tools directly, because
 * what matters is what the agent can and cannot cause to happen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { run } from "trireme";
import { CORRECT_IMPLEMENTATION, makeJob, readIfPresent, type TempJob } from "./support/job.ts";
import { scriptedProvider } from "./support/scripted-provider.ts";

/** Reads a gzipped ustar tarball into name → content. Independent of the packer. */
function readTarball(file: string): Map<string, string> {
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name === "") break;
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/[\0 ].*$/, ""), 8);
    if (header[156] === 0x30) entries.set(name, raw.subarray(offset + 512, offset + 512 + size).toString("utf8"));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

let job: TempJob | undefined;
afterEach(() => {
  job?.cleanup();
  job = undefined;
});

/** Runs a fixed list of tool calls, one per turn, then ends. */
function performs(calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  return scriptedProvider({
    respond: (request) =>
      request < calls.length ? { tools: [calls[request]!] } : { text: "Finished." },
  });
}

async function perform(calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  job = makeJob({ manifest: { safety: { maxIterations: 2 } } });
  const agent = performs(calls);
  const result = await run({
    jobDir: job.dir,
    runsDir: job.runsDir,
    extensions: [agent.extension],
    overrides: { model: agent.modelRef },
  });
  const events = (readIfPresent(path.join(result.runDir, "events.jsonl")) ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { result, events, workspace: path.join(result.runDir, "workspace") };
}

describe("modules", () => {
  it("creates a module the agent declared, with the file it wrote", async () => {
    const { workspace } = await perform([
      { name: "declare_module", arguments: { name: "arith", purpose: "Arithmetic helpers." } },
      {
        name: "write_module_file",
        arguments: { module: "arith", file: "index", content: "export const two = 2;\n" },
      },
    ]);

    const file = readIfPresent(path.join(workspace, "src", "modules", "arith", "index.ts"));
    expect(file).toContain("export const two = 2;");
  });

  it("treats a name with and without its extension as the same file", async () => {
    const { workspace } = await perform([
      { name: "declare_module", arguments: { name: "arith", purpose: "Arithmetic helpers." } },
      {
        name: "write_module_file",
        arguments: { module: "arith", file: "helper", content: "export const first = 1;\n" },
      },
      {
        name: "write_module_file",
        arguments: { module: "arith", file: "helper.ts", content: "export const second = 2;\n" },
      },
    ]);

    const dir = path.join(workspace, "src", "modules", "arith");
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("helper"))).toEqual(["helper.ts"]);
    expect(readIfPresent(path.join(dir, "helper.ts"))).toContain("export const second = 2;");
  });

  it("keeps a module's test suite separate from its implementation files", async () => {
    const { workspace } = await perform([
      { name: "declare_module", arguments: { name: "arith", purpose: "Arithmetic helpers." } },
      {
        name: "write_module_file",
        arguments: { module: "arith", file: "index", content: "export const two = 2;\n" },
      },
      {
        name: "write_module_test",
        arguments: {
          module: "arith",
          file: "index",
          content: `import { expect, it } from "vitest";\nit("holds", () => expect(2).toBe(2));\n`,
        },
      },
    ]);

    const dir = path.join(workspace, "src", "modules", "arith");
    expect(fs.existsSync(path.join(dir, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "index.test.ts"))).toBe(true);
  });

  it("refuses a test name given to write_module_file, and names the right tool", async () => {
    const { events, workspace } = await perform([
      { name: "declare_module", arguments: { name: "arith", purpose: "Arithmetic helpers." } },
      {
        name: "write_module_file",
        arguments: { module: "arith", file: "sneaky.test.ts", content: "// not an implementation\n" },
      },
    ]);

    expect(fs.existsSync(path.join(workspace, "src", "modules", "arith", "sneaky.test.ts"))).toBe(
      false,
    );
    const text = JSON.stringify(events);
    expect(text).toContain("write_module_test");
  });

  it("lets a module be imported by name, from the entry point through to the artifact", async () => {
    // The agent never learns where a module lives. It declares one, is told to
    // import it as #name, and does. That has to resolve for the typecheck, for
    // the acceptance suite, and inside the packed artifact when Node runs it.
    job = makeJob({ manifest: { safety: { maxIterations: 2 } } });
    const agent = performs([
      { name: "declare_module", arguments: { name: "arith", purpose: "Arithmetic helpers." } },
      {
        name: "write_module_file",
        arguments: {
          module: "arith",
          file: "index",
          content:
            "export function plus(a: number, b: number): number { return a + b; }\n" +
            "export function times(a: number, b: number): number { return a * b; }\n",
        },
      },
      {
        name: "write_entry",
        arguments: {
          content:
            'import { plus, times } from "#arith";\n' +
            "export function add(a: number, b: number): number { return plus(a, b); }\n" +
            "export function mul(a: number, b: number): number { return times(a, b); }\n",
        },
      },
    ]);
    const result = await run({
      jobDir: job.dir,
      runsDir: job.runsDir,
      extensions: [agent.extension],
      overrides: { model: agent.modelRef },
    });

    expect(result.outcome).toBe("success");
    const events = (readIfPresent(path.join(result.runDir, "events.jsonl")) ?? "").split("\n").join(" ");
    expect(events).toContain("#arith");

    const artifact = readTarball(result.artifactPath!);
    const packaged = JSON.parse(artifact.get("package/package.json")!);
    expect(packaged.imports).toEqual({ "#arith": "./dist/modules/arith/index.js" });
    expect(artifact.get("package/dist/index.js")).toContain('from "#arith"');

    const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), "trireme-artifact-"));
    try {
      for (const [name, content] of artifact) {
        const target = path.join(unpacked, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
      const { stdout } = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `import { add, mul } from "${unpacked}/package/dist/index.js"; console.log(add(2, 3), mul(2, 3));`],
        { encoding: "utf8" },
      );
      expect(stdout.trim()).toBe("5 6");
    } finally {
      fs.rmSync(unpacked, { recursive: true, force: true });
    }
  });

  it("survives a tool call it cannot honour, rather than ending the run", async () => {
    const { result, events } = await perform([
      {
        name: "write_module_file",
        arguments: { module: "never-declared", file: "index", content: "// orphan\n" },
      },
    ]);

    expect(result.outcome).not.toBe("aborted:infra");
    expect(result.outcome).not.toBe("error:usage");
    expect(JSON.stringify(events)).toContain("never-declared");
  });
});

describe("the job's own files", () => {
  it("lets the agent read the spec and the contract", async () => {
    const { events } = await perform([
      { name: "read_spec", arguments: {} },
      { name: "read_contract", arguments: {} },
    ]);

    const names = events
      .map((e) => (e as { tool?: string }).tool)
      .filter((n): n is string => typeof n === "string");
    expect(names).toContain("read_spec");
    expect(names).toContain("read_contract");
  });

  it("lists the acceptance tests by name", async () => {
    const { events } = await perform([{ name: "list_acceptance_tests", arguments: {} }]);
    expect(JSON.stringify(events)).toContain("adder.test.ts");
  });

  it("has no tool that writes to the acceptance suite", async () => {
    const { result, workspace } = await perform([
      {
        name: "write_acceptance_test",
        arguments: { file: "adder.test.ts", content: "// neutered\n" },
      },
    ]);

    // The call fails because no such tool is registered; the suite is untouched.
    expect(readIfPresent(path.join(workspace, "acceptance", "adder.test.ts"))).toContain(
      "expect(add(2, 3)).toBe(5)",
    );
    expect(result.outcome).not.toBe("success");
  });
});

describe("the entry point", () => {
  it("is writable, and what it writes is what the gate sees", async () => {
    const { workspace } = await perform([
      { name: "write_entry", arguments: { content: CORRECT_IMPLEMENTATION } },
    ]);
    expect(readIfPresent(path.join(workspace, "src", "index.ts"))).toBe(CORRECT_IMPLEMENTATION);
  });

  it("can be edited in place rather than rewritten", async () => {
    const { workspace } = await perform([
      { name: "write_entry", arguments: { content: CORRECT_IMPLEMENTATION } },
      {
        name: "edit_entry",
        arguments: { find: "return a + b;", replace: "return b + a;" },
      },
    ]);

    const entry = readIfPresent(path.join(workspace, "src", "index.ts"));
    expect(entry).toContain("return b + a;");
    expect(entry).toContain("export function mul");
  });
});
