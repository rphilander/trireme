/**
 * artifact.ts — load the `run()` an agent shipped in a finished run's package.
 *
 * A run's artifact is the packed npm tarball trireme built from the workspace;
 * this unpacks it to a temp dir and imports its entry, so `measure.ts` and
 * `holdout.ts` can call the interpreter exactly as it was published. Impure
 * (fs, tar, dynamic import); the caller must `cleanup()` when done.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EvalResult } from "./test262.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RUNS_DIR = path.resolve(HERE, "../../runs");

export type Loaded = { run: (source: string) => EvalResult; cleanup: () => void };

export async function loadArtifact(runId: string, runsDir: string = RUNS_DIR): Promise<Loaded> {
  const artDir = path.join(runsDir, runId, "artifact");
  const tgz = fs.readdirSync(artDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no .tgz artifact in ${artDir}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es5c-"));
  execFileSync("tar", ["-xzf", path.join(artDir, tgz), "-C", tmp]);
  const pkgDir = path.join(tmp, "package");
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const exp = pkg.exports;
  const entry = typeof exp === "string" ? exp : (exp?.["."]?.import ?? exp?.["."]?.default ?? exp?.["."] ?? pkg.main);
  const mod = await import(pathToFileURL(path.join(pkgDir, entry)).href);
  return { run: mod.run, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
