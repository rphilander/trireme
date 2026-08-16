/**
 * Purpose: keep the build graph — which modules the agent declared, what each
 * is for, and which files it holds.
 *
 * The graph exists so trireme knows the shape of the work rather than just the
 * bytes on disk: it is what `list_modules` answers from, what a progress metric
 * would read, and what delegation would later hand to a sub-agent.
 */
import { describe, expect, it } from "vitest";
import { BuildGraph } from "./graph.ts";

describe("declaring a module", () => {
  it("records its purpose", () => {
    const graph = new BuildGraph();
    graph.declare("tokenizer", "Splits input into tokens.");
    expect(graph.get("tokenizer")?.purpose).toBe("Splits input into tokens.");
  });

  it("reports whether it created something or updated it", () => {
    const graph = new BuildGraph();
    expect(graph.declare("tokenizer", "First.").created).toBe(true);
    expect(graph.declare("tokenizer", "Revised.").created).toBe(false);
    expect(graph.get("tokenizer")?.purpose).toBe("Revised.");
  });

  it("keeps a redeclared module's files", () => {
    const graph = new BuildGraph();
    graph.declare("tokenizer", "First.");
    graph.addFile("tokenizer", "index.ts");
    graph.declare("tokenizer", "Revised.");
    expect(graph.get("tokenizer")?.files).toEqual(["index.ts"]);
  });
});

describe("files and tests are tracked apart", () => {
  const seeded = () => {
    const graph = new BuildGraph();
    graph.declare("tokenizer", "Splits input.");
    graph.addFile("tokenizer", "index.ts");
    graph.addTest("tokenizer", "index.test.ts");
    return graph;
  };

  it("lists each in its own place", () => {
    const module = seeded().get("tokenizer")!;
    expect(module.files).toEqual(["index.ts"]);
    expect(module.tests).toEqual(["index.test.ts"]);
  });

  it("does not double-count a rewritten file", () => {
    const graph = seeded();
    graph.addFile("tokenizer", "index.ts");
    expect(graph.get("tokenizer")!.files).toEqual(["index.ts"]);
  });

  it("keeps names sorted, so a report does not depend on write order", () => {
    const graph = seeded();
    graph.addFile("tokenizer", "scanner.ts");
    graph.addFile("tokenizer", "helpers.ts");
    expect(graph.get("tokenizer")!.files).toEqual(["helpers.ts", "index.ts", "scanner.ts"]);
  });

  it("forgets a deleted file", () => {
    const graph = seeded();
    graph.removeFile("tokenizer", "index.ts");
    expect(graph.get("tokenizer")!.files).toEqual([]);
    expect(graph.get("tokenizer")!.tests).toEqual(["index.test.ts"]);
  });
});

describe("undeclared modules", () => {
  it("are not there", () => {
    const graph = new BuildGraph();
    expect(graph.has("tokenizer")).toBe(false);
    expect(graph.get("tokenizer")).toBeUndefined();
  });

  it("do not gain files by a write that should have been refused", () => {
    const graph = new BuildGraph();
    expect(() => graph.addFile("tokenizer", "index.ts")).toThrow(/tokenizer/);
  });
});

describe("deleting a module", () => {
  it("removes it and everything it held", () => {
    const graph = new BuildGraph();
    graph.declare("tokenizer", "Splits input.");
    graph.addFile("tokenizer", "index.ts");
    expect(graph.remove("tokenizer")).toBe(true);
    expect(graph.has("tokenizer")).toBe(false);
  });

  it("says so when there was nothing to delete", () => {
    expect(new BuildGraph().remove("tokenizer")).toBe(false);
  });
});

describe("listing", () => {
  it("is sorted by name", () => {
    const graph = new BuildGraph();
    graph.declare("zeta", "Last.");
    graph.declare("alpha", "First.");
    expect(graph.list().map((m) => m.name)).toEqual(["alpha", "zeta"]);
  });

  it("serialises to something a report can carry", () => {
    const graph = new BuildGraph();
    graph.declare("alpha", "First.");
    graph.addFile("alpha", "index.ts");
    expect(JSON.parse(JSON.stringify(graph))).toEqual({
      modules: [{ name: "alpha", purpose: "First.", files: ["index.ts"], tests: [] }],
    });
  });
});
