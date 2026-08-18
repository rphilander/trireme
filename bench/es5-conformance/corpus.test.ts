import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectCases, collectTree, harnessOf } from "./corpus.ts";

// A miniature Test262 checkout on disk, exercising the walk end to end:
// harness files, nesting, an out-of-scope file, a fixture, and a negative.
let root: string;

function write(rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function test262File(frontmatter: string, body: string): string {
  return `// Copyright.\n// BSD license.\n\n/*---\n${frontmatter}\n---*/\n\n${body}`;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "t262-fixture-"));
  write("harness/sta.js", "function Test262Error(m){ this.message = m }\n");
  write("harness/assert.js", "function assert(x){ if (!x) throw new Test262Error('no') }\n");
  write("harness/compareArray.js", "function compareArray(a, b){ return true }\n");

  // language/statements/if: two in-scope positives and one fixture
  write("test/language/statements/if/S12.5_A1.js", test262File("es5id: 12.5_A1", "if (true) { var x = 1; }\n"));
  write("test/language/statements/if/S12.5_A2.js", test262File("es5id: 12.5_A2", "if (false) {} else { var y = 2; }\n"));
  write("test/language/statements/if/helper_FIXTURE.js", "not a test\n");
  // nested: a negative parse case
  write(
    "test/language/statements/for/deep/S12.6_neg.js",
    test262File("es5id: 12.6_neg\nnegative:\n  phase: parse\n  type: SyntaxError", "for (;;\n"),
  );
  // out of scope: features tag
  write("test/language/statements/if/modern.js", test262File("es5id: 12.5_A9\nfeatures: [Symbol]", "1;\n"));
  // out of scope: uses eval
  write("test/language/statements/if/uses-eval.js", test262File("es5id: 12.5_A8", "eval('1');\n"));
  // out of scope: raw flag
  write("test/language/statements/if/raw.js", test262File("es5id: 12.5_A7\nflags: [raw]", "1;\n"));
  // an include is inlined before the body
  write(
    "test/language/statements/if/with-include.js",
    test262File("es5id: 12.5_A3\nincludes: [compareArray.js]", "assert(compareArray([1], [1]));\n"),
  );
  // boundary-A style flat chapter for collectCases
  write("test/language/expressions/addition/S11.6.1_A1.js", test262File("es5id: 11.6.1_A1", "assert(1 + 1 === 2);\n"));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("harnessOf", () => {
  it("is sta.js then assert.js", () => {
    expect(harnessOf(root)).toBe(
      "function Test262Error(m){ this.message = m }\n\nfunction assert(x){ if (!x) throw new Test262Error('no') }\n\n",
    );
  });
});

describe("collectTree", () => {
  it("walks recursively and names chapters by path relative to test/", () => {
    const cases = collectTree(root, "language/statements");
    const ids = cases.map((c) => c.id);
    expect(ids).toContain("language/statements/if/S12.5_A1");
    expect(ids).toContain("language/statements/for/deep/S12.6_neg");
    const c = cases.find((x) => x.id === "language/statements/if/S12.5_A1");
    expect(c?.chapter).toBe("language/statements/if");
  });

  it("skips fixtures, features, eval users, and raw-flagged tests", () => {
    const ids = collectTree(root, "language/statements").map((c) => c.id);
    expect(ids.join()).not.toContain("FIXTURE");
    expect(ids.join()).not.toContain("modern");
    expect(ids.join()).not.toContain("uses-eval");
    expect(ids.join()).not.toContain("raw");
  });

  it("carries a negative's expected error and phase", () => {
    const neg = collectTree(root, "language/statements").find((c) => c.id.endsWith("S12.6_neg"));
    expect(neg?.expected).toBe("SyntaxError");
    expect(neg?.phase).toBe("parse");
  });

  it("inlines a case's extra includes before its body", () => {
    const c = collectTree(root, "language/statements").find((c) => c.id.endsWith("with-include"));
    expect(c?.body.startsWith("function compareArray")).toBe(true);
    expect(c?.body).toContain("assert(compareArray([1], [1]));");
  });

  it("returns [] for a missing root", () => {
    expect(collectTree(root, "language/no-such-dir")).toEqual([]);
  });

  it("covers the whole language tree from its root", () => {
    const ids = collectTree(root, "language").map((c) => c.id);
    expect(ids).toContain("language/statements/if/S12.5_A1");
    expect(ids).toContain("language/expressions/addition/S11.6.1_A1");
  });
});

describe("collectCases (boundary A naming is unchanged)", () => {
  it("keeps flat chapter names and ids", () => {
    const cases = collectCases(root, ["addition"]);
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe("addition/S11.6.1_A1");
    expect(cases[0].chapter).toBe("addition");
  });
});
