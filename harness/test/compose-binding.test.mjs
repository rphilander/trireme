// compose-binding.test.mjs — REAL-script test for the binding world composer.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const REAL_HOME = process.env.HOME;
const SCRIPT = path.join(REAL_HOME, "src/trireme/harness/bin/compose-binding-world.sh");

function write(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test("compose-binding-world: layout, verbatim goal, read-only tests, no domain leakage", () => {
  const H = fs.mkdtempSync(path.join(SCRATCH, "cbw-"));
  write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// ext");
  write(path.join(H, ".pi/agent/models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: "x", models: [] } } }));
  fs.mkdirSync(path.join(H, "control-runs"), { recursive: true });
  const TESTS = path.join(H, "acceptance");
  write(path.join(TESTS, "suite/alpha.spec.js"), "// test");
  write(path.join(TESTS, "docs/README.md"), "how to run");
  const GOAL = path.join(H, "goal.txt");
  write(GOAL, "Build a frobnicator as a Node package.");

  execFileSync("bash", [SCRIPT, "bindx-1", TESTS, GOAL, "45"], {
    env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"],
  });

  const R = path.join(H, "control-runs/bindx-1");
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /Build a frobnicator as a Node package\./, "goal verbatim");
  assert.match(mandate, /bridge\/run\.mjs/);
  assert.match(mandate, /pass \| fail \| unsupported/);
  // no domain vocabulary from campaign one may leak into the generic mandate
  for (const banned of [/test262/i, /strict mode/i, /dual-mode/i, /es5/i, /webgl/i]) {
    assert.ok(!banned.test(mandate), `mandate leaks domain vocabulary: ${banned}`);
  }
  // the shipped tests are present, hardlinked, and write-denied
  assert.ok(fs.existsSync(path.join(R, "workspace/tests/suite/alpha.spec.js")));
  assert.ok(fs.existsSync(path.join(R, "workspace/tests/docs/README.md")));
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/tests")));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/MANDATE.md")));
  assert.deepEqual(settings.network.allowedDomains, ["api.deepseek.com"]);
  // prompt carries the cap
  assert.match(fs.readFileSync(path.join(R, "prompt.txt"), "utf8"), /45 minutes/);
  // models.json copied with baseUrl stripped
  const models = JSON.parse(fs.readFileSync(path.join(R, "home/.pi/agent/models.json"), "utf8"));
  assert.ok(!("baseUrl" in models.providers.deepseek));
});
