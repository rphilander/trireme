// run-lineage.test.mjs — REAL-script tests for the lineage relay's
// inter-layer validation, born from a live incident (2026-08-23,
// entry15-2): a full-suite sweep under concurrent-lineage load flaked two
// cases and FALSE-HALTED a lineage. The relay must apply the standing
// isolated-recheck habit before halting — a halt has to be earned.
// Sandbox: fake $HOME with stub compose/launch kernel scripts and a stub
// bridge whose flake behavior is scripted per invocation.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const REAL_HOME = process.env.HOME;
const SCRIPT = path.join(REAL_HOME, "src/trireme/experiments/kernel/run-lineage.sh");

function write(p, content, { exec = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (exec) fs.chmodSync(p, 0o755);
}

// flakes: ids that fail on the FIRST bridge invocation that sees them, then
// pass. reds: ids that always fail.
function buildSandbox({ layers = 2, flakes = [], reds = [] } = {}) {
  const H = fs.mkdtempSync(path.join(SCRATCH, "rl-"));
  const CR = path.join(H, "control-runs");
  const K = path.join(H, "src/trireme/experiments/kernel");
  const P = path.join(H, "pristine");
  write(path.join(CR, "trunk/ACCEPTED.txt"), "test/a1.js\ntest/a2.js\ntest/a3.js\n");
  fs.mkdirSync(path.join(CR, "trunk/entry-0/src"), { recursive: true });
  fs.symlinkSync(path.join(CR, "trunk/entry-0"), path.join(CR, "trunk/current"));
  for (let i = 1; i <= layers; i++) {
    write(path.join(CR, `plan/entry-9/layer-${i}/BRIEF.md`), `layer ${i}`);
    write(path.join(CR, `plan/entry-9/layer-${i}/editable.txt`), "src/engine/x.ts\n");
  }
  write(path.join(H, "flakes.json"), JSON.stringify({ flakes, reds }));
  write(path.join(K, "compose-module-world.sh"), `#!/bin/bash
mkdir -p ${CR}/$1/workspace/src/engine
echo code > ${CR}/$1/workspace/src/engine/index.ts
`, { exec: true });
  write(path.join(K, "launch-world.sh"), `#!/bin/bash
echo "exit=0" >> ${CR}/$1/run.log
`, { exec: true });
  write(path.join(P, "bridge/run.mjs"), `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const H = ${JSON.stringify(H)};
const cfg = JSON.parse(fs.readFileSync(H + "/flakes.json", "utf8"));
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
const results = ids.map((id) => {
  if (cfg.reds.includes(id)) return { id, status: "fail" };
  if (cfg.flakes.includes(id)) {
    const seen = H + "/.flaked-" + Buffer.from(id).toString("hex");
    if (!fs.existsSync(seen)) { fs.writeFileSync(seen, "1"); return { id, status: "timeout" }; }
  }
  return { id, status: "pass" };
});
fs.writeFileSync(arg("--out"), JSON.stringify({ results }));
console.log("gated", results.length);
`);
  return { H, CR, P };
}

function relay(sb, name = "entry9-1") {
  try {
    const out = execFileSync("bash", [SCRIPT, name, sb.P, "entry-9", "60"], {
      env: { ...process.env, HOME: sb.H },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
}

test("relay: load-flake at a layer boundary is rechecked in isolation — NO false halt", () => {
  const sb = buildSandbox({ layers: 2, flakes: ["test/a2.js"] });
  const r = relay(sb);
  assert.equal(r.code, 0, r.out);
  const status = fs.readFileSync(path.join(sb.CR, "entry9-1.lineage-status"), "utf8");
  assert.match(status, /^COMPLETE layers=2/);
  const log = fs.readFileSync(path.join(sb.CR, "entry9-1.lineage.md"), "utf8");
  assert.match(log, /re-ran green in isolation|isolation.*green/i, "the rescue must be logged as a fact");
});

test("relay: persistent red still HALTS (recheck can only rescue flakes)", () => {
  const sb = buildSandbox({ layers: 2, reds: ["test/a3.js"] });
  const r = relay(sb);
  assert.notEqual(r.code, 0);
  const status = fs.readFileSync(path.join(sb.CR, "entry9-1.lineage-status"), "utf8");
  assert.match(status, /^HALTED layer=1/);
});

test("relay: clean layers complete without any recheck invocation", () => {
  const sb = buildSandbox({ layers: 3 });
  const r = relay(sb);
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(sb.CR, "entry9-1.lineage-status"), "utf8"), /^COMPLETE layers=3/);
  assert.ok(!fs.existsSync(path.join(sb.CR, "entry9-1-L1/layer-gate-recheck.json")), "no recheck artifact on clean layers");
});
