#!/usr/bin/env node
/**
 * grade.mjs — grade a vanilla-pi control run (or one of its snapshots) with
 * the same yardsticks trireme runs get.
 *
 *   node experiments/vanilla-pi/grade.mjs <run-dir> <job-dir>              # final grade
 *   node experiments/vanilla-pi/grade.mjs <run-dir> <job-dir> --snapshots  # trajectory
 *
 * Final grade: verify acceptance/ is untampered against the job dir (the
 * read-only mount should make tampering impossible; verify anyway), restore it
 * regardless, then run the workspace's own vitest over acceptance/ (the gate
 * count) and tsc. Also sums cost/messages from the pi session transcript.
 *
 * Snapshots have no node_modules, so they are graded through the Test262
 * judge directly (import the snapshot's entry, score with the shared
 * machinery) — needs TEST262_DIR. A snapshot whose entry fails to import
 * scores 0.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TRIREME = path.resolve(HERE, "../..");

const [runArg, jobArg, mode] = process.argv.slice(2);
if (!runArg || !jobArg) throw new Error("usage: grade.mjs <run-dir> <job-dir> [--snapshots]");
const runDir = path.resolve(runArg);
const jobDir = path.resolve(jobArg);

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

async function judgeScore(wsDir) {
  const { collectTree, harnessOf } = await import(pathToFileURL(path.join(TRIREME, "bench/es5-conformance/corpus.ts")).href);
  const { judge } = await import(pathToFileURL(path.join(TRIREME, "bench/es5-conformance/test262.ts")).href);
  const t262 = process.env.TEST262_DIR;
  if (!t262) throw new Error("set TEST262_DIR for judge scoring");
  const cases = collectTree(t262, "language");
  const harness = harnessOf(t262);
  let run;
  try {
    ({ run } = await import(pathToFileURL(path.join(wsDir, "src", "index.ts")).href));
    if (typeof run !== "function") throw new Error("no run export");
  } catch (e) {
    return { passed: 0, total: cases.length, note: `entry not importable: ${String(e).slice(0, 80)}` };
  }
  let passed = 0;
  for (const c of cases) {
    try { if (judge(run, harness, c.body, c.expected)) passed++; } catch { /* fail */ }
  }
  return { passed, total: cases.length };
}

if (mode === "--snapshots") {
  const snaps = fs.readdirSync(path.join(runDir, "snapshots")).sort();
  for (const s of snaps) {
    const r = await judgeScore(path.join(runDir, "snapshots", s));
    console.log(`${s}: ${r.passed}/${r.total}${r.note ? `  (${r.note})` : ""}`);
  }
  process.exit(0);
}

const ws = path.join(runDir, "workspace");

// 1. Tamper check + restore.
const pristine = path.join(jobDir, "acceptance");
const wsAcc = path.join(ws, "acceptance");
const tampered = [];
for (const f of listFiles(pristine)) {
  const a = fs.readFileSync(path.join(pristine, f), "utf8");
  let b = null;
  try { b = fs.readFileSync(path.join(wsAcc, f), "utf8"); } catch { /* missing */ }
  if (a !== b) tampered.push(f);
}
for (const f of listFiles(wsAcc)) {
  if (!fs.existsSync(path.join(pristine, f))) tampered.push(`${f} (added)`);
}
if (tampered.length) console.log(`TAMPERED (${tampered.length}): ${tampered.slice(0, 5).join(", ")} — restoring`);
else console.log("acceptance/ untampered");
fs.rmSync(wsAcc, { recursive: true, force: true });
fs.cpSync(pristine, wsAcc, { recursive: true });

// 2. The gate count: the workspace's own vitest over acceptance/.
const outputFile = path.join(runDir, "vitest-grade.json");
try {
  execFileSync(process.execPath, [
    path.join(ws, "node_modules", "vitest", "vitest.mjs"),
    "run", "--root", ws, "--reporter=json", `--outputFile=${outputFile}`, "acceptance/",
  ], { cwd: ws, stdio: "ignore", timeout: 30 * 60 * 1000 });
} catch { /* nonzero exit on failures is expected */ }
const rep = JSON.parse(fs.readFileSync(outputFile, "utf8"));
const passed = rep.numPassedTests ?? 0;
const failed = rep.numFailedTests ?? 0;
console.log(`acceptance: ${passed}/${passed + failed} passing`);

// 3. Typecheck.
let tsOk = true;
try {
  execFileSync(process.execPath, [path.join(ws, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: ws, stdio: "pipe", timeout: 5 * 60 * 1000 });
} catch (e) {
  tsOk = false;
  const out = String(e.stdout ?? "").trim().split("\n");
  console.log(`typecheck: ${out.length} diagnostic line(s); first: ${out[0] ?? ""}`);
}
if (tsOk) console.log("typecheck: ok");

// 4. Cost + messages from the pi session transcript.
const sessRoot = path.join(runDir, "home", ".pi", "agent", "sessions");
let cost = 0, messages = 0, sessFiles = 0;
if (fs.existsSync(sessRoot)) {
  const stack = [sessRoot];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".jsonl")) {
        sessFiles++;
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const u = ev?.message?.usage ?? ev?.usage;
            if (u?.cost?.total) { cost += u.cost.total; messages++; }
          } catch { /* skip */ }
        }
      }
    }
  }
}
console.log(`cost: $${cost.toFixed(3)} across ${messages} priced messages (${sessFiles} session file(s))`);
