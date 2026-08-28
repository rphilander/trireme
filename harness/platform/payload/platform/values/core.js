/**
 * platform/values/core — the value system facade (PROTOTYPE, API under
 * operator review; freezes after sign-off).
 *
 * This directory is the system's audited kernel: the ONLY code allowed
 * to import the vendored backing and the only place `as` casts are
 * legal. Everything above sees opaque branded types and this closed
 * vocabulary; the trusted computing base of the type story is this
 * directory plus tsc.
 */
import { List, Map as IMap, Set as ISet, is, hash as backingHash, } from './vendor/immutable/immutable.es.js';
// ---------------------------------------------------------------------------
// Records: heterogeneous typed shapes over persistent maps.
export const rec = (fields) => IMap(fields);
export const get = (r, k) => r.get(k);
export const set = (r, k, v) => r.set(k, v);
export const update = (r, k, f) => set(r, k, f(get(r, k)));
export const merge = (r, patch) => r.merge(patch);
export const tag = (r) => r.get('tag');
export const match = (r, arms) => arms[tag(r)](r);
// ---------------------------------------------------------------------------
// Equality, hashing, printing — one notion of each, system-wide.
export const equals = (a, b) => is(a, b);
export const valueHash = (v) => backingHash(v);
const KEYWORD = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const showKey = (k) => typeof k === 'string' && KEYWORD.test(k) ? `:${k}` : show(k);
/** Canonical EDN rendering; deterministic (map/set entries sorted). */
export const show = (v) => {
    if (v === null)
        return 'nil';
    if (typeof v === 'boolean' || typeof v === 'number')
        return String(v);
    if (typeof v === 'string')
        return JSON.stringify(v);
    if (List.isList(v))
        return `[${v.toArray().map(show).join(' ')}]`;
    if (ISet.isSet(v)) {
        const xs = v.toArray().map(show).sort();
        return `#{${xs.join(' ')}}`;
    }
    if (IMap.isMap(v)) {
        const entries = v
            .toArray()
            .map(([k, x]) => `${showKey(k)} ${show(x)}`)
            .sort();
        return `{${entries.join(', ')}}`;
    }
    return String(v);
};
