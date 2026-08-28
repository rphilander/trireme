/**
 * platform/values/vec — vector operations. House idiom: namespaced
 * imports (`import * as Vec from '…/vec.js'`), data-first signatures.
 * Part of the audited kernel (casts legal here only).
 */
import { List } from './vendor/immutable/immutable.es.js';
const raw = (v) => v;
const wrap = (l) => l;
export const of = (...xs) => wrap(List(xs));
export const from = (xs) => wrap(List(xs));
export const empty = () => wrap(List());
export const count = (v) => raw(v).size;
export const isEmpty = (v) => raw(v).size === 0;
export const nth = (v, i) => raw(v).get(i);
export const first = (v) => raw(v).first();
export const last = (v) => raw(v).last();
export const push = (v, x) => wrap(raw(v).push(x));
export const pop = (v) => wrap(raw(v).pop());
export const setNth = (v, i, x) => wrap(raw(v).set(i, x));
export const updateNth = (v, i, f) => {
    const cur = raw(v).get(i);
    if (cur === undefined && !raw(v).has(i))
        return v;
    return wrap(raw(v).set(i, f(cur)));
};
export const slice = (v, start, end) => wrap(raw(v).slice(start, end));
export const concat = (a, b) => wrap(raw(a).concat(raw(b)));
export const reverse = (v) => wrap(raw(v).reverse());
export const map = (v, f) => wrap(raw(v).map(f));
export const filter = (v, p) => wrap(raw(v).filter(p));
export const reduce = (v, init, f) => raw(v).reduce((acc, x, i) => f(acc, x, i), init);
export const some = (v, p) => raw(v).some(p);
export const every = (v, p) => raw(v).every(p);
export const indexOf = (v, x) => raw(v).indexOf(x);
export const toArray = (v) => raw(v).toArray();
