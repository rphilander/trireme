#!/usr/bin/env node
/**
 * measure.ts — score a finished run's interpreter against a Test262 subset.
 *
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/measure.ts <runId> [chapter ...]
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/measure.ts --noop  [chapter ...]
 *
 * Default chapters = boundary A. Prints the per-chapter and total pass rate
 * using the exact acceptance verdict (`test262.judge`), so the number matches
 * what the job's acceptance suite would report. `--noop` scores the do-nothing
 * interpreter as a control: it must be ~0, which is the liveness guard working.
 *
 * This is the instrument we read the axis through — a run's conformance on the
 * graded subset, and (by naming other chapters) its generalisation beyond it.
 */
import { pathToFileURL } from "node:url";
import { CHAPTERS_A, judge, type Case, type EvalResult } from "./test262.ts";
import { collectCases, harnessOf } from "./corpus.ts";
import { loadArtifact } from "./artifact.ts";

export type Score = {
  total: number;
  passed: number;
  byChapter: Record<string, { n: number; pass: number }>;
};

/** Score a `run` against the cases under `harness`, via the acceptance verdict. */
export function score(run: (s: string) => EvalResult, harness: string, cases: Case[]): Score {
  const byChapter: Record<string, { n: number; pass: number }> = {};
  let passed = 0;
  for (const c of cases) {
    const b = (byChapter[c.chapter] ??= { n: 0, pass: 0 });
    b.n++;
    if (judge(run, harness, c.body, c.expected)) { b.pass++; passed++; }
  }
  return { total: cases.length, passed, byChapter };
}

function requireDir(): string {
  const dir = process.env.TEST262_DIR ?? "";
  if (!dir) throw new Error("set TEST262_DIR to a Test262 checkout");
  return dir;
}

function report(label: string, s: Score): void {
  for (const chapter of Object.keys(s.byChapter)) {
    const b = s.byChapter[chapter];
    console.log(`  ${chapter.padEnd(24)} ${String(b.pass).padStart(3)}/${String(b.n).padStart(3)}`);
  }
  const pct = s.total ? (100 * s.passed / s.total).toFixed(1) : "0.0";
  console.log(`${label}: ${s.passed}/${s.total} = ${pct}%`);
}

async function main(argv: string[]): Promise<number> {
  const dir = requireDir();
  const noop = argv[0] === "--noop";
  if (!argv[0]) throw new Error("usage: measure.ts <runId|--noop> [chapter ...]");
  const chapters = argv.slice(1).length ? argv.slice(1) : CHAPTERS_A;
  const cases = collectCases(dir, chapters);
  const harness = harnessOf(dir);

  if (noop) {
    const s = score(() => ({ output: [], error: null }), harness, cases);
    report("NO-OP control", s);
    return 0;
  }
  const { run, cleanup } = await loadArtifact(argv[0]);
  try {
    report(`artifact ${argv[0].slice(-6)}`, score(run, harness, cases));
  } finally {
    cleanup();
  }
  return 0;
}

// Run as a CLI, but stay importable by the test (which only wants `score`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
