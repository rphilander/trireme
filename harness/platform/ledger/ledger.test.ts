/**
 * ledger.test.ts — accretion ledger: formatting-insensitive hashes,
 * SCC handling for mutual recursion, cross-module closure propagation,
 * and the accretion diff (modified = violation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeLedger, diffLedgers } from './ledger.js';

const SCRATCH = process.env['SCRATCHPAD_DIR'] ?? os.tmpdir();

const mkModule = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'ledg-'));
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), src);
  return dir;
};

test('definitions extracted; hashes formatting/comment-insensitive; node counts stable', () => {
  const a1 = mkModule({ 'index.ts': `
// a helper
const twice = (n: number): number => n * 2;
export const quad = (n: number): number => twice(twice(n));
` });
  const a2 = mkModule({ 'index.ts': `
const twice = (n: number): number =>
  /* reformatted, commented differently */ n * 2;


export const quad = (n: number): number => twice(twice(n));
` });
  const l1 = computeLedger({ alpha: a1 });
  const l2 = computeLedger({ alpha: a2 });
  const d1 = l1.modules['alpha']?.definitions ?? {};
  const d2 = l2.modules['alpha']?.definitions ?? {};
  assert.deepEqual(Object.keys(d1).sort(), ['quad', 'twice']);
  assert.equal(d1['quad']?.exported, true);
  assert.equal(d1['twice']?.exported, false);
  assert.equal(d1['twice']?.selfHash, d2['twice']?.selfHash, 'formatting must not change hashes');
  assert.equal(d1['quad']?.closureHash, d2['quad']?.closureHash);
  assert.equal(d1['quad']?.nodes, d2['quad']?.nodes, 'node count formatting-insensitive');
  assert.deepEqual(d1['quad']?.refs, ['alpha#twice']);
});

test('closure hash: editing a helper changes dependents; unrelated defs untouched', () => {
  const v1 = mkModule({ 'index.ts': `
const helper = (n: number): number => n + 1;
export const user = (n: number): number => helper(n);
export const loner = (n: number): number => n;
` });
  const v2 = mkModule({ 'index.ts': `
const helper = (n: number): number => n + 2;
export const user = (n: number): number => helper(n);
export const loner = (n: number): number => n;
` });
  const a = computeLedger({ m: v1 }).modules['m']?.definitions ?? {};
  const b = computeLedger({ m: v2 }).modules['m']?.definitions ?? {};
  assert.equal(a['user']?.selfHash, b['user']?.selfHash, 'user text unchanged');
  assert.notEqual(a['user']?.closureHash, b['user']?.closureHash, 'closure sees the helper edit');
  assert.equal(a['loner']?.closureHash, b['loner']?.closureHash);
});

test('mutual recursion: SCC hashed as a unit, no divergence', () => {
  const dir = mkModule({ 'index.ts': `
export const evalExpr = (d: number): number => (d <= 0 ? 1 : evalStmt(d - 1));
export const evalStmt = (d: number): number => (d <= 0 ? 2 : evalExpr(d - 1));
` });
  const l = computeLedger({ core: dir });
  const defs = l.modules['core']?.definitions ?? {};
  assert.ok(defs['evalExpr']?.closureHash);
  assert.equal(defs['evalExpr']?.closureHash, defs['evalStmt']?.closureHash, 'same SCC, same closure');
  assert.notEqual(defs['evalExpr']?.selfHash, defs['evalStmt']?.selfHash);
});

test('cross-module: dependent closure tracks dependency edits', () => {
  const noun1 = mkModule({ 'index.ts': `export const base = (): number => 1;` });
  const noun2 = mkModule({ 'index.ts': `export const base = (): number => 99;` });
  const verbSrc = (nounDir: string): string =>
    `import { base } from '${nounDir}/index.js';\nexport const use = (): number => base() + 1;`;
  const verbA = mkModule({ 'index.ts': verbSrc('../' + path.basename(noun1)) });
  const verbB = mkModule({ 'index.ts': verbSrc('../' + path.basename(noun2)) });
  // place verbs as siblings of their nouns so relative resolution lands
  const lA = computeLedger({ noun: noun1, verb: verbA });
  const lB = computeLedger({ noun: noun2, verb: verbB });
  assert.equal(lA.modules['verb']?.definitions['use']?.selfHash,
    lB.modules['verb']?.definitions['use']?.selfHash);
  assert.notEqual(lA.modules['verb']?.definitions['use']?.closureHash,
    lB.modules['verb']?.definitions['use']?.closureHash);
});

test('diff: additions and orphan deletions legal; modification detected', () => {
  const before = computeLedger({ m: mkModule({ 'index.ts': `
export const keep = (): number => 1;
export const dropMe = (): number => 2;
` }) });
  const after = computeLedger({ m: mkModule({ 'index.ts': `
export const keep = (): number => 1;
export const added = (): number => 3;
` }) });
  const d = diffLedgers(before, after);
  assert.deepEqual(d, { added: ['m#added'], deleted: ['m#dropMe'], modified: [] });

  const tampered = computeLedger({ m: mkModule({ 'index.ts': `
export const keep = (): number => 42;
export const dropMe = (): number => 2;
` }) });
  const d2 = diffLedgers(before, tampered);
  assert.deepEqual(d2.modified, ['m#keep'], 'in-place edit = accretion violation');
});
