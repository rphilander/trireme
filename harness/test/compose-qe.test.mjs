// compose-qe.test.mjs — REAL-script tests for the unified brief-driven
// QE world composer (bootstrap mode and evolve-banked-gate mode).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BIN, fakeHome, qeWorkspace, write } from "./stubs.mjs";

const SCRIPT = path.join(BIN, "compose-qe-world.sh");

function compose(H, args) {
  return execFileSync("bash", [SCRIPT, ...args],
    { env: { ...process.env, HOME: H }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

test("bootstrap mode: layout, verbatim goal+brief, gate contract, no gate dir, no leakage", () => {
  const { H, TESTS, GOAL } = fakeHome();
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: qe\n\nAuthor the subject contract and verdict runner; bring a first\ntranche into scope; self-tests. Beware the $DONE literal.\n");

  compose(H, ["qe-x1", TESTS, GOAL, BRIEF, "75"]);

  const R = path.join(H, "control-runs/qe-x1");
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  // verbatim goal and verbatim brief (unexpanded $ literals survive)
  assert.match(mandate, /Build a frobnicator as a Node package\./);
  assert.match(mandate, /bring a first\ntranche into scope/);
  assert.match(mandate, /\$DONE literal/);
  // platform framing: gate contract, deliverables, red-is-finding
  assert.match(mandate, /bridge\/run\.mjs/);
  assert.match(mandate, /pass \| fail \| unsupported/);
  assert.match(mandate, /scope\/cases\.txt/);
  assert.match(mandate, /suite\/self\/run\.mjs/);
  assert.match(mandate, /FINDING/);
  assert.match(mandate, /[Nn]ever weaken/);
  // fixed framing carries no domain or defect vocabulary
  const fixed = mandate.replace(/Build a frobnicator as a Node package\./, "")
    .replace(/TYPE: qe[\s\S]*?\$DONE literal\./, "");
  for (const banned of [/test262/i, /webgl/i, /es5/i, /sloppy/i, /strict mode/i, /deadlock/i, /dual-mode/i]) {
    assert.ok(!banned.test(fixed), `fixed framing leaks vocabulary: ${banned}`);
  }
  // bootstrap: no gate starting state
  assert.ok(!fs.existsSync(path.join(R, "workspace/bridge")));
  // tests present and write-denied
  assert.ok(fs.existsSync(path.join(R, "workspace/tests/suite/alpha.spec.js")));
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/workspace/tests")));
  assert.ok(settings.filesystem.denyWrite.some((p) => p.endsWith("/MANDATE.md")));
  assert.ok(settings.filesystem.denyRead.some((p) => p.endsWith("/.trireme-env")));
  assert.deepEqual(settings.network.allowedDomains, ["api.deepseek.com"]);
  // prompt carries the cap; models.json baseUrl stripped
  assert.match(fs.readFileSync(path.join(R, "prompt.txt"), "utf8"), /75 minutes/);
  const models = JSON.parse(fs.readFileSync(path.join(R, "home/.pi/agent/models.json"), "utf8"));
  assert.ok(!("baseUrl" in models.providers.deepseek));
});

test("evolve mode: banked gate copied in EDITABLE as starting state", () => {
  const { H, TESTS, GOAL } = fakeHome();
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: qe\n\nWiden the scope tranche.\n");
  const GATE = qeWorkspace(); // stands in for <campaign>/gate/current

  compose(H, ["qe-x2", TESTS, GOAL, BRIEF, "75", GATE]);

  const R = path.join(H, "control-runs/qe-x2");
  // full module present in the workspace root, editable (not write-denied)
  assert.ok(fs.existsSync(path.join(R, "workspace/bridge/run.mjs")));
  assert.ok(fs.existsSync(path.join(R, "workspace/scope/cases.txt")));
  assert.ok(fs.existsSync(path.join(R, "workspace/suite/self/run.mjs")));
  const settings = JSON.parse(fs.readFileSync(path.join(R, "settings.json"), "utf8"));
  assert.ok(!settings.filesystem.denyWrite.some((p) => p.includes("/workspace/bridge")));
  const mandate = fs.readFileSync(path.join(R, "workspace/MANDATE.md"), "utf8");
  assert.match(mandate, /already contains the current banked/i);
});

test("brief of the wrong TYPE → refuse", () => {
  const { H, TESTS, GOAL } = fakeHome();
  const BRIEF = path.join(H, "brief.md");
  write(BRIEF, "TYPE: code\n\nBuild the thing.\n");
  assert.throws(() => compose(H, ["qe-x3", TESTS, GOAL, BRIEF, "75"]),
    (e) => /TYPE/.test(String(e.stdout) + String(e.stderr)));
  assert.ok(!fs.existsSync(path.join(H, "control-runs/qe-x3/workspace/MANDATE.md")));
});
