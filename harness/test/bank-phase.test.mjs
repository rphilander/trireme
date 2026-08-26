// bank-phase.test.mjs — REAL-script tests for the phase bank: verdict
// parse, TYPE dispatch, isolated recheck, gate entries, void records.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, qeWorkspace, write } from "./stubs.mjs";

function setup({ decision, type = "qe", winnerOk = true } = {}) {
  const { H, TESTS } = fakeHome();
  const CAMPAIGN = path.join(H, "campaign");
  fs.mkdirSync(CAMPAIGN, { recursive: true });
  // retro run with TYPE stamp + CORPUS stamp + DECISION.md
  write(path.join(H, "control-runs/retro-1/TYPE"), type + "\n");
  write(path.join(H, "control-runs/retro-1/CORPUS"), TESTS + "\n");
  write(path.join(H, "control-runs/retro-1/workspace/DECISION.md"), decision);
  // winner run — includes the world artifacts a real workspace carries
  const W = winnerOk ? qeWorkspace() : qeWorkspace({ omit: ["budgets"] });
  fs.mkdirSync(path.join(H, "control-runs/qw-1"), { recursive: true });
  fs.cpSync(W, path.join(H, "control-runs/qw-1/workspace"), { recursive: true });
  write(path.join(H, "control-runs/qw-1/workspace/MANDATE.md"), "# world mandate");
  write(path.join(H, "control-runs/qw-1/workspace/tests/decoy.js"), "// materialized corpus copy");
  return { H, CAMPAIGN, TESTS };
}

function bank(H, CAMPAIGN, retro = "retro-1") {
  try {
    return { code: 0, out: execFileSync("bash", [path.join(BIN, "bank-phase.sh"), CAMPAIGN, retro],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: H } }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
}

test("qe BANK with valid winner → gate/entry-1 + current symlink + history", () => {
  const { H, CAMPAIGN } = setup({ decision: "BANK: qw-1\n\nrationale...\n" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "gate/entry-1/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "gate/entry-1/scope/cases.txt")));
  assert.equal(fs.readlinkSync(path.join(CAMPAIGN, "gate/current")), "entry-1");
  // world artifacts excluded; corpus re-linked from the stamp, not copied
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate/entry-1/MANDATE.md")));
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate/entry-1/tests/decoy.js")));
  const relinked = path.join(CAMPAIGN, "gate/entry-1/tests/suite/alpha.spec.js");
  assert.ok(fs.existsSync(relinked), "corpus present in the banked gate");
  assert.ok(fs.statSync(relinked).nlink > 1, "corpus hardlinked, not materialized");
  const hist = fs.readFileSync(path.join(CAMPAIGN, "history.log"), "utf8");
  assert.match(hist, /BANK qe retro=retro-1 winner=qw-1 gate\/entry-1/);
});

test("markdown-decorated verdict line is tolerated", () => {
  const { H, CAMPAIGN } = setup({ decision: "## **BANK: qw-1**\n\nrationale\n" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "gate/entry-1")));
});

test("second qe BANK → entry-2, current repointed", () => {
  const { H, CAMPAIGN } = setup({ decision: "BANK: qw-1\n" });
  assert.equal(bank(H, CAMPAIGN).code, 0);
  // a second retro banking the same winner again
  write(path.join(H, "control-runs/retro-2/TYPE"), "qe\n");
  write(path.join(H, "control-runs/retro-2/workspace/DECISION.md"), "BANK: qw-1\n");
  const r = bank(H, CAMPAIGN, "retro-2");
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "gate/entry-2")));
  assert.equal(fs.readlinkSync(path.join(CAMPAIGN, "gate/current")), "entry-2");
});

test("qe BANK with winner failing recheck → VOID (exit 2), void record, no entry", () => {
  const { H, CAMPAIGN } = setup({ decision: "BANK: qw-1\n", winnerOk: false });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANK VOID/);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate/entry-1")));
  const voids = fs.readdirSync(path.join(CAMPAIGN, "void"));
  assert.equal(voids.length, 1);
  assert.match(fs.readFileSync(path.join(CAMPAIGN, "void", voids[0], "VALIDATION.txt"), "utf8"), /REJECT/);
  assert.match(fs.readFileSync(path.join(CAMPAIGN, "history.log"), "utf8"), /VOID/);
});

test("REDO → exit 3, nothing banked, history records it", () => {
  const { H, CAMPAIGN } = setup({ decision: "REDO: framing must change\n" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /REDO: framing must change/);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate")));
  assert.match(fs.readFileSync(path.join(CAMPAIGN, "history.log"), "utf8"), /REDO/);
});

test("code phase against a gateless campaign → VOID (regrade impossible)", () => {
  const { H, CAMPAIGN } = setup({ decision: "BANK: qw-1\n", type: "code" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANK VOID/);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate")));
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "trunk")));
});

test("garbage verdict line → exit 1 escalation", () => {
  const { H, CAMPAIGN } = setup({ decision: "I think we should probably bank qw-1.\n" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /verdict/i);
});

test("BANK naming a missing run → exit 1 escalation", () => {
  const { H, CAMPAIGN } = setup({ decision: "BANK: no-such-run\n" });
  const r = bank(H, CAMPAIGN);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no-such-run/);
});
