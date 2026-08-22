import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGate, recheckOutcome, mergeRecheck } from "../grade.mjs";

const gate = (pairs) => ({ results: pairs.map(([id, status]) => ({ id, status })) });

test("analyzeGate all green", () => {
  const a = analyzeGate(gate([["a.js", "pass"], ["b.js", "pass"]]));
  assert.deepEqual(a, { ok: true, total: 2, nonPassIds: [] });
});
test("analyzeGate flags every non-pass status", () => {
  const a = analyzeGate(gate([["a.js", "pass"], ["b.js", "fail"], ["c.js", "timeout"], ["d.js", "error"]]));
  assert.deepEqual(a.nonPassIds, ["b.js", "c.js", "d.js"]);
});
test("analyzeGate on malformed json is not ok", () => {
  assert.equal(analyzeGate(null).ok, false);
  assert.equal(analyzeGate({}).ok, false);
});
test("recheckOutcome splits flakes from real reds", () => {
  const r = recheckOutcome(["b.js", "c.js"], gate([["b.js", "pass"], ["c.js", "fail"]]));
  assert.deepEqual(r, { passedIds: ["b.js"], failedIds: ["c.js"] });
});
test("recheckOutcome treats an id missing from the recheck as failed", () => {
  const r = recheckOutcome(["b.js"], gate([]));
  assert.deepEqual(r.failedIds, ["b.js"]);
});
test("mergeRecheck substitutes isolated results and records the recheck", () => {
  const merged = mergeRecheck(
    gate([["a.js", "pass"], ["b.js", "timeout"]]),
    gate([["b.js", "pass"]])
  );
  const b = merged.results.find((r) => r.id === "b.js");
  assert.equal(b.status, "pass");
  assert.equal(b.initialStatus, "timeout");
  assert.equal(b.recheckedInIsolation, true);
  assert.deepEqual(merged.recheck.ids, ["b.js"]);
  assert.equal(merged.results.find((r) => r.id === "a.js").recheckedInIsolation, undefined);
});
