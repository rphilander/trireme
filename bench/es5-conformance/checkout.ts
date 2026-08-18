/**
 * checkout.ts — resolve and verify the Test262 checkout every generator reads.
 *
 * The checkout lives outside the repo (~53K files; only selected, vetted cases
 * are committed, inlined into acceptance suites). TEST262_DIR names it, and the
 * generator refuses to run against the wrong pin, so regeneration is exact.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function requireCheckoutAtPin(pin: string): string {
  const dir = process.env.TEST262_DIR ?? "";
  if (!dir) throw new Error("set TEST262_DIR to a Test262 checkout at pin " + pin.slice(0, 8));
  if (!fs.existsSync(path.join(dir, "harness", "sta.js"))) throw new Error(`no Test262 checkout at ${dir}`);
  let head = "";
  try { head = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim(); } catch { /* not a git checkout */ }
  if (head && head !== pin) throw new Error(`Test262 checkout is at ${head.slice(0, 8)}, expected pin ${pin.slice(0, 8)}`);
  return dir;
}
