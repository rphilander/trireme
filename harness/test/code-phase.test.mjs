// code-phase.test.mjs — REAL-script tests for the code-phase machinery:
// world composer, grading by the campaign gate, code retro, code banking,
// and brief authorship (brief-writer world + mechanical adoption).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeCampaign, codeWorkspace, write } from "./stubs.mjs";

function run(script, args, env) {
  try {
    return { code: 0, out: execFileSync("bash", [path.join(BIN, script), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
}

const CODE_BRIEF = "TYPE: code\n\nImplement the engine core; bank tranche-1 cases.\n";

test("compose-code-world: gate hardlinked read-only, product convention, verbatim goal+brief", () => {
  const { H, GOAL, CAMPAIGN } = fakeCampaign();
  const BRIEF = path.join(H, "brief2.md");
  write(BRIEF, CODE_BRIEF);
  const r = run("compose-code-world.sh", ["cx-1", GOAL, BRIEF, path.join(CAMPAIGN, "gate/current"), "90"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/cx-1");
  // the banked gate ships in the world, hardlinked
  assert.ok(fs.existsSync(path.join(R, "workspace/gate/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(R, "workspace/gate/scope/cases.txt")));
  assert.ok(fs.statSync(path.join(R, "workspace/gate/bridge/run.mjs")).nlink > 1, "gate hardlinked, not copied");
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /Implement the engine core; bank tranche-1 cases\./);
  assert.match(mandate, /product\//);
  assert.match(mandate, /BUILD\.md/);
  assert.match(mandate, /gate\/contract\.d\.ts/);
  assert.match(mandate, /node gate\/bridge\/run\.mjs --subject product/);
  assert.match(mandate, /newly-passing/i);
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/gate")), "gate write-denied (invariant 2)");
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/MANDATE.md")));
});

test("compose-code-world: qe brief → refuse", () => {
  const { H, GOAL, CAMPAIGN } = fakeCampaign();
  const BRIEF = path.join(H, "briefq.md");
  write(BRIEF, "TYPE: qe\n\nWrong type.\n");
  const r = run("compose-code-world.sh", ["cx-bad", GOAL, BRIEF, path.join(CAMPAIGN, "gate/current"), "90"], { HOME: H });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /TYPE/);
});

test("grade-code: grades with the campaign gate; facts reported; missing product → REJECT", () => {
  const { H, CAMPAIGN } = fakeCampaign();
  const W = codeWorkspace();
  const out = path.join(H, "grade.json");
  const r = run("grade-code.sh", [CAMPAIGN, W, out], { HOME: H });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 pass, 0 fail, 0 unsupported/);
  const grade = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(grade.results.length, 2);
  // an empty product grades all-fail but grading itself succeeds
  const We = codeWorkspace({ empty: true });
  const r2 = run("grade-code.sh", [CAMPAIGN, We, out], { HOME: H });
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /0 pass, 2 fail/);
  // no product/ → mechanical reject
  const Wm = codeWorkspace();
  fs.rmSync(path.join(Wm, "product"), { recursive: true });
  const r3 = run("grade-code.sh", [CAMPAIGN, Wm, out], { HOME: H });
  assert.notEqual(r3.code, 0);
  assert.match(r3.out, /REJECT/);
});

test("compose-code-retro: candidates + GRADE facts + stamps + next-brief deliverable", () => {
  const { H, TESTS, GOAL, CAMPAIGN } = fakeCampaign();
  const BRIEF = path.join(H, "brief2.md");
  write(BRIEF, CODE_BRIEF);
  for (const [name, empty] of [["cw-1", false], ["cw-2", true]]) {
    const W = codeWorkspace({ empty });
    fs.mkdirSync(path.join(H, "control-runs", name), { recursive: true });
    fs.cpSync(W, path.join(H, "control-runs", name, "workspace"), { recursive: true });
    write(path.join(H, "control-runs", name, "home/.pi/agent/sessions/s/a.jsonl"), '{"n":1}\n');
  }
  const r = run("compose-code-retro.sh", ["retro-cx", TESTS, GOAL, BRIEF, CAMPAIGN, "cw-1", "cw-2"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/retro-cx");
  const W = path.join(R, "workspace");
  assert.ok(fs.existsSync(path.join(W, "candidates/cw-1/product/index.mjs")));
  assert.ok(fs.existsSync(path.join(W, "candidates/cw-1/transcript.jsonl")));
  assert.match(fs.readFileSync(path.join(W, "candidates/cw-1/VALIDATION.txt"), "utf8"), /2 pass/);
  assert.match(fs.readFileSync(path.join(W, "candidates/cw-2/VALIDATION.txt"), "utf8"), /0 pass/);
  assert.ok(fs.existsSync(path.join(W, "candidates/cw-1/GRADE.json")));
  // the gate ships for probe-based judgment; the plan for brief authorship;
  // the platform contracts so the authored brief cannot re-invent interfaces
  assert.ok(fs.existsSync(path.join(W, "gate/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(W, "platform/PHASE-CONTRACT.md")));
  assert.equal(fs.readFileSync(path.join(R, "TYPE"), "utf8").trim(), "code");
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /BANK: <run-name>/);
  assert.match(mandate, /Implement the engine core/);
  assert.match(mandate, /briefs\//, "retro must be asked to author the next phase's brief");
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/candidates")));
});

test("bank-phase code: strict progress vs empty trunk, then VOID on no-new; gate untouched", () => {
  const { H, CAMPAIGN } = fakeCampaign();
  const W = codeWorkspace();
  fs.mkdirSync(path.join(H, "control-runs/cw-1"), { recursive: true });
  fs.cpSync(W, path.join(H, "control-runs/cw-1/workspace"), { recursive: true });
  write(path.join(H, "control-runs/retro-c1/TYPE"), "code\n");
  write(path.join(H, "control-runs/retro-c1/workspace/DECISION.md"), "BANK: cw-1\n");
  const r = run("bank-phase.sh", [CAMPAIGN, "retro-c1"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "trunk/entry-1/product/index.mjs")));
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "trunk/entry-1/GRADE.json")));
  assert.equal(fs.readlinkSync(path.join(CAMPAIGN, "trunk/current")), "entry-1");
  assert.match(fs.readFileSync(path.join(CAMPAIGN, "history.log"), "utf8"), /BANK code retro=retro-c1 winner=cw-1 trunk\/entry-1 \(2 new\)/);
  // code banks never touch gate/
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "gate/entry-2")));
  // an identical winner brings nothing new → VOID
  write(path.join(H, "control-runs/retro-c2/TYPE"), "code\n");
  write(path.join(H, "control-runs/retro-c2/workspace/DECISION.md"), "BANK: cw-1\n");
  const r2 = run("bank-phase.sh", [CAMPAIGN, "retro-c2"], { HOME: H });
  assert.equal(r2.code, 2, r2.out);
  assert.match(r2.out, /BANK VOID: no newly-passing/);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "trunk/entry-2")));
});

test("compose-brief-world: plan + gate visible, next-brief deliverable, TYPE convention", () => {
  const { H, GOAL, CAMPAIGN } = fakeCampaign();
  write(path.join(CAMPAIGN, "plan/plan.md"), "# plan\nphase-2 (code): engine core\n");
  write(path.join(CAMPAIGN, "plan/briefs/phase-1.md"), "TYPE: qe\n\nDone already.\n");
  const r = run("compose-brief-world.sh", ["bw-1", GOAL, CAMPAIGN, "2", "30"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  const R = path.join(H, "control-runs/bw-1");
  assert.ok(fs.existsSync(path.join(R, "workspace/plan/plan.md")));
  assert.ok(fs.existsSync(path.join(R, "workspace/gate/bridge/run.mjs")));
  // the platform's fixed contracts ship into brief-authoring worlds so a
  // brief cannot re-invent layouts or invocations
  assert.ok(fs.existsSync(path.join(R, "workspace/platform/PHASE-CONTRACT.md")));
  assert.ok(fs.existsSync(path.join(R, "workspace/platform/QE-CONTRACT.md")));
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /briefs\/phase-2\.md/);
  assert.match(mandate, /TYPE: qe|TYPE: code/);
  assert.match(mandate, /self-contained/i);
  assert.match(mandate, /never re-specify|do not re-specify/i);
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/plan")));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/gate")));
});

test("adopt-brief: legal brief → committed into campaign plan; bad TYPE → refuse", () => {
  const { H, CAMPAIGN } = fakeCampaign();
  // campaign plan repo
  write(path.join(CAMPAIGN, "plan/plan.md"), "# plan\n");
  write(path.join(CAMPAIGN, "plan/briefs/phase-1.md"), "TYPE: qe\n\nDone.\n");
  execFileSync("git", ["init", "-q"], { cwd: path.join(CAMPAIGN, "plan") });
  execFileSync("git", ["add", "-A"], { cwd: path.join(CAMPAIGN, "plan") });
  execFileSync("git", ["-c", "user.name=kernel", "-c", "user.email=kernel@trireme.local", "commit", "-qm", "v1"],
    { cwd: path.join(CAMPAIGN, "plan") });
  write(path.join(H, "control-runs/bw-1/workspace/briefs/phase-2.md"), CODE_BRIEF);
  const r = run("adopt-brief.sh", [CAMPAIGN, "bw-1", "briefs/phase-2.md"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "plan/briefs/phase-2.md")));
  const log = execFileSync("git", ["log", "--format=%an %s", "-1"], { cwd: path.join(CAMPAIGN, "plan"), encoding: "utf8" });
  assert.match(log, /kernel/);
  assert.match(log, /bw-1/);
  // refuse a brief without a legal TYPE line
  write(path.join(H, "control-runs/bw-2/workspace/briefs/phase-3.md"), "Do things.\n");
  const r2 = run("adopt-brief.sh", [CAMPAIGN, "bw-2", "briefs/phase-3.md"], { HOME: H });
  assert.notEqual(r2.code, 0);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "plan/briefs/phase-3.md")));
});
