/**
 * services.test.ts — the benign services: memo is observationally its
 * function, intern is equals-preserving, trace is write-only for logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { type Rec, rec, get, equals } from './core.js';
import * as V from './vec.js';
import { memo, intern, trace } from './services.js';
import { drainTrace } from './services-admin.js';

type Pt = Rec<{ readonly tag: 'pt'; readonly x: number; readonly y: number }>;
const pt = (x: number, y: number): Pt => rec({ tag: 'pt', x, y });

test('memo: observationally identical to f; keyed by value equality', () => {
  let calls = 0;
  const dist2 = (p: Pt): number => { calls++; return get(p, 'x') ** 2 + get(p, 'y') ** 2; };
  const fast = memo(dist2);
  assert.equal(fast(pt(3, 4)), 25);
  assert.equal(fast(pt(3, 4)), 25);           // separately-built equal value: hit
  assert.equal(calls, 1);
  assert.equal(fast(pt(1, 1)), 2);
  assert.equal(calls, 2);
});

test('memo: multi-arg and undefined-safe', () => {
  let calls = 0;
  const cat = memo((a: string, b: string): string => { calls++; return a + b; });
  assert.equal(cat('x', 'y'), 'xy');
  assert.equal(cat('x', 'y'), 'xy');
  assert.equal(calls, 1);
});

test('intern: equals-preserving; interned values behave identically', () => {
  const a = intern(pt(1, 2));
  const b = intern(pt(1, 2));
  assert.ok(equals(a, b));
  assert.equal(get(b, 'x'), 1);
});

test('trace: write-only from logic; admin drains in order', () => {
  drainTrace();
  trace(rec({ tag: 'ev', n: 1 }));
  trace(V.of<number>(1, 2));
  const drained = drainTrace();
  assert.equal(drained.length, 2);
  assert.equal(drainTrace().length, 0, 'drained once, gone');
});
