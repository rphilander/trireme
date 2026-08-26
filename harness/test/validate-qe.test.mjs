// validate-qe.test.mjs — REAL-script tests for the unified QE validator:
// gate probes + inventory/scope sanity + self-suite checks.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { BIN, qeWorkspace } from "./stubs.mjs";

function validate(W) {
  try {
    const out = execFileSync("bash", [path.join(BIN, "validate-qe.sh"), W],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
}

test("conforming module passes; facts reported: inventory, scope, self red count", () => {
  const r = validate(qeWorkspace());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
  assert.match(r.out, /3 inventory ids/);
  assert.match(r.out, /2 in scope/);
  assert.match(r.out, /2 self-tests, 1 currently red/);
});

for (const miss of ["runner", "inventory", "derive", "contract", "budgets", "scope", "self", "SUITE", "FINDINGS"]) {
  test(`missing deliverable (${miss}) → REJECT`, () => {
    const r = validate(qeWorkspace({ omit: [miss] }));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /REJECT/);
  });
}

test("runner that crashes on missing subject → REJECT", () => {
  const r = validate(qeWorkspace({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.readFileSync(arg("--subject"), "utf8"); // throws on missing subject
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [] }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /probe|crash|exit/i);
});

test("runner with malformed output shape → REJECT", () => {
  const r = validate(qeWorkspace({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.writeFileSync(arg("--out"), JSON.stringify({ verdicts: [] })); // wrong key
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /shape|results/i);
});

test("runner that drops requested ids → REJECT", () => {
  const r = validate(qeWorkspace({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.slice(1).map(id => ({ id, status: "fail" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /missing id|complete/i);
});

test("runner with an illegal status → REJECT", () => {
  const r = validate(qeWorkspace({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map(id => ({ id, status: "skipped" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /status/i);
});

test("nondeterministic runner (state keyed on --out path) → REJECT", () => {
  const r = validate(qeWorkspace({ runner: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
const marker = arg("--out") + ".seen";
const flip = fs.existsSync(marker); fs.writeFileSync(marker, "1");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map(id => ({ id, status: flip ? "pass" : "fail" })) }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /determin/i);
});

test("duplicate inventory ids → REJECT", () => {
  const r = validate(qeWorkspace({ inventory: ["a.js", "b.js", "a.js"], scope: ["a.js"] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /duplicate/i);
});

test("empty inventory → REJECT", () => {
  const r = validate(qeWorkspace({ inventory: [], scope: [] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /empty|non-empty/i);
});

test("scope id not in inventory → REJECT", () => {
  const r = validate(qeWorkspace({ scope: ["case/a.js", "case/NOT-THERE.js"] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /scope/i);
});

test("empty scope → REJECT", () => {
  const r = validate(qeWorkspace({ scope: [] }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /scope/i);
});

test("crashing self-suite → REJECT", () => {
  const r = validate(qeWorkspace({ self: "throw new Error('boom');" }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /self.*crash|crash.*self/is);
});

test("nondeterministic self-suite → REJECT", () => {
  const r = validate(qeWorkspace({ self: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const marker = arg("--out") + ".seen";
const flip = fs.existsSync(marker); fs.writeFileSync(marker, "1");
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [{ id: "t", status: flip ? "pass" : "fail" }] }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /determin/i);
});

test("empty self-suite results → REJECT", () => {
  const r = validate(qeWorkspace({ self: `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
fs.writeFileSync(arg("--out"), JSON.stringify({ results: [] }));
` }));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /non-empty/i);
});

test("large inventory (>64KB) does not SIGPIPE the validator", () => {
  // volume must exceed the 64KB pipe buffer or grep finishes before head exits
  const ids = Array.from({ length: 60000 }, (_, i) => `suite/some/deeply/nested/path/case-number-${i}.js`);
  const r = validate(qeWorkspace({ inventory: ids, scope: ids.slice(0, 50) }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
});
