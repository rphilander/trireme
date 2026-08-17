/**
 * test262.ts — the mechanics of the Test262 conformance axis, in one place.
 *
 * Turning a pinned Test262 checkout into runnable, scored ES5-conformance cases
 * involves a handful of fiddly decisions — which tests are in the ES5 sloppy
 * subset, how a body is assembled with the harness, what "passed" means — and
 * three tools need the *same* answers: `generate.ts` (emits the acceptance
 * suite), `measure.ts` (scores an artifact against a subset) and `holdout.ts`
 * (grades a finished run against held-out chapters). Keeping the logic here,
 * behind unit tests, is what lets the axis grow to new boundaries without each
 * tool drifting from the others.
 *
 * Pure except for acorn: no fs, no vm, no process. The callers own the I/O
 * (reading the checkout, running an artifact); this module owns the decisions.
 *
 * A Test262 test is self-checking — assemble the shared harness (`sta.js` +
 * `assert.js`) plus any `includes:` plus the body, run it, and it *passes* iff
 * nothing throws (the assertions live inside the test). Because a positive test
 * signals success by *not* throwing, `error === null` alone would also pass a
 * no-op interpreter that runs nothing; the liveness sentinel below closes that.
 */
import * as acorn from "acorn";

export type EvalResult = { output: string[]; error: string | null };

// Boundary A of the axis, in emit order: the arithmetic, relational and
// equality operator chapters under `language/expressions`.
export const CHAPTERS_A: readonly string[] = [
  "addition", "subtraction", "multiplication", "division", "modulus",
  "less-than", "less-than-or-equal", "greater-than", "greater-than-or-equal",
  "equals", "does-not-equals", "strict-equals", "strict-does-not-equals",
];

// Harness includes we can assemble; anything else — notably `propertyHelper.js`,
// which needs property descriptors the ES5 subset does not model — is skipped.
export const KNOWN_INCLUDES: ReadonlySet<string> = new Set([
  "sta.js", "assert.js", "compareArray.js", "decimalToHexString.js", "isConstructor.js",
]);

// Appended after a positive body: the case passes only if the program runs all
// the way here and prints the sentinel, which a no-op interpreter cannot do.
// The leading `;` guards the join against an ASI edge at the end of a body.
export const SENTINEL = "__262_completed__";
export const LIVENESS = `\n;print(${JSON.stringify(SENTINEL)});\n`;

export type Meta = {
  flags: string[];
  feats: string[];
  inc: string[];
  neg: boolean;
  phase: string | null; // "parse" | "resolution" | "runtime" | null
  type: string | null; // the expected error name for a negative test
  es5: boolean; // carries an `es5id`
};

/** Parse a Test262 file's `/*--- ---*\/` YAML frontmatter into the fields we use. */
export function parseMeta(src: string): Meta {
  const m = /\/\*---([\s\S]*?)---\*\//.exec(src);
  const y = m ? m[1] : "";
  const list = (name: string): string[] => {
    const x = new RegExp(name + ":\\s*\\[([^\\]]*)\\]").exec(y);
    return x ? x[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  };
  const g = (re: RegExp): string | null => { const x = re.exec(y); return x ? x[1] : null; };
  const neg = /negative:/.test(y);
  return {
    flags: list("flags"), feats: list("features"), inc: list("includes"),
    neg, phase: neg ? g(/phase:\s*(\w+)/) : null, type: neg ? g(/type:\s*(\w+)/) : null,
    es5: /es5id:/.test(src),
  };
}

/**
 * In scope when it is an ES5 test that runs in the sloppy script goal with only
 * harness pieces we stock and no post-ES5 feature. `onlyStrict`/`module`/`async`
 * are other goals; a `features:` tag or an unknown include is a corner the ES5
 * subset does not cover.
 */
export function inScope(mt: Meta): boolean {
  if (!mt.es5) return false;
  if (mt.flags.includes("module") || mt.flags.includes("onlyStrict") || mt.flags.includes("async") || mt.flags.includes("CanBlockIsFalse")) return false;
  if (mt.feats.length) return false;
  if (mt.inc.some((i) => !KNOWN_INCLUDES.has(i))) return false;
  return true;
}

/**
 * `eval` and the Function constructor are deliberately out of the ES5 subset;
 * many language tests use `eval()` purely as a parse harness, so exclude them.
 */
export function usesOutOfScope(src: string): boolean {
  return /\beval\s*\(/.test(src) || /\bnew\s+Function\b/.test(src) || /\bFunction\s*\(/.test(src);
}

/** Whether acorn accepts `source` at `ecmaVersion: 5` — the definition of ES5-valid. */
export function parsesAtEs5(source: string): boolean {
  try { acorn.parse(source, { ecmaVersion: 5, sourceType: "script" }); return true; } catch { return false; }
}

/**
 * The body an ES5 engine actually runs: the `/*--- ---*\/` frontmatter and the
 * leading BSD-license comment removed (both inert), everything else verbatim,
 * including the `//CHECK#` comments that make a failure legible.
 */
export function stripBody(src: string): string {
  let s = src.replace(/\/\*---[\s\S]*?---\*\//, "");
  s = s.replace(/^\s*(\/\/[^\n]*\n)+/, ""); // leading license comment lines
  return s.replace(/^\n+/, "");
}

/** The whole harness prepended to every case: `sta.js` then `assert.js`. */
export function assembleHarness(sta: string, assert: string): string {
  return sta + "\n" + assert + "\n";
}

/**
 * A case's inlined text: any non-sta/assert includes it needs (read via
 * `readInclude`), then its stripped body.
 */
export function caseBody(src: string, mt: Meta, readInclude: (file: string) => string): string {
  let s = "";
  for (const i of mt.inc) if (i !== "sta.js" && i !== "assert.js") s += readInclude(i) + "\n";
  return s + stripBody(src);
}

/** What the suite expects `error` to be: `null` for a positive, else the error name. */
export function expectedError(mt: Meta): string | null {
  if (!mt.neg) return null;
  return mt.phase === "parse" ? "SyntaxError" : mt.type;
}

/** One assembled, gradable case: `body` is what follows the harness at run time. */
export type Case = {
  chapter: string;
  id: string;
  body: string;
  expected: string | null;
  phase: string | null; // negative phase, for the generator's reference vetting
};

/**
 * The single decision "is this Test262 file an in-scope case, and if so what is
 * its body/expected/phase" — shared by the generator, the scorer and the
 * holdout so they never disagree on the set. Returns null for anything out of
 * the ES5 sloppy subset, or a positive whose body is not ES5 (e.g. a `\u{...}`
 * escape — a post-ES5 test an ES5 engine is right to reject, not to pass).
 */
export function toCase(
  src: string,
  chapter: string,
  file: string,
  readInclude: (f: string) => string,
): Case | null {
  const mt = parseMeta(src);
  if (!inScope(mt) || usesOutOfScope(src)) return null;
  const body = caseBody(src, mt, readInclude);
  const expected = expectedError(mt);
  if (expected === null && !parsesAtEs5(body + LIVENESS)) return null;
  return { chapter, id: `${chapter}/${file.replace(/\.js$/, "")}`, body, expected, phase: mt.phase };
}

/**
 * The acceptance verdict, identical to what each emitted test asserts and what
 * `measure.ts`/`holdout.ts` score by. A positive case must run to completion
 * with the sentinel as its last printed line; a negative must report exactly
 * the declared error. `run` throwing at the host level is always a fail.
 */
export function judge(
  run: (source: string) => EvalResult,
  harness: string,
  body: string,
  expected: string | null,
): boolean {
  if (expected === null) {
    let r: EvalResult;
    try { r = run(harness + body + LIVENESS); } catch { return false; }
    return r.error === null && r.output[r.output.length - 1] === SENTINEL;
  }
  let r: EvalResult;
  try { r = run(harness + body); } catch { return false; }
  return r.error === expected;
}
