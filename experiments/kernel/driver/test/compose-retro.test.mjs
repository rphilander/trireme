// compose-retro.test.mjs — REAL-script test for compose-retro-world.sh
// (previously only stub-covered; the CHALLENGES.md carry was verified live
// but never in the suite). The script resolves everything under $HOME, so
// it runs against a sandbox HOME, like the bank-trunk suite.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const REAL_HOME = process.env.HOME;
const SCRIPT = path.join(REAL_HOME, "src/trireme/experiments/kernel/compose-retro-world.sh");

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function buildSandbox() {
  const H = fs.mkdtempSync(path.join(SCRATCH, "cmp-"));
  const CR = path.join(H, "control-runs");
  // the script copies the shell extension from $HOME/src/trireme/... and
  // rewrites $HOME/.pi/agent/models.json (dropping the deepseek baseUrl)
  write(path.join(H, "src/trireme/experiments/kernel/extensions/trireme-shell.ts"), "// ext");
  write(path.join(H, ".pi/agent/models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: "http://x", models: [] } } }));
  // canonical plan repo with real git history
  const PLAN = path.join(CR, "plan");
  write(path.join(PLAN, "PLAN.md"), "# plan");
  write(path.join(PLAN, "entry-9/cases.txt"), "test/c1.js\n");
  execFileSync("bash", ["-c", `cd ${PLAN} && git init -q && git add -A && git -c user.email=k@t -c user.name=k commit -qm rev1`]);
  // pristine: bridge + corpus
  const P = path.join(H, "pristine");
  for (const f of ["run.mjs", "stub.mjs", "README.md", "generate.mjs", "cases.json"]) write(path.join(P, "bridge", f), "//");
  write(path.join(P, "test262/test/x.js"), "//");
  // trunk-before source
  write(path.join(CR, "trunk/entry-8/src/engine/index.ts"), "// trunk8");
  fs.symlinkSync(path.join(CR, "trunk/entry-8"), path.join(CR, "trunk/current"));
  // kernel log
  write(path.join(CR, "kernel-logs/entry-9.md"), "# Kernel log — entry-9\n- fact\n");
  // two builder runs: one WITH challenges, one without
  for (const [name, challenged] of [["entry9-1", true], ["entry9-2", false]]) {
    write(path.join(CR, name, "workspace/src/engine/index.ts"), `// ${name}`);
    write(path.join(CR, name, "workspace/package.json"), "{}");
    write(path.join(CR, name, "gate.json"), '{"results":[]}');
    if (challenged) write(path.join(CR, name, "workspace/CHALLENGES.md"), "# CHALLENGES\nclaim\n");
    write(path.join(CR, name, "home/.pi/agent/sessions/s/2026-08-22T01_a.jsonl"), '{"n":1}\n');
    write(path.join(CR, name, "home/.pi/agent/sessions/s/2026-08-22T02_b.jsonl"), '{"n":2}\n');
  }
  return { H, CR, P };
}

test("compose-retro-world.sh: full world — challenges carried, transcripts concatenated, mandate substituted", () => {
  const sb = buildSandbox();
  execFileSync("bash", [SCRIPT, "retro-e9", sb.P, "entry-9", "entry9-1", "entry9-2"], {
    env: { ...process.env, HOME: sb.H },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const W = path.join(sb.CR, "retro-e9/workspace");

  // CHALLENGES.md: present for the filer, absent for the non-filer
  assert.ok(fs.existsSync(path.join(W, "runs/entry9-1/CHALLENGES.md")), "filer's CHALLENGES.md must be carried");
  assert.ok(!fs.existsSync(path.join(W, "runs/entry9-2/CHALLENGES.md")), "non-filer must not get one");

  // transcripts concatenated in filename order
  assert.equal(fs.readFileSync(path.join(W, "runs/entry9-1/transcript.jsonl"), "utf8"), '{"n":1}\n{"n":2}\n');

  // code + gate + kernel log + trunk-before + corpus all in place
  assert.match(fs.readFileSync(path.join(W, "runs/entry9-1/src/engine/index.ts"), "utf8"), /entry9-1/);
  assert.ok(fs.existsSync(path.join(W, "runs/entry9-2/gate.json")));
  assert.match(fs.readFileSync(path.join(W, "KERNEL-LOG.md"), "utf8"), /entry-9/);
  assert.match(fs.readFileSync(path.join(W, "trunk-before/src/engine/index.ts"), "utf8"), /trunk8/);
  assert.ok(fs.existsSync(path.join(W, "test262/test/x.js")));
  assert.ok(fs.existsSync(path.join(W, "bridge/cases.json")));

  // plan is a real git clone with history; mandate placeholders substituted
  const gitlog = execFileSync("git", ["-C", path.join(W, "plan"), "log", "--oneline"], { encoding: "utf8" });
  assert.match(gitlog, /rev1/);
  const mandate = fs.readFileSync(path.join(W, "MANDATE.md"), "utf8");
  assert.match(mandate, /entry-9/);
  assert.match(mandate, /entry-10/);
  assert.ok(!mandate.includes("@ENTRY@") && !mandate.includes("@NEXT@"), "placeholders must be substituted");
  assert.match(mandate, /BANK: <builder-run-name>|BANK:/, "machine-verdict contract present");

  // extension installed into the retro home
  assert.ok(fs.existsSync(path.join(sb.CR, "retro-e9/home/.pi/agent/extensions/trireme-shell.ts")));
  // models.json copied with the deepseek baseUrl stripped
  const models = JSON.parse(fs.readFileSync(path.join(sb.CR, "retro-e9/home/.pi/agent/models.json"), "utf8"));
  assert.ok(!("baseUrl" in models.providers.deepseek));
});

test("compose-retro-world.sh: missing kernel log yields the no-interventions default", () => {
  const sb = buildSandbox();
  fs.rmSync(path.join(sb.CR, "kernel-logs/entry-9.md"));
  execFileSync("bash", [SCRIPT, "retro-e9", sb.P, "entry-9", "entry9-1"], {
    env: { ...process.env, HOME: sb.H }, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(
    fs.readFileSync(path.join(sb.CR, "retro-e9/workspace/KERNEL-LOG.md"), "utf8"),
    /no interventions/
  );
});
