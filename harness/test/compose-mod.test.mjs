// compose-mod.test.mjs — REAL-script tests for the modular code-world
// composer: header parsing, interface-only dep mounting, file-level
// freezing of banked source, platform payload, sandbox shape.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, write } from "./stubs.mjs";

const SCRIPT = path.join(BIN, "compose-mod-world.sh");
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
  // banked dep 'tokens': implementation + interface + doc and opaque tests
  write(path.join(T, "tokens/index.ts"), "export const t = 1;");
  write(path.join(T, "tokens/index.js"), "export const t = 1;");
  write(path.join(T, "tokens/index.d.ts"), "export declare const t: number;");
  write(path.join(T, "tokens/test/doc/basics.test.ts"), "// doc test source");
  write(path.join(T, "tokens/test/doc/basics.test.js"), "// doc test compiled");
  write(path.join(T, "tokens/test/opaque/edge.test.ts"), "// opaque source");
  write(path.join(T, "tokens/test/opaque/edge.test.js"), "// opaque compiled");
  // banked own module 'lexer' (for the reopen case)
  write(path.join(T, "lexer/index.ts"), "export const lex = 1;");
  write(path.join(T, "lexer/index.js"), "export const lex = 1;");
  write(path.join(T, "lexer/index.d.ts"), "export declare const lex: number;");
  write(path.join(T, "lexer/test/opaque/l.test.js"), "// t");
  fs.symlinkSync("entry-1", path.join(C, "trunk/current"));
  return C;
};

test("bootstrap module world: fresh writable module, dep interface only, payload mounted", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: cycle\nMODULE: parser\nKIND: verb\nDEPENDS: tokens,\n\nBuild the parser verbs over tokens.\n");
  const r = compose(H, ["mw-1", GOAL, BRIEF, C, "60"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/mw-1/workspace");
  // own module: fresh dir, writable (not in denyWrite)
  assert.ok(fs.existsSync(path.join(W, "modules/parser")));
  // dep: interface + compiled + doc tests — never implementation or opaque sources
  assert.ok(fs.existsSync(path.join(W, "modules/tokens/index.d.ts")));
  assert.ok(fs.existsSync(path.join(W, "modules/tokens/index.js")));
  assert.ok(!fs.existsSync(path.join(W, "modules/tokens/index.ts")), "dep implementation hidden");
  assert.ok(fs.existsSync(path.join(W, "modules/tokens/test/doc/basics.test.ts")), "doc tests are interface");
  assert.ok(!fs.existsSync(path.join(W, "modules/tokens/test/opaque")), "opaque tests not mounted in dep");
  // platform payload + world config
  assert.ok(fs.existsSync(path.join(W, "platform/CODE-CONTRACT.md")));
  assert.ok(fs.existsSync(path.join(W, "platform/values/core.d.ts")));
  assert.ok(fs.existsSync(path.join(W, "node_modules/typescript/lib/tsc.js")));
  const pkg = JSON.parse(fs.readFileSync(path.join(W, "package.json"), "utf8"));
  assert.equal(pkg.imports["#platform/*"], "./platform/*");
  // mandate: goal + brief verbatim, module identity, commands
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /Build the parser verbs over tokens\./);
  assert.match(mandate, /\*\*parser\*\* \(kind: verb\)/);
  assert.match(mandate, /platform\/lint\/check\.js modules\/parser/);
  // sandbox: platform/deps/tests denied; own module dir NOT denied
  const settings = JSON.parse(fs.readFileSync(path.join(H, "control-runs/mw-1/settings.json"), "utf8"));
  const dw = settings.filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("/workspace/platform")));
  assert.ok(dw.some((p) => p.endsWith("/modules/tokens")));
  assert.ok(dw.some((p) => p.endsWith("/modules/parser/test")));
  assert.ok(!dw.some((p) => p.endsWith("/modules/parser")), "own module writable");
});

test("reopen world: banked own source frozen at file level, emitted js regenerable", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const BRIEF = path.join(H, "brief2.md");
  write(BRIEF, "TYPE: cycle\nMODULE: lexer\nKIND: verb\n\nExpand the lexer: add lex2.\n");
  const r = compose(H, ["mw-2", GOAL, BRIEF, C, "60"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/mw-2/workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/lexer/index.ts")), "own banked source present");
  const dw = JSON.parse(fs.readFileSync(path.join(H, "control-runs/mw-2/settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("modules/lexer/index.ts")), "banked .ts frozen");
  assert.ok(!dw.some((p) => p.endsWith("modules/lexer/index.js")), "emitted .js regenerable");
});

test("header validation: wrong TYPE, missing MODULE, bad KIND, unbanked dep all refuse", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const cases = [
    ["TYPE: code\nMODULE: x\nKIND: verb\n", /TYPE/],
    ["TYPE: cycle\nKIND: verb\n", /MODULE/],
    ["TYPE: cycle\nMODULE: x\nKIND: widget\n", /KIND/],
    ["TYPE: cycle\nMODULE: x\nKIND: verb\nDEPENDS: ghost\n", /ghost.*not banked|not banked/],
  ];
  for (const [hdrs, re] of cases) {
    const B = path.join(H, `b-${Math.random().toString(36).slice(2)}.md`);
    write(B, hdrs + "\nBody.\n");
    const r = compose(H, ["mw-bad", GOAL, B, C, "60"]);
    assert.notEqual(r.code, 0, hdrs);
    assert.match(r.out, re);
  }
});

test("DEPENDS prose normalization: 'none (platform values only)' means leaf", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = mkCampaign(H);
  const B = path.join(H, "b-none.md");
  write(B, "TYPE: cycle\nMODULE: fresh\nKIND: noun\nDEPENDS: none (platform values only)\n\nBody.\n");
  const r = compose(H, ["mw-none", GOAL, B, C, "60"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /deps=\[\]/);
});

test("transitive runtime closure: dep's own imports mounted as runtime support", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = path.join(H, "campaign");
  const T = path.join(C, "trunk/entry-1/modules");
  write(path.join(T, "b/index.js"), "export const b = 1;");
  write(path.join(T, "b/index.d.ts"), "export declare const b: number;");
  write(path.join(T, "b/test/doc/d.test.ts"), "// b doc");
  write(path.join(T, "a/index.js"), "import { b } from '#modules/b/index.js';\nexport const a = b;");
  write(path.join(T, "a/index.d.ts"), "export declare const a: number;");
  fs.symlinkSync("entry-1", path.join(C, "trunk/current"));
  const B = path.join(H, "b-trans.md");
  write(B, "TYPE: cycle\nMODULE: c\nKIND: verb\nDEPENDS: a\n\nBody.\n");
  const r = compose(H, ["mw-trans", GOAL, B, C, "60"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/mw-trans/workspace");
  assert.ok(fs.existsSync(path.join(W, "modules/b/index.js")), "runtime closure mounted");
  assert.ok(!fs.existsSync(path.join(W, "modules/b/test")), "no doc tests for undeclared deps");
  const dw = JSON.parse(fs.readFileSync(path.join(H, "control-runs/mw-trans/settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("/modules/b")), "transitive mount write-denied");
});
