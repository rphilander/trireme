// validate-binding.test.mjs — REAL-script tests for the binding validator,
// with stub bindings covering the contract's failure classes.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const SCRIPT = path.join(process.env.HOME, "src/trireme/harness/bin/validate-binding.sh");

function write(p, content, { exec = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (exec) fs.chmodSync(p, 0o755);
}

// A conforming runner: deterministic, never crashes, honest statuses.
const GOOD_RUNNER = `
import fs from "node:fs";
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1]; };
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(l => l.trim() && !l.startsWith("#"));
let subjectOk = false;
try { subjectOk = fs.readFileSync(arg("--subject"), "utf8").length > 0; } catch {}
const results = ids.map(id => ({ id, status: subjectOk ? "pass" : "fail", ms: 1 }));
fs.writeFileSync(arg("--out"), JSON.stringify({ results }));
`;

function buildBinding({ runner = GOOD_RUNNER, inventory = ["case/a.js", "case/b.js", "case/c.js"],
                        omit = [] } = {}) {
  const W = fs.mkdtempSync(path.join(SCRATCH, "bind-"));
  if (!omit.includes("runner")) write(path.join(W, "bridge/run.mjs"), runner);
  if (!omit.includes("inventory")) write(path.join(W, "inventory/cases.txt"), inventory.join("\n") + "\n");
  if (!omit.includes("derive")) write(path.join(W, "inventory/derive.mjs"), "// derive");
  if (!omit.includes("contract")) write(path.join(W, "contract.d.ts"), "export declare function run(s: string): unknown;");
  if (!omit.includes("budgets")) write(path.join(W, "budgets.json"), '{"defaultTimeoutMs": 10000, "perCase": {}}');
  if (!omit.includes("binding")) write(path.join(W, "BINDING.md"), "# rationale");
  return W;
}

function validate(W) {
  try {
    const out = execFileSync("bash", [SCRIPT, W], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
}

test("conforming binding passes with an OK summary", () => {
  const r = validate(buildBinding());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
});

for (const miss of ["runner", "inventory", "contract", "budgets", "binding", "derive"]) {
  test(`missing deliverable (${miss}) → REJECT naming it`, () => {
    const r = validate(buildBinding({ omit: [miss] }));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /REJECT/);
  });
}

test("runner that crashes on missing subject → REJECT", () => {
  const r = validate(buildBinding({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.readFileSync(arg("--subject"), "utf8"); // throws on missing subject
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [] }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /REJECT/);
  assert.match(r.out, /probe|crash|exit/i);
});

test("runner with malformed output shape → REJECT", () => {
  const r = validate(buildBinding({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.writeFileSync(arg("--out"), JSON.stringify({ verdicts: [] })); // wrong key
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /shape|results/i);
});

test("runner that drops requested ids → REJECT", () => {
  const r = validate(buildBinding({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.slice(1).map(id => ({ id, status: "fail" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /missing id|complete/i);
});

test("runner with an illegal status → REJECT", () => {
  const r = validate(buildBinding({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map(id => ({ id, status: "skipped" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /status/i);
});

test("nondeterministic runner → REJECT", () => {
  const r = validate(buildBinding({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
// flips verdicts based on a marker file it creates on first run
const marker = arg("--out") + ".seen";
const flip = fs.existsSync(marker); fs.writeFileSync(marker, "1");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map(id => ({ id, status: flip ? "pass" : "fail" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /determin/i);
});

test("duplicate inventory ids → REJECT", () => {
  const r = validate(buildBinding({ inventory: ["a.js", "b.js", "a.js"] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /duplicate/i);
});

test("empty inventory → REJECT", () => {
  const r = validate(buildBinding({ inventory: [] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /empty|non-empty/i);
});

test("large inventory (>20 ids) does not SIGPIPE the validator", () => {
  const ids = Array.from({ length: 5000 }, (_, i) => `case/${i}.js`);
  const r = validate(buildBinding({ inventory: ids }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
});
