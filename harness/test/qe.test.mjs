// qe.test.mjs — REAL-script tests for the QE composer + suite validator.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const REAL_HOME = process.env.HOME;
const BIN = path.join(REAL_HOME, "src/trireme/harness/bin");
function write(p, c, x) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); if (x) fs.chmodSync(p, 0o755); }

const GOOD_SUITE = `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const bindingDir = arg("--binding");
const hasRunner = fs.existsSync(bindingDir + "/bridge/run.mjs");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [
  { id: "runner-exists", status: hasRunner ? "pass" : "fail", ms: 1 },
  { id: "always-red-finding", status: "fail", detail: "expected X observed Y", ms: 1 },
]}));
`;

function qeWorkspace({ suite = GOOD_SUITE, omit = [] } = {}) {
  const W = fs.mkdtempSync(path.join(SCRATCH, "qe-"));
  if (!omit.includes("suite")) write(path.join(W, "suite/run.mjs"), suite);
  if (!omit.includes("SUITE")) write(path.join(W, "SUITE.md"), "# suite");
  if (!omit.includes("FINDINGS")) write(path.join(W, "FINDINGS.md"), "# findings");
  return W;
}
function bindingDir() {
  const B = fs.mkdtempSync(path.join(SCRATCH, "bd-"));
  write(path.join(B, "bridge/run.mjs"), "// runner");
  return B;
}
function validate(W, B) {
  try { return { code: 0, out: execFileSync("bash", [path.join(BIN, "validate-qe.sh"), W, B], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
}

test("conforming QE suite passes; red count reported as fact", () => {
  const r = validate(qeWorkspace(), bindingDir());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 tests, 1 currently red/);
});
test("missing deliverables → REJECT", () => {
  for (const m of ["suite", "SUITE", "FINDINGS"]) {
    const r = validate(qeWorkspace({ omit: [m] }), bindingDir());
    assert.notEqual(r.code, 0);
    assert.match(r.out, /REJECT/);
  }
});
test("crashing suite → REJECT", () => {
  const r = validate(qeWorkspace({ suite: "throw new Error('boom');" }), bindingDir());
  assert.notEqual(r.code, 0);
  assert.match(r.out, /crashed/);
});
test("nondeterministic suite → REJECT", () => {
  const r = validate(qeWorkspace({ suite: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const marker = arg("--out") + ".seen";
const flip = fs.existsSync(marker); fs.writeFileSync(marker, "1");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [{ id: "t", status: flip ? "pass" : "fail" }] }));
` }), bindingDir());
  assert.notEqual(r.code, 0);
  assert.match(r.out, /determinism/);
});
test("empty results → REJECT", () => {
  const r = validate(qeWorkspace({ suite: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [] }));
` }), bindingDir());
  assert.notEqual(r.code, 0);
  assert.match(r.out, /non-empty/);
});

test("compose-qe-world: binding + tests read-only, mandate has goal + red-is-finding rule, no defect leakage", () => {
  const H = fs.mkdtempSync(path.join(SCRATCH, "cqw-"));
  write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// ext");
  write(path.join(H, ".pi/agent/models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: "x" } } }));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const TESTS = path.join(H, "acceptance"); write(path.join(TESTS, "t/a.js"), "//");
  write(path.join(H, "control-runs/bind-1/workspace/bridge/run.mjs"), "// runner");
  write(path.join(H, "control-runs/bind-1/workspace/contract.d.ts"), "export {};");
  const GOAL = path.join(H, "goal.txt"); write(GOAL, "Build a frobnicator.");
  execFileSync("bash", [path.join(BIN, "compose-qe-world.sh"), "qe-1", TESTS, GOAL, "bind-1", "60"],
    { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"] });
  const R = path.join(H, "control-runs/qe-1");
  assert.ok(fs.existsSync(path.join(R, "workspace/binding/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(R, "workspace/tests/t/a.js")));
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator\./);
  assert.match(mandate, /RED against the current binding is a FINDING/);
  assert.match(mandate, /Never weaken a test/);
  for (const banned of [/sloppy/i, /strict/i, /deadlock/i, /directive/i, /dual-mode/i]) {
    assert.ok(!banned.test(mandate), `mandate leaks defect knowledge: ${banned}`);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/binding")));
});
