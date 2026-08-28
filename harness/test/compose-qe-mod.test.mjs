// compose-qe-mod.test.mjs — REAL-script tests for the modular QE-world
// composer: test-only writable surface, interface-only mounts,
// perspective separation, test accretion on reopen.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, write } from "./stubs.mjs";

const SCRIPT = path.join(BIN, "compose-qe-mod-world.sh");
const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");

const compose = (H, args) => {
  try {
    return { code: 0, out: execFileSync("bash", [SCRIPT, ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};

const mkCampaign = (H) => {
  const C = path.join(H, "campaign");
  const T = path.join(C, "trunk/entry-1/modules");
  write(path.join(T, "tokens/index.ts"), "export const t = 1;");
  write(path.join(T, "tokens/index.js"), "export const t = 1;");
  write(path.join(T, "tokens/index.d.ts"), "export declare const t: number;");
  write(path.join(T, "tokens/test/doc/basics.test.js"), "// doc compiled");
  write(path.join(T, "lexer/index.ts"), "export const lex = 1;");
  write(path.join(T, "lexer/index.js"), "export const lex = 1;");
  write(path.join(T, "lexer/index.d.ts"), "export declare const lex: number;");
  write(path.join(T, "lexer/test/opaque/l.test.ts"), "// banked opaque source");
  write(path.join(T, "lexer/test/opaque/l.test.js"), "// banked opaque compiled");
  fs.symlinkSync("entry-1", path.join(C, "trunk/current"));
  return C;
};

test("bootstrap QE world: test-only writable, born-red framing, doc/opaque deliverables", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: cycle\nMODULE: parser\nKIND: verb\nDEPENDS: tokens\n\nSuite for the parser verbs.\n");
  const r = compose(H, ["qmw-1", GOAL, BRIEF, C, "45"]);
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/qmw-1");
  const W = path.join(R, "workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/parser/test")));
  assert.ok(!fs.existsSync(path.join(W, "modules/parser/index.ts")), "module does not exist yet");
  assert.ok(fs.existsSync(path.join(W, "modules/tokens/index.d.ts")), "dep interface mounted");
  assert.ok(!fs.existsSync(path.join(W, "modules/tokens/index.ts")), "dep implementation hidden");
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /Suite for the parser verbs\./);
  assert.match(mandate, /test\/doc\/\*\.test\.ts/);
  assert.match(mandate, /test\/opaque\/\*\.test\.ts/);
  assert.match(mandate, /born red/);
  assert.match(mandate, /never see their code/);
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.allowWrite.some((p) => p.endsWith("/modules/parser/test")),
    "writable surface is the test dir only");
  assert.ok(!settings.filesystem.allowWrite.some((p) => p.endsWith("/workspace")));
});

test("reopen QE world: interface mounted, banked test sources frozen, accretion framing", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const BRIEF = path.join(H, "brief2.md");
  write(BRIEF, "TYPE: cycle\nMODULE: lexer\nKIND: verb\n\nPin more lexer behavior.\n");
  const r = compose(H, ["qmw-2", GOAL, BRIEF, C, "45"]);
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/qmw-2");
  const W = path.join(R, "workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/lexer/index.d.ts")), "own interface visible");
  assert.ok(!fs.existsSync(path.join(W, "modules/lexer/index.ts")), "own implementation hidden from QE");
  assert.ok(fs.existsSync(path.join(W, "modules/lexer/test/opaque/l.test.ts")), "banked tests present");
  const dw = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("test/opaque/l.test.ts")), "banked test source frozen");
  assert.match(fs.readFileSync(path.join(W, "MANDATE.md"), "utf8"), /FROZEN/);
});

test("header validation: code brief refused", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const B = path.join(H, "bad.md");
  write(B, "TYPE: qe\nMODULE: x\nKIND: verb\n\nBody.\n");
  const r = compose(H, ["qmw-bad", GOAL, B, C, "45"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /TYPE/);
});
