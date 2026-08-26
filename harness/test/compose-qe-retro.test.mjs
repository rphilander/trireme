// compose-qe-retro.test.mjs — REAL-script test for the QE-retro world
// composer: candidates + validation facts + transcripts + verdict mandate
// + phase TYPE stamp.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, qeWorkspace, write } from "./stubs.mjs";

const SCRIPT = path.join(BIN, "compose-qe-retro.sh");

test("qe retro world: candidates, VALIDATION facts, transcripts, brief, verdict mandate, TYPE stamp", () => {
  const { H, TESTS, GOAL } = fakeHome();
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: qe\n\nAuthor the gate module and a first tranche.\n");

  // one conforming candidate, one incomplete candidate
  const good = qeWorkspace();
  fs.mkdirSync(path.join(H, "control-runs/qx-1"), { recursive: true });
  fs.cpSync(good, path.join(H, "control-runs/qx-1/workspace"), { recursive: true });
  // extra root-level code outside the fixed layout is part of the module
  // (banking adopts the whole workspace) and must reach the retro
  write(path.join(H, "control-runs/qx-1/workspace/lib/helper.mjs"), "// shared");
  write(path.join(H, "control-runs/qx-1/workspace/tests/decoy.js"), "// corpus hardlink stand-in");
  const bad = qeWorkspace({ omit: ["contract", "budgets"] });
  fs.mkdirSync(path.join(H, "control-runs/qx-2"), { recursive: true });
  fs.cpSync(bad, path.join(H, "control-runs/qx-2/workspace"), { recursive: true });
  for (const name of ["qx-1", "qx-2"]) {
    write(path.join(H, "control-runs", name, "home/.pi/agent/sessions/s/a.jsonl"), '{"n":1}\n');
  }

  execFileSync("bash", [SCRIPT, "retro-qx", TESTS, GOAL, BRIEF, "qx-1", "qx-2"], {
    env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"],
  });

  const R = path.join(H, "control-runs/retro-qx");
  const W = path.join(R, "workspace");
  // per-candidate: full module surface, transcript, validation FACTS
  assert.ok(fs.existsSync(path.join(W, "candidates/qx-1/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(W, "candidates/qx-1/scope/cases.txt")));
  assert.ok(fs.existsSync(path.join(W, "candidates/qx-1/suite/self/run.mjs")));
  assert.ok(fs.existsSync(path.join(W, "candidates/qx-1/lib/helper.mjs")),
    "whole workspace carried (what banking would adopt), not a whitelist");
  assert.ok(!fs.existsSync(path.join(W, "candidates/qx-1/tests")), "candidate's corpus hardlink never carried");
  assert.ok(!fs.existsSync(path.join(W, "candidates/qx-1/MANDATE.md")));
  assert.ok(fs.existsSync(path.join(W, "candidates/qx-1/transcript.jsonl")));
  assert.match(fs.readFileSync(path.join(W, "candidates/qx-1/VALIDATION.txt"), "utf8"), /OK:/);
  assert.match(fs.readFileSync(path.join(W, "candidates/qx-2/VALIDATION.txt"), "utf8"), /REJECT/);
  // acceptance tests present for probe-based judgment
  assert.ok(fs.existsSync(path.join(W, "tests/suite/alpha.spec.js")));
  // mandate: goal + brief verbatim, machine verdict, decide-only language
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /Author the gate module and a first tranche\./);
  assert.match(mandate, /BANK: <run-name>/);
  assert.match(mandate, /REDO:/);
  assert.match(mandate, /never edit[\s\S]{0,3}their deliverables/i);
  // phase TYPE stamped for bank-phase dispatch
  assert.equal(fs.readFileSync(path.join(R, "TYPE"), "utf8").trim(), "qe");
  // sandbox: candidates and tests write-denied
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/candidates")));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/tests")));
});
