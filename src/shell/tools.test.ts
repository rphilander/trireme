/**
 * Purpose: the twenty-one tools, each called directly.
 *
 * The acceptance suite drives tools through a whole agent session and can only
 * afford to sample them. This suite pays milliseconds per case, so it can hold
 * every tool to its description: what it does, what it refuses, and what it
 * names when it refuses. The checker (typecheck, tests) is faked, so the status
 * footer is exercised without a subprocess.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BuildGraph } from "../core/graph.ts";
import { MUTATING_TOOLS, createTools } from "./tools.ts";
import type { Checker, ToolContext } from "./tools.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TestSummary } from "../core/types.ts";

const passing = (total: number): TestSummary => ({ total, passed: total, failed: 0, failures: [], truncated: 0 });

class FakeChecker implements Checker {
  typecheckResult = { ok: true, diagnostics: [] as string[] };
  acceptance = passing(3);
  moduleTests = new Map<string, TestSummary>();
  calls: string[] = [];

  async typecheck() {
    this.calls.push("typecheck");
    return this.typecheckResult;
  }

  async runTests(scope: { kind: "acceptance" } | { kind: "module"; module: string }) {
    if (scope.kind === "acceptance") {
      this.calls.push("acceptance");
      return { ok: this.acceptance.failed === 0, summary: this.acceptance };
    }
    this.calls.push(`module:${scope.module}`);
    const summary = this.moduleTests.get(scope.module) ?? passing(0);
    return { ok: summary.failed === 0, summary };
  }
}

let workspace: string;
let graph: BuildGraph;
let checker: FakeChecker;
let mutations: number;
let graphChanges: number;
let tools: Map<string, ToolDefinition>;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "trireme-tools-"));
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "acceptance"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(path.join(workspace, "acceptance", "adder.test.ts"), "// adder tests\n");
  fs.writeFileSync(path.join(workspace, "acceptance", "mul.test.ts"), "// mul tests\n");
  graph = new BuildGraph();
  checker = new FakeChecker();
  mutations = 0;
  graphChanges = 0;
  const context: ToolContext = {
    workspace,
    spec: "# the spec\n",
    contract: "export declare function add(a: number, b: number): number;\n",
    acceptanceFiles: ["adder.test.ts", "mul.test.ts"],
    graph,
    checker,
    onMutation: () => {
      mutations += 1;
    },
    onGraphChange: () => {
      graphChanges += 1;
    },
  };
  tools = new Map(createTools(context).map((t) => [t.name, t]));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.execute(`call-${name}`, args as never, undefined, undefined, {} as never);
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function refusal(name: string, args: Record<string, unknown> = {}): Promise<string> {
  try {
    await call(name, args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected ${name} to refuse`);
}

const read = (relative: string) => fs.readFileSync(path.join(workspace, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(workspace, relative));

describe("the surface", () => {
  it("is exactly twenty-one tools", () => {
    expect(tools.size).toBe(21);
    expect([...tools.keys()].sort()).toEqual(
      [
        "read_spec",
        "read_contract",
        "list_acceptance_tests",
        "read_acceptance_test",
        "read_entry",
        "write_entry",
        "edit_entry",
        "list_modules",
        "declare_module",
        "read_module_file",
        "write_module_file",
        "edit_module_file",
        "delete_module_file",
        "read_module_test",
        "write_module_test",
        "edit_module_test",
        "delete_module_test",
        "delete_module",
        "run_acceptance_tests",
        "run_module_tests",
        "typecheck",
      ].sort(),
    );
  });

  it("has no tool that takes a path, and no tool that writes to the job", () => {
    for (const tool of tools.values()) {
      const params = JSON.stringify(tool.parameters);
      expect(params).not.toMatch(/"path"/);
    }
    expect(tools.has("write_acceptance_test")).toBe(false);
    expect(tools.has("write_spec")).toBe(false);
    expect(tools.has("write_contract")).toBe(false);
  });

  it("knows which of its tools mutate the workspace", () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(
      [
        "write_entry",
        "edit_entry",
        "declare_module",
        "write_module_file",
        "edit_module_file",
        "delete_module_file",
        "write_module_test",
        "edit_module_test",
        "delete_module_test",
        "delete_module",
      ].sort(),
    );
  });
});

describe("the job, read only", () => {
  it("read_spec returns the spec", async () => {
    expect(await call("read_spec")).toBe("# the spec\n");
  });

  it("read_contract returns the contract", async () => {
    expect(await call("read_contract")).toContain("export declare function add");
  });

  it("list_acceptance_tests names the files", async () => {
    const listed = await call("list_acceptance_tests");
    expect(listed).toContain("adder.test.ts");
    expect(listed).toContain("mul.test.ts");
  });

  it("read_acceptance_test reads by exact name and by shortened name", async () => {
    expect(await call("read_acceptance_test", { file: "adder.test.ts" })).toBe("// adder tests\n");
    expect(await call("read_acceptance_test", { file: "adder" })).toBe("// adder tests\n");
  });

  it("read_acceptance_test lists the suite when the name matches nothing", async () => {
    const message = await refusal("read_acceptance_test", { file: "nope" });
    expect(message).toContain("adder.test.ts");
    expect(message).toContain("mul.test.ts");
  });

  it("reads carry no status footer, because nothing changed", async () => {
    expect(await call("read_spec")).not.toContain("typecheck:");
    expect(checker.calls).toEqual([]);
  });
});

describe("the entry point", () => {
  it("read_entry reads it", async () => {
    expect(await call("read_entry")).toBe("export {};\n");
  });

  it("write_entry replaces it", async () => {
    await call("write_entry", { content: "export const x = 1;\n" });
    expect(read("src/index.ts")).toBe("export const x = 1;\n");
    expect(mutations).toBe(1);
  });

  it("edit_entry replaces an exact fragment", async () => {
    await call("write_entry", { content: "return a + b;\nreturn c;\n" });
    await call("edit_entry", { find: "a + b", replace: "b + a" });
    expect(read("src/index.ts")).toBe("return b + a;\nreturn c;\n");
  });

  it("edit_entry refuses an ambiguous fragment and names replaceAll", async () => {
    await call("write_entry", { content: "x\nx\n" });
    const message = await refusal("edit_entry", { find: "x", replace: "y" });
    expect(message).toContain("2 times");
    expect(message).toContain("replaceAll");
    expect(read("src/index.ts")).toBe("x\nx\n");
  });

  it("edit_entry replaces every occurrence when asked", async () => {
    await call("write_entry", { content: "x\nx\n" });
    await call("edit_entry", { find: "x", replace: "y", replaceAll: true });
    expect(read("src/index.ts")).toBe("y\ny\n");
  });

  it("edit_entry refuses a fragment that is not there, and says to re-read", async () => {
    const message = await refusal("edit_entry", { find: "nowhere", replace: "y" });
    expect(message.toLowerCase()).toContain("does not appear");
  });

  it("edit_entry refuses an empty fragment", async () => {
    expect(await refusal("edit_entry", { find: "", replace: "y" })).toBeTruthy();
  });
});

describe("declaring modules", () => {
  it("creates the module directory and records the purpose", async () => {
    await call("declare_module", { name: "arith", purpose: "Arithmetic." });
    expect(exists("src/modules/arith")).toBe(true);
    expect(graph.get("arith")?.purpose).toBe("Arithmetic.");
    expect(mutations).toBe(1);
    expect(graphChanges).toBe(1);
  });

  it("tells the agent how to import the module, so it never has to guess a path", async () => {
    const reply = await call("declare_module", { name: "arith", purpose: "Arithmetic." });
    expect(reply).toContain("#arith");
    expect(reply).toContain("index.ts");
    expect(reply).not.toContain("src/modules");
  });

  it("redeclaring updates the purpose and keeps the files", async () => {
    await call("declare_module", { name: "arith", purpose: "First." });
    await call("write_module_file", { module: "arith", file: "index", content: "export const a = 1;\n" });
    const reply = await call("declare_module", { name: "arith", purpose: "Second." });
    expect(reply.toLowerCase()).toContain("updated");
    expect(graph.get("arith")?.files).toEqual(["index.ts"]);
    expect(exists("src/modules/arith/index.ts")).toBe(true);
  });

  it("refuses an empty purpose", async () => {
    expect(await refusal("declare_module", { name: "arith", purpose: "   " })).toContain("purpose");
  });

  it("refuses a name that is a path or reserved", async () => {
    expect(await refusal("declare_module", { name: "../etc", purpose: "x" })).toBeTruthy();
    expect(await refusal("declare_module", { name: "acceptance", purpose: "x" })).toBeTruthy();
    expect(exists("src/modules/acceptance")).toBe(false);
  });

  it("list_modules shows purpose, files, tests and the import name", async () => {
    await call("declare_module", { name: "arith", purpose: "Arithmetic." });
    await call("write_module_file", { module: "arith", file: "index", content: "" });
    await call("write_module_test", { module: "arith", file: "index", content: "" });
    const listing = await call("list_modules");
    expect(listing).toContain("arith");
    expect(listing).toContain("Arithmetic.");
    expect(listing).toContain("index.ts");
    expect(listing).toContain("index.test.ts");
    expect(listing).toContain("#arith");
  });

  it("list_modules says when there are none", async () => {
    expect((await call("list_modules")).toLowerCase()).toContain("no modules");
  });
});

describe("module files", () => {
  beforeEach(async () => {
    await call("declare_module", { name: "arith", purpose: "Arithmetic." });
    checker.calls = [];
  });

  it("write_module_file writes under the module and records it in the graph", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "export const h = 1;\n" });
    expect(read("src/modules/arith/helper.ts")).toBe("export const h = 1;\n");
    expect(graph.get("arith")?.files).toEqual(["helper.ts"]);
  });

  it("treats x, x.ts and x.js as the same file", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "1" });
    await call("write_module_file", { module: "arith", file: "helper.ts", content: "2" });
    await call("write_module_file", { module: "arith", file: "helper.js", content: "3" });
    expect(fs.readdirSync(path.join(workspace, "src/modules/arith"))).toEqual(["helper.ts"]);
    expect(read("src/modules/arith/helper.ts")).toBe("3");
  });

  it("refuses a test name and names write_module_test", async () => {
    const message = await refusal("write_module_file", { module: "arith", file: "helper.test.ts", content: "" });
    expect(message).toContain("write_module_test");
    expect(exists("src/modules/arith/helper.test.ts")).toBe(false);
  });

  it("refuses an undeclared module and lists the ones that exist", async () => {
    const message = await refusal("write_module_file", { module: "nope", file: "index", content: "" });
    expect(message).toContain("declare_module");
    expect(message).toContain("arith");
    expect(exists("src/modules/nope")).toBe(false);
  });

  it("read_module_file reads what was written", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "hello" });
    expect(await call("read_module_file", { module: "arith", file: "helper.js" })).toBe("hello");
  });

  it("read_module_file says when the file does not exist yet", async () => {
    const message = await refusal("read_module_file", { module: "arith", file: "ghost" });
    expect(message).toContain("ghost.ts");
  });

  it("edit_module_file edits in place", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "const a = 1;\n" });
    await call("edit_module_file", { module: "arith", file: "helper", find: "1", replace: "2" });
    expect(read("src/modules/arith/helper.ts")).toBe("const a = 2;\n");
  });

  it("delete_module_file removes it from disk and from the graph", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "" });
    await call("delete_module_file", { module: "arith", file: "helper" });
    expect(exists("src/modules/arith/helper.ts")).toBe(false);
    expect(graph.get("arith")?.files).toEqual([]);
  });

  it("delete_module_file refuses a file that is not there", async () => {
    expect(await refusal("delete_module_file", { module: "arith", file: "ghost" })).toContain("ghost.ts");
  });
});

describe("module tests are addressed apart from module files", () => {
  beforeEach(async () => {
    await call("declare_module", { name: "arith", purpose: "Arithmetic." });
  });

  it("write_module_test writes x.test.ts whatever the name given", async () => {
    await call("write_module_test", { module: "arith", file: "helper", content: "a" });
    await call("write_module_test", { module: "arith", file: "other.ts", content: "b" });
    await call("write_module_test", { module: "arith", file: "third.test.ts", content: "c" });
    expect(fs.readdirSync(path.join(workspace, "src/modules/arith")).sort()).toEqual([
      "helper.test.ts",
      "other.test.ts",
      "third.test.ts",
    ]);
    expect(graph.get("arith")?.tests).toEqual(["helper.test.ts", "other.test.ts", "third.test.ts"]);
    expect(graph.get("arith")?.files).toEqual([]);
  });

  it("read, edit and delete address the test file, never the implementation", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "impl" });
    await call("write_module_test", { module: "arith", file: "helper", content: "test 1" });
    expect(await call("read_module_test", { module: "arith", file: "helper" })).toBe("test 1");
    await call("edit_module_test", { module: "arith", file: "helper", find: "1", replace: "2" });
    expect(read("src/modules/arith/helper.test.ts")).toBe("test 2");
    expect(read("src/modules/arith/helper.ts")).toBe("impl");
    await call("delete_module_test", { module: "arith", file: "helper" });
    expect(exists("src/modules/arith/helper.test.ts")).toBe(false);
    expect(exists("src/modules/arith/helper.ts")).toBe(true);
  });

  it("delete_module removes the directory and the graph entry", async () => {
    await call("write_module_file", { module: "arith", file: "helper", content: "" });
    graphChanges = 0;
    await call("delete_module", { module: "arith" });
    expect(exists("src/modules/arith")).toBe(false);
    expect(graph.has("arith")).toBe(false);
    expect(graphChanges).toBe(1);
  });
});

describe("verification on demand", () => {
  it("run_acceptance_tests reports the score and the failures", async () => {
    checker.acceptance = {
      total: 3,
      passed: 1,
      failed: 2,
      truncated: 0,
      failures: [{ file: "acceptance/adder.test.ts", name: "add sums", message: "expected -1 to be 5", line: 5 }],
    };
    const report = await call("run_acceptance_tests");
    expect(report).toContain("1/3 passing");
    expect(report).toContain("acceptance/adder.test.ts:5");
    expect(report).toContain("expected -1 to be 5");
  });

  it("run_module_tests reports one module's suite", async () => {
    await call("declare_module", { name: "arith", purpose: "x" });
    checker.moduleTests.set("arith", { total: 2, passed: 2, failed: 0, failures: [], truncated: 0 });
    expect(await call("run_module_tests", { module: "arith" })).toContain("2/2 passing");
  });

  it("run_module_tests says when a module has no tests", async () => {
    await call("declare_module", { name: "arith", purpose: "x" });
    expect(await call("run_module_tests", { module: "arith" })).toContain("no tests");
  });

  it("typecheck reports pass or the diagnostics", async () => {
    expect(await call("typecheck")).toContain("passes");
    checker.typecheckResult = { ok: false, diagnostics: ["src/index.ts(1,1): error TS1: x"] };
    expect(await call("typecheck")).toContain("TS1");
  });
});

describe("the status footer on mutating tools", () => {
  it("rides on every mutating result", async () => {
    const reply = await call("write_entry", { content: "export {};\n" });
    expect(reply).toContain("typecheck: ok");
    expect(reply).toContain("acceptance: 3/3 passing");
  });

  it("runs the checks the harness can run cheaply, and no more", async () => {
    await call("write_entry", { content: "" });
    expect(checker.calls.sort()).toEqual(["acceptance", "typecheck"]);
  });

  it("includes the touched module's tests when a module was written", async () => {
    await call("declare_module", { name: "arith", purpose: "x" });
    checker.moduleTests.set("arith", { total: 4, passed: 3, failed: 1, failures: [], truncated: 0 });
    checker.calls = [];
    const reply = await call("write_module_file", { module: "arith", file: "index", content: "" });
    expect(reply).toContain("arith tests: 3/4 passing");
    expect(checker.calls).toContain("module:arith");
  });

  it("does not run a module's tests after the module was deleted", async () => {
    await call("declare_module", { name: "arith", purpose: "x" });
    checker.calls = [];
    const reply = await call("delete_module", { module: "arith" });
    expect(checker.calls).not.toContain("module:arith");
    expect(reply).toContain("typecheck:");
  });

  it("shows typecheck errors inline, so the agent sees a broken write immediately", async () => {
    checker.typecheckResult = {
      ok: false,
      diagnostics: ["src/index.ts(1,10): error TS2307: Cannot find module '#arith'."],
    };
    const reply = await call("write_entry", { content: "import '#arith';\n" });
    expect(reply).toContain("typecheck: 1 error");
    expect(reply).toContain("TS2307");
  });

  it("is absent from a refused call, which changed nothing", async () => {
    const message = await refusal("write_module_file", { module: "nope", file: "index", content: "" });
    expect(message).not.toContain("typecheck:");
    expect(checker.calls).toEqual([]);
  });

  it("survives a checker that throws, reporting rather than failing the write", async () => {
    checker.typecheck = async () => {
      throw new Error("tsc exploded");
    };
    const reply = await call("write_entry", { content: "export {};\n" });
    expect(read("src/index.ts")).toBe("export {};\n");
    expect(reply.toLowerCase()).toContain("typecheck");
    expect(reply).toContain("tsc exploded");
  });
});
