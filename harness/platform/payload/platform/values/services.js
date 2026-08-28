/**
 * platform/values/services — the benign-state services: the ONLY
 * sanctioned mutable state reachable from logic code, made benign by
 * API shape (observation-proof), not by promise. Audited kernel.
 *
 *  - memo(f): observationally identical to f (f pure — the lint's job);
 *    keys are the argument vectors themselves under value equality, so
 *    there is no cache object and no key to get wrong.
 *  - intern(v): returns something `equals` to v. The facade exports no
 *    reference identity on Values, so interning is unobservable.
 *  - trace(event): write-only from logic; the read side lives in
 *    services-admin.ts, which agent worlds never see.
 */
import { List, Map as IMap } from './vendor/immutable/immutable.es.js';
import { sink } from './services-admin.js';
export const memo = (f) => {
    let cache = IMap();
    return (...args) => {
        const key = List(args);
        const hit = cache.get(key);
        if (hit !== undefined || cache.has(key))
            return hit;
        const r = f(...args);
        cache = cache.set(key, r);
        return r;
    };
};
let interned = IMap();
export const intern = (v) => {
    const hit = interned.get(v);
    if (hit !== undefined)
        return hit;
    interned = interned.set(v, v);
    return v;
};
export const trace = (event) => { sink.push(event); };
