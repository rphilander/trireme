// grade.mjs — pure grading logic over bridge gate.json files.
// Schema: { results: [ { id, status } ] }; non-pass = status !== "pass"
// (same rule as run-lineage.sh). The isolated-recheck habit is standing
// policy: gate non-passes are re-run alone before any verdict, because
// concurrent-load flake (seen at entry-6/8.5.1) would otherwise turn a
// bankable run into a false VOID.

export function analyzeGate(gateJson) {
  const results = Array.isArray(gateJson?.results) ? gateJson.results : null;
  if (!results) return { ok: false, total: 0, nonPassIds: [] };
  return {
    ok: true,
    total: results.length,
    nonPassIds: results.filter((r) => r.status !== "pass").map((r) => r.id),
  };
}

// recheckJson = gate.json shape from the isolated re-run over just the ids.
export function recheckOutcome(nonPassIds, recheckJson) {
  const byId = new Map(
    (recheckJson?.results ?? []).map((r) => [r.id, r.status])
  );
  const passedIds = [];
  const failedIds = [];
  for (const id of nonPassIds) {
    (byId.get(id) === "pass" ? passedIds : failedIds).push(id);
  }
  return { passedIds, failedIds };
}

// Merged gate.json for the retro world: initial verdicts with isolated
// re-run results substituted, and the recheck recorded on the artifact so
// the retro sees exactly what happened (facts, not silent correction).
export function mergeRecheck(gateJson, recheckJson) {
  const byId = new Map(
    (recheckJson?.results ?? []).map((r) => [r.id, r.status])
  );
  return {
    ...gateJson,
    results: (gateJson?.results ?? []).map((r) =>
      byId.has(r.id)
        ? { ...r, status: byId.get(r.id), recheckedInIsolation: true, initialStatus: r.status }
        : r
    ),
    recheck: { ids: [...byId.keys()] },
  };
}
