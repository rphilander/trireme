/**
 * corpus.ts — read a pinned Test262 checkout into the in-scope case set.
 *
 * The one place that touches the checkout on disk (`fs`), so the generator, the
 * scorer and the holdout walk it identically. The per-file decision lives in
 * `test262.toCase`; this only handles the directory walk and the harness read.
 */
import fs from "node:fs";
import path from "node:path";
import { assembleHarness, toCase, type Case } from "./test262.ts";

export function readHarness(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, "harness", file), "utf8");
}

/** The whole harness prepended to every case, read from the checkout. */
export function harnessOf(dir: string): string {
  return assembleHarness(readHarness(dir, "sta.js"), readHarness(dir, "assert.js"));
}

/**
 * Every in-scope case under the given `language/expressions` chapters, in emit
 * order (chapters as given, files sorted). Skips `_FIXTURE` files and duplicate
 * ids.
 */
export function collectCases(dir: string, chapters: readonly string[]): Case[] {
  const cases: Case[] = [];
  const seen = new Set<string>();
  for (const chapter of chapters) {
    const cdir = path.join(dir, "test/language/expressions", chapter);
    if (!fs.existsSync(cdir)) continue;
    for (const file of fs.readdirSync(cdir).sort()) {
      if (!file.endsWith(".js") || file.includes("_FIXTURE")) continue;
      const src = fs.readFileSync(path.join(cdir, file), "utf8");
      const c = toCase(src, chapter, file, (inc) => readHarness(dir, inc));
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      cases.push(c);
    }
  }
  return cases;
}
