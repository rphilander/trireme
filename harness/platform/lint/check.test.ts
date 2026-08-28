/**
 * check.test.ts — the lint against known-good and known-bad sources.
 * Each bad case must produce its named rule; the clean case none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintFiles, type Finding } from './check.js';

const SCRATCH = process.env['SCRATCHPAD_DIR'] ?? os.tmpdir();

const lintSrc = (src: string): Finding[] => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'lint-'));
  const f = path.join(dir, 'mod.ts');
  fs.writeFileSync(f, src);
  return lintFiles([f]);
};
const rules = (fs: Finding[]): string[] => [...new Set(fs.map((f) => f.rule))].sort();

test('clean house-style module → no findings', () => {
  const out = lintSrc(`
type EnvState = { readonly tag: 'env'; readonly n: number };
const step = (s: EnvState): EnvState => ({ tag: 'env', n: s.n + 1 });
export const run = (s0: EnvState, k: number): EnvState => {
  let s = s0;
  for (let i = 0; i < k; i++) { s = step(s); }
  return s;
};
export const scratch = (xs: readonly number[]): number => {
  const acc: number[] = [];
  let total = 0;
  for (const x of xs) { acc.push(x * 2); total += x; }
  return total + (acc[0] ?? 0);
};
`);
  assert.deepEqual(out, []);
});

test('classes, this, enum, namespace → flagged', () => {
  const out = lintSrc(`
class C { m(): void { console.log(this); } }
enum E { A }
namespace N { export const x = 1; }
export const use = (): C => new C();
`);
  assert.deepEqual(rules(out), ['no-class', 'no-enum', 'no-namespace', 'no-this']);
});

test('casts and any: as-const allowed, the rest kernel-only', () => {
  const out = lintSrc(`
export const a = { k: 'v' } as const;
export const b = (x: unknown): string => x as string;
export const c = (x: string | null): string => x!;
export const d = (x: any): number => x;
`);
  assert.deepEqual(rules(out), ['no-any', 'no-as', 'no-non-null']);
});

test('module-level let and shared mutation → flagged; local scratch fine', () => {
  const out = lintSrc(`
let counter = 0;
const config = { retries: 1 };
export const bump = (): number => { counter++; config.retries = 2; return counter; };
export const local = (): number => { let n = 0; n++; const o = { x: 1 }; o.x = 2; return n + o.x; };
`);
  assert.deepEqual(rules(out), ['no-module-mutable', 'no-shared-mutation']);
  assert.equal(out.filter((f) => f.rule === 'no-shared-mutation').length, 2);
});

test('services-admin import → flagged', () => {
  const out = lintSrc(`import { drainTrace } from './services-admin.js';\nexport const x = drainTrace;`);
  assert.deepEqual(rules(out), ['no-admin-import']);
});

test('linear-state: double use flagged; rethreading and branches clean', () => {
  const bad = lintSrc(`
type EnvState = { readonly tag: 'env' };
const g = (s: EnvState): number => 1;
const h = (s: EnvState): number => 2;
export const f = (s0: EnvState): number => g(s0) + h(s0);
`);
  assert.deepEqual(rules(bad), ['linear-state']);

  const good = lintSrc(`
type EnvState = { readonly tag: 'env' };
const g = (s: EnvState): EnvState => s;
const h = (s: EnvState): number => 0;
export const f = (s0: EnvState): number => { const s1 = g(s0); return h(s1); };
export const branched = (s0: EnvState, c: boolean): number => (c ? h(s0) : h(s0));
`);
  assert.deepEqual(good, []);
});

test('linear-state: loop without rethreading flagged; with rethreading clean', () => {
  const bad = lintSrc(`
type EnvState = { readonly tag: 'env' };
const h = (s: EnvState): number => 0;
export const f = (s0: EnvState, k: number): number => {
  let total = 0;
  for (let i = 0; i < k; i++) { total += h(s0); }
  return total;
};
`);
  assert.deepEqual(rules(bad), ['linear-state']);

  const good = lintSrc(`
type EnvState = { readonly tag: 'env' };
const step = (s: EnvState): EnvState => s;
export const f = (s0: EnvState, k: number): EnvState => {
  let s = s0;
  for (let i = 0; i < k; i++) { s = step(s); }
  return s;
};
`);
  assert.deepEqual(good, []);
});
