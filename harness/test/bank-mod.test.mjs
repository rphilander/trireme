// bank-mod.test.mjs — module-cycle banking: qe overlay then code
// overlay build successive trunk entries; recheck floors (compile,
// suite, accretion) gate the bank; VOID leaves no entry behind.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, write } from "./stubs.mjs";

const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");
const hasPayload = fs.existsSync(path.join(PLATFORM, "payload/platform"));

const sh = (H, script, args) => {
  try {
    return { code: 0, out: execFileSync("bash", [path.join(BIN, script), ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};

const NOUN_TS = `import { type Rec, rec, get } from '#platform/values/core.js';
export type Interval = Rec<{ readonly tag: 'interval'; readonly lo: number; readonly hi: number }>;
export const interval = (lo: number, hi: number): Interval => rec({ tag: 'interval', lo, hi });
export const width = (i: Interval): number => get(i, 'hi') - get(i, 'lo');
`;
const DOC_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { interval, width } from '#modules/interval/index.js';
test('interval width', () => { assert.equal(width(interval(1, 4)), 3); });
`;
const OPAQUE_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { interval, width } from '#modules/interval/index.js';
test('zero-width interval', () => { assert.equal(width(interval(2, 2)), 0, 'expected width 0 for degenerate interval'); });
`;

// a candidate run dir whose workspace is a real compiled world
const mkCandidate = (H, name, { withCode = true, tamper = false } = {}) => {
  const W = path.join(H, "control-runs", name, "workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  write(path.join(W, "modules/interval/test/doc/basics.test.ts"), DOC_TEST);
  write(path.join(W, "modules/interval/test/opaque/edge.test.ts"), OPAQUE_TEST);
  if (withCode) {
    write(path.join(W, "modules/interval/index.ts"),
      tamper ? NOUN_TS.replace("- get(i, 'lo')", "- get(i, 'lo') + 1") : NOUN_TS);
    execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: W, stdio: "ignore" });
  }
  return W;
};

const mkRetro = (H, name, { type, module: mod, winner }) => {
  write(path.join(H, "control-runs", name, "TYPE"), type + "\n");
  write(path.join(H, "control-runs", name, "MODULE"), mod + "\n");
  write(path.join(H, "control-runs", name, "workspace/DECISION.md"), `BANK: ${winner}\n`);
};

test("qe bank then code bank: successive entries, suite green at code recheck", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const C = path.join(H, "campaign");

  // cycle half 1: QE candidate (tests only, no module yet)
  mkCandidate(H, "q-1", { withCode: false });
  mkRetro(H, "retro-q1", { type: "qe", module: "interval", winner: "q-1" });
  const r1 = sh(H, "bank-mod.sh", [C, "retro-q1"]);
  assert.equal(r1.code, 0, r1.out);
  assert.ok(fs.existsSync(path.join(C, "trunk/entry-1/modules/interval/test/doc/basics.test.ts")));
  assert.ok(!fs.existsSync(path.join(C, "trunk/entry-1/modules/interval/index.ts")));

  // cycle half 2: code candidate delivers the module; recheck compiles + runs the suite
  mkCandidate(H, "c-1", { withCode: true });
  mkRetro(H, "retro-c1", { type: "code", module: "interval", winner: "c-1" });
  const r2 = sh(H, "bank-mod.sh", [C, "retro-c1"]);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /2 tests pass/);
  assert.equal(fs.readlinkSync(path.join(C, "trunk/current")), "entry-2");
  assert.ok(fs.existsSync(path.join(C, "trunk/entry-2/modules/interval/index.js")), "compiled module banked");
  const hist = fs.readFileSync(path.join(C, "history.log"), "utf8");
  assert.match(hist, /BANK qe module=interval/);
  assert.match(hist, /BANK code module=interval/);
});

test("code bank with red suite → VOID, no entry, void record", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const C = path.join(H, "campaign");
  mkCandidate(H, "q-1", { withCode: false });
  mkRetro(H, "retro-q1", { type: "qe", module: "interval", winner: "q-1" });
  assert.equal(sh(H, "bank-mod.sh", [C, "retro-q1"]).code, 0);

  mkCandidate(H, "c-bad", { withCode: true, tamper: true }); // width off-by-one → suite red
  mkRetro(H, "retro-cbad", { type: "code", module: "interval", winner: "c-bad" });
  const r = sh(H, "bank-mod.sh", [C, "retro-cbad"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANK VOID/);
  assert.ok(!fs.existsSync(path.join(C, "trunk/entry-2")));
  assert.equal(fs.readlinkSync(path.join(C, "trunk/current")), "entry-1");
  assert.ok(fs.readdirSync(path.join(C, "void")).length === 1);
});

test("REDO recorded, nothing banked", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const C = path.join(H, "campaign");
  write(path.join(H, "control-runs/retro-r/TYPE"), "code\n");
  write(path.join(H, "control-runs/retro-r/MODULE"), "interval\n");
  write(path.join(H, "control-runs/retro-r/workspace/DECISION.md"), "REDO: briefs diverged\n");
  const r = sh(H, "bank-mod.sh", [C, "retro-r"]);
  assert.equal(r.code, 3, r.out);
  assert.ok(!fs.existsSync(path.join(C, "trunk")));
  assert.match(fs.readFileSync(path.join(C, "history.log"), "utf8"), /REDO/);
});

test("validate-mod works under a bare systemd-like PATH", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  mkCandidate(H, "q-path", { withCode: false });
  const r = (() => {
    try {
      return { code: 0, out: execFileSync("bash", [path.join(BIN, "validate-mod.sh"),
        path.join(H, "control-runs/q-path/workspace"), "interval", "qe"],
        { encoding: "utf8", env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin" } }) };
    } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
  })();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK: qe candidate/);
});

test("concurrent banks serialize on the campaign lock (distinct entries)", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const C = path.join(H, "campaign");
  mkCandidate(H, "q-a", { withCode: false });
  fs.cpSync(path.join(H, "control-runs/q-a"), path.join(H, "control-runs/q-b"), { recursive: true });
  fs.renameSync(path.join(H, "control-runs/q-b/workspace/modules/interval"),
    path.join(H, "control-runs/q-b/workspace/modules/span"));
  mkRetro(H, "retro-a", { type: "qe", module: "interval", winner: "q-a" });
  mkRetro(H, "retro-b", { type: "qe", module: "span", winner: "q-b" });
  return import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    let done = 0; const finish = (err) => { if (err) return reject(err); if (++done === 2) resolve(); };
    for (const r of ["retro-a", "retro-b"]) {
      execFile("bash", [path.join(BIN, "bank-mod.sh"), C, r],
        { env: { ...process.env, HOME: H } }, (e) => finish(e));
    }
  })).then(() => {
    assert.ok(fs.existsSync(path.join(C, "trunk/entry-1")));
    assert.ok(fs.existsSync(path.join(C, "trunk/entry-2")), "second bank got a distinct entry");
    const hist = fs.readFileSync(path.join(C, "history.log"), "utf8");
    assert.equal((hist.match(/BANK qe/g) || []).length, 2);
  });
});

test("qe type floor: stub-inconsistent estate REJECTed, consistent passes, stubless legacy skips", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const W = path.join(H, "control-runs/q-floor/workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  write(path.join(W, "modules/interval/index.ts"),
    "import type { Vec } from '#platform/values/core.js';\nexport declare const total: (xs: Vec<string>) => number;\n");
  write(path.join(W, "modules/interval/test/doc/d.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '#modules/interval/index.js';\nimport * as vec from '#platform/values/vec.js';\ntest('total', () => { assert.equal(total(vec.of(1)), 1); });\n");
  write(path.join(W, "modules/interval/test/opaque/o.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '#modules/interval/index.js';\nimport * as vec from 'node:util';\ntest('t', () => { assert.ok(total, 'expected total exported'); });\n");
  const r1 = sh(H, "validate-mod.sh", [W, "interval", "qe"]);
  assert.notEqual(r1.code, 0);
  assert.match(r1.out, /estate not compile-clean/);
  // fix the stub to match the estate's usage → passes, reports typechecked
  write(path.join(W, "modules/interval/index.ts"),
    "import type { Vec } from '#platform/values/core.js';\nexport declare const total: (xs: Vec<number>) => number;\n");
  const r2 = sh(H, "validate-mod.sh", [W, "interval", "qe"]);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /typechecked/);
  // stubless legacy estate: floor skipped, no typechecked claim
  fs.rmSync(path.join(W, "modules/interval/index.ts"));
  const r3 = sh(H, "validate-mod.sh", [W, "interval", "qe"]);
  assert.equal(r3.code, 0, r3.out);
  assert.doesNotMatch(r3.out, /typechecked/);
});

test("qe bank: stub travels into the recheck, never into the entry", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H } = fakeHome();
  const C = path.join(H, "campaign");
  const W = path.join(H, "control-runs/q-stub/workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  write(path.join(W, "modules/interval/index.ts"),
    "export declare const width: (lo: number, hi: number) => number;\n");
  write(path.join(W, "modules/interval/test/doc/d.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('width', () => { assert.equal(width(1, 4), 3); });\n");
  write(path.join(W, "modules/interval/test/opaque/o.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('degenerate', () => { assert.equal(width(2, 2), 0, 'expected 0'); });\n");
  mkRetro(H, "retro-qs", { type: "qe", module: "interval", winner: "q-stub" });
  const r = sh(H, "bank-mod.sh", [C, "retro-qs"]);
  assert.equal(r.code, 0, r.out);
  const E = path.join(C, "trunk/entry-1/modules/interval");
  assert.ok(fs.existsSync(path.join(E, "test/doc/d.test.ts")), "estate banked");
  assert.ok(!fs.existsSync(path.join(E, "index.ts")), "stub never banks");
});
