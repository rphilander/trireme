// stubs.mjs — shared reality-faithful stubs for harness tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
export const REAL_HOME = process.env.HOME;
export const BIN = path.join(REAL_HOME, "src/trireme/harness/bin");

export function write(p, c, { exec = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
  if (exec) fs.chmodSync(p, 0o755);
}

// A conforming gate runner: deterministic, never crashes, honest statuses.
export const GOOD_RUNNER = `
import fs from "node:fs";
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(l => l.trim() && !l.startsWith("#"));
let subjectOk = false;
try { subjectOk = fs.readFileSync(arg("--subject"), "utf8").length > 0; } catch {}
const results = ids.map(id => ({ id, status: subjectOk ? "pass" : "fail", ms: 1 }));
fs.writeFileSync(arg("--out"), JSON.stringify({ results }));
`;

// A conforming self-suite: probes the sibling gate, one red finding.
export const GOOD_SELF = `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const hasRunner = fs.existsSync("bridge/run.mjs");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [
  { id: "self/runner-exists", status: hasRunner ? "pass" : "fail", ms: 1 },
  { id: "self/always-red-finding", status: "fail", detail: "expected X observed Y", ms: 1 },
]}));
`;

// Build a full unified QE workspace (the gate module).
export function qeWorkspace({
  runner = GOOD_RUNNER,
  self = GOOD_SELF,
  inventory = ["case/a.js", "case/b.js", "case/c.js"],
  scope = ["case/a.js", "case/b.js"],
  omit = [],
} = {}) {
  const W = fs.mkdtempSync(path.join(SCRATCH, "qew-"));
  if (!omit.includes("runner")) write(path.join(W, "bridge/run.mjs"), runner);
  if (!omit.includes("inventory")) write(path.join(W, "inventory/cases.txt"), inventory.join("\n") + "\n");
  if (!omit.includes("derive")) write(path.join(W, "inventory/derive.mjs"), "// derive");
  if (!omit.includes("contract")) write(path.join(W, "contract.d.ts"), "export declare function run(s: string): unknown;");
  if (!omit.includes("budgets")) write(path.join(W, "budgets.json"), '{"defaultTimeoutMs": 10000, "perCase": {}}');
  if (!omit.includes("scope")) write(path.join(W, "scope/cases.txt"), scope.join("\n") + (scope.length ? "\n" : ""));
  if (!omit.includes("self")) write(path.join(W, "suite/self/run.mjs"), self);
  if (!omit.includes("SUITE")) write(path.join(W, "SUITE.md"), "# suite");
  if (!omit.includes("FINDINGS")) write(path.join(W, "FINDINGS.md"), "# findings");
  return W;
}

// A fake operator HOME for composer tests (extensions, models.json,
// control-runs, an acceptance corpus, a goal file, and the real
// validators mirrored so composers resolve them path-relative).
export function fakeHome() {
  const H = fs.mkdtempSync(path.join(SCRATCH, "home-"));
  write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// ext");
  write(path.join(H, ".pi/agent/models.json"),
    JSON.stringify({ providers: { deepseek: { baseUrl: "x", models: [] } } }));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const TESTS = path.join(H, "acceptance");
  write(path.join(TESTS, "suite/alpha.spec.js"), "// test");
  write(path.join(TESTS, "docs/README.md"), "how to run");
  const GOAL = path.join(H, "goal.txt");
  write(GOAL, "Build a frobnicator as a Node package.");
  return { H, TESTS, GOAL };
}
