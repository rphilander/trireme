// bank-trunk.test.mjs — bash-level tests for the kernel's ONLY mechanical
// bank arbiter. Two rules, both enforced here and nowhere else:
//   1. GREEN: the winner must pass ACCEPTED ∪ post-fold entry delta.
//   2. PROGRESS: banking must move the ball — the entry must add a
//      non-zero number of NEW case ids beyond the previous ACCEPTED set
//      (settled 2026-08-22).
// Plus the standing invariants: append-only; VOID preserved as evidence.
// The script resolves everything under $HOME, so each test runs it with
// HOME pointed at a sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const SCRIPT = path.join(process.env.HOME, "src/trireme/experiments/kernel/bank-trunk.sh");

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Sandbox: fake HOME with control-runs/{winner run, trunk}, and a plan
// workspace carrying plan/entry-9/cases.txt + a stub bridge whose verdicts
// come from red-ids.txt.
function buildSandbox({ accepted, entryCases, redIds = [] }) {
  const H = fs.mkdtempSync(path.join(SCRATCH, "bank-"));
  const CR = path.join(H, "control-runs");
  const P = path.join(CR, "retro-e9/workspace");
  write(path.join(CR, "entry9-2/workspace/src/engine/index.ts"), "// winner code");
  write(path.join(CR, "entry9-2/workspace/package.json"), "{}");
  if (accepted.length) write(path.join(CR, "trunk/ACCEPTED.txt"), accepted.join("\n") + "\n");
  write(path.join(P, "plan/entry-9/cases.txt"), entryCases.join("\n") + "\n");
  write(path.join(H, "red-ids.txt"), redIds.join("\n"));
  write(path.join(P, "bridge/run.mjs"), `
import fs from "node:fs";
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const ids = fs.readFileSync(arg("--cases"), "utf8").split("\\n").filter(Boolean);
const red = new Set(fs.readFileSync(${JSON.stringify(path.join(H, "red-ids.txt"))}, "utf8").split("\\n").filter(Boolean));
fs.writeFileSync(arg("--out"), JSON.stringify({ results: ids.map((id) => ({ id, status: red.has(id) ? "fail" : "pass" })) }));
`);
  return { H, CR, P };
}

function bank(sb, args = ["entry-9", "entry9-2", sb.P, "src/engine/index.ts"]) {
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, HOME: sb.H },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
}

test("bank-trunk: green + new cases → banks, ACCEPTED grows, current points at entry", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js", "test/a2.js"], entryCases: ["test/c1.js", "test/c2.js"] });
  const r = bank(sb);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /BANKED trunk\/entry-9/);
  const acc = fs.readFileSync(path.join(sb.CR, "trunk/ACCEPTED.txt"), "utf8").trim().split("\n");
  assert.deepEqual(acc, ["test/a1.js", "test/a2.js", "test/c1.js", "test/c2.js"]);
  assert.equal(fs.readlinkSync(path.join(sb.CR, "trunk/current")), path.join(sb.CR, "trunk/entry-9"));
  assert.match(fs.readFileSync(path.join(sb.CR, "trunk/entry-9/src/engine/index.ts"), "utf8"), /winner code/);
});

test("bank-trunk PROGRESS RULE: green but zero new cases → VOID, trunk untouched", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js", "test/a2.js"], entryCases: ["test/a1.js", "test/a2.js"] });
  const r = bank(sb);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /VOID/);
  assert.match(r.out, /no new accepted cases|0 new/i);
  assert.ok(fs.existsSync(path.join(sb.CR, "trunk/entry-9.VOID")), "VOID evidence preserved");
  assert.ok(!fs.existsSync(path.join(sb.CR, "trunk/entry-9")));
  assert.equal(fs.readFileSync(path.join(sb.CR, "trunk/ACCEPTED.txt"), "utf8").trim().split("\n").length, 2, "ACCEPTED unchanged");
});

test("bank-trunk PROGRESS RULE: partial overlap with ≥1 genuinely new case → banks", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js"], entryCases: ["test/a1.js", "test/c1.js"] });
  const r = bank(sb);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /BANKED/);
});

test("bank-trunk: first entry (no ACCEPTED.txt yet) — everything is new, banks", () => {
  const sb = buildSandbox({ accepted: [], entryCases: ["test/c1.js"] });
  const r = bank(sb);
  assert.equal(r.code, 0, r.out);
});

test("bank-trunk GREEN RULE: any red in ACCEPTED ∪ delta → VOID with the ids", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js"], entryCases: ["test/c1.js", "test/c2.js"], redIds: ["test/c2.js"] });
  const r = bank(sb);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /VOID/);
  assert.match(r.out, /test\/c2\.js/);
  assert.ok(fs.existsSync(path.join(sb.CR, "trunk/entry-9.VOID")));
});

test("bank-trunk APPEND-ONLY: existing trunk entry is never overwritten", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js"], entryCases: ["test/c1.js"] });
  fs.mkdirSync(path.join(sb.CR, "trunk/entry-9"), { recursive: true });
  const r = bank(sb);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /append-only/);
});

test("bank-trunk: missing post-fold cases.txt fails loudly, no trunk side effects", () => {
  const sb = buildSandbox({ accepted: ["test/a1.js"], entryCases: ["test/c1.js"] });
  fs.rmSync(path.join(sb.P, "plan/entry-9/cases.txt"));
  const r = bank(sb);
  assert.notEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(sb.CR, "trunk/current")), "no current symlink on failure");
});
