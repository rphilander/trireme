#!/usr/bin/env node
/**
 * Generates the es5-conformance acceptance suite from a pinned Test262 checkout.
 *
 * Boundary A of the Test262 axis: the ES5, in-scope, sloppy tests under
 * `language/expressions` for the arithmetic (`+ - * / %`), relational
 * (`< <= > >=`) and equality (`== != === !==`) operators. Each Test262 test is
 * self-checking — it runs a small assertion library (`sta.js` + `assert.js`)
 * plus a body that throws on a wrong result — so there is no external oracle:
 * a case passes iff `run(assembled).error === null`.
 *
 * What is emitted:
 *   - `acceptance/support/harness.ts` — the shared `sta.js` + `assert.js`
 *     prelude as one exported string (`HARNESS`), imported by every test file.
 *   - `acceptance/<chapter>[-N].test.ts` — the per-test bodies inlined as string
 *     literals, each case `[id, body, expected]`; the suite asserts
 *     `run(HARNESS + body).error === expected` (null for the positive cases).
 * The bodies are kept verbatim except for the leading BSD-license comment and
 * the `/*--- ---*\/` YAML frontmatter, which are inert and stripped to save room.
 *
 * How each case is vetted at generation (so the committed suite is known-good):
 *   - positive: parses at acorn `ecmaVersion: 5` AND runs to completion under a
 *     reference engine (Node `vm`) without throwing;
 *   - negative parse: acorn *rejects* it at ecmaVersion 5 (that is the
 *     `SyntaxError`);
 *   - negative runtime: parses at ES5 and the reference throws the named error.
 * A case that fails its vet aborts generation rather than being emitted.
 *
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/generate.ts
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/generate.ts --check
 *
 * Regeneration needs a Test262 checkout at pin PIN below; running the benchmark
 * needs only the committed `acceptance/` (the bodies travel inlined).
 */
import * as acorn from "acorn";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { CHAPTERS_A, LIVENESS, parsesAtEs5, SENTINEL, type Case } from "./test262.ts";
import { collectCases, harnessOf } from "./corpus.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "acceptance");
const PACKAGE = "es5-conformance";
const PIN = "3655e7464de3d52643ecddd4b5f9f4f3e7f62398";
const READ_LIMIT = 80_000;
const CAP = 68_000; // per test-file inlined budget, with headroom under READ_LIMIT
const ACORN_VERSION: string = (acorn as unknown as { version: string }).version;

const problems: string[] = [];

const TEST262_DIR = process.env.TEST262_DIR ?? "";

function requireCheckoutAtPin(): void {
  if (!TEST262_DIR) throw new Error("set TEST262_DIR to a Test262 checkout at pin " + PIN.slice(0, 8));
  if (!fs.existsSync(path.join(TEST262_DIR, "harness", "sta.js"))) throw new Error(`no Test262 checkout at ${TEST262_DIR}`);
  let head = "";
  try { head = execSync("git rev-parse HEAD", { cwd: TEST262_DIR }).toString().trim(); } catch { /* not a git checkout */ }
  if (head && head !== PIN) throw new Error(`Test262 checkout is at ${head.slice(0, 8)}, expected pin ${PIN.slice(0, 8)}`);
}

function harnessString(): string { return harnessOf(TEST262_DIR); }

// Reference engine: run assembled source in a fresh vm, capturing print output
// and what escaped — the same observable model the interpreter must produce.
function referenceRun(assembled: string): { error: string | null; output: string[] } {
  const output: string[] = [];
  const sandbox: Record<string, unknown> = { print: (...a: unknown[]) => output.push(a.map((x) => String(x)).join(" ")) };
  try {
    vm.runInNewContext(assembled, sandbox, { timeout: 5000 });
    return { error: null, output };
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      problems.push("a case did not terminate within the reference's 5s budget");
    }
    const thrown = error as { name?: unknown };
    return { error: error && typeof error === "object" && typeof thrown.name === "string" ? thrown.name : String(error), output };
  }
}

// Vet what the acceptance suite actually runs: HARNESS + body (+ LIVENESS for
// positives). A positive must run to completion under the reference AND emit
// the sentinel; a negative must fail exactly as its phase declares. This is the
// gate that keeps a non-conforming or post-ES5 case out of the committed suite.
function vet(c: Case, harness: string): void {
  if (c.expected === null) {
    const assembled = harness + c.body + LIVENESS;
    if (!parsesAtEs5(assembled)) { problems.push(`${c.id}: positive case does not parse at ES5`); return; }
    const r = referenceRun(assembled);
    if (r.error !== null) problems.push(`${c.id}: positive case threw under the reference engine: ${r.error}`);
    else if (r.output[r.output.length - 1] !== SENTINEL) problems.push(`${c.id}: liveness sentinel not observed under the reference`);
  } else if (c.phase === "parse") {
    if (parsesAtEs5(harness + c.body)) problems.push(`${c.id}: negative-parse case parses at ES5, so it is not a SyntaxError`);
  } else {
    if (!parsesAtEs5(harness + c.body)) { problems.push(`${c.id}: negative-runtime case does not parse at ES5`); return; }
    const err = referenceRun(harness + c.body).error;
    if (err !== c.expected) problems.push(`${c.id}: negative-runtime case threw ${err}, expected ${c.expected}`);
  }
}

function collect(): Case[] {
  const cases = collectCases(TEST262_DIR, CHAPTERS_A);
  const harness = harnessString();
  for (const c of cases) vet(c, harness);
  return cases;
}

// ASCII-only string literal, matching the es5-interpreter generator's escaping.
function str(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

const HEADER = `// Generated by generate.ts from Test262 @ ${PIN.slice(0, 8)} (harness ${"sta.js+assert.js"}); do not edit by hand.\n`;

function emitHarness(): string {
  return [
    HEADER,
    "// The shared Test262 assertion library (sta.js + assert.js), prepended to every case.",
    `export const HARNESS = ${str(harnessString())};`,
    "",
    "// Appended after a positive body: the case passes only if the program runs all",
    "// the way here and prints the sentinel, which a no-op interpreter cannot do.",
    `export const SENTINEL = ${str(SENTINEL)};`,
    `export const LIVENESS = ${str(LIVENESS)};`,
    "",
  ].join("\n");
}

function emitTestFile(chapter: string, cases: Case[]): string {
  const lines: string[] = [HEADER];
  lines.push('import { describe, expect, it } from "vitest";');
  lines.push(`import { run } from "${PACKAGE}";`);
  lines.push('import { HARNESS, LIVENESS, SENTINEL } from "./support/harness.js";');
  lines.push("");
  lines.push(`describe(${str("language/expressions/" + chapter)}, () => {`);
  lines.push("  const cases: Array<[string, string, string | null]> = [");
  for (const c of cases) lines.push(`    [${str(c.id)}, ${str(c.body)}, ${c.expected === null ? "null" : str(c.expected)}],`);
  lines.push("  ];");
  lines.push('  it.each(cases)("%s", (_id, body, expected) => {');
  lines.push("    if (expected === null) {");
  lines.push("      const result = run(HARNESS + body + LIVENESS);");
  lines.push("      expect(result.error).toBe(null);");
  lines.push("      expect(result.output[result.output.length - 1]).toBe(SENTINEL);");
  lines.push("    } else {");
  lines.push("      expect(run(HARNESS + body).error).toBe(expected);");
  lines.push("    }");
  lines.push("  });");
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

// Bin-pack a chapter's cases into files each under CAP rendered chars.
function filesForChapter(chapter: string, cases: Case[]): Array<[string, string]> {
  const bins: Case[][] = [[]];
  const render = (cs: Case[]) => emitTestFile(chapter, cs);
  for (const c of cases) {
    const bin = bins[bins.length - 1];
    bin.push(c);
    if (render(bin).length > CAP && bin.length > 1) { bin.pop(); bins.push([c]); }
  }
  return bins.map((cs, i) => [`${chapter}${bins.length > 1 ? `-${i + 1}` : ""}.test.ts`, render(cs)] as [string, string]);
}

function generate(): { files: Record<string, string>; total: number } {
  const cases = collect();
  const byChapter = new Map<string, Case[]>();
  for (const c of cases) (byChapter.get(c.chapter) ?? byChapter.set(c.chapter, []).get(c.chapter)!).push(c);
  const files: Record<string, string> = { "support/harness.ts": emitHarness() };
  for (const chapter of CHAPTERS_A) {
    const cs = byChapter.get(chapter);
    if (!cs || !cs.length) continue;
    for (const [name, content] of filesForChapter(chapter, cs)) files[name] = content;
  }
  return { files, total: cases.length };
}

function main(argv: string[]): number {
  requireCheckoutAtPin();
  const { files, total } = generate();
  for (const [n, f] of Object.entries(files)) {
    if (n.endsWith(".test.ts") && f.length > READ_LIMIT) problems.push(`${n} is ${f.length} chars, over the ${READ_LIMIT} read limit — lower CAP`);
  }
  if (problems.length) throw new Error(`case problems (${problems.length}):\n  ${problems.slice(0, 40).join("\n  ")}`);

  const rel = (n: string) => path.join(OUT, n);
  const isGen = (n: string) => n.endsWith(".test.ts") || n === "support/harness.ts";
  if (argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([n, c]) => !fs.existsSync(rel(n)) || fs.readFileSync(rel(n), "utf8") !== c)
      .map(([n]) => n);
    const present = fs.existsSync(OUT)
      ? [...fs.readdirSync(OUT), ...(fs.existsSync(path.join(OUT, "support")) ? fs.readdirSync(path.join(OUT, "support")).map((s) => "support/" + s) : [])]
      : [];
    const strays = present.filter((n) => isGen(n) && !(n in files));
    const issues = [...stale, ...strays.map((s) => `${s} (stray)`)];
    console.log(`${total} cases; ${issues.length ? "STALE: " + issues.join(", ") : "up to date"}`);
    return issues.length ? 1 : 0;
  }

  fs.mkdirSync(path.join(OUT, "support"), { recursive: true });
  const present = [...fs.readdirSync(OUT), ...fs.readdirSync(path.join(OUT, "support")).map((s) => "support/" + s)];
  for (const stray of present) if (isGen(stray) && !(stray in files)) fs.unlinkSync(rel(stray));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(rel(name), content);
  const largest = Math.max(...Object.entries(files).filter(([n]) => n.endsWith(".test.ts")).map(([, f]) => f.length));
  console.log(`wrote ${Object.keys(files).length} files, ${total} cases, largest test ${largest} chars; vetted with node vm + acorn ${ACORN_VERSION} against Test262 @ ${PIN.slice(0, 8)}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
