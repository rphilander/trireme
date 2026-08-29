// verdicts.test.mjs — write-once verdict mechanics end to end:
// pending until paired, one run per pair ever, def-granular closures
// (supersession re-pairs nothing), live-green accounting.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const V3BIN = path.join(process.env.HOME, "src/trireme/harness/v3/bin");
const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");
const V2BIN = path.join(process.env.HOME, "src/trireme/harness/bin");
const hasPayload = fs.existsSync(path.join(PLATFORM, "payload/platform"));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "v3verd-"));
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const sh = (H, script, args) => {
  try {
    return { code: 0, out: execFileSync("bash", [script, ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
const mkWorld = (H, name, module) => {
  const W = path.join(H, "control-runs", name, "workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  execFileSync("bash", [path.join(V2BIN, "scope-tsconfig.sh"), W, module], { stdio: "ignore" });
  const hm = path.join(H, "campaign/history/modules");
  if (fs.existsSync(hm)) fs.cpSync(hm, path.join(W, "modules"), { recursive: true });
  return W;
};
const tsc = (W) => execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: W, stdio: "ignore" });

test("write-once conversation: pending → red facts → idempotent → supersede re-pairs nothing → migration green → challenge accounted", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const H = fs.mkdtempSync(path.join(SCRATCH, "h-"));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const C = path.join(H, "campaign");
  fs.mkdirSync(C, { recursive: true });
  assert.equal(sh(H, path.join(V3BIN, "init-history.sh"), [C]).code, 0);

  // 1. estate publishes; no code → both tests pending
  const Wq = mkWorld(H, "q-1", "interval");
  write(path.join(Wq, "modules/interval/index.ts"),
    "export declare const width: (lo: number, hi: number) => number;\n");
  write(path.join(Wq, "modules/interval/test/doc/d.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('width', () => { assert.equal(width(1, 4), 3); });\n");
  write(path.join(Wq, "modules/interval/test/opaque/o.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('degenerate', () => { assert.equal(width(2, 2), 0, 'expected 0'); });\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);
  let r = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 new pair\(s\).*2 pending/);

  // 2. red code admits; verdicts record two immutable red facts
  const Wc = mkWorld(H, "c-1", "interval");
  write(path.join(Wc, "modules/interval/index.ts"),
    "export const width = (lo: number, hi: number): number => hi - lo + 1;\n");
  tsc(Wc);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]).code, 0);
  r = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.match(r.out, /2 new pair\(s\) — 0 green, 2 red/);

  // 3. write-once: nothing re-runs
  r = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.match(r.out, /0 new pair\(s\)/);

  // 4. supersession: width2 accretes; width's closure unchanged → NO re-pairs
  const Ws = mkWorld(H, "c-2", "interval");
  const cur = fs.readFileSync(path.join(C, "history/modules/interval/index.ts"), "utf8");
  write(path.join(Ws, "modules/interval/index.ts"),
    cur + "export const width2 = (lo: number, hi: number): number => hi - lo;\n");
  tsc(Ws);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-2", "code"]).code, 0, "accretion admits");
  r = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.match(r.out, /0 new pair\(s\)/, "unrelated accretion re-pairs nothing");

  // 5. migration: a new test imports width2 → exactly one new pair, green
  const Wm = mkWorld(H, "q-2", "interval");
  write(path.join(Wm, "modules/interval/test/doc/d2.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width2 } from '#modules/interval/index.js';\ntest('width2', () => { assert.equal(width2(1, 4), 3); });\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-2", "tests"]).code, 0);
  r = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.match(r.out, /1 new pair\(s\) — 1 green, 0 red/);

  // 6. accounting: 3 live tests = 1 green, 2 red; challenge marks one
  let acct = JSON.parse(sh(H, path.join(V3BIN, "accounting.sh"), [C]).out);
  assert.deepEqual(acct.totals, { tests: 3, green: 1, red: 2, pending: 0, challenged: 0 });
  const Wch = mkWorld(H, "c-3", "interval");
  write(path.join(Wch, "challenges/interval-degenerate.md"),
    "TEST: modules/interval/test/opaque/o.test.ts\nThe degenerate row is disputed.\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-3", "code"]).code, 0, "challenge-only delivery admits");
  acct = JSON.parse(sh(H, path.join(V3BIN, "accounting.sh"), [C]).out);
  assert.equal(acct.totals.challenged, 1);
  assert.equal(acct.modules.interval.red, 2);
});
