import { describe, expect, it } from "vitest";
import {
  assembleHarness, caseBody, CHAPTERS_A, expectedError, inScope, judge,
  KNOWN_INCLUDES, LIVENESS, parseMeta, parsesAtEs5, SENTINEL, stripBody,
  usesOutOfScope, type EvalResult, type Meta,
} from "./test262.ts";

// A realistic Test262 file: BSD license, frontmatter, //CHECK body.
function file(frontmatter: string, body: string): string {
  return `// Copyright 2009 the authors.  All rights reserved.\n// This code is governed by the BSD license found in the LICENSE file.\n\n/*---\n${frontmatter}\n---*/\n\n${body}`;
}

describe("parseMeta", () => {
  it("reads es5id, flags, features, includes", () => {
    const mt = parseMeta(file("es5id: 11.6.1_A1\nflags: [noStrict]\nfeatures: [Symbol]\nincludes: [compareArray.js, sta.js]\ndescription: x", "1 + 1;"));
    expect(mt.es5).toBe(true);
    expect(mt.flags).toEqual(["noStrict"]);
    expect(mt.feats).toEqual(["Symbol"]);
    expect(mt.inc).toEqual(["compareArray.js", "sta.js"]);
    expect(mt.neg).toBe(false);
  });

  it("reads a negative parse test", () => {
    const mt = parseMeta(file("es5id: 1\nnegative:\n  phase: parse\n  type: SyntaxError", "var x = ;"));
    expect(mt.neg).toBe(true);
    expect(mt.phase).toBe("parse");
    expect(mt.type).toBe("SyntaxError");
  });

  it("reads a negative runtime test", () => {
    const mt = parseMeta(file("es5id: 1\nnegative:\n  phase: runtime\n  type: TypeError", "null.x;"));
    expect(mt.phase).toBe("runtime");
    expect(mt.type).toBe("TypeError");
  });

  it("treats a file with no es5id as not-ES5, empty lists", () => {
    const mt = parseMeta(file("esid: sec-addition\ndescription: modern", "1 + 1;"));
    expect(mt.es5).toBe(false);
    expect(mt.flags).toEqual([]);
    expect(mt.inc).toEqual([]);
  });
});

describe("inScope", () => {
  const base: Meta = { flags: [], feats: [], inc: [], neg: false, phase: null, type: null, es5: true };
  const with_ = (o: Partial<Meta>): Meta => ({ ...base, ...o });

  it("accepts a plain ES5 sloppy test", () => expect(inScope(base)).toBe(true));
  it("accepts a known include", () => expect(inScope(with_({ inc: ["compareArray.js"] }))).toBe(true));
  it("rejects a non-ES5 test", () => expect(inScope(with_({ es5: false }))).toBe(false));
  it("rejects module goal", () => expect(inScope(with_({ flags: ["module"] }))).toBe(false));
  it("rejects onlyStrict", () => expect(inScope(with_({ flags: ["onlyStrict"] }))).toBe(false));
  it("rejects async", () => expect(inScope(with_({ flags: ["async"] }))).toBe(false));
  it("rejects a features tag (post-ES5 corner)", () => expect(inScope(with_({ feats: ["generators"] }))).toBe(false));
  it("rejects propertyHelper.js (needs descriptors)", () => expect(inScope(with_({ inc: ["propertyHelper.js"] }))).toBe(false));
  it("rejects an unknown include", () => expect(inScope(with_({ inc: ["mystery.js"] }))).toBe(false));
});

describe("usesOutOfScope", () => {
  it("flags eval(", () => expect(usesOutOfScope("eval('1+1')")).toBe(true));
  it("flags new Function", () => expect(usesOutOfScope("var f = new Function('return 1')")).toBe(true));
  it("flags the Function constructor call", () => expect(usesOutOfScope("Function('return 1')()")).toBe(true));
  it("passes ordinary code", () => expect(usesOutOfScope("var x = evaluate ? 1 : 2; x + functions;")).toBe(false));
});

describe("parsesAtEs5", () => {
  it("accepts ES5", () => expect(parsesAtEs5("var x = 1 + 2; x;")).toBe(true));
  it("rejects let/const", () => expect(parsesAtEs5("let x = 1")).toBe(false));
  it("rejects ES2015 code-point escapes", () => expect(parsesAtEs5('"\\u{10000}"')).toBe(false));
  it("rejects malformed source", () => expect(parsesAtEs5("var x = ;")).toBe(false));
});

describe("stripBody", () => {
  const raw = file("es5id: 1\ndescription: x", "//CHECK#1\nif (1 + 1 !== 2) {\n  throw new Test262Error('bad');\n}\n");
  const body = stripBody(raw);
  it("drops the BSD license comment", () => expect(body).not.toContain("BSD license"));
  it("drops the frontmatter", () => { expect(body).not.toContain("es5id"); expect(body).not.toContain("---"); });
  it("keeps the //CHECK comment and the code", () => {
    expect(body).toContain("//CHECK#1");
    expect(body).toContain("throw new Test262Error('bad')");
  });
  it("starts at the first real line", () => expect(body.startsWith("//CHECK#1")).toBe(true));
});

describe("assembleHarness / caseBody", () => {
  it("joins sta then assert with newlines", () => expect(assembleHarness("STA", "ASSERT")).toBe("STA\nASSERT\n"));
  it("caseBody inlines non-sta/assert includes before the body", () => {
    const src = file("es5id: 1\nincludes: [compareArray.js]", "compareArray([1], [1]);\n");
    const mt = parseMeta(src);
    const out = caseBody(src, mt, (f) => (f === "compareArray.js" ? "FN_compareArray\n" : "?"));
    expect(out.startsWith("FN_compareArray\n")).toBe(true);
    expect(out).toContain("compareArray([1], [1]);");
  });
  it("caseBody with no extra includes is just the body", () => {
    const src = file("es5id: 1\nincludes: [sta.js, assert.js]", "1 + 1;\n");
    const mt = parseMeta(src);
    expect(caseBody(src, mt, () => "SHOULD_NOT_APPEAR")).not.toContain("SHOULD_NOT_APPEAR");
  });
});

describe("expectedError", () => {
  const base: Meta = { flags: [], feats: [], inc: [], neg: false, phase: null, type: null, es5: true };
  it("null for a positive", () => expect(expectedError(base)).toBe(null));
  it("SyntaxError for negative parse", () => expect(expectedError({ ...base, neg: true, phase: "parse", type: "SyntaxError" })).toBe("SyntaxError"));
  it("the type for negative runtime", () => expect(expectedError({ ...base, neg: true, phase: "runtime", type: "TypeError" })).toBe("TypeError"));
});

describe("judge — the acceptance verdict and the no-op guard", () => {
  const H = "HARNESS;\n";
  const BODY = "if (1 + 1 !== 2) { throw 0 }\n";

  it("passes a positive that runs to the sentinel with error null", () => {
    const run = (): EvalResult => ({ output: ["whatever", SENTINEL], error: null });
    expect(judge(run, H, BODY, null)).toBe(true);
  });

  it("FAILS a no-op interpreter that returns error:null without running", () => {
    const noop = (): EvalResult => ({ output: [], error: null });
    expect(judge(noop, H, BODY, null)).toBe(false); // the liveness guard
  });

  it("fails a positive whose last line is not the sentinel", () => {
    const run = (): EvalResult => ({ output: [SENTINEL, "trailing"], error: null });
    expect(judge(run, H, BODY, null)).toBe(false);
  });

  it("fails a positive that threw an assertion error", () => {
    const run = (): EvalResult => ({ output: [], error: "Test262Error: bad" });
    expect(judge(run, H, BODY, null)).toBe(false);
  });

  it("fails when run itself throws at the host level", () => {
    const run = (): EvalResult => { throw new Error("host blew up"); };
    expect(judge(run, H, BODY, null)).toBe(false);
  });

  it("passes a negative that reports the declared error", () => {
    const run = (): EvalResult => ({ output: [], error: "SyntaxError" });
    expect(judge(run, H, "var x = ;", "SyntaxError")).toBe(true);
  });

  it("fails a negative that did not throw", () => {
    const run = (): EvalResult => ({ output: [], error: null });
    expect(judge(run, H, "var x = ;", "SyntaxError")).toBe(false);
  });

  it("appends LIVENESS only to the positive assembly", () => {
    let seen = "";
    const run = (s: string): EvalResult => { seen = s; return { output: [SENTINEL], error: null }; };
    judge(run, H, BODY, null);
    expect(seen).toBe(H + BODY + LIVENESS);
    judge(run, H, BODY, "TypeError"); // negative: no liveness appended
    expect(seen).toBe(H + BODY);
  });
});

describe("constants", () => {
  it("LIVENESS prints the sentinel", () => {
    expect(LIVENESS).toContain(SENTINEL);
    expect(LIVENESS).toContain("print(");
  });
  it("CHAPTERS_A is the 13 boundary-A operator chapters", () => {
    expect(CHAPTERS_A).toHaveLength(13);
    expect(CHAPTERS_A).toContain("addition");
    expect(CHAPTERS_A).toContain("strict-does-not-equals");
  });
  it("KNOWN_INCLUDES excludes propertyHelper.js", () => {
    expect(KNOWN_INCLUDES.has("sta.js")).toBe(true);
    expect(KNOWN_INCLUDES.has("propertyHelper.js")).toBe(false);
  });
});
