/**
 * platform/values/vmap — persistent map operations (homogeneous typed
 * keys/values; for heterogeneous shapes use records in core). House
 * idiom: `import * as VMap from '…/vmap.js'`. Audited kernel.
 */
import { Map as IMap } from './vendor/immutable/immutable.es.js';
import type { Value, VMap } from './core.js';

const raw = <K extends Value, V extends Value>(m: VMap<K, V>): IMap<K, V> => m as unknown as IMap<K, V>;
const wrap = <K extends Value, V extends Value>(m: IMap<K, V>): VMap<K, V> => m as unknown as VMap<K, V>;

export const empty = <K extends Value, V extends Value>(): VMap<K, V> => wrap(IMap());
export const of = <K extends Value, V extends Value>(entries: Iterable<[K, V]>): VMap<K, V> =>
  wrap(IMap(entries));

export const count = (m: VMap<Value, Value>): number => raw(m).size;
export const isEmpty = (m: VMap<Value, Value>): boolean => raw(m).size === 0;
export const has = <K extends Value>(m: VMap<K, Value>, k: K): boolean => raw(m).has(k);
export const get = <K extends Value, V extends Value>(m: VMap<K, V>, k: K): V | undefined => raw(m).get(k);
export const getOr = <K extends Value, V extends Value>(m: VMap<K, V>, k: K, fallback: V): V =>
  raw(m).get(k, fallback);

export const set = <K extends Value, V extends Value>(m: VMap<K, V>, k: K, v: V): VMap<K, V> =>
  wrap(raw(m).set(k, v));
export const remove = <K extends Value, V extends Value>(m: VMap<K, V>, k: K): VMap<K, V> =>
  wrap(raw(m).remove(k));
export const update = <K extends Value, V extends Value>(
  m: VMap<K, V>, k: K, fallback: V, f: (v: V) => V,
): VMap<K, V> => wrap(raw(m).set(k, f(raw(m).get(k, fallback))));

export const keys = <K extends Value>(m: VMap<K, Value>): K[] => [...raw(m).keys()];
export const entries = <K extends Value, V extends Value>(m: VMap<K, V>): [K, V][] => [...raw(m).entries()];
export const reduce = <K extends Value, V extends Value, A>(
  m: VMap<K, V>, init: A, f: (acc: A, v: V, k: K) => A,
): A => raw(m).reduce((acc, v, k) => f(acc, v, k), init);
