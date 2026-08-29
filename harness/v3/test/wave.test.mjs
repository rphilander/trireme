// wave.test.mjs — supersession waves: mechanical closure, discovered
// frontier, estate migration, deterministic verify.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");
const V2BIN = path.join(process.env.HOME, "src/trireme/harness/bin");
const hasPayload = fs.existsSync(path.join(PLATFORM, "payload/platform/wave"));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "wavet-"));
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const wave = (W, args) => {
  try {
    return { code: 0, out: execFileSync("node", ["platform/wave/wave.js", ...args],
      { cwd: W, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};

const mkW = () => {
  const W = fs.mkdtempSync(path.join(SCRATCH, "w-"));
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  execFileSync("bash", [path.join(V2BIN, "scope-tsconfig.sh"), W, "calc"], { stdio: "ignore" });
  write(path.join(W, "modules/calc/index.ts"), `const isPos = (n: number): boolean => n > 0;
const check = (n: number): boolean => isPos(n) && n < 1000;
export const total = (a: number, b: number): number => check(a) && check(b) ? a + b : 0;
`);
  write(path.join(W, "modules/calc/test/doc/d.test.ts"), `import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '#modules/calc/index.js';
test('total', () => { assert.equal(total(1, 2), 3); });
`);
  write(path.join(W, "modules/calc/test/opaque/o.test.ts"), `import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '#modules/calc/index.js';
test('reject', () => { assert.equal(total(-1, 2), 0, 'expected 0'); });
`);
  return W;
};

test("stable-signature wave: mechanical closure, migrated estate, suite green, verify honest", (t) => {
  if (!hasPayload) { t.skip("payload lacks wave"); return; }
  const W = mkW();
  // hand successor (same prototype; tightened) + declaration
  fs.appendFileSync(path.join(W, "modules/calc/index.ts"),
    "const isPos2 = (n: number): boolean => n > 0 && Number.isFinite(n);\n");
  write(path.join(W, "modules/calc/supersessions/tighten.md"),
    "Tighten positivity to finite.\nSUPERSEDE: isPos -> isPos2\n");
  const p = wave(W, ["plan", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.equal(p.code, 0, p.out);
  const rep = JSON.parse(p.out);
  assert.equal(rep.status, "clean");
  assert.deepEqual(rep.mechanical.map((m) => m.def).sort(), ["check", "total"]);
  assert.deepEqual(rep.exportSwap, { total: "total2" });
  const a = wave(W, ["apply", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.equal(a.code, 0, a.out);
  const src = fs.readFileSync(path.join(W, "modules/calc/index.ts"), "utf8");
  assert.match(src, /const check2 = \(n: number\): boolean => isPos2\(n\)/);
  assert.match(src, /export const total2 = \(a: number, b: number\): number => check2\(a\) && check2\(b\)/);
  assert.ok(fs.existsSync(path.join(W, "modules/calc/test/doc/d.tighten.test.ts")));
  const mig = fs.readFileSync(path.join(W, "modules/calc/test/doc/d.tighten.test.ts"), "utf8");
  assert.match(mig, /import \{ total2 \}/);
  assert.match(mig, /total2\(1, 2\)/);
  // compile + run the migrated world: old and new generations coexist green
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: W, stdio: "ignore" });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  const run = execFileSync("node", ["--test", "modules/calc/test/doc/d.tighten.test.ts".replace(".ts", ".js")],
    { cwd: W, encoding: "utf8", env });
  assert.match(run, /pass 1/);
  // verify passes; tampering the generated tail refuses
  const v = wave(W, ["verify", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.equal(v.code, 0, v.out);
  fs.appendFileSync(path.join(W, "modules/calc/index.ts"), "// sneaky\n");
  const v2 = wave(W, ["verify", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.notEqual(v2.code, 0);
  assert.match(v2.out, /does not match|mismatch|tail/);
});

test("namespace-import estate migrates through ns.member accesses; inert copies dropped", (t) => {
  if (!hasPayload) { t.skip("payload lacks wave"); return; }
  const W = mkW();
  // an estate file bound via namespace import, plus one that never
  // binds swapped exports (must NOT produce a migrated copy)
  write(path.join(W, "modules/calc/test/opaque/ns.test.ts"), `import test from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '#modules/calc/index.js';
test('ns total', () => { assert.equal(calc.total(1, 2), 3); });
`);
  write(path.join(W, "modules/calc/test/opaque/unrelated.test.ts"), `import test from 'node:test';
import assert from 'node:assert/strict';
test('math', () => { assert.equal(1 + 1, 2); });
`);
  fs.appendFileSync(path.join(W, "modules/calc/index.ts"),
    "const isPos2 = (n: number): boolean => n > 0 && Number.isFinite(n);\n");
  write(path.join(W, "modules/calc/supersessions/tighten.md"),
    "Tighten.\nSUPERSEDE: isPos -> isPos2\n");
  const a = wave(W, ["apply", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.equal(a.code, 0, a.out);
  const mig = fs.readFileSync(path.join(W, "modules/calc/test/opaque/ns.tighten.test.ts"), "utf8");
  assert.match(mig, /calc\.total2\(1, 2\)/, "ns member access migrated");
  assert.ok(!fs.existsSync(path.join(W, "modules/calc/test/opaque/unrelated.tighten.test.ts")), "no inert copy");
});

test("signature-change wave: plan discovers the frontier and names the caller", (t) => {
  if (!hasPayload) { t.skip("payload lacks wave"); return; }
  const W = mkW();
  fs.appendFileSync(path.join(W, "modules/calc/index.ts"),
    "const isPos2 = (n: number, eps: number): boolean => n > eps;\n");
  write(path.join(W, "modules/calc/supersessions/eps.md"),
    "Positivity needs a threshold.\nSUPERSEDE: isPos -> isPos2\n");
  const p = wave(W, ["plan", "calc", "modules/calc/supersessions/eps.md"]);
  assert.notEqual(p.code, 0);
  assert.match(p.out, /INCOMPLETE/);
  assert.match(p.out, /"frontier":\s*\[\s*"check"/);
});

test("wave delivery admits end-to-end: declaration + successors + migrated estate publish", (t) => {
  if (!hasPayload) { t.skip("payload lacks wave"); return; }
  const V3BIN = path.join(process.env.HOME, "src/trireme/harness/v3/bin");
  const H = fs.mkdtempSync(path.join(SCRATCH, "h-"));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const C = path.join(H, "campaign");
  fs.mkdirSync(C, { recursive: true });
  const sh = (script, args) => {
    try { return { code: 0, out: execFileSync("bash", [script, ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
    } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
  };
  assert.equal(sh(path.join(V3BIN, "init-history.sh"), [C]).code, 0);
  // publish estate + code for calc
  const Wq = path.join(H, "control-runs/q-1/workspace");
  fs.cpSync(mkW(), Wq, { recursive: true });
  fs.rmSync(path.join(Wq, "modules/calc/index.ts"));
  write(path.join(Wq, "modules/calc/index.ts"),
    "export declare const total: (a: number, b: number) => number;\n");
  assert.equal(sh(path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);
  const Wc = path.join(H, "control-runs/c-1/workspace");
  fs.cpSync(mkW(), Wc, { recursive: true });
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: Wc, stdio: "ignore" });
  assert.equal(sh(path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]).code, 0);
  // wave delivery: fresh world from history + hand successor + declaration + apply
  const Ww = path.join(H, "control-runs/c-2/workspace");
  fs.cpSync(mkW(), Ww, { recursive: true });
  fs.rmSync(path.join(Ww, "modules/calc"), { recursive: true });
  fs.cpSync(path.join(C, "history/modules/calc"), path.join(Ww, "modules/calc"), { recursive: true });
  fs.appendFileSync(path.join(Ww, "modules/calc/index.ts"),
    "const isPos2 = (n: number): boolean => n > 0 && Number.isFinite(n);\n");
  write(path.join(Ww, "modules/calc/supersessions/tighten.md"),
    "Tighten positivity to finite.\nSUPERSEDE: isPos -> isPos2\n");
  const a = wave(Ww, ["apply", "calc", "modules/calc/supersessions/tighten.md"]);
  assert.equal(a.code, 0, a.out);
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: Ww, stdio: "ignore" });
  const r = sh(path.join(V3BIN, "admit.sh"), [C, "c-2", "code"]);
  assert.equal(r.code, 0, r.out);
  const hist = path.join(C, "history/modules/calc");
  assert.match(fs.readFileSync(path.join(hist, "index.ts"), "utf8"), /const total2 =/);
  assert.ok(fs.existsSync(path.join(hist, "supersessions/tighten.md")));
  assert.ok(fs.existsSync(path.join(hist, "supersessions/tighten.manifest.json")));
  assert.ok(fs.existsSync(path.join(hist, "test/doc/d.tighten.test.ts")), "migrated estate published");
  // verdicts pair the migrated tests against the successor closure
  const v = sh(path.join(V3BIN, "verdicts.sh"), [C]);
  assert.equal(v.code, 0, v.out);
  assert.match(v.out, /new pair\(s\)/);
});
