#!/usr/bin/env node
/**
 * Generates es5-interpreter's acceptance suite.
 *
 * The job under test exports `run(source: string)`: it parses ES5 source *and*
 * evaluates it, reporting what the program observably did — the lines it
 * `print`ed and the name of any exception that escaped (a parse failure is
 * reported as `"SyntaxError"`). Source in, observable behaviour out; the
 * package owns the whole pipeline (this is the es5-parser and es5-evaluator
 * rungs in one build), so the tests pass plain source strings.
 *
 * Two producers:
 *   - VALID programs: authored as ES5 source that acorn accepts at
 *     `ecmaVersion: 5`; the expected `{output, error}` is what Node produces
 *     running the same source in a fresh `vm` with a capturing `print`. Because
 *     the program is genuine ES5, Node (modern V8) runs it identically.
 *   - INVALID programs: source acorn *rejects* at `ecmaVersion: 5`; the
 *     expected result is `{ output: [], error: "SyntaxError" }`, regardless of
 *     what a newer engine would do with it (a real ES5 implementation must
 *     reject `let`, arrow functions and the rest).
 *
 *     node bench/es5-interpreter/generate.ts            # regenerate
 *     node bench/es5-interpreter/generate.ts --check    # verify acceptance/ is up to date
 *
 * Guards: a VALID program must parse at ecmaVersion 5 and stay inside the ES5
 * global set the spec lists (so the vm can never enshrine an out-of-scope
 * behaviour); an INVALID program must be rejected at ecmaVersion 5, and those
 * marked `modernOnly` must parse at acorn's latest version (so "rejects later
 * syntax" cases are real syntax, not garbage); the deterministic and
 * function-source guards from the evaluator rung apply; no source is listed
 * twice; every file stays under the harness read limit.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as acorn from "acorn";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "acceptance");
const PACKAGE = "es5-interpreter";
const ACORN_VERSION: string = (acorn as unknown as { version: string }).version;
const READ_LIMIT = 80_000;

type EvalResult = { output: string[]; error: string | null };
const problems: string[] = [];

function toStr(value: unknown): string {
  return typeof value === "symbol" ? (value as symbol).toString() : String(value);
}

function oracle(source: string): EvalResult {
  const output: string[] = [];
  const sandbox = { print: (...args: unknown[]) => output.push(args.map(toStr).join(" ")) };
  try {
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    return { output, error: null };
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      problems.push(`${JSON.stringify(source)}: did not terminate within the oracle's 2s budget`);
    }
    const thrown = error as { name?: unknown };
    const name = error && typeof error === "object" && typeof thrown.name === "string" ? thrown.name : toStr(error);
    return { output, error: name };
  }
}

function parsesAtEs5(source: string): boolean {
  try {
    acorn.parse(source, { ecmaVersion: 5, sourceType: "script" });
    return true;
  } catch {
    return false;
  }
}

function parsesAtLatest(source: string): boolean {
  try {
    acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
    return true;
  } catch {
    return false;
  }
}

function es5Tree(source: string): unknown {
  return acorn.parse(source, { ecmaVersion: 5, sourceType: "script" });
}

const OUT_OF_SCOPE = new Set([
  "Date", "JSON", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "Proxy", "Reflect",
  "console", "escape", "unescape", "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
  "Buffer", "ArrayBuffer", "Int8Array", "Uint8Array", "Float64Array", "Int32Array", "Uint32Array",
  "Intl", "globalThis", "process", "require", "setTimeout", "setInterval", "eval", "structuredClone", "queueMicrotask",
]);

function checkInScope(source: string, ast: unknown): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "Identifier" && typeof n.name === "string" && OUT_OF_SCOPE.has(n.name)) {
      problems.push(`${JSON.stringify(source)}: uses \`${n.name}\`, which is outside the ES5 subset the spec lists`);
    }
    if (n.type === "Literal" && "regex" in n) {
      problems.push(`${JSON.stringify(source)}: contains a regular-expression literal, which is out of scope`);
    }
    if (/\bMath\s*\.\s*random\b/.test(source)) {
      problems.push(`${JSON.stringify(source)}: uses Math.random (nondeterministic)`);
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(ast);
}

function checkResult(source: string, result: EvalResult): void {
  for (const s of [...result.output, result.error ?? ""]) {
    if (/function\s*\(|=>|\[native code\]/.test(s)) {
      problems.push(`${JSON.stringify(source)}: expected output contains a function's source text or a native-code marker`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

type Group = { title: string; programs: string[] };
type ErrorGroup = { title: string; programs: string[]; modernOnly?: boolean };

// The valid-evaluation corpus is the es5-evaluator rung's programs, fed as
// source rather than as trees. Loaded from a sibling JSON the generator writes
// (see below) so the two rungs cannot drift.
const CORPUS: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(HERE, "corpus.json"), "utf8"));

// Programs where the *parse* is the hard part — ASI, comments, literal edge
// cases — each printing something so evaluation observes the result.
const PARSING: Group[] = [
  { title: "automatic semicolon insertion", programs: [
    "var a = 1\nvar b = 2\nprint(a + b)", "var x = 1\n++x\nprint(x)", "var a = 1; var b = 2\nprint(a\n+ b)", "function f(){ return\n1 } print(f())",
    "var x = 5\nprint(x)\n", "var a = 1, b = 2\nprint(a, b)", "var i = 0\nwhile (i < 3) { print(i); i++ }", "var x = 1\n;print(x)",
    "print(1)\nprint(2)\nprint(3)", "var o = { a: 1 }\nprint(o.a)", "do print(\"once\"); while (false)",
  ] },
  { title: "comments are skipped", programs: [
    "// a line comment\nprint(1)", "print(1) // trailing\nprint(2)", "/* block */ print(3)", "print(/* inline */ 4)", "/* multi\n line\n comment */ print(5)",
    "var x = 1 /* c */ + 2; print(x)", "// only a comment\n", "print(6) /* end */", "var a = 1;// no space\nprint(a)", "/**\n * doc\n */\nfunction f(){ return 7 } print(f())",
  ] },
  { title: "literal lexing: numbers, strings, escapes", programs: [
    "print(0xff, 0XA, 010, 0.5, .25, 5., 1e3, 1E-2, 2e+3)", "print(08, 09, 08 + 1)", "print(0, 00, 000)", "print(\"tab\\there\", \"new\\nline\".length)", "print('single', \"double\")", "print(\"quote\\\"inside\")",
    "print(\"unicode\\u0041\", \"hex\\x42\")", "print(\"\\\\\", \"back\\\\slash\")", "print(\"line \\\ncontinuation\")", "print(100000000000000000000)", "print(\"a\" + \"\\n\" + \"b\")",
    "print(\"\\t\\r\\n\".length)", "print('\\'', \"\\\"\")",
  ] },
  { title: "operator lexing that needs the maximal-munch rule", programs: [
    "var a = 1; print(a++ + 2)", "var a = 5; print(a>>>1)", "print(1<<2>>1)", "print(!!(1<=2))", "print(-1- -1)", "var x = 10; x-=3; x+=1; print(x)",
    "print(1===1, 1!==2, 1==1, 1!=2)", "var a = true; print(a?1:2)", "print(1<2?3:4)", "print(5%2, 5&3, 5|2, 5^1)", "var a = 2; a*=3; a/=2; print(a)", "print(1&&2||0)",
  ] },
  { title: "reserved words are allowed as property names (ES5)", programs: [
    "var o = { if: 1, function: 2, return: 3 }; print(o.if, o.function, o[\"return\"])", "var o = {}; o.class = \"c\"; o.new = \"n\"; print(o.class, o.new)",
    "var o = { in: 1, typeof: 2, delete: 3, void: 4 }; print(o.in + o.typeof + o.delete + o.void)", "var o = { \"true\": 1 }; print(o.true, o[\"true\"])", "var o = { get: 5, set: 6 }; print(o.get, o.set)",
  ] },
  { title: "the top-level scope is the global object", programs: [
    "var g = 10; function h(){ return this.g } print(h())", "var flag = 5; print(this.flag)", "this.z = 3; print(z)", "w = 7; print(this.w)", "var x = 1; function f(){ return this } print(f().x)",
  ] },
];

// Source a real ES5 implementation must reject as SyntaxError. `modernOnly`
// groups are valid at acorn's latest version (real later syntax), not garbage.
const SYNTAX_ERRORS: ErrorGroup[] = [
  { title: "ECMAScript 2015 and later syntax is not ES5", modernOnly: true, programs: [
    "let x = 1", "const x = 1", "var f = (x) => x", "var f = () => { return 1 }", "class C {}", "print(`template`)", "function* g(){}", "var [a, b] = [1, 2]", "var { a } = { a: 1 }",
    "for (var x of [1, 2]) print(x)", "var o = { m(){} }", "var o = { [k]: 1 }", "function f(a = 1){ return a }", "function f(...args){ return args }", "print(1 ** 2)", "var x = 0b101", "var x = 0o17",
    "var s = \"a\"; print(s?.length)", "var x = a ?? b", "async function f(){}", "print({ ...o })", "for (let i = 0; i < 1; i++) print(i)",
  ] },
  { title: "malformed source is a SyntaxError", programs: [
    "var =", "print(", "function (){}", "if (", "print(1", "var x = ;", "1 +", "for (;;", "print(1 2)", "}", "){", "var 1x = 1", "a b c", "print(1))", "if) print(1)", "var x = { a: }",
    "return 1", "break", "continue", "print('unterminated", "var x = 0x", "function f(1){}", "var a = [1, 2", "switch (x) { case }", "try {}", "do print(1)", "while", "print(1); )(",
    "throw\n1", "{ a: 1, b: 2 }", "var 08 = 1", "print(1 +)", "a.", "new", "delete", "var x = 1 = 2",
  ] },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function str(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function flat(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  throw new Error(`cannot render ${typeof value}`);
}

function renderResult(result: EvalResult): string {
  return `{ output: ${flat(result.output)}, error: ${result.error === null ? "null" : str(result.error)} }`;
}

const HEADER = `// Generated by generate.ts (ES5-validated with acorn ${ACORN_VERSION}; results from Node's vm); do not edit by hand.\n`;

const seen = new Set<string>();

function emitValid(name: string, groups: Group[]): { content: string; count: number } {
  const lines = [HEADER, 'import { describe, expect, it } from "vitest";', `import { run } from "${PACKAGE}";`, ""];
  let count = 0;
  for (const group of groups) {
    lines.push(`describe(${str(group.title)}, () => {`);
    lines.push("  const cases: Array<[string, { output: string[]; error: string | null }]> = [");
    for (const source of group.programs) {
      if (seen.has(source)) { problems.push(`${JSON.stringify(source)} listed twice`); continue; }
      seen.add(source);
      if (!parsesAtEs5(source)) { problems.push(`${name}: ${JSON.stringify(source)} does not parse at ecmaVersion 5`); continue; }
      checkInScope(source, es5Tree(source));
      const result = oracle(source);
      checkResult(source, result);
      count++;
      lines.push(`    [${str(source)}, ${renderResult(result)}],`);
    }
    lines.push("  ];");
    lines.push('  it.each(cases)("%s", (source, expected) => {');
    lines.push("    expect(run(source)).toEqual(expected);");
    lines.push("  });");
    lines.push("});");
    lines.push("");
  }
  return { content: lines.join("\n"), count };
}

function emitErrors(groups: ErrorGroup[]): { content: string; count: number } {
  const lines = [HEADER, 'import { describe, expect, it } from "vitest";', `import { run } from "${PACKAGE}";`, ""];
  let count = 0;
  for (const group of groups) {
    lines.push(`describe(${str(group.title)}, () => {`);
    lines.push("  const cases: string[] = [");
    for (const source of group.programs) {
      if (seen.has(source)) { problems.push(`${JSON.stringify(source)} listed twice`); continue; }
      seen.add(source);
      if (parsesAtEs5(source)) { problems.push(`errors: ${JSON.stringify(source)} parses at ecmaVersion 5 but is listed as invalid`); continue; }
      if (group.modernOnly && !parsesAtLatest(source)) { problems.push(`errors: ${JSON.stringify(source)} is not valid at acorn's latest version either`); continue; }
      count++;
      lines.push(`    ${str(source)},`);
    }
    lines.push("  ];");
    lines.push('  it.each(cases)("run(%j) reports SyntaxError", (source) => {');
    lines.push('    expect(run(source)).toEqual({ output: [], error: "SyntaxError" });');
    lines.push("  });");
    lines.push("});");
    lines.push("");
  }
  return { content: lines.join("\n"), count };
}

function corpusFiles(): Record<string, Group[]> {
  // Rebuild the evaluator rung's file grouping from the flat corpus map, so
  // each file stays a coherent topic and under the read limit.
  const byFile: Record<string, Group[]> = {};
  const titles = Object.keys(CORPUS);
  // Chunk the corpus into files of at most ~40 programs, keeping groups whole.
  let file = 1;
  let inThis = 0;
  for (const title of titles) {
    const key = `eval-${String(file).padStart(2, "0")}`;
    (byFile[key] ??= []).push({ title, programs: CORPUS[title]! });
    inThis += CORPUS[title]!.length;
    if (inThis >= 60) { file++; inThis = 0; }
  }
  return byFile;
}

function generate(): { files: Record<string, string>; total: number } {
  seen.clear();
  problems.length = 0;
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, groups] of Object.entries(corpusFiles())) {
    const { content, count } = emitValid(name, groups);
    files[`${name}.test.ts`] = content;
    total += count;
  }
  const parsing = emitValid("parsing", PARSING);
  files["parsing.test.ts"] = parsing.content;
  total += parsing.count;
  const errors = emitErrors(SYNTAX_ERRORS);
  files["syntax-errors.test.ts"] = errors.content;
  total += errors.count;
  return { files, total };
}

function main(argv: string[]): number {
  const { files, total } = generate();
  const largest = Math.max(...Object.values(files).map((f) => f.length));
  for (const [n, f] of Object.entries(files)) {
    if (f.length > READ_LIMIT) problems.push(`${n} is ${f.length} chars, over the ${READ_LIMIT} read limit — split it`);
  }
  if (problems.length) throw new Error(`case problems:\n  ${problems.join("\n  ")}`);
  if (argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([n, c]) => !fs.existsSync(path.join(OUT, n)) || fs.readFileSync(path.join(OUT, n), "utf8") !== c)
      .map(([n]) => n);
    const strays = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((n) => n.endsWith(".test.ts") && !(n in files)) : [];
    const issues = [...stale, ...strays.map((s) => `${s} (stray)`)];
    console.log(`${total} programs; ${issues.length ? "STALE: " + issues.join(", ") : "up to date"}`);
    return issues.length ? 1 : 0;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const stray of fs.readdirSync(OUT)) {
    if (stray.endsWith(".test.ts") && !(stray in files)) fs.unlinkSync(path.join(OUT, stray));
  }
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote ${Object.keys(files).length} files, ${total} programs, largest ${largest} chars, oracle: node vm + acorn ${ACORN_VERSION}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
