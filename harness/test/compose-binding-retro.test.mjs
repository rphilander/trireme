// compose-binding-retro.test.mjs — REAL-script test for the binding-retro
// world composer.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const REAL_HOME = process.env.HOME;
const SCRIPT = path.join(REAL_HOME, "src/trireme/harness/bin/compose-binding-retro.sh");

function write(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test("compose-binding-retro: bindings + validation facts + transcripts + verdict mandate", () => {
  const H = fs.mkdtempSync(path.join(SCRATCH, "cbr-"));
  write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// ext");
  // the composer runs the REAL validator against each binding
  fs.mkdirSync(path.join(H, "src/trireme/harness/bin"), { recursive: true });
  fs.copyFileSync(path.join(REAL_HOME, "src/trireme/harness/bin/validate-binding.sh"),
                  path.join(H, "src/trireme/harness/bin/validate-binding.sh"));
  fs.chmodSync(path.join(H, "src/trireme/harness/bin/validate-binding.sh"), 0o755);
  write(path.join(H, ".pi/agent/models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: "x" } } }));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const TESTS = path.join(H, "acceptance");
  write(path.join(TESTS, "suite/alpha.js"), "// t");
  const GOAL = path.join(H, "goal.txt");
  write(GOAL, "Build a frobnicator.");
  // one conforming binding, one incomplete binding
  const RUNNER = `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map(id => ({ id, status: "fail", ms: 1 })) }));
`;
  for (const [name, complete] of [["bx-1", true], ["bx-2", false]]) {
    const W = path.join(H, "control-runs", name, "workspace");
    write(path.join(W, "bridge/run.mjs"), RUNNER);
    write(path.join(W, "inventory/cases.txt"), "suite/alpha.js\n");
    write(path.join(W, "inventory/derive.mjs"), "//");
    if (complete) {
      write(path.join(W, "contract.d.ts"), "export {};");
      write(path.join(W, "budgets.json"), '{"defaultTimeoutMs": 5000}');
      write(path.join(W, "BINDING.md"), "# rationale");
    }
    write(path.join(H, "control-runs", name, "home/.pi/agent/sessions/s/a.jsonl"), '{"n":1}\n');
  }

  execFileSync("bash", [SCRIPT, "retro-bx", TESTS, GOAL, "bx-1", "bx-2"], {
    env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"],
  });

  const W = path.join(H, "control-runs/retro-bx/workspace");
  // per-binding: full deliverables, transcript, validation FACTS
  assert.ok(fs.existsSync(path.join(W, "bindings/bx-1/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(W, "bindings/bx-1/transcript.jsonl")));
  assert.match(fs.readFileSync(path.join(W, "bindings/bx-1/VALIDATION.txt"), "utf8"), /OK: binding conformant/);
  assert.match(fs.readFileSync(path.join(W, "bindings/bx-2/VALIDATION.txt"), "utf8"), /REJECT/);
  // the acceptance tests are present for probe-based judgment
  assert.ok(fs.existsSync(path.join(W, "tests/suite/alpha.js")));
  // mandate: goal verbatim, machine verdict line, decide-only language
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator\./);
  assert.match(mandate, /BANK: <binding-run-name>/);
  assert.match(mandate, /REDO:/);
  assert.match(mandate, /never edit[\s\S]{0,3}their deliverables/i);
  // sandbox: bindings and tests write-denied
  const settings = JSON.parse(fs.readFileSync(path.join(H, "control-runs/retro-bx/settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/bindings")));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/tests")));
});
