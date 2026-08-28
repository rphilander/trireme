/**
 * platform/values/vset — persistent set operations. House idiom:
 * `import * as VSet from '…/vset.js'`. Audited kernel.
 */
import { Set as ISet } from './vendor/immutable/immutable.es.js';
import type { Value, VSet } from './core.js';

const raw = <T extends Value>(s: VSet<T>): ISet<T> => s as unknown as ISet<T>;
const wrap = <T extends Value>(s: ISet<T>): VSet<T> => s as unknown as VSet<T>;

export const empty = <T extends Value>(): VSet<T> => wrap(ISet());
export const of = <T extends Value>(...xs: readonly T[]): VSet<T> => wrap(ISet(xs));
export const from = <T extends Value>(xs: Iterable<T>): VSet<T> => wrap(ISet(xs));

export const count = (s: VSet<Value>): number => raw(s).size;
export const isEmpty = (s: VSet<Value>): boolean => raw(s).size === 0;
export const has = <T extends Value>(s: VSet<T>, x: T): boolean => raw(s).has(x);

export const add = <T extends Value>(s: VSet<T>, x: T): VSet<T> => wrap(raw(s).add(x));
export const remove = <T extends Value>(s: VSet<T>, x: T): VSet<T> => wrap(raw(s).remove(x));
export const union = <T extends Value>(a: VSet<T>, b: VSet<T>): VSet<T> => wrap(raw(a).union(raw(b)));
export const intersect = <T extends Value>(a: VSet<T>, b: VSet<T>): VSet<T> => wrap(raw(a).intersect(raw(b)));
export const subtract = <T extends Value>(a: VSet<T>, b: VSet<T>): VSet<T> => wrap(raw(a).subtract(raw(b)));

export const toArray = <T extends Value>(s: VSet<T>): T[] => raw(s).toArray();
