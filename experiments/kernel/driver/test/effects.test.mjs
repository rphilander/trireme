// effects.test.mjs — seam tests: the REAL driver loop + REAL effects layer
// run against a sandbox of stub kernel scripts and a stub bridge gate.
// Catches what the pure tests cannot: argv order, path wiring, file
// placement, run.log parsing, session assembly. Entirely offline and fast.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDriver } from "../driver.mjs";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();

function write(p, content, { exec = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (exec) fs.chmodSync(p, 0o755);
}

function buildSandbox(opts = {}) {
  const SB = fs.mkdtempSync(path.join(SCRATCH, "drv-"));
  const K = path.join(SB, "kernel");
  const CR = path.join(SB, "control-runs");
  const PLAN = path.join(CR, "plan");
  const PR = path.join(SB, "pristine");
  const rec = `echo "$(basename "$0") $@" >> ${SB}/calls.log`;

  // ---- plan + trunk -------------------------------------------------------
  write(path.join(PLAN, "entry-9/cases.txt"), "test/c1.js\ntest/c2.js\ntest/c3.js\n");
  if (opts.layered) {
    for (const i of [1, 2]) {
      write(path.join(PLAN, `entry-9/layer-${i}/BRIEF.md`), `layer ${i}`);
      write(path.join(PLAN, `entry-9/layer-${i}/editable.txt`), "src/engine/x.ts\n");
    }
  } else {
    write(path.join(PLAN, "entry-9/BRIEF.md"), "brief");
    write(path.join(PLAN, "entry-9/editable.txt"), "src/engine/builtins/string.ts\nsrc/engine/builtins/index.ts wiring\n");
  }
  write(path.join(CR, "trunk/ACCEPTED.txt"), "test/a1.js\ntest/a2.js\n");
  write(path.join(SB, "red-ids.txt"), (opts.redIds ?? []).join("\n"));
  write(path.join(SB, "flaky-ids.txt"), (opts.flakyIds ?? []).join("\n"));
  write(path.join(SB, "verdict.txt"), opts.verdict ?? "BANK: entry9-2\n\nrationale.");

  // ---- stub bridge gate ---------------------------------------------------
  write(path.join(PR, "bridge/run.mjs"), `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const SB = ${JSON.stringify(SB)};
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
const red = new Set(fs.readFileSync(SB + "/red-ids.txt", "utf8").split("\\n").filter(Boolean));
const flaky = new Set(fs.readFileSync(SB + "/flaky-ids.txt", "utf8").split("\\n").filter(Boolean));
const results = ids.map((id) => {
  if (red.has(id)) return { id, status: "fail" };
  if (flaky.has(id)) {
    const seen = SB + "/.seen-" + Buffer.from(id).toString("hex");
    if (!fs.existsSync(seen)) { fs.writeFileSync(seen, "1"); return { id, status: "timeout" }; }
  }
  return { id, status: "pass" };
});
fs.writeFileSync(arg("--out"), JSON.stringify({ results }));
`);

  // ---- stub kernel scripts ------------------------------------------------
  write(path.join(K, "validate-phase.sh"), `#!/bin/bash\n${rec}\nexit 0\n`, { exec: true });

  write(path.join(K, "compose-module-world.sh"), `#!/bin/bash
${rec}
R=${CR}/$1
mkdir -p $R/workspace/src/engine $R/home/.pi/agent/sessions
echo engine > $R/workspace/src/engine/index.ts
echo '{}' > $R/workspace/package.json
exit ${opts.composeExit ?? 0}
`, { exec: true });

  write(path.join(K, "launch-world.sh"), `#!/bin/bash
${rec}
R=${CR}/$1
mkdir -p $R/home/.pi/agent/sessions
echo '{"role":"assistant"}' > $R/home/.pi/agent/sessions/2026-08-22T00-00-00-000Z_$1.jsonl
if [ "$1" = "retro-e9" ]; then
  W=$R/workspace; mkdir -p $W/plan/entry-10
  echo retro > $W/RETRO.md
  cp ${SB}/verdict.txt $W/DECISION.md
  echo revision > $W/REVISION.md
  echo "test/n1.js" > $W/plan/entry-10/cases.txt
  echo brief > $W/plan/entry-10/BRIEF.md
  echo "src/engine/n.ts" > $W/plan/entry-10/editable.txt
fi
{ echo '⏱ took 2s · 88:00 remaining · $0.123 spent'; echo "exit=0"; } >> $R/run.log
`, { exec: true });

  write(path.join(K, "run-lineage.sh"), `#!/bin/bash
${rec}
NAME=$1
for i in 1 2; do
  R=${CR}/$NAME-L$i
  mkdir -p $R/workspace/src/engine $R/home/.pi/agent/sessions/relay
  echo "layer $i of $NAME" > $R/workspace/src/engine/index.ts
  echo '{}' > $R/workspace/package.json
  echo '{"layer":'$i'}' > $R/home/.pi/agent/sessions/2026-08-22T0$i-00-00-000Z_$NAME-L$i.jsonl
  { echo '⏱ took 2s · 88:00 remaining · $0.200 spent'; echo "exit=0"; } >> $R/run.log
done
if [ -f ${SB}/halt-$NAME ]; then
  echo "HALTED layer=1" > ${CR}/$NAME.lineage-status; exit 1
fi
echo "COMPLETE layers=2 final=${CR}/$NAME-L2/workspace" > ${CR}/$NAME.lineage-status
`, { exec: true });

  write(path.join(K, "compose-retro-world.sh"), `#!/bin/bash
${rec}
mkdir -p ${CR}/$1/workspace
exit 0
`, { exec: true });

  write(path.join(K, "commit-plan.sh"), `#!/bin/bash
${rec}
if [ "${opts.foldExit ?? 0}" != "0" ]; then echo "commit-plan REJECTED: scope rule" >&2; exit 1; fi
mkdir -p ${PLAN}/entry-10 && echo "test/n1.js" > ${PLAN}/entry-10/cases.txt
`, { exec: true });

  write(path.join(K, "bank-trunk.sh"), `#!/bin/bash
${rec}
if [ "${opts.bankExit ?? 0}" != "0" ]; then echo "gate red — bank VOID" >&2; exit 1; fi
exit 0
`, { exec: true });

  const ctx = { kernelDir: K, controlDir: CR, pristine: PR, logLine: () => {} };
  return { SB, CR, PLAN, ctx, calls: () => (fs.existsSync(`${SB}/calls.log`) ? fs.readFileSync(`${SB}/calls.log`, "utf8").trim().split("\n") : []) };
}

const CFG = { entry: "entry-9", cycles: 1, capS: 60, retroCapS: 60 };
const out = (SB) => path.join(SB, "driver-out");

test("seam: single-layer happy path with a load flake — full cycle, correct argv", async () => {
  const sb = buildSandbox({ flakyIds: ["test/a2.js"] });
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  assert.equal(state.step, "DONE");
  assert.deepEqual(state.banked, [{ entry: "entry-9", winner: "entry9-2" }]);

  const calls = sb.calls();
  // composition passes the editable surface with the wiring tag stripped
  const comp = calls.filter((c) => c.startsWith("compose-module-world.sh"));
  assert.equal(comp.length, 3);
  assert.match(comp[0], /compose-module-world\.sh entry9-1 \S+pristine entry-9 src\/engine\/builtins\/string\.ts src\/engine\/builtins\/index\.ts$/);
  // three builder launches with the cap, one retro launch
  assert.equal(calls.filter((c) => /^launch-world\.sh entry9-\d 60$/.test(c)).length, 3);
  assert.ok(calls.some((c) => c === "launch-world.sh retro-e9 60"));
  // retro world composed over all three runs, after the kernel log exists
  assert.ok(calls.some((c) => /^compose-retro-world\.sh retro-e9 \S+ entry-9 entry9-1 entry9-2 entry9-3$/.test(c)));
  assert.ok(fs.existsSync(path.join(sb.CR, "kernel-logs/entry-9.md")));
  // fold before bank; bank argv exact
  assert.ok(calls.indexOf(calls.find((c) => c.startsWith("commit-plan.sh"))) <
            calls.indexOf(calls.find((c) => c.startsWith("bank-trunk.sh"))));
  assert.ok(calls.some((c) => /^bank-trunk\.sh entry-9 entry9-2 \S+pristine src\/engine\/index\.ts$/.test(c)));

  // gate-cases = ACCEPTED ∪ entry delta, sorted unique
  const gc = fs.readFileSync(path.join(sb.CR, "entry9-1/gate-cases.txt"), "utf8").trim().split("\n");
  assert.deepEqual(gc, ["test/a1.js", "test/a2.js", "test/c1.js", "test/c2.js", "test/c3.js"]);

  // the flake was rechecked in isolation and the merged artifact says so
  const gate = JSON.parse(fs.readFileSync(path.join(sb.CR, "entry9-1/gate.json"), "utf8"));
  const flaked = gate.results.find((r) => r.id === "test/a2.js");
  assert.equal(flaked.status, "pass");
  assert.equal(flaked.recheckedInIsolation, true);
  assert.equal(flaked.initialStatus, "timeout");
  const klog = fs.readFileSync(path.join(sb.CR, "kernel-logs/entry-9.md"), "utf8");
  assert.match(klog, /re-run in isolation — 1 passed \(load flake\), 0 still red/);
  assert.ok(fs.existsSync(path.join(out(sb.SB), "SUMMARY.md")));
});

test("seam: layered phase — lineages driven, aggregates assembled with relay sessions", async () => {
  const sb = buildSandbox({ layered: true });
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  assert.equal(state.step, "DONE");

  const calls = sb.calls();
  assert.equal(calls.filter((c) => /^run-lineage\.sh entry9-\d \S+pristine entry-9 60$/.test(c)).length, 3);
  assert.ok(!calls.some((c) => c.startsWith("compose-module-world.sh")), "no direct compose on a layered phase");

  // aggregate run dir: final layer workspace + both layers' sessions merged
  const agg = path.join(sb.CR, "entry9-1");
  assert.equal(fs.readFileSync(path.join(agg, "workspace/src/engine/index.ts"), "utf8").trim(), "layer 2 of entry9-1");
  const relay = fs.readdirSync(path.join(agg, "home/.pi/agent/sessions/relay")).sort();
  assert.equal(relay.length, 2);
  assert.match(relay[0], /entry9-1-L1\.jsonl$/);
  const klog = fs.readFileSync(path.join(sb.CR, "kernel-logs/entry-9.md"), "utf8");
  assert.match(klog, /entry9-1: 2 layers, all inter-layer validations green/);
  // lineage spend = sum of layer spends
  assert.equal(state.runs[0].spend, "0.400");
});

test("seam: halted lineage is included as evidence and the cycle still lands", async () => {
  const sb = buildSandbox({ layered: true, verdict: "BANK: entry9-3\n" });
  write(path.join(sb.SB, "halt-entry9-1"), "1");
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  assert.equal(state.step, "DONE");
  assert.equal(state.runs[0].bankable, false);
  assert.equal(state.runs[0].lineage.status, "HALTED");
  // halted aggregate assembled from the halting layer's own workspace
  assert.match(fs.readFileSync(path.join(sb.CR, "entry9-1/workspace/src/engine/index.ts"), "utf8"), /layer 1/);
  assert.match(fs.readFileSync(path.join(sb.CR, "kernel-logs/entry-9.md"), "utf8"), /HALTED at layer 1/);
});

test("seam: commit-plan REJECT escalates with plan-rejected and never banks", async () => {
  const sb = buildSandbox({ foldExit: 1 });
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "plan-rejected");
  assert.match(state.escalation.detail, /REJECTED/);
  assert.ok(!sb.calls().some((c) => c.startsWith("bank-trunk.sh")));
  assert.match(fs.readFileSync(path.join(out(sb.SB), "ESCALATION.md"), "utf8"), /plan-rejected/);
});

test("seam: REDO verdict halts before the plan is touched", async () => {
  const sb = buildSandbox({ verdict: "REDO: the brief mis-scopes the module\n" });
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "redo");
  const calls = sb.calls();
  assert.ok(!calls.some((c) => c.startsWith("commit-plan.sh")));
  assert.ok(!calls.some((c) => c.startsWith("bank-trunk.sh")));
});

test("seam: hard-red run in cohort — rechecked once, unbankable, cohort proceeds", async () => {
  const sb = buildSandbox({ redIds: ["test/c3.js"], verdict: "BANK: entry9-2\n" });
  // red id fails initial gate AND recheck for every run — all runs red on c3
  const state = await runDriver(CFG, sb.ctx, { outDir: out(sb.SB) });
  // every run carries the same red → no-bankable escalation, no retro composed
  assert.equal(state.step, "ESCALATED");
  assert.equal(state.escalation.reason, "no-bankable");
  assert.ok(!sb.calls().some((c) => c.startsWith("compose-retro-world.sh")));
  const klog = fs.existsSync(path.join(sb.CR, "kernel-logs/entry-9.md"));
  assert.equal(klog, false); // kernel log is written with the retro world, which never happened
});
