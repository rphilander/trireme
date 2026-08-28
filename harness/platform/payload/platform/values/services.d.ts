import type { Value } from './core.js';
export declare const memo: <A extends readonly Value[], R extends Value>(f: (...args: A) => R) => ((...args: A) => R);
export declare const intern: <T extends Value>(v: T) => T;
export declare const trace: (event: Value) => void;
