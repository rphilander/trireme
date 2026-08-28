/**
 * platform/values/vmap — persistent map operations (homogeneous typed
 * keys/values; for heterogeneous shapes use records in core). House
 * idiom: `import * as VMap from '…/vmap.js'`. Audited kernel.
 */
import { Map as IMap } from './vendor/immutable/immutable.es.js';
const raw = (m) => m;
const wrap = (m) => m;
export const empty = () => wrap(IMap());
export const of = (entries) => wrap(IMap(entries));
export const count = (m) => raw(m).size;
export const isEmpty = (m) => raw(m).size === 0;
export const has = (m, k) => raw(m).has(k);
export const get = (m, k) => raw(m).get(k);
export const getOr = (m, k, fallback) => raw(m).get(k, fallback);
export const set = (m, k, v) => wrap(raw(m).set(k, v));
export const remove = (m, k) => wrap(raw(m).remove(k));
export const update = (m, k, fallback, f) => wrap(raw(m).set(k, f(raw(m).get(k, fallback))));
export const keys = (m) => [...raw(m).keys()];
export const entries = (m) => [...raw(m).entries()];
export const reduce = (m, init, f) => raw(m).reduce((acc, v, k) => f(acc, v, k), init);
