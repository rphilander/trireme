/** A parsed semantic version. Build metadata is retained but never affects precedence. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Numeric identifiers as numbers, alphanumeric ones as strings. Empty when absent. */
  prerelease: ReadonlyArray<string | number>;
  /** Always strings; build identifiers are never interpreted numerically. Empty when absent. */
  build: ReadonlyArray<string>;
}

/** Parses a version, or returns null. Never throws. */
export declare function parse(version: string): SemVer | null;

/** Whether the string is a valid semantic version. */
export declare function valid(version: string): boolean;

/** -1, 0 or 1 by precedence. Throws TypeError on invalid input. */
export declare function compare(a: string, b: string): -1 | 0 | 1;

/** Ascending by precedence. Stable, and does not modify the input. Throws TypeError on invalid input. */
export declare function sort(versions: readonly string[]): string[];

/** Whether the version falls within the range. Throws TypeError on invalid input. */
export declare function satisfies(version: string, range: string): boolean;
