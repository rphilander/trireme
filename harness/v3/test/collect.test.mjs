// collect.test.mjs — adjudicated collections: the only deletions
// history sees, gated by referential integrity; verdict facts are
// never erased, accounting just stops counting collected tests.
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
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "v3coll-"));
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

test("collection: integrity refusal, then a full supersession collect with auto-collected challenge", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const H = fs.mkdtempSync(path.join(SCRATCH, "h-"));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const C = path.join(H, "campaign");
  fs.mkdirSync(C, { recursive: true });
  assert.equal(sh(H, path.join(V3BIN, "init-history.sh"), [C]).code, 0);

  const Wq = mkWorld(H, "q-1", "interval");
  write(path.join(Wq, "modules/interval/index.ts"),
    "export declare const width: (lo: number, hi: number) => number;\n");
  write(path.join(Wq, "modules/interval/test/doc/d.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('width', () => { assert.equal(width(1, 4), 3); });\n");
  write(path.join(Wq, "modules/interval/test/opaque/o.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('degenerate', () => { assert.equal(width(2, 2), 0, 'expected 0'); });\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);

  const Wc = mkWorld(H, "c-1", "interval");
  write(path.join(Wc, "modules/interval/index.ts"),
    "export const width = (lo: number, hi: number): number => hi - lo + 1;\n");
  tsc(Wc);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]).code, 0);
  const Ws = mkWorld(H, "c-2", "interval");
  const cur = fs.readFileSync(path.join(C, "history/modules/interval/index.ts"), "utf8");
  write(path.join(Ws, "modules/interval/index.ts"),
    cur + "export const width2 = (lo: number, hi: number): number => hi - lo;\n");
  tsc(Ws);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-2", "code"]).code, 0);
  const Wm = mkWorld(H, "q-2", "interval");
  write(path.join(Wm, "modules/interval/test/doc/d2.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width2 } from '#modules/interval/index.js';\ntest('width2', () => { assert.equal(width2(1, 4), 3); });\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-2", "tests"]).code, 0);
  const Wch = mkWorld(H, "c-3", "interval");
  write(path.join(Wch, "challenges/interval-degenerate.md"),
    "TEST: modules/interval/test/opaque/o.test.ts\nDisputed.\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-3", "code"]).code, 0);
  assert.equal(sh(H, path.join(V3BIN, "verdicts.sh"), [C]).code, 0);

  // decision A: collect width alone → integrity refusal (tests import it)
  const Wd1 = mkWorld(H, "d-1", "x");
  write(path.join(Wd1, "decisions/0001-collect-width.md"),
    "Supersede width by width2.\nCOLLECT-DEF: interval width\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "d-1", "decision"]).code, 0);
  const rA = sh(H, path.join(V3BIN, "execute-decision.sh"), [C, "decisions/0001-collect-width.md"]);
  assert.notEqual(rA.code, 0);
  assert.match(rA.out, /referential integrity/);

  // decision B: the whole supersession as ONE decision
  const Wd2 = mkWorld(H, "d-2", "x");
  write(path.join(Wd2, "decisions/0002-supersede-width.md"),
    "Supersede width by width2; migrate/retire its tests.\n" +
    "COLLECT-DEF: interval width\n" +
    "COLLECT: modules/interval/test/doc/d.test.ts\n" +
    "COLLECT: modules/interval/test/opaque/o.test.ts\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "d-2", "decision"]).code, 0);
  const rB = sh(H, path.join(V3BIN, "execute-decision.sh"), [C, "decisions/0002-supersede-width.md"]);
  assert.equal(rB.code, 0, rB.out);
  assert.match(rB.out, /COLLECTED: 3 file\(s\), 1 def\(s\)/); // challenge auto-collected
  const idx = fs.readFileSync(path.join(C, "history/modules/interval/index.ts"), "utf8");
  assert.ok(!/const width =/.test(idx), "width collected");
  assert.ok(/const width2 =/.test(idx), "width2 survives");
  assert.ok(!fs.existsSync(path.join(C, "history/challenges/interval-degenerate.md")), "challenge auto-collected");

  // accounting: one live test, green; verdict facts remain in the ledger file
  const acct = JSON.parse(sh(H, path.join(V3BIN, "accounting.sh"), [C]).out);
  assert.deepEqual(acct.totals, { tests: 1, green: 1, red: 0, pending: 0, challenged: 0 });
  const facts = fs.readFileSync(path.join(C, "verdicts.jsonl"), "utf8").trim().split("\n");
  assert.equal(facts.length, 3, "immutable facts survive collection");
  // write-once still holds post-collection
  const rv = sh(H, path.join(V3BIN, "verdicts.sh"), [C]);
  assert.match(rv.out, /0 new pair\(s\)/);
});
