// machine.test.mjs — the fixture catalogue, scripted through the pure state
// machine. v1.1 spec (settled 2026-08-22): THE FRAMEWORK FORMS NO OPINION
// about banking. Grading produces facts (gate results, isolated-recheck
// outcomes, challenge-file presence); the retro alone judges; the driver
// executes the verdict mechanically; bank-trunk.sh is the sole mechanical
// enforcer (green on post-fold delta + strict progress). Escalations are
// mechanical-only: phase-invalid, no judgeable worlds, missing
// deliverables, malformed verdict, redo (held for operator), unknown
// winner, plan REJECT, bank VOID, budget, driver error.
import test from "node:test";
import assert from "node:assert/strict";
import { initialState, nextAction, reduce } from "../machine.mjs";

const CFG = { entry: "entry-9", cycles: 1, cohortSize: 3, capS: 5400, retroCapS: 5400 };

function drive(config, script, { maxSteps = 200 } = {}) {
  let state = initialState(config);
  const trace = [];
  const counts = {};
  for (let i = 0; i < maxSteps; i++) {
    const a = nextAction(state);
    if (a === null) return { state, trace };
    trace.push(a);
    let result = null;
    if (!a.internal) {
      const k = counts[a.type] ?? 0;
      counts[a.type] = k + 1;
      const s = script[a.type];
      if (s === undefined) throw new Error(`unscripted action: ${a.type}`);
      result = typeof s === "function" ? s(a, k) : s;
    }
    state = reduce(state, a, result);
  }
  throw new Error("machine did not terminate");
}

const greenRun = (name) => ({ name, exit: "exit=0", capOut: false, spend: "0.41", startedAt: "T0", endedAt: "T1" });
const SINGLE = { ok: true, layered: false, layers: 1 };
const GREEN_GATE = { ok: true, total: 2758, nonPassIds: [], hasChallenges: false };

function happyScript(overrides = {}) {
  return {
    VALIDATE_PHASE: SINGLE,
    RUN_COHORT: (a) => ({ runs: a.runs.map(greenRun) }),
    GATE_RUN: GREEN_GATE,
    WRITE_KERNEL_LOG: { ok: true },
    COMPOSE_RETRO: { ok: true },
    LAUNCH_RETRO: { exit: "exit=0", spend: "0.30" },
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "BANK: entry9-2\n\nrationale" },
    FOLD_PLAN: { ok: true, output: "" },
    BANK: { ok: true, output: "" },
    CHECK_NEXT: { declared: true },
    ...overrides,
  };
}

// ---------- core sequencing ------------------------------------------------

test("single-layer happy path: exact action sequence, DONE, banked", () => {
  const { state, trace } = drive(CFG, happyScript());
  assert.deepEqual(
    trace.map((a) => a.type),
    ["VALIDATE_PHASE", "RUN_COHORT", "GATE_RUN", "GATE_RUN", "GATE_RUN",
     "WRITE_KERNEL_LOG", "COMPOSE_RETRO", "LAUNCH_RETRO", "CHECK_DELIVERABLES",
     "FOLD_PLAN", "BANK"]
  );
  assert.equal(state.step, "DONE");
  assert.deepEqual(state.banked, [{ entry: "entry-9", winner: "entry9-2" }]);
  assert.equal(state.escalation, null);
});

test("BANK action carries the retro name (bank-trunk's plan-workspace source)", () => {
  const { trace } = drive(CFG, happyScript());
  const bank = trace.find((a) => a.type === "BANK");
  assert.equal(bank.retro, "retro-e9");
  assert.equal(bank.winner, "entry9-2");
  assert.equal(bank.subjectRel, "src/engine/index.ts");
});

test("layered happy path: assemble per lineage, lineage facts in kernel log", () => {
  const lineageRun = (name) => ({
    ...greenRun(name),
    lineage: { status: "COMPLETE", layers: 2, finalWorkspace: `/cr/${name}-L2/workspace` },
  });
  const { state, trace } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: true, layered: true, layers: 2 },
    RUN_COHORT: (a) => ({ runs: a.runs.map(lineageRun) }),
    ASSEMBLE_LINEAGE: { ok: true },
  }));
  const types = trace.map((a) => a.type);
  assert.deepEqual(types.slice(0, 5), ["VALIDATE_PHASE", "RUN_COHORT", "ASSEMBLE_LINEAGE", "ASSEMBLE_LINEAGE", "ASSEMBLE_LINEAGE"]);
  assert.equal(types.filter((t) => t === "GATE_RUN").length, 3);
  assert.equal(state.step, "DONE");
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /entry9-1: 2 layers, all inter-layer validations green/);
});

// ---------- grading = facts, never opinions --------------------------------

test("load flake: recheck passes, fact recorded, cycle proceeds", () => {
  const { state, trace } = drive(CFG, happyScript({
    GATE_RUN: (a, k) =>
      k === 1
        ? { ok: true, total: 2758, nonPassIds: ["test/S8.5.1.js"], hasChallenges: false }
        : GREEN_GATE,
    RECHECK_RUN: { passedIds: ["test/S8.5.1.js"], failedIds: [] },
  }));
  assert.equal(state.step, "DONE");
  assert.equal(trace.filter((a) => a.type === "RECHECK_RUN").length, 1);
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /re-run in isolation — 1 passed \(load flake\), 0 still red/);
});

test("hard red survives recheck: recorded as fact, NO escalation, no opinion", () => {
  const { state } = drive(CFG, happyScript({
    GATE_RUN: (a, k) =>
      k === 0 ? { ok: true, total: 2758, nonPassIds: ["test/x.js"], hasChallenges: false } : GREEN_GATE,
    RECHECK_RUN: { passedIds: [], failedIds: ["test/x.js"] },
  }));
  assert.equal(state.step, "DONE");
  assert.deepEqual(state.runs[0].grade.recheck.failedIds, ["test/x.js"]);
  assert.ok(!("bankable" in state.runs[0]), "framework must not hold a bank opinion");
});

test("ALL runs red: cycle STILL proceeds to the retro (the retro judges, not us)", () => {
  const { state, trace } = drive(CFG, happyScript({
    GATE_RUN: { ok: true, total: 2758, nonPassIds: ["test/x.js"], hasChallenges: true },
    RECHECK_RUN: { passedIds: [], failedIds: ["test/x.js"] },
  }));
  assert.equal(state.step, "DONE");
  assert.ok(trace.some((a) => a.type === "COMPOSE_RETRO"));
  assert.ok(trace.some((a) => a.type === "BANK"));
});

test("all-challenge cohort: challenge facts in kernel log, uninterpreted", () => {
  const { trace } = drive(CFG, happyScript({
    GATE_RUN: { ok: true, total: 2758, nonPassIds: ["test/r1.js", "test/r2.js"], hasChallenges: true },
    RECHECK_RUN: (a) => ({ passedIds: [], failedIds: a.ids }),
  }));
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /entry9-1: CHALLENGES\.md filed \(contents not interpreted by the platform\)/);
  assert.match(klog, /entry9-2: CHALLENGES\.md filed/);
  assert.ok(!/bankable/i.test(klog), "kernel log must carry no bank opinion");
});

test("halted lineage: facts recorded; if the retro banks it, the framework executes", () => {
  const mk = (name, i) =>
    i === 0
      ? { ...greenRun(name), exit: "exit=1", lineage: { status: "HALTED", haltedLayer: 2, layers: 2, finalWorkspace: `/cr/${name}-L2/workspace` } }
      : { ...greenRun(name), lineage: { status: "COMPLETE", layers: 2, finalWorkspace: `/cr/${name}-L2/workspace` } };
  const { state, trace } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: true, layered: true, layers: 2 },
    RUN_COHORT: (a) => ({ runs: a.runs.map(mk) }),
    ASSEMBLE_LINEAGE: { ok: true },
    GATE_RUN: (a) =>
      a.run === "entry9-1" ? { ok: true, total: 2758, nonPassIds: ["test/y.js"], hasChallenges: false } : GREEN_GATE,
    RECHECK_RUN: { passedIds: [], failedIds: ["test/y.js"] },
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "BANK: entry9-1\n" },
  }));
  assert.equal(state.step, "DONE"); // bank-trunk (scripted ok) is the only arbiter
  assert.equal(trace.find((a) => a.type === "BANK").winner, "entry9-1");
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /entry9-1: lineage HALTED at layer 2/);
});

test("gate tool error on one run: fact recorded, not fatal", () => {
  const { state } = drive(CFG, happyScript({
    GATE_RUN: (a, k) => (k === 0 ? { ok: false, gateExit: 124 } : GREEN_GATE),
  }));
  assert.equal(state.step, "DONE");
  assert.equal(state.runs[0].grade.gateError, true);
});

// ---------- mechanical escalations (the only kind) --------------------------

test("world/launch error: run excluded, retro sees the rest, fact recorded", () => {
  const { state, trace } = drive(CFG, happyScript({
    RUN_COHORT: (a) => ({
      runs: a.runs.map((n, i) => (i === 1 ? { name: n, error: "compose failed", exit: null } : greenRun(n))),
    }),
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "BANK: entry9-3\n" },
  }));
  assert.equal(state.step, "DONE");
  const retro = trace.find((a) => a.type === "COMPOSE_RETRO");
  assert.deepEqual(retro.runs, ["entry9-1", "entry9-3"]);
  assert.equal(trace.filter((a) => a.type === "GATE_RUN").length, 2);
  assert.match(trace.find((a) => a.type === "WRITE_KERNEL_LOG").content, /entry9-2: world\/launch error/);
});

test("all runs lost → escalate no-runs (nothing to judge is mechanical)", () => {
  const { state } = drive(CFG, happyScript({
    RUN_COHORT: (a) => ({ runs: a.runs.map((n) => ({ name: n, error: "launch failed" })) }),
  }));
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "no-runs");
});

test("missing core deliverables → escalate with the list", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: ["DECISION.md", "REVISION.md"], nextDeclared: false, decisionText: null },
  }));
  assert.equal(state.escalation.reason, "missing-deliverables");
  assert.deepEqual(state.escalation.detail.missing, ["DECISION.md", "REVISION.md"]);
});

test("invalid verdict line → escalate invalid-verdict", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "# DECISION — winner entry9-2\n" },
  }));
  assert.equal(state.escalation.reason, "invalid-verdict");
});

test("REDO verdict → escalate redo (held for the operator)", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "REDO: the brief mis-scopes the module\n" },
  }));
  assert.equal(state.escalation.reason, "redo");
  assert.match(state.escalation.detail.reason, /mis-scopes/);
});

test("ORDER: REDO with NO next phase declared is redo, NOT missing-deliverables", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: false, decisionText: "REDO: rerun under revised entry-9\n" },
  }));
  assert.equal(state.escalation.reason, "redo");
});

test("BANK verdict with NO next phase declared → missing-deliverables", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: false, decisionText: "BANK: entry9-2\n" },
  }));
  assert.equal(state.escalation.reason, "missing-deliverables");
  assert.deepEqual(state.escalation.detail.missing, ["plan/entry-10/ declaration"]);
});

test("BANK names a run outside the cohort → escalate winner-unknown (no code to bank)", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "BANK: entry8-3\n" },
  }));
  assert.equal(state.escalation.reason, "winner-unknown");
});

test("BANK names an excluded (worldless) run → winner-unknown", () => {
  const { state } = drive(CFG, happyScript({
    RUN_COHORT: (a) => ({
      runs: a.runs.map((n, i) => (i === 1 ? { name: n, error: "compose failed" } : greenRun(n))),
    }),
    CHECK_DELIVERABLES: { missingCore: [], nextDeclared: true, decisionText: "BANK: entry9-2\n" },
  }));
  assert.equal(state.escalation.reason, "winner-unknown");
});

test("commit-plan REJECT → escalate plan-rejected, no bank", () => {
  const { state, trace } = drive(CFG, happyScript({
    FOLD_PLAN: { ok: false, output: "commit-plan REJECTED: phase entry-10 violates the scope rule" },
  }));
  assert.equal(state.escalation.reason, "plan-rejected");
  assert.ok(!trace.some((a) => a.type === "BANK"));
});

test("bank VOID (kernel refused what the plan blessed) → escalate bank-void", () => {
  const { state } = drive(CFG, happyScript({ BANK: { ok: false, output: "BANK VOID: no new accepted cases" } }));
  assert.equal(state.escalation.reason, "bank-void");
  assert.match(state.escalation.detail, /VOID/);
});

test("budget cap: expensive steps blocked once wall budget is spent", () => {
  const { state, trace } = drive({ ...CFG, maxWallS: 100 }, happyScript({
    RUN_COHORT: (a) => ({ runs: a.runs.map(greenRun), elapsedS: 200 }),
    LAUNCH_RETRO: () => { throw new Error("must not launch retro over budget"); },
  }));
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "budget");
  assert.ok(trace.some((a) => a.type === "GATE_RUN")); // cheap evidence-gathering still ran
});

test("invalid phase declaration → escalate phase-invalid, nothing launched", () => {
  const { state, trace } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: false, error: "REJECT [entry-9]: missing cases.txt" },
  }));
  assert.equal(state.escalation.reason, "phase-invalid");
  assert.equal(trace.length, 1);
});

// ---------- multi-cycle + reuse ---------------------------------------------

test("two-cycle chain: advances to entry-10 with fresh cohort names", () => {
  const cohorts = [];
  const { state } = drive({ ...CFG, cycles: 2 }, happyScript({
    RUN_COHORT: (a) => { cohorts.push(a.runs); return { runs: a.runs.map(greenRun) }; },
    CHECK_DELIVERABLES: (a) => ({ missingCore: [], nextDeclared: true, decisionText: `BANK: entry${a.nextEntry === "entry-10" ? 9 : 10}-1\n` }),
  }));
  assert.equal(state.step, "DONE");
  assert.deepEqual(cohorts, [
    ["entry9-1", "entry9-2", "entry9-3"],
    ["entry10-1", "entry10-2", "entry10-3"],
  ]);
});

test("single cycle does NOT require CHECK_NEXT", () => {
  const { trace } = drive(CFG, happyScript({ CHECK_NEXT: () => { throw new Error("must not run"); } }));
  assert.ok(!trace.some((a) => a.type === "CHECK_NEXT"));
});

test("next phase missing on a multi-cycle run → escalate next-phase-missing", () => {
  const { state } = drive({ ...CFG, cycles: 2 }, happyScript({ CHECK_NEXT: { declared: false } }));
  assert.equal(state.escalation.reason, "next-phase-missing");
  assert.deepEqual(state.banked, [{ entry: "entry-9", winner: "entry9-2" }]);
});

test("fromGrading: REUSE_COHORT replaces RUN_COHORT, then normal flow", () => {
  const { state, trace } = drive({ ...CFG, fromGrading: true }, happyScript({
    REUSE_COHORT: (a) => ({ runs: a.runs.map(greenRun) }),
    RUN_COHORT: () => { throw new Error("must not launch a fresh cohort"); },
  }));
  assert.equal(state.step, "DONE");
  assert.equal(trace.filter((a) => a.type === "REUSE_COHORT").length, 1);
});

test("fromGrading applies ONLY to the first cycle; cycle 2 runs fresh", () => {
  const seen = [];
  const { state } = drive({ ...CFG, cycles: 2, fromGrading: true }, happyScript({
    REUSE_COHORT: (a) => { seen.push(["reuse", a.entry]); return { runs: a.runs.map(greenRun) }; },
    RUN_COHORT: (a) => { seen.push(["run", a.entry]); return { runs: a.runs.map(greenRun) }; },
    CHECK_DELIVERABLES: (a) => ({ missingCore: [], nextDeclared: true, decisionText: `BANK: entry${a.nextEntry === "entry-10" ? 9 : 10}-1\n` }),
  }));
  assert.equal(state.step, "DONE");
  assert.deepEqual(seen, [["reuse", "entry-9"], ["run", "entry-10"]]);
});

// ---------- kernel log charter ----------------------------------------------

test("kernel log is facts-only: no analysis vocabulary ever appears", () => {
  const { trace } = drive(CFG, happyScript({
    GATE_RUN: (a, k) => (k === 2 ? { ok: true, total: 10, nonPassIds: ["z.js"], hasChallenges: false } : GREEN_GATE),
    RECHECK_RUN: { passedIds: ["z.js"], failedIds: [] },
  }));
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  for (const banned of [/I think/i, /probably/i, /should we/i, /\?\s*$/m, /recommend/i, /bankable/i]) {
    assert.ok(!banned.test(klog), `kernel log contains opinion-like text: ${banned}`);
  }
  assert.match(klog, /Facts below are mechanical observations/);
});

test("retro cap-out with deliverables intact still proceeds to fold+bank", () => {
  const { state } = drive(CFG, happyScript({
    LAUNCH_RETRO: { exit: "exit=124", capOut: true, spend: "0.90" },
  }));
  assert.equal(state.step, "DONE");
});

test("retro cap-out WITHOUT deliverables escalates and says the retro capped", () => {
  const { state } = drive(CFG, happyScript({
    LAUNCH_RETRO: { exit: "exit=124", capOut: true },
    CHECK_DELIVERABLES: { missingCore: ["DECISION.md"], nextDeclared: false, decisionText: null },
  }));
  assert.equal(state.escalation.reason, "missing-deliverables");
  assert.equal(state.escalation.detail.retroCapOut, true);
});
