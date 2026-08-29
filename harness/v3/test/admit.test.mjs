// admit.test.mjs — the v3 admission gate: floors then kernel commit.
// Key inversion vs v2: red suites admit; only shape floors refuse.
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
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "v3admit-"));

const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const sh = (H, script, args) => {
  try {
    return { code: 0, out: execFileSync("bash", [script, ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
const git = (H, ...args) => execFileSync("git", ["-C", path.join(H, "campaign/history"), ...args],
  { encoding: "utf8" }).trim();

const mkCampaign = () => {
  const H = fs.mkdtempSync(path.join(SCRATCH, "h-"));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const C = path.join(H, "campaign");
  fs.mkdirSync(C, { recursive: true });
  const r = sh(H, path.join(V3BIN, "init-history.sh"), [C]);
  assert.equal(r.code, 0, r.out);
  return { H, C };
};
// a session workspace: platform kit + checkout of history modules/
const mkWorld = (H, name, module) => {
  const W = path.join(H, "control-runs", name, "workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  execFileSync("bash", [path.join(V2BIN, "scope-tsconfig.sh"), W, module], { stdio: "ignore" });
  const hm = path.join(H, "campaign/history/modules");
  if (fs.existsSync(hm)) fs.cpSync(hm, path.join(W, "modules"), { recursive: true });
  return W;
};

const STUB = "export declare const width: (lo: number, hi: number) => number;\n";
const DOC = `import test from 'node:test';
import assert from 'node:assert/strict';
import { width } from '#modules/interval/index.js';
test('width', () => { assert.equal(width(1, 4), 3); });
`;
const OPAQUE = `import test from 'node:test';
import assert from 'node:assert/strict';
import { width } from '#modules/interval/index.js';
test('degenerate', () => { assert.equal(width(2, 2), 0, 'expected 0'); });
`;
const CODE_GREEN = "export const width = (lo: number, hi: number): number => hi - lo;\n";
const CODE_RED = "export const width = (lo: number, hi: number): number => hi - lo + 1;\n";

test("init refuses a second history", () => {
  const { H, C } = mkCampaign();
  const r = sh(H, path.join(V3BIN, "init-history.sh"), [C]);
  assert.notEqual(r.code, 0);
});

test("tests kind: valid estate admits; stub never publishes; published tests immutable", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, C } = mkCampaign();
  const W = mkWorld(H, "q-1", "interval");
  write(path.join(W, "modules/interval/index.ts"), STUB);
  write(path.join(W, "modules/interval/test/doc/d.test.ts"), DOC);
  write(path.join(W, "modules/interval/test/opaque/o.test.ts"), OPAQUE);
  const r = sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ADMITTED: tests/);
  assert.ok(fs.existsSync(path.join(C, "history/modules/interval/test/doc/d.test.ts")));
  assert.ok(!fs.existsSync(path.join(C, "history/modules/interval/index.ts")), "stub excluded");
  assert.match(git(H, "log", "--oneline"), /tests from q-1/);
  // editing a published test refuses
  const W2 = mkWorld(H, "q-2", "interval");
  write(path.join(W2, "modules/interval/index.ts"), STUB);
  write(path.join(W2, "modules/interval/test/doc/d.test.ts"), DOC.replace("3", "4"));
  const r2 = sh(H, path.join(V3BIN, "admit.sh"), [C, "q-2", "tests"]);
  assert.notEqual(r2.code, 0);
  assert.match(r2.out, /immutable/);
});

test("tests kind: non-test path refused; type-broken estate refused by stub floor", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, C } = mkCampaign();
  const W = mkWorld(H, "q-bad", "interval");
  write(path.join(W, "modules/interval/notes.md"), "notes");
  const r = sh(H, path.join(V3BIN, "admit.sh"), [C, "q-bad", "tests"]);
  assert.notEqual(r.code, 0);
  const W2 = mkWorld(H, "q-typ", "interval");
  write(path.join(W2, "modules/interval/index.ts"), STUB);
  write(path.join(W2, "modules/interval/test/doc/d.test.ts"),
    DOC.replace("width(1, 4)", "width('a', 4)"));
  write(path.join(W2, "modules/interval/test/opaque/o.test.ts"), OPAQUE);
  const r2 = sh(H, path.join(V3BIN, "admit.sh"), [C, "q-typ", "tests"]);
  assert.notEqual(r2.code, 0);
  assert.match(r2.out, /compile/);
});

test("code kind: RED suite still admits (the inversion); test-touch refused; def edit refused", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, C } = mkCampaign();
  // publish the estate first
  const Wq = mkWorld(H, "q-1", "interval");
  write(path.join(Wq, "modules/interval/index.ts"), STUB);
  write(path.join(Wq, "modules/interval/test/doc/d.test.ts"), DOC);
  write(path.join(Wq, "modules/interval/test/opaque/o.test.ts"), OPAQUE);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);
  // code delivery whose suite is red: admits anyway
  const Wc = mkWorld(H, "c-red", "interval");
  write(path.join(Wc, "modules/interval/index.ts"), CODE_RED);
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: Wc, stdio: "ignore" });
  const r = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-red", "code"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(C, "history/modules/interval/index.ts")));
  // touching tests refused
  const Wt = mkWorld(H, "c-t", "interval");
  write(path.join(Wt, "modules/interval/test/doc/extra.test.ts"), DOC);
  const rt = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-t", "code"]);
  assert.notEqual(rt.code, 0);
  assert.match(rt.out, /never touch tests/);
  // editing the published def in place refused (accretion)
  const We = mkWorld(H, "c-e", "interval");
  write(path.join(We, "modules/interval/index.ts"), CODE_GREEN); // same def name, different body
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: We, stdio: "ignore" });
  const re = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-e", "code"]);
  assert.notEqual(re.code, 0, re.out);
  assert.match(re.out, /accretion|edited/i);
});

test("code kind: challenge needs TEST: line; decision kind adds decisions only; deletion refused", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, C } = mkCampaign();
  const Wq = mkWorld(H, "q-1", "interval");
  write(path.join(Wq, "modules/interval/index.ts"), STUB);
  write(path.join(Wq, "modules/interval/test/doc/d.test.ts"), DOC);
  write(path.join(Wq, "modules/interval/test/opaque/o.test.ts"), OPAQUE);
  assert.equal(sh(H, path.join(V3BIN, "admit.sh"), [C, "q-1", "tests"]).code, 0);
  const Wc = mkWorld(H, "c-1", "interval");
  write(path.join(Wc, "modules/interval/index.ts"), CODE_GREEN);
  write(path.join(Wc, "challenges/interval-degenerate.md"), "bad row\n");
  execFileSync("node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"], { cwd: Wc, stdio: "ignore" });
  const r = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /TEST:/);
  write(path.join(Wc, "challenges/interval-degenerate.md"),
    "TEST: modules/interval/test/opaque/o.test.ts\nThe degenerate row contradicts the brief.\n");
  const r2 = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-1", "code"]);
  assert.equal(r2.code, 0, r2.out);
  assert.ok(fs.existsSync(path.join(C, "history/challenges/interval-degenerate.md")));
  // decision
  const Wd = mkWorld(H, "d-1", "x");
  write(path.join(Wd, "decisions/0001-collect-degenerate.md"), "COLLECT test o.test.ts; reason...\n");
  const rd = sh(H, path.join(V3BIN, "admit.sh"), [C, "d-1", "decision"]);
  assert.equal(rd.code, 0, rd.out);
  // deletion refused
  const Wx = mkWorld(H, "c-x", "interval");
  fs.rmSync(path.join(Wx, "modules/interval/test/doc/d.test.ts"));
  const rx = sh(H, path.join(V3BIN, "admit.sh"), [C, "c-x", "code"]);
  assert.notEqual(rx.code, 0);
  assert.match(rx.out, /append-only/);
});
