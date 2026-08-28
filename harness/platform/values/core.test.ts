/**
 * core.test.ts — executable review artifact for the facade API.
 * Written in the house style an agent module would use: nouns as tagged
 * records, total `match`, namespaced collection ops, linear threading.
 * The @ts-expect-error lines are compile-time assertions: tsc fails if
 * the marked line is NOT an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { type Rec, type Vec, type VMap, rec, get, set, update, tag, match, equals, show, valueHash } from './core.js';
import * as V from './vec.js';
import * as M from './vmap.js';

// --- nouns, the house pattern -----------------------------------------------
type NumV = Rec<{ readonly tag: 'num'; readonly n: number }>;
type StrV = Rec<{ readonly tag: 'str'; readonly s: string }>;
type BoolV = Rec<{ readonly tag: 'bool'; readonly b: boolean }>;
type JsVal = NumV | StrV | BoolV;

const numV = (n: number): NumV => rec({ tag: 'num', n });
const strV = (s: string): StrV => rec({ tag: 'str', s });
const boolV = (b: boolean): BoolV => rec({ tag: 'bool', b });

const render = (v: JsVal): string =>
  match(v, {
    num: (x) => String(get(x, 'n')),
    str: (x) => JSON.stringify(get(x, 's')),
    bool: (x) => (get(x, 'b') ? 'true' : 'false'),
  });

test('tagged records: construct, tag, total match with narrowing', () => {
  const vals: Vec<JsVal> = V.of<JsVal>(numV(42), strV('hi'), boolV(false));
  assert.equal(tag(numV(1)), 'num');
  assert.deepEqual(V.toArray(V.map(vals, (v): StrV => strV(render(v)))).map((r) => get(r, 's')),
    ['42', '"hi"', 'false']);

  // @ts-expect-error — match must be total: 'bool' arm missing
  const bad = (v: JsVal) => match(v, { num: () => 0, str: () => 1 });
  void bad;
});

test('records: typed get/set/update; persistence (original untouched)', () => {
  const a = numV(1);
  const b = set(a, 'n', 2);
  assert.equal(get(a, 'n'), 1);
  assert.equal(get(b, 'n'), 2);
  assert.equal(get(update(b, 'n', (n) => n * 10), 'n'), 20);

  // @ts-expect-error — 's' is not a key of NumV
  get(a, 's');
  // @ts-expect-error — wrong value type for 'n'
  set(a, 'n', 'not a number');
});

test('opacity: no backing methods reachable through the brand', () => {
  const v = V.of(1, 2, 3);
  // @ts-expect-error — Vec exposes nothing; only the facade vocabulary exists
  v.push(4);
  assert.equal(V.count(V.push(v, 4)), 4);
});

// --- linear state threading, the house shape --------------------------------
type Env = Rec<{ readonly tag: 'env'; readonly vars: VMap<string, number>; readonly depth: number }>;
const envRoot = (): Env => rec({ tag: 'env', vars: M.empty<string, number>(), depth: 0 });
const define = (s0: Env, name: string, val: number): Env =>
  update(s0, 'vars', (vs) => M.set(vs, name, val));
const lookup = (s: Env, name: string): number | undefined => M.get(get(s, 'vars'), name);

test('threading: each state consumed once, values equal by structure', () => {
  const s0 = envRoot();
  const s1 = define(s0, 'x', 1);
  const s2 = define(s1, 'y', 2);
  assert.equal(lookup(s2, 'x'), 1);
  assert.equal(lookup(s0, 'x'), undefined);
  assert.ok(equals(define(s0, 'x', 1), s1), 'structural equality across separately-built states');
  assert.equal(valueHash(define(s0, 'x', 1)), valueHash(s1));
});

test('EDN show: canonical, deterministic, one printer for everything', () => {
  assert.equal(show(numV(42)), '{:n 42, :tag "num"}');
  assert.equal(show(V.of<number | string | null>(1, 'two', null)), '[1 "two" nil]');
  const m = M.of<string, number>([['b', 2], ['a', 1]]);
  assert.equal(show(m), '{:a 1, :b 2}');
  const nested = rec({ tag: 'pair', items: V.of<NumV | StrV>(numV(1), strV('x')) });
  assert.equal(show(nested), '{:items [{:n 1, :tag "num"} {:s "x", :tag "str"}], :tag "pair"}');
});
