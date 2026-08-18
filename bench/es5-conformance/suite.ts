/**
 * suite.ts — shared vet + emit machinery for Test262-axis jobs.
 *
 * Every boundary on the axis (es5-conformance, es5-language, …) turns the same
 * kind of case list into the same kind of acceptance suite: vet each case
 * against the reference engine, inline the bodies into `*.test.ts` files under
 * the read limit, and write/`--check` the result byte-reproducibly. Job
 * generators stay thin configs (chapters, grouping, package name); the
 * mechanics live here so boundaries cannot drift from each other.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { errorMatches, LIVENESS, parsesAtEs5, SENTINEL, type Case } from "./test262.ts";

/** Run assembled source in a fresh vm, capturing print output and what escaped. */
export function referenceRun(assembled: string): { error: string | null; output: string[]; timedOut: boolean } {
  const output: string[] = [];
  const sandbox: Record<string, unknown> = { print: (...a: unknown[]) => output.push(a.map((x) => String(x)).join(" ")) };
  try {
    vm.runInNewContext(assembled, sandbox, { timeout: 5000 });
    return { error: null, output, timedOut: false };
  } catch (error) {
    const timedOut = !!(error && typeof error === "object" && (error as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT");
    const thrown = error as { name?: unknown };
    const name = error && typeof error === "object" && typeof thrown.name === "string" ? thrown.name : String(error);
    return { error: name, output, timedOut };
  }
}

/**
 * Vet what the acceptance suite actually runs: HARNESS + body (+ LIVENESS for
 * positives). A positive must run to completion under the reference AND emit
 * the sentinel; a negative must fail exactly as its phase declares. Returns the
 * problems found (empty = the case is sound); a generator aborts on any.
 */
export function vetCase(c: Case, harness: string): string[] {
  const problems: string[] = [];
  if (c.expected === null) {
    const assembled = harness + c.body + LIVENESS;
    if (!parsesAtEs5(assembled)) return [`${c.id}: positive case does not parse at ES5`];
    const r = referenceRun(assembled);
    if (r.timedOut) problems.push(`${c.id}: did not terminate within the reference's 5s budget`);
    if (r.error !== null) problems.push(`${c.id}: positive case threw under the reference engine: ${r.error}`);
    else if (r.output[r.output.length - 1] !== SENTINEL) problems.push(`${c.id}: liveness sentinel not observed under the reference`);
  } else if (c.phase === "parse") {
    if (parsesAtEs5(harness + c.body)) problems.push(`${c.id}: negative-parse case parses at ES5, so it is not a SyntaxError`);
  } else {
    if (!parsesAtEs5(harness + c.body)) return [`${c.id}: negative-runtime case does not parse at ES5`];
    const r = referenceRun(harness + c.body);
    if (r.timedOut) problems.push(`${c.id}: did not terminate within the reference's 5s budget`);
    if (!errorMatches(r.error, c.expected)) problems.push(`${c.id}: negative-runtime case threw ${r.error}, expected ${c.expected}`);
  }
  return problems;
}

/** ASCII-only string literal, matching the es5-interpreter generator's escaping. */
export function str(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** The `acceptance/support/harness.ts` module: harness string + liveness constants. */
export function emitHarnessModule(header: string, harness: string): string {
  return [
    header,
    "// The shared Test262 assertion library (sta.js + assert.js), prepended to every case.",
    `export const HARNESS = ${str(harness)};`,
    "",
    "// Appended after a positive body: the case passes only if the program runs all",
    "// the way here and prints the sentinel, which a no-op interpreter cannot do.",
    `export const SENTINEL = ${str(SENTINEL)};`,
    `export const LIVENESS = ${str(LIVENESS)};`,
    "",
    "// Whether a reported error satisfies a negative case's declared error:",
    '// "SyntaxError" (a parse negative) is contract-exact; any other declared',
    "// error matches on the name part before the first ':' (a thrown Test262Error",
    '// has no `name` property, so ToString gives "Test262Error: <message>").',
    "export function errorMatches(reported: string | null, expected: string): boolean {",
    '  if (expected === "SyntaxError") return reported === "SyntaxError";',
    '  return reported !== null && reported.split(":")[0].trim() === expected;',
    "}",
    "",
  ].join("\n");
}

/** One emitted test file: the cases inlined, judged exactly as `test262.judge`. */
export function emitTestFile(header: string, pkg: string, describeLabel: string, cases: Case[]): string {
  const lines: string[] = [header];
  lines.push('import { describe, expect, it } from "vitest";');
  lines.push(`import { run } from "${pkg}";`);
  lines.push('import { errorMatches, HARNESS, LIVENESS, SENTINEL } from "./support/harness.js";');
  lines.push("");
  lines.push(`describe(${str(describeLabel)}, () => {`);
  lines.push("  const cases: Array<[string, string, string | null]> = [");
  for (const c of cases) lines.push(`    [${str(c.id)}, ${str(c.body)}, ${c.expected === null ? "null" : str(c.expected)}],`);
  lines.push("  ];");
  lines.push('  it.each(cases)("%s", (_id, body, expected) => {');
  lines.push("    if (expected === null) {");
  lines.push("      const result = run(HARNESS + body + LIVENESS);");
  lines.push("      expect(result.error).toBe(null);");
  lines.push("      expect(result.output[result.output.length - 1]).toBe(SENTINEL);");
  lines.push("    } else {");
  lines.push("      const err = run(HARNESS + body).error;");
  lines.push("      expect(errorMatches(err, expected), `expected error \${expected}, got \${err}`).toBe(true);");
  lines.push("    }");
  lines.push("  });");
  lines.push("});");
  lines.push("");
  return lines.join("\n");
}

/** Bin-pack a group's cases into `<base>[-N].test.ts` files each under `cap` chars. */
export function packFiles(
  base: string,
  cases: Case[],
  render: (cs: Case[]) => string,
  cap: number,
): Array<[string, string]> {
  const bins: Case[][] = [[]];
  for (const c of cases) {
    const bin = bins[bins.length - 1];
    bin.push(c);
    if (render(bin).length > cap && bin.length > 1) { bin.pop(); bins.push([c]); }
  }
  return bins.map((cs, i) => [`${base}${bins.length > 1 ? `-${i + 1}` : ""}.test.ts`, render(cs)] as [string, string]);
}

/**
 * Write (or `--check`) an emitted file set under `out`, deleting strays. The
 * shared tail of every generator's `main`. Returns the process exit code.
 */
export function finalize(
  files: Record<string, string>,
  total: number,
  opts: { out: string; readLimit: number; check: boolean; footer: string },
): number {
  for (const [n, f] of Object.entries(files)) {
    if (n.endsWith(".test.ts") && f.length > opts.readLimit) {
      throw new Error(`${n} is ${f.length} chars, over the ${opts.readLimit} read limit — lower the cap`);
    }
  }
  const rel = (n: string) => path.join(opts.out, n);
  const isGen = (n: string) => n.endsWith(".test.ts") || n === "support/harness.ts";
  const listPresent = (): string[] =>
    fs.existsSync(opts.out)
      ? [
          ...fs.readdirSync(opts.out),
          ...(fs.existsSync(path.join(opts.out, "support")) ? fs.readdirSync(path.join(opts.out, "support")).map((s) => "support/" + s) : []),
        ]
      : [];
  if (opts.check) {
    const stale = Object.entries(files)
      .filter(([n, c]) => !fs.existsSync(rel(n)) || fs.readFileSync(rel(n), "utf8") !== c)
      .map(([n]) => n);
    const strays = listPresent().filter((n) => isGen(n) && !(n in files));
    const issues = [...stale, ...strays.map((s) => `${s} (stray)`)];
    console.log(`${total} cases; ${issues.length ? "STALE: " + issues.join(", ") : "up to date"}`);
    return issues.length ? 1 : 0;
  }
  fs.mkdirSync(path.join(opts.out, "support"), { recursive: true });
  for (const stray of listPresent()) if (isGen(stray) && !(stray in files)) fs.unlinkSync(rel(stray));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(rel(name), content);
  const largest = Math.max(...Object.entries(files).filter(([n]) => n.endsWith(".test.ts")).map(([, f]) => f.length));
  console.log(`wrote ${Object.keys(files).length} files, ${total} cases, largest test ${largest} chars; ${opts.footer}`);
  return 0;
}
