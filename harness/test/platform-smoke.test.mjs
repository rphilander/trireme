// platform-smoke.test.mjs — the full modular-era toolchain on a
// hand-written noun/verb module pair: workspace assembly, offline
// compile (vendored tsc), lint (clean + violations), ledger + tamper
// detection, and runtime behavior of the compiled product.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRATCH = process.env.SCRATCHPAD_DIR || os.tmpdir();
const PLATFORM = path.join(process.env.HOME, "src/trireme/harness/platform");

const sh = (cwd, cmd, args) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
const write = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };

const NOUN = `/** interval — a closed numeric interval noun. */
import { type Rec, rec, get } from '#platform/values/core.js';

export type Interval = Rec<{ readonly tag: 'interval'; readonly lo: number; readonly hi: number }>;

export const interval = (lo: number, hi: number): Interval => rec({ tag: 'interval', lo, hi });
export const lo = (i: Interval): number => get(i, 'lo');
export const hi = (i: Interval): number => get(i, 'hi');
export const width = (i: Interval): number => hi(i) - lo(i);
export const contains = (i: Interval, x: number): boolean => x >= lo(i) && x <= hi(i);
`;

const VERB = `/** interval-ops — operations over interval collections. */
import { type Rec, type Vec, rec, update, show } from '#platform/values/core.js';
import * as V from '#platform/values/vec.js';
import { memo } from '#platform/values/services.js';
import { type Interval, interval, lo, hi, width } from '#modules/interval/index.js';

export const hull = (a: Interval, b: Interval): Interval =>
  interval(Math.min(lo(a), lo(b)), Math.max(hi(a), hi(b)));

export const totalWidth = memo((xs: Vec<Interval>): number =>
  V.reduce(xs, 0, (acc, i) => acc + width(i)));

export type SweepState = Rec<{ readonly tag: 'sweep'; readonly acc: number }>;
export const sweepInit = (): SweepState => rec({ tag: 'sweep', acc: 0 });
export const sweepAdd = (s: SweepState, i: Interval): SweepState =>
  update(s, 'acc', (n) => n + width(i));
export const sweep = (s0: SweepState, xs: Vec<Interval>): SweepState =>
  V.reduce(xs, s0, (s, i) => sweepAdd(s, i));

export const describe = (i: Interval): string => show(i);
`;

const RUN_CHECK = `import { interval, width } from '#modules/interval/index.js';
import { hull, totalWidth, sweep, sweepInit, describe } from '#modules/interval-ops/index.js';
import { get, equals } from '#platform/values/core.js';
import * as V from '#platform/values/vec.js';

const a = interval(0, 2);
const b = interval(5, 6);
const assertEq = (x, y, m) => { if (!Object.is(x, y)) { console.error('FAIL', m, x, y); process.exit(1); } };

assertEq(width(hull(a, b)), 6, 'hull spans both');
const xs = V.of(a, b);
assertEq(totalWidth(xs), 3, 'total width');
assertEq(totalWidth(V.of(interval(0, 2), interval(5, 6))), 3, 'memo hit on equal-by-value arg');
assertEq(get(sweep(sweepInit(), xs), 'acc'), 3, 'threaded sweep');
if (!equals(interval(1, 2), interval(1, 2))) { console.error('FAIL equals'); process.exit(1); }
assertEq(describe(interval(1, 2)), '{:hi 2, :lo 1, :tag "interval"}', 'EDN show');
console.log('RUNTIME OK');
`;

test("smoke: workspace → compile → lint → ledger → tamper → runtime", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) {
    t.skip("platform payload not built");
    return;
  }
  const W = fs.mkdtempSync(path.join(SCRATCH, "smoke-"));
  assert.equal(sh(W, "bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W]).code, 0);
  write(path.join(W, "modules/interval/index.ts"), NOUN);
  write(path.join(W, "modules/interval-ops/index.ts"), VERB);

  // compile, offline, vendored toolchain
  const c = sh(W, "node", ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json"]);
  assert.equal(c.code, 0, c.out);
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.js")), "in-place emit");
  assert.ok(fs.existsSync(path.join(W, "modules/interval/index.d.ts")), "interface artifact emitted");

  // lint: clean house-style modules
  const l = sh(W, "node", ["platform/lint/check.js", "modules"]);
  assert.equal(l.code, 0, l.out);
  assert.match(l.out, /LINT OK/);

  // ledger: definitions present; then tamper → modified detected
  const led = sh(W, "node", ["platform/ledger/ledger.js", "modules/interval", "modules/interval-ops"]);
  assert.equal(led.code, 0, led.out);
  const ledger = JSON.parse(led.out);
  assert.ok(ledger.modules.interval.definitions.width.selfHash);
  assert.ok(ledger.modules["interval-ops"].definitions.sweep.exported);
  assert.ok(ledger.totalNodes > 100);
  fs.writeFileSync(path.join(W, "ledger-before.json"), led.out);

  const nounPath = path.join(W, "modules/interval/index.ts");
  const pristine = fs.readFileSync(nounPath, "utf8");
  fs.writeFileSync(nounPath, pristine.replace("hi(i) - lo(i)", "hi(i) - lo(i) + 1"));
  const diff = sh(W, "node", ["platform/ledger/ledger.js", "--diff", "ledger-before.json",
    "modules/interval", "modules/interval-ops"]);
  assert.equal(diff.code, 1, "in-place edit must fail the accretion floor");
  assert.match(diff.out, /interval#width/);
  fs.writeFileSync(nounPath, pristine);

  // runtime: compiled product behaves; memo/equals/EDN live
  write(path.join(W, "run-check.mjs"), RUN_CHECK);
  const r = sh(W, "node", ["run-check.mjs"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RUNTIME OK/);
});

test("smoke: lint catches contract violations in a workspace module", (t) => {
  if (!fs.existsSync(path.join(PLATFORM, "payload/platform"))) {
    t.skip("platform payload not built");
    return;
  }
  const W = fs.mkdtempSync(path.join(SCRATCH, "smoke-bad-"));
  assert.equal(sh(W, "bash", [path.join(PLATFORM, "bin/mk-workspace.sh"), W]).code, 0);
  write(path.join(W, "modules/bad/index.ts"), `
let hits = 0;
type RunState = { readonly tag: 'run'; readonly n: number };
const step = (s: RunState): number => s.n;
export const f = (s0: RunState): number => { hits++; return step(s0) + step(s0); };
`);
  const l = sh(W, "node", ["platform/lint/check.js", "modules"]);
  assert.equal(l.code, 1);
  assert.match(l.out, /no-module-mutable/);
  assert.match(l.out, /no-shared-mutation/);
  assert.match(l.out, /linear-state/);
});
