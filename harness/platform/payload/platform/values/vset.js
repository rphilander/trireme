/**
 * platform/values/vset — persistent set operations. House idiom:
 * `import * as VSet from '…/vset.js'`. Audited kernel.
 */
import { Set as ISet } from './vendor/immutable/immutable.es.js';
const raw = (s) => s;
const wrap = (s) => s;
export const empty = () => wrap(ISet());
export const of = (...xs) => wrap(ISet(xs));
export const from = (xs) => wrap(ISet(xs));
export const count = (s) => raw(s).size;
export const isEmpty = (s) => raw(s).size === 0;
export const has = (s, x) => raw(s).has(x);
export const add = (s, x) => wrap(raw(s).add(x));
export const remove = (s, x) => wrap(raw(s).remove(x));
export const union = (a, b) => wrap(raw(a).union(raw(b)));
export const intersect = (a, b) => wrap(raw(a).intersect(raw(b)));
export const subtract = (a, b) => wrap(raw(a).subtract(raw(b)));
export const toArray = (s) => raw(s).toArray();
