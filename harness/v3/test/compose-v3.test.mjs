// compose-v3.test.mjs — v3 session worlds: sealed mounts from the
// history tip, perspective separation, drop-box surfaces, dry driver.
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
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "v3comp-"));
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

// one campaign: interval fully published (estate + green code)
const H = fs.mkdtempSync(path.join(SCRATCH, "h-"));
fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
const C = path.join(H, "campaign");
fs.mkdirSync(C, { recursive: true });
const GOAL = path.join(H, "goal.txt");
write(GOAL, "Build a frobnicator.\n");
write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// stub extension");
write(path.join(H, ".pi/agent/models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: "x" } } }));
fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });

test("setup: publish interval estate + code", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  assert.equal(sh(H, path.join(V3BIN, "init-history.sh"), [C]).code, 0);
  const Wq = mkWorld(H, "q-1", "interval");
  write(path.join(Wq, "modules/interval/index.ts"),
    "export declare const width: (lo: number, hi: number) => number;\n");
  write(path.join(Wq, "modules/interval/test/doc/d.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('width', () => { assert.equal(width(1, 4), 3); });\n");
  write(path.join(Wq, "modules/interval/test/opaque/o.test.ts"),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { width } from '#modules/interval/index.js';\ntest('deg', () => { assert.equal(width(2, 2), 0, 'expected 0'); });\n");
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);
  const Wc = mkWorld(H, "c-1", "interval");
  write(path.join(Wc, "modules/interval/index.ts"),
    "export const width = (lo: number, hi: number): number => hi - lo;\n");
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: Wc, stdio: "ignore" });
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]).code, 0);
});

test("qe reopen world: interface only, tests frozen, stub denied", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const B = path.join(H, "b-interval.md");
  write(B, "TYPE: cycle\nMODULE: interval\nKIND: noun\nDEPENDS: none\n\nMore interval claims.\n");
  const r = sh(H, path.join(V3BIN, "compose-v3-qe-world.sh"), ["v3q-t1", GOAL, B, C, "45"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/v3q-t1/workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.d.ts")), "interface mounted");
  assert.ok(!fs.existsSync(path.join(W, "modules/interval/index.ts")), "source hidden from QE");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/test/doc/d.test.ts")), "published tests present");
  const dw = JSON.parse(fs.readFileSync(path.join(H, "control-runs/v3q-t1/settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("test/doc/d.test.ts")), "published test frozen");
  assert.ok(dw.some((p) => p.endsWith("modules/interval/index.ts")), "stub-shadowing denied");
  assert.match(fs.readFileSync(path.join(W, "MANDATE.md"), "utf8"), /immutable history/);
});

test("qe bootstrap world for a dependent module: sealed dep, closure check, stub mandate", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const B = path.join(H, "b-span.md");
  write(B, "TYPE: cycle\nMODULE: span\nKIND: verb\nDEPENDS: interval\n\nSpan verbs over intervals.\n");
  const r = sh(H, path.join(V3BIN, "compose-v3-qe-world.sh"), ["v3q-t2", GOAL, B, C, "45"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/v3q-t2/workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.d.ts")), "dep interface");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.js")), "dep bundle");
  assert.ok(!fs.existsSync(path.join(W, "modules/interval/index.ts")), "dep source sealed");
  assert.match(fs.readFileSync(path.join(W, "MANDATE.md"), "utf8"), /TYPED STUB/);
});

test("code world: own source visible, tests frozen, challenge channel open", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const B = path.join(H, "b-interval.md");
  const r = sh(H, path.join(V3BIN, "compose-v3-code-world.sh"), ["v3c-t1", GOAL, B, C, "60"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/v3c-t1/workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.ts")), "own source visible");
  const st = JSON.parse(fs.readFileSync(path.join(H, "control-runs/v3c-t1/settings.json"), "utf8"));
  assert.ok(st.filesystem.denyWrite.some((p) => p.endsWith("test/doc/d.test.ts")), "published test frozen");
  assert.ok(!st.filesystem.denyWrite.some((p) => p.endsWith("/challenges")), "challenges writable");
  const m = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(m, /never edit a published def/i);
  assert.match(m, /TEST: modules\/interval\/test/);
});

test("adjudication world: frontier mounted, decisions writable only", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  execFileSync("bash", [path.join(V3BIN, "verdicts.sh"), C], { env: { ...process.env, HOME: H }, stdio: "ignore" });
  const B = path.join(H, "b-interval.md");
  const r = sh(H, path.join(V3BIN, "compose-v3-adj-world.sh"), ["v3adj-t1", GOAL, B, C, "45"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/v3adj-t1/workspace");
  assert.ok(fs.existsSync(path.join(W, "frontier/ACCOUNTING.json")));
  assert.ok(fs.existsSync(path.join(W, "frontier/verdicts.jsonl")));
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.ts")), "full visibility");
  const dw = JSON.parse(fs.readFileSync(path.join(H, "control-runs/v3adj-t1/settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("/modules")), "history read-only");
  assert.ok(!dw.some((p) => p.endsWith("/decisions")), "decisions writable");
  assert.match(fs.readFileSync(path.join(W, "MANDATE.md"), "utf8"), /decisions\/0001-/);
});

test("driver dry-run sequences the conversation", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const B = path.join(H, "b-interval.md");
  const r = sh(H, path.join(V3BIN, "run-ledger.sh"), [C, B, "--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /compose-v3-code-world/);
  assert.match(r.out, /dry sequence complete/);
});
