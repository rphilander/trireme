declare const VEC: unique symbol;
declare const VMAP: unique symbol;
declare const VSET: unique symbol;
declare const REC: unique symbol;
export interface Vec<T extends Value> {
    readonly [VEC]: T;
}
export interface VMap<K extends Value, V extends Value> {
    readonly [VMAP]: [K, V];
}
export interface VSet<T extends Value> {
    readonly [VSET]: T;
}
export interface Rec<S extends RecShape> {
    readonly [REC]: S;
}
export type Scalar = null | boolean | number | string;
export type RecShape = {
    readonly [k: string]: Value;
};
export type Value = Scalar | Vec<Value> | VMap<Value, Value> | VSet<Value> | Rec<RecShape>;
export declare const rec: <S extends RecShape>(fields: S) => Rec<S>;
export declare const get: <S extends RecShape, K extends keyof S & string>(r: Rec<S>, k: K) => S[K];
export declare const set: <S extends RecShape, K extends keyof S & string>(r: Rec<S>, k: K, v: S[K]) => Rec<S>;
export declare const update: <S extends RecShape, K extends keyof S & string>(r: Rec<S>, k: K, f: (v: S[K]) => S[K]) => Rec<S>;
export declare const merge: <S extends RecShape>(r: Rec<S>, patch: Partial<S>) => Rec<S>;
export type Tagged = Rec<RecShape & {
    readonly tag: string;
}>;
export type ShapeOf<R> = R extends Rec<infer S> ? S : never;
export type TagOf<R extends Tagged> = ShapeOf<R>['tag'] & string;
export declare const tag: <R extends Tagged>(r: R) => TagOf<R>;
export declare const match: <R extends Tagged, Out>(r: R, arms: { [K in TagOf<R>]: (v: Extract<R, Rec<{
    readonly tag: K;
} & RecShape>>) => Out; }) => Out;
export declare const equals: (a: Value, b: Value) => boolean;
export declare const valueHash: (v: Value) => number;
/** Canonical EDN rendering; deterministic (map/set entries sorted). */
export declare const show: (v: Value) => string;
export {};
