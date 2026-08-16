/**
 * Purpose: own the mapping from the names the agent uses to the paths trireme
 * writes, and the rules about which names are addressable at all.
 *
 * The agent never sees a path. That is only true if exactly one module turns
 * names into paths, and it is this one. Suffixes are normalised rather than
 * ruled upon, because the agent must write `./x.js` in its own imports anyway
 * and a second, competing convention would be trireme's fault, not the model's.
 */
import { describe, expect, it } from "vitest";
import {
  ENTRY_PATH,
  MODULES_DIR,
  moduleDir,
  moduleFilePath,
  normalizeImplFile,
  normalizeModuleName,
  normalizeTestFile,
  resolveAcceptanceFile,
} from "./layout.ts";

const value = <T>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(`expected success, got: ${r.message}`);
  return r.value;
};
const message = (r: { ok: true; value: unknown } | { ok: false; message: string }): string => {
  if (r.ok) throw new Error("expected a refusal");
  return r.message;
};

describe("implementation file names", () => {
  it("treats a bare name and a .ts name as the same file", () => {
    expect(value(normalizeImplFile("tokenizer"))).toBe("tokenizer.ts");
    expect(value(normalizeImplFile("tokenizer.ts"))).toBe("tokenizer.ts");
  });

  it("accepts the .js name the agent has to write in its own imports", () => {
    expect(value(normalizeImplFile("tokenizer.js"))).toBe("tokenizer.ts");
  });

  it("refuses a test name, and names the tool that was wanted", () => {
    const refusal = message(normalizeImplFile("tokenizer.test.ts"));
    expect(refusal).toContain("write_module_test");
    expect(message(normalizeImplFile("tokenizer.test"))).toContain("write_module_test");
  });

  it("refuses anything shaped like a path", () => {
    expect(message(normalizeImplFile("sub/dir.ts"))).toBeTruthy();
    expect(message(normalizeImplFile("../escape.ts"))).toBeTruthy();
    expect(message(normalizeImplFile("/abs.ts"))).toBeTruthy();
    expect(message(normalizeImplFile("a\\b.ts"))).toBeTruthy();
  });

  it("refuses an empty name", () => {
    expect(message(normalizeImplFile(""))).toBeTruthy();
    expect(message(normalizeImplFile("   "))).toBeTruthy();
    expect(message(normalizeImplFile(".ts"))).toBeTruthy();
  });
});

describe("test file names", () => {
  it("accepts the bare name, the .ts name and the .test.ts name alike", () => {
    expect(value(normalizeTestFile("tokenizer"))).toBe("tokenizer.test.ts");
    expect(value(normalizeTestFile("tokenizer.ts"))).toBe("tokenizer.test.ts");
    expect(value(normalizeTestFile("tokenizer.test.ts"))).toBe("tokenizer.test.ts");
    expect(value(normalizeTestFile("tokenizer.test"))).toBe("tokenizer.test.ts");
  });

  it("refuses a path here too", () => {
    expect(message(normalizeTestFile("sub/dir"))).toBeTruthy();
  });
});

describe("module names", () => {
  it("accepts a plain name", () => {
    expect(value(normalizeModuleName("tokenizer"))).toBe("tokenizer");
    expect(value(normalizeModuleName("range-set"))).toBe("range-set");
  });

  it("trims surrounding whitespace", () => {
    expect(value(normalizeModuleName("  tokenizer "))).toBe("tokenizer");
  });

  it("refuses names that could address something else", () => {
    expect(message(normalizeModuleName(".."))).toBeTruthy();
    expect(message(normalizeModuleName("a/b"))).toBeTruthy();
    expect(message(normalizeModuleName(""))).toBeTruthy();
    expect(message(normalizeModuleName("-leading"))).toBeTruthy();
  });

  it("refuses a name that would collide with the acceptance suite's directory", () => {
    expect(message(normalizeModuleName("acceptance"))).toBeTruthy();
  });
});

describe("paths", () => {
  it("puts a module in its own directory under the modules root", () => {
    expect(moduleDir("tokenizer")).toBe(`${MODULES_DIR}/tokenizer`);
    expect(moduleFilePath("tokenizer", "index.ts")).toBe(`${MODULES_DIR}/tokenizer/index.ts`);
  });

  it("keeps the entry point where the scaffold put it", () => {
    expect(ENTRY_PATH).toBe("src/index.ts");
  });
});

describe("acceptance test names", () => {
  const available = ["parse.test.ts", "ranges.test.ts"];

  it("resolves an exact name", () => {
    expect(value(resolveAcceptanceFile("parse.test.ts", available))).toBe("parse.test.ts");
  });

  it("resolves a name the agent shortened", () => {
    expect(value(resolveAcceptanceFile("parse", available))).toBe("parse.test.ts");
    expect(value(resolveAcceptanceFile("parse.ts", available))).toBe("parse.test.ts");
  });

  it("lists what is there when the name matches nothing", () => {
    const refusal = message(resolveAcceptanceFile("nope", available));
    expect(refusal).toContain("parse.test.ts");
    expect(refusal).toContain("ranges.test.ts");
  });

  it("refuses a path even when it would resolve", () => {
    expect(message(resolveAcceptanceFile("../../etc/passwd", available))).toBeTruthy();
  });
});
