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
import {
  List,
  Map as IMap,
  Set as ISet,
  is,
  hash as backingHash,
} from './vendor/immutable/immutable.es.js';

// ---------------------------------------------------------------------------
// Brands. Phantom fields on `unique symbol`s — type-only; at runtime a
// Vec IS a backing List, a Rec IS a backing Map. Nothing here exists
// after compilation.
declare const VEC: unique symbol;
declare const VMAP: unique symbol;
declare const VSET: unique symbol;
declare const REC: unique symbol;

export interface Vec<T extends Value> { readonly [VEC]: T }
export interface VMap<K extends Value, V extends Value> { readonly [VMAP]: [K, V] }
export interface VSet<T extends Value> { readonly [VSET]: T }
export interface Rec<S extends RecShape> { readonly [REC]: S }

export type Scalar = null | boolean | number | string;
export type RecShape = { readonly [k: string]: Value };
export type Value =
  | Scalar
  | Vec<Value>
  | VMap<Value, Value>
  | VSet<Value>
  | Rec<RecShape>;

// ---------------------------------------------------------------------------
// Records: heterogeneous typed shapes over persistent maps.

export const rec = <S extends RecShape>(fields: S): Rec<S> =>
  IMap(fields) as unknown as Rec<S>;

export const get = <S extends RecShape, K extends keyof S & string>(
  r: Rec<S>, k: K,
): S[K] =>
  (r as unknown as IMap<string, Value>).get(k) as S[K];

export const set = <S extends RecShape, K extends keyof S & string>(
  r: Rec<S>, k: K, v: S[K],
): Rec<S> =>
  (r as unknown as IMap<string, Value>).set(k, v) as unknown as Rec<S>;

export const update = <S extends RecShape, K extends keyof S & string>(
  r: Rec<S>, k: K, f: (v: S[K]) => S[K],
): Rec<S> => set(r, k, f(get(r, k)));

export const merge = <S extends RecShape>(r: Rec<S>, patch: Partial<S>): Rec<S> =>
  (r as unknown as IMap<string, Value>).merge(patch as never) as unknown as Rec<S>;

// ---------------------------------------------------------------------------
// Tagged unions + total match. The blessed case-analysis idiom: nouns
// are Rec shapes with a literal `tag`; `match` requires exactly one arm
// per tag — a missing arm (or a new variant added later) is a compile
// error at every match site.

export type Tagged = Rec<RecShape & { readonly tag: string }>;
export type ShapeOf<R> = R extends Rec<infer S> ? S : never;
export type TagOf<R extends Tagged> = ShapeOf<R>['tag'] & string;

export const tag = <R extends Tagged>(r: R): TagOf<R> =>
  (r as unknown as IMap<string, Value>).get('tag') as TagOf<R>;

export const match = <R extends Tagged, Out>(
  r: R,
  arms: { [K in TagOf<R>]: (v: Extract<R, Rec<{ readonly tag: K } & RecShape>>) => Out },
): Out =>
  (arms as unknown as Record<string, (v: R) => Out>)[tag(r)]!(r);

// ---------------------------------------------------------------------------
// Equality, hashing, printing — one notion of each, system-wide.

export const equals = (a: Value, b: Value): boolean => is(a, b);
export const valueHash = (v: Value): number => backingHash(v);

const KEYWORD = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const showKey = (k: Value): string =>
  typeof k === 'string' && KEYWORD.test(k) ? `:${k}` : show(k);

/** Canonical EDN rendering; deterministic (map/set entries sorted). */
export const show = (v: Value): string => {
  if (v === null) return 'nil';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (List.isList(v)) return `[${(v as List<Value>).toArray().map(show).join(' ')}]`;
  if (ISet.isSet(v)) {
    const xs = (v as ISet<Value>).toArray().map(show).sort();
    return `#{${xs.join(' ')}}`;
  }
  if (IMap.isMap(v)) {
    const entries = (v as IMap<Value, Value>)
      .toArray()
      .map(([k, x]) => `${showKey(k)} ${show(x)}`)
      .sort();
    return `{${entries.join(', ')}}`;
  }
  return String(v);
};
