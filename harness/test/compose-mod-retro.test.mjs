// compose-mod-retro.test.mjs — module-cycle retro worlds for both
// halves: candidates + VALIDATION facts + stamps + half-specific
// judgment framing + next-brief deliverable spec.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, write } from "./stubs.mjs";

const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");
const hasPayload = fs.existsSync(path.join(PLATFORM, "payload/platform"));

const sh = (H, args) => {
  try {
    return { code: 0, out: execFileSync("bash", [path.join(BIN, "compose-mod-retro.sh"), ...args],
      { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};

const DOC = `import test from 'node:test';
import assert from 'node:assert/strict';
test('placeholder', () => { assert.equal(1, 1); });
`;

const mkQeCandidate = (H, name, { omitOpaque = false } = {}) => {
  const W = path.join(H, "control-runs", name, "workspace");
  fs.mkdirSync(W, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W], { stdio: "ignore" });
  write(path.join(W, "modules/interval/test/doc/basics.test.ts"), DOC);
  if (!omitOpaque) write(path.join(W, "modules/interval/test/opaque/edge.test.ts"), DOC);
  write(path.join(H, "control-runs", name, "home/.pi/agent/sessions/s/a.jsonl"), '{"n":1}\n');
};

test("qe-half retro world: facts, stamps, suite-judgment framing, next-brief spec", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = path.join(H, "campaign");
  fs.mkdirSync(C, { recursive: true });
  write(path.join(C, "plan/plan.md"), "# plan\ncycle-1: interval (noun)\n");
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: cycle\nMODULE: interval\nKIND: noun\n\nThe interval noun: interval(lo, hi), width, contains.\n");
  mkQeCandidate(H, "q-1");
  mkQeCandidate(H, "q-2", { omitOpaque: true });

  const r = sh(H, ["retro-i1", GOAL, BRIEF, C, "qe", "q-1", "q-2"]);
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/retro-i1");
  const W = path.join(R, "workspace");
  assert.equal(fs.readFileSync(path.join(R, "TYPE"), "utf8").trim(), "qe");
  assert.equal(fs.readFileSync(path.join(R, "MODULE"), "utf8").trim(), "interval");
  assert.ok(fs.existsSync(path.join(W, "candidates/q-1/modules/interval/test/doc/basics.test.ts")));
  assert.match(fs.readFileSync(path.join(W, "candidates/q-1/VALIDATION.txt"), "utf8"), /OK: qe candidate/);
  assert.match(fs.readFileSync(path.join(W, "candidates/q-2/VALIDATION.txt"), "utf8"), /REJECT/);
  assert.ok(fs.existsSync(path.join(W, "plan/plan.md")));
  assert.ok(fs.existsSync(path.join(W, "platform/PHASE-CONTRACT.md")));
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /The interval noun: interval\(lo, hi\), width, contains\./);
  assert.match(mandate, /requirements corpus/);
  assert.match(mandate, /failure-message clarity/i);
  assert.match(mandate, /BANK: <run-name>/);
  assert.match(mandate, /TYPE: cycle/);
  const dw = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8")).filesystem.denyWrite;
  assert.ok(dw.some((p) => p.endsWith("/workspace/candidates")));
});

test("code-half retro world: probe-beyond framing, trunk mounted", (t) => {
  if (!hasPayload) { t.skip("payload not built"); return; }
  const { H, GOAL } = fakeHome();
  const C = path.join(H, "campaign");
  // a minimal banked trunk with the qe-half suite
  const E = path.join(C, "trunk/entry-1");
  fs.mkdirSync(path.join(C, "trunk"), { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), E], { stdio: "ignore" });
  write(path.join(E, "modules/interval/test/doc/basics.test.ts"), DOC);
  fs.symlinkSync("entry-1", path.join(C, "trunk/current"));
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: cycle\nMODULE: interval\nKIND: noun\n\nThe interval noun.\n");
  // one code candidate (uncompiled — VALIDATION will REJECT; facts still carried)
  const W1 = path.join(H, "control-runs/c-1/workspace");
  fs.mkdirSync(W1, { recursive: true });
  execFileSync("bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W1], { stdio: "ignore" });
  write(path.join(W1, "modules/interval/index.ts"), "export const nope: number = 'x';");
  write(path.join(H, "control-runs/c-1/home/.pi/agent/sessions/s/a.jsonl"), '{"n":1}\n');

  const r = sh(H, ["retro-i2", GOAL, BRIEF, C, "code", "c-1"]);
  assert.equal(r.code, 0, r.out);
  const W = path.join(H, "control-runs/retro-i2/workspace");
  assert.equal(fs.readFileSync(path.join(H, "control-runs/retro-i2/TYPE"), "utf8").trim(), "code");
  assert.match(fs.readFileSync(path.join(W, "candidates/c-1/VALIDATION.txt"), "utf8"), /REJECT: compile/);
  assert.ok(fs.existsSync(path.join(W, "modules/interval/test/doc/basics.test.ts")), "trunk mounted read-only");
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /floor, not the ceiling/);
  assert.match(mandate, /probe BEYOND/);
});
