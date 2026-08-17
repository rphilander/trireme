#!/usr/bin/env node
/**
 * holdout.ts — grade a finished run against Test262 operator chapters it was
 * NOT graded on, to see whether the interpreter generalises beyond boundary A
 * or was tuned to it. Same checkout, same verdict; only the chapters differ.
 *
 *   TEST262_DIR=/path/to/test262 node bench/es5-conformance/holdout.ts <runId>
 */
import { pathToFileURL } from "node:url";
import { score } from "./measure.ts";
import { collectCases, harnessOf } from "./corpus.ts";
import { loadArtifact } from "./artifact.ts";

// Operator chapters outside boundary A: unary, bitwise, shift, logical,
// conditional, and the membership/typeof family. Missing chapters are skipped
// by collectCases, so this list can be generous.
export const HELD_OUT: readonly string[] = [
  "unary-plus", "unary-minus", "logical-not", "bitwise-not",
  "bitwise-and", "bitwise-or", "bitwise-xor",
  "left-shift", "right-shift", "unsigned-right-shift",
  "logical-and", "logical-or", "conditional",
  "typeof", "void", "delete", "instanceof", "in", "comma",
];

async function main(argv: string[]): Promise<number> {
  const dir = process.env.TEST262_DIR ?? "";
  if (!dir) throw new Error("set TEST262_DIR to a Test262 checkout");
  if (!argv[0]) throw new Error("usage: holdout.ts <runId>");
  const cases = collectCases(dir, HELD_OUT);
  const harness = harnessOf(dir);
  const { run, cleanup } = await loadArtifact(argv[0]);
  try {
    const s = score(run, harness, cases);
    for (const chapter of Object.keys(s.byChapter)) {
      const b = s.byChapter[chapter];
      console.log(`  ${chapter.padEnd(24)} ${String(b.pass).padStart(3)}/${String(b.n).padStart(3)}`);
    }
    const pct = s.total ? (100 * s.passed / s.total).toFixed(1) : "0.0";
    console.log(`held-out ${argv[0].slice(-6)}: ${s.passed}/${s.total} = ${pct}%`);
  } finally {
    cleanup();
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
