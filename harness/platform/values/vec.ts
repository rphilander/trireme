/**
 * platform/values/vec — vector operations. House idiom: namespaced
 * imports (`import * as Vec from '…/vec.js'`), data-first signatures.
 * Part of the audited kernel (casts legal here only).
 */
import { List } from './vendor/immutable/immutable.es.js';
import type { Value, Vec } from './core.js';

const raw = <T extends Value>(v: Vec<T>): List<T> => v as unknown as List<T>;
const wrap = <T extends Value>(l: List<T>): Vec<T> => l as unknown as Vec<T>;

export const of = <T extends Value>(...xs: readonly T[]): Vec<T> => wrap(List(xs));
export const from = <T extends Value>(xs: Iterable<T>): Vec<T> => wrap(List(xs));
export const empty = <T extends Value>(): Vec<T> => wrap(List());

export const count = (v: Vec<Value>): number => raw(v).size;
export const isEmpty = (v: Vec<Value>): boolean => raw(v).size === 0;
export const nth = <T extends Value>(v: Vec<T>, i: number): T | undefined => raw(v).get(i);
export const first = <T extends Value>(v: Vec<T>): T | undefined => raw(v).first();
export const last = <T extends Value>(v: Vec<T>): T | undefined => raw(v).last();

export const push = <T extends Value>(v: Vec<T>, x: T): Vec<T> => wrap(raw(v).push(x));
export const pop = <T extends Value>(v: Vec<T>): Vec<T> => wrap(raw(v).pop());
export const setNth = <T extends Value>(v: Vec<T>, i: number, x: T): Vec<T> => wrap(raw(v).set(i, x));
export const updateNth = <T extends Value>(v: Vec<T>, i: number, f: (x: T) => T): Vec<T> => {
  const cur = raw(v).get(i);
  if (cur === undefined && !raw(v).has(i)) return v;
  return wrap(raw(v).set(i, f(cur as T)));
};
export const slice = <T extends Value>(v: Vec<T>, start?: number, end?: number): Vec<T> =>
  wrap(raw(v).slice(start, end));
export const concat = <T extends Value>(a: Vec<T>, b: Vec<T>): Vec<T> => wrap(raw(a).concat(raw(b)));
export const reverse = <T extends Value>(v: Vec<T>): Vec<T> => wrap(raw(v).reverse());

export const map = <T extends Value, U extends Value>(v: Vec<T>, f: (x: T, i: number) => U): Vec<U> =>
  wrap(raw(v).map(f));
export const filter = <T extends Value>(v: Vec<T>, p: (x: T, i: number) => boolean): Vec<T> =>
  wrap(raw(v).filter(p));
export const reduce = <T extends Value, A>(v: Vec<T>, init: A, f: (acc: A, x: T, i: number) => A): A =>
  raw(v).reduce((acc, x, i) => f(acc, x, i), init);
export const some = <T extends Value>(v: Vec<T>, p: (x: T) => boolean): boolean => raw(v).some(p);
export const every = <T extends Value>(v: Vec<T>, p: (x: T) => boolean): boolean => raw(v).every(p);
export const indexOf = <T extends Value>(v: Vec<T>, x: T): number => raw(v).indexOf(x);

export const toArray = <T extends Value>(v: Vec<T>): T[] => raw(v).toArray();
