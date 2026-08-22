// machine.test.mjs — the fixture catalogue, scripted through the pure state
// machine. Every incident class we've met (or designed against) in eight
// manual cycles gets a fast deterministic test here: wedge/cap-out, lineage
// halt, load-flake recheck, hard-red recheck, missing deliverables, invalid
// verdict, REDO, unknown/red winner, plan REJECT, bank VOID, budget cap,
// multi-cycle chaining, world-composition loss.
import test from "node:test";
import assert from "node:assert/strict";
import { initialState, nextAction, reduce, renderKernelLog } from "../machine.mjs";

const CFG = { entry: "entry-9", cycles: 1, cohortSize: 3, capS: 5400, retroCapS: 5400 };

// drive the machine with a table of scripted results keyed by action type
// (value = result object, or a function(action, callIndexForType) => result).
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

function happyScript(overrides = {}) {
  return {
    VALIDATE_PHASE: SINGLE,
    RUN_COHORT: (a) => ({ runs: a.runs.map(greenRun) }),
    GATE_RUN: { ok: true, total: 2758, nonPassIds: [] },
    WRITE_KERNEL_LOG: { ok: true },
    COMPOSE_RETRO: { ok: true },
    LAUNCH_RETRO: { exit: "exit=0", spend: "0.30" },
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry9-2\n\nrationale" },
    FOLD_PLAN: { ok: true, output: "" },
    BANK: { ok: true, output: "" },
    CHECK_NEXT: { declared: true },
    ...overrides,
  };
}

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

test("load flake: recheck passes, run stays bankable, fact recorded", () => {
  const { state, trace } = drive(CFG, happyScript({
    GATE_RUN: (a, k) =>
      k === 1
        ? { ok: true, total: 2758, nonPassIds: ["test/S8.5.1.js"] }
        : { ok: true, total: 2758, nonPassIds: [] },
    RECHECK_RUN: { passedIds: ["test/S8.5.1.js"], failedIds: [] },
  }));
  assert.equal(state.step, "DONE");
  assert.equal(trace.filter((a) => a.type === "RECHECK_RUN").length, 1);
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /re-run in isolation — 1 passed \(load flake\), 0 still red/);
});

test("hard red survives recheck: run not bankable; others carry the cohort", () => {
  const { state } = drive(CFG, happyScript({
    GATE_RUN: (a, k) =>
      k === 0
        ? { ok: true, total: 2758, nonPassIds: ["test/x.js"] }
        : { ok: true, total: 2758, nonPassIds: [] },
    RECHECK_RUN: { passedIds: [], failedIds: ["test/x.js"] },
  }));
  assert.equal(state.step, "DONE");
  assert.equal(state.runs[0].bankable, false);
  assert.equal(state.runs[1].bankable, true);
});

test("all runs red → escalate no-bankable BEFORE any retro is composed", () => {
  const { state, trace } = drive(CFG, happyScript({
    GATE_RUN: { ok: true, total: 2758, nonPassIds: ["test/x.js"] },
    RECHECK_RUN: { passedIds: [], failedIds: ["test/x.js"] },
  }));
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "no-bankable");
  assert.ok(!trace.some((a) => a.type === "COMPOSE_RETRO"));
});

test("halted lineage: graded as evidence, never bankable, retro still runs", () => {
  const mk = (name, i) =>
    i === 0
      ? { ...greenRun(name), exit: "exit=1", lineage: { status: "HALTED", haltedLayer: 2, layers: 2, finalWorkspace: `/cr/${name}-L2/workspace` } }
      : { ...greenRun(name), lineage: { status: "COMPLETE", layers: 2, finalWorkspace: `/cr/${name}-L2/workspace` } };
  const { state, trace } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: true, layered: true, layers: 2 },
    RUN_COHORT: (a) => ({ runs: a.runs.map(mk) }),
    ASSEMBLE_LINEAGE: { ok: true },
    GATE_RUN: (a, k) =>
      a.run === "entry9-1"
        ? { ok: true, total: 2758, nonPassIds: ["test/y.js"] }
        : { ok: true, total: 2758, nonPassIds: [] },
    RECHECK_RUN: { passedIds: [], failedIds: ["test/y.js"] },
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry9-3\n" },
  }));
  assert.equal(state.step, "DONE");
  assert.equal(state.runs[0].bankable, false);
  const retro = trace.find((a) => a.type === "COMPOSE_RETRO");
  assert.deepEqual(retro.runs, ["entry9-1", "entry9-2", "entry9-3"]); // halted run included as evidence
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  assert.match(klog, /entry9-1: lineage HALTED at layer 2/);
});

test("halted lineage that gates green is STILL not bankable (stack incomplete)", () => {
  const mk = (name, i) =>
    i === 0
      ? { ...greenRun(name), lineage: { status: "HALTED", haltedLayer: 1, layers: 2, finalWorkspace: `/x` } }
      : { ...greenRun(name), lineage: { status: "COMPLETE", layers: 2, finalWorkspace: `/x` } };
  const { state } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: true, layered: true, layers: 2 },
    RUN_COHORT: (a) => ({ runs: a.runs.map(mk) }),
    ASSEMBLE_LINEAGE: { ok: true },
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry9-2\n" },
  }));
  assert.equal(state.runs[0].bankable, false);
  assert.equal(state.step, "DONE");
});

test("world/launch error: run excluded, retro sees the rest, fact recorded", () => {
  const { state, trace } = drive(CFG, happyScript({
    RUN_COHORT: (a) => ({
      runs: a.runs.map((n, i) => (i === 1 ? { name: n, error: "compose failed", exit: null } : greenRun(n))),
    }),
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry9-3\n" },
  }));
  assert.equal(state.step, "DONE");
  const retro = trace.find((a) => a.type === "COMPOSE_RETRO");
  assert.deepEqual(retro.runs, ["entry9-1", "entry9-3"]);
  assert.equal(trace.filter((a) => a.type === "GATE_RUN").length, 2);
  assert.match(trace.find((a) => a.type === "WRITE_KERNEL_LOG").content, /entry9-2: world\/launch error/);
});

test("all runs lost → escalate no-runs", () => {
  const { state } = drive(CFG, happyScript({
    RUN_COHORT: (a) => ({ runs: a.runs.map((n) => ({ name: n, error: "launch failed" })) }),
  }));
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "no-runs");
});

test("gate tool error on one run: red, not fatal", () => {
  const { state } = drive(CFG, happyScript({
    GATE_RUN: (a, k) => (k === 0 ? { ok: false, gateExit: 124 } : { ok: true, total: 2758, nonPassIds: [] }),
  }));
  assert.equal(state.step, "DONE");
  assert.equal(state.runs[0].bankable, false);
});

test("missing deliverables → escalate with the list", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missing: ["REVISION.md", "plan/entry-10/cases.txt"], decisionText: null },
  }));
  assert.equal(state.escalation.reason, "missing-deliverables");
  assert.deepEqual(state.escalation.detail.missing, ["REVISION.md", "plan/entry-10/cases.txt"]);
});

test("invalid verdict line → escalate invalid-verdict", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missing: [], decisionText: "# DECISION — winner entry9-2\n" },
  }));
  assert.equal(state.escalation.reason, "invalid-verdict");
});

test("REDO verdict → escalate redo with the reason (held for the operator)", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missing: [], decisionText: "REDO: the brief mis-scopes the module\n" },
  }));
  assert.equal(state.escalation.reason, "redo");
  assert.match(state.escalation.detail.reason, /mis-scopes/);
});

test("BANK names a run outside the cohort → escalate winner-unknown", () => {
  const { state } = drive(CFG, happyScript({
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry8-3\n" },
  }));
  assert.equal(state.escalation.reason, "winner-unknown");
});

test("BANK names a red run → escalate winner-not-bankable before touching trunk", () => {
  const { state, trace } = drive(CFG, happyScript({
    GATE_RUN: (a, k) => (k === 0 ? { ok: true, total: 10, nonPassIds: ["t.js"] } : { ok: true, total: 10, nonPassIds: [] }),
    RECHECK_RUN: { passedIds: [], failedIds: ["t.js"] },
    CHECK_DELIVERABLES: { missing: [], decisionText: "BANK: entry9-1\n" },
  }));
  assert.equal(state.escalation.reason, "winner-not-bankable");
  assert.ok(!trace.some((a) => a.type === "BANK"));
});

test("commit-plan REJECT → escalate plan-rejected, no bank", () => {
  const { state, trace } = drive(CFG, happyScript({
    FOLD_PLAN: { ok: false, output: "commit-plan REJECTED: phase entry-10 violates the scope rule" },
  }));
  assert.equal(state.escalation.reason, "plan-rejected");
  assert.ok(!trace.some((a) => a.type === "BANK"));
});

test("bank VOID → escalate bank-void", () => {
  const { state } = drive(CFG, happyScript({ BANK: { ok: false, output: "gate red — bank VOID" } }));
  assert.equal(state.escalation.reason, "bank-void");
});

test("budget cap: expensive steps blocked once wall budget is spent", () => {
  const { state, trace } = drive({ ...CFG, maxWallS: 100 }, happyScript({
    VALIDATE_PHASE: SINGLE,
    RUN_COHORT: (a) => ({ runs: a.runs.map(greenRun), elapsedS: 200 }),
    LAUNCH_RETRO: () => { throw new Error("must not launch retro over budget"); },
  }));
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "budget");
  // cheap grading/klog steps still ran — evidence is preserved for the operator
  assert.ok(trace.some((a) => a.type === "GATE_RUN"));
});

test("two-cycle chain: advances to entry-10 with fresh cohort names", () => {
  const cohorts = [];
  const { state } = drive({ ...CFG, cycles: 2 }, happyScript({
    RUN_COHORT: (a) => { cohorts.push(a.runs); return { runs: a.runs.map(greenRun) }; },
    CHECK_DELIVERABLES: (a) => ({ missing: [], decisionText: `BANK: entry${a.nextEntry === "entry-10" ? 9 : 10}-1\n` }),
  }));
  assert.equal(state.step, "DONE");
  assert.deepEqual(cohorts, [
    ["entry9-1", "entry9-2", "entry9-3"],
    ["entry10-1", "entry10-2", "entry10-3"],
  ]);
  assert.deepEqual(state.banked, [
    { entry: "entry-9", winner: "entry9-1" },
    { entry: "entry-10", winner: "entry10-1" },
  ]);
});

test("single cycle does NOT check/require the next phase declaration", () => {
  const { trace } = drive(CFG, happyScript({ CHECK_NEXT: () => { throw new Error("must not run"); } }));
  assert.ok(!trace.some((a) => a.type === "CHECK_NEXT"));
});

test("next phase missing on a multi-cycle run → escalate next-phase-missing", () => {
  const { state } = drive({ ...CFG, cycles: 2 }, happyScript({ CHECK_NEXT: { declared: false } }));
  assert.equal(state.escalation.reason, "next-phase-missing");
  assert.deepEqual(state.banked, [{ entry: "entry-9", winner: "entry9-2" }]); // cycle 1 landed
});

test("invalid phase declaration → escalate phase-invalid, nothing launched", () => {
  const { state, trace } = drive(CFG, happyScript({
    VALIDATE_PHASE: { ok: false, error: "REJECT [entry-9]: missing cases.txt" },
  }));
  assert.equal(state.escalation.reason, "phase-invalid");
  assert.equal(trace.length, 1);
});

test("kernel log is facts-only: no analysis vocabulary ever appears", () => {
  const { trace } = drive(CFG, happyScript({
    GATE_RUN: (a, k) => (k === 2 ? { ok: true, total: 10, nonPassIds: ["z.js"] } : { ok: true, total: 10, nonPassIds: [] }),
    RECHECK_RUN: { passedIds: ["z.js"], failedIds: [] },
  }));
  const klog = trace.find((a) => a.type === "WRITE_KERNEL_LOG").content;
  for (const banned of [/I think/i, /probably/i, /should we/i, /\?\s*$/m, /recommend/i]) {
    assert.ok(!banned.test(klog), `kernel log contains analysis-like text: ${banned}`);
  }
  assert.match(klog, /Facts below are mechanical observations/);
});

test("retro cap-out with deliverables intact still proceeds to fold+bank", () => {
  const { state } = drive(CFG, happyScript({
    LAUNCH_RETRO: { exit: "exit=124", capOut: true, spend: "0.90" },
  }));
  assert.equal(state.step, "DONE"); // artifacts were complete; exit code is not the arbiter
});

test("retro cap-out WITHOUT deliverables escalates and says the retro capped", () => {
  const { state } = drive(CFG, happyScript({
    LAUNCH_RETRO: { exit: "exit=124", capOut: true },
    CHECK_DELIVERABLES: { missing: ["DECISION.md"], decisionText: null },
  }));
  assert.equal(state.escalation.reason, "missing-deliverables");
  assert.equal(state.escalation.detail.retroCapOut, true);
});
