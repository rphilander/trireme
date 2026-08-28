// plan.test.mjs — REAL-script tests for the planner world composer, the
// plan validator, and plan adoption into a campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, SCRATCH, fakeHome, write } from "./stubs.mjs";

function run(script, args, env) {
  try {
    return { code: 0, out: execFileSync("bash", [path.join(BIN, script), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
}

function planWorkspace({ omit = [], phase1Type = "qe", extraBrief } = {}) {
  const W = fs.mkdtempSync(path.join(SCRATCH, "plan-"));
  if (!omit.includes("plan")) write(path.join(W, "plan/plan.md"), "# plan\n\nphase-1 (qe): bootstrap the gate\n");
  if (!omit.includes("brief")) write(path.join(W, "plan/briefs/phase-1.md"), `TYPE: ${phase1Type}\n\nBootstrap the gate module.\n`);
  if (extraBrief) write(path.join(W, "plan/briefs/phase-2.md"), extraBrief);
  return W;
}

test("compose-plan-world: goal verbatim, bootstrap rule, TYPE convention, tests read-only", () => {
  const { H, TESTS, GOAL } = fakeHome();
  execFileSync("bash", [path.join(BIN, "compose-plan-world.sh"), "plan-x1", TESTS, GOAL, "60"], {
    env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"],
  });
  const R = path.join(H, "control-runs/plan-x1");
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /TYPE: qe/);
  assert.match(mandate, /[Pp]hase 1 .*qe|qe.* [Pp]hase 1/s);
  assert.match(mandate, /plan\/briefs\/phase-1\.md/);
  // briefs are the only channel to a cohort — the mandate must say so
  assert.match(mandate, /self-contained/i);
  // the planner must see the platform's fixed interfaces so briefs
  // cannot contradict them, and must be told briefs never re-specify them
  assert.match(mandate, /--subject/);
  assert.match(mandate, /scope\/cases\.txt/);
  assert.match(mandate, /never re-specify|do not re-specify/i);
  for (const banned of [/test262/i, /webgl/i, /es5/i]) {
    assert.ok(!banned.test(mandate), `mandate leaks domain vocabulary: ${banned}`);
  }
  assert.ok(fs.existsSync(path.join(R, "workspace/tests/suite/alpha.spec.js")));
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/tests")));
  assert.match(fs.readFileSync(path.join(R, "prompt.txt"), "utf8"), /60 minutes/);
});

test("validate-plan: conforming plan OK", () => {
  const r = run("validate-plan.sh", [planWorkspace()]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
});

test("validate-plan: missing plan.md or phase-1 brief → REJECT", () => {
  for (const omit of ["plan", "brief"]) {
    const r = run("validate-plan.sh", [planWorkspace({ omit: [omit] })]);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /REJECT/);
  }
});

test("validate-plan: phase-1 brief typed code → REJECT (bootstrap rule)", () => {
  const r = run("validate-plan.sh", [planWorkspace({ phase1Type: "code" })]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /phase 1|qe/i);
});

test("validate-plan: any brief without a legal TYPE first line → REJECT", () => {
  const r = run("validate-plan.sh", [planWorkspace({ extraBrief: "Do more things.\n" })]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /TYPE/);
});

test("adopt-plan: valid plan → campaign/plan git repo with kernel commit", () => {
  const { H } = fakeHome();
  const W = planWorkspace();
  fs.mkdirSync(path.join(H, "control-runs/plan-a/workspace"), { recursive: true });
  fs.cpSync(W, path.join(H, "control-runs/plan-a/workspace"), { recursive: true });
  const CAMPAIGN = path.join(H, "campaign");
  const r = run("adopt-plan.sh", [CAMPAIGN, "plan-a"], { HOME: H });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "plan/plan.md")));
  assert.ok(fs.existsSync(path.join(CAMPAIGN, "plan/briefs/phase-1.md")));
  const log = execFileSync("git", ["log", "--format=%an %s"], { cwd: path.join(CAMPAIGN, "plan"), encoding: "utf8" });
  assert.match(log, /kernel/);
  assert.match(log, /plan-a/);
});

test("adopt-plan: invalid plan → refuse, nothing adopted", () => {
  const { H } = fakeHome();
  const W = planWorkspace({ phase1Type: "code" });
  fs.mkdirSync(path.join(H, "control-runs/plan-b/workspace"), { recursive: true });
  fs.cpSync(W, path.join(H, "control-runs/plan-b/workspace"), { recursive: true });
  const CAMPAIGN = path.join(H, "campaign");
  const r = run("adopt-plan.sh", [CAMPAIGN, "plan-b"], { HOME: H });
  assert.notEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(CAMPAIGN, "plan")));
});

test("validate-plan: modular cycle briefs — conformant, leaf rule, header rules", () => {
  const W = fs.mkdtempSync(path.join(SCRATCH, "mplan-"));
  write(path.join(W, "plan/plan.md"), "# module map\n");
  write(path.join(W, "plan/briefs/cycle-1.md"), "TYPE: cycle\nMODULE: values-core\nKIND: noun\n\nBody.\n");
  const ok = run("validate-plan.sh", [W]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /modular plan conformant/);

  write(path.join(W, "plan/briefs/cycle-1.md"), "TYPE: cycle\nMODULE: x\nKIND: noun\nDEPENDS: y\n\nBody.\n");
  const leaf = run("validate-plan.sh", [W]);
  assert.notEqual(leaf.code, 0);
  assert.match(leaf.out, /leaf/);

  write(path.join(W, "plan/briefs/cycle-1.md"), "TYPE: cycle\nMODULE: x\nKIND: widget\n\nBody.\n");
  const kind = run("validate-plan.sh", [W]);
  assert.notEqual(kind.code, 0);
  assert.match(kind.out, /KIND/);
});
