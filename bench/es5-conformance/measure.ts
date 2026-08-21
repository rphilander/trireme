#!/usr/bin/env node
/**
 * measure.ts — score a finished run's interpreter against a Test262 subset.
 *
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/measure.ts <runId> [chapter ... | --tree <root>]
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
import { Worker } from "node:worker_threads";
import { CHAPTERS_A, judge, type Case, type EvalResult } from "./test262.ts";
import { collectCases, collectTree, harnessOf } from "./corpus.ts";

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

/**
 * Score an artifact with a per-case watchdog: the loop runs in a worker
 * (measure-worker.ts), and a case that exceeds `timeoutMs` gets its worker
 * terminated, is recorded as a fail, and scoring resumes at the next case —
 * an interpreter under test may not terminate on a case it has never seen.
 */
export async function scoreArtifact(
  target: string, // a run id, or a file:// URL of an entry module (e.g. a workspace's src/index.ts)
  harness: string,
  cases: Case[],
  timeoutMs = 10_000,
): Promise<Score & { hung: string[] }> {
  const byChapter: Record<string, { n: number; pass: number }> = {};
  for (const c of cases) (byChapter[c.chapter] ??= { n: 0, pass: 0 }).n++;
  let passed = 0;
  const hung: string[] = [];
  let next = 0;
  while (next < cases.length) {
    const startAt = next;
    const outcome = await new Promise<"done" | "stalled">((resolve) => {
      const worker = new Worker(new URL("./measure-worker.ts", import.meta.url), {
        workerData: { target, harness, cases, startAt },
      });
      let timer: NodeJS.Timeout;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void worker.terminate().then(() => resolve("stalled")), timeoutMs);
      };
      arm();
      worker.on("message", (m: { i?: number; pass?: boolean; done?: boolean }) => {
        if (m.done) { clearTimeout(timer); void worker.terminate(); resolve("done"); return; }
        next = (m.i ?? 0) + 1;
        if (m.pass) { passed++; byChapter[cases[m.i!].chapter].pass++; }
        arm();
      });
      worker.on("error", () => { clearTimeout(timer); resolve("stalled"); });
    });
    if (outcome === "stalled" && next < cases.length) {
      hung.push(cases[next].id); // the case the worker was on when it stalled
      next++;
    }
  }
  return { total: cases.length, passed, byChapter, hung };
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
  if (!argv[0]) throw new Error("usage: measure.ts <runId|--noop> [chapter ... | --tree <root>]");
  // `--tree language` scores a whole subtree of test/ recursively (boundary D
  // and beyond); bare names remain boundary-A chapters under language/expressions.
  const treeAt = argv.indexOf("--tree");
  const cases = treeAt >= 0
    ? collectTree(dir, argv[treeAt + 1] ?? "language")
    : collectCases(dir, argv.slice(1).length ? argv.slice(1) : CHAPTERS_A);
  const harness = harnessOf(dir);

  if (noop) {
    const s = score(() => ({ output: [], error: null }), harness, cases);
    report("NO-OP control", s);
    return 0;
  }
  const s = await scoreArtifact(argv[0], harness, cases);
  report(`artifact ${argv[0].slice(-6)}`, s);
  if (s.hung.length) console.log(`  (${s.hung.length} case(s) did not terminate: ${s.hung.slice(0, 5).join(", ")}${s.hung.length > 5 ? ", …" : ""})`);
  return 0;
}

// Run as a CLI, but stay importable by the test (which only wants `score`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
