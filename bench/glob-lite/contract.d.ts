/**
 * glob-lite — public API contract.
 *
 * Bash pattern matching and brace expansion, as strings in and results out.
 * The reference is bash 5.2 with `extglob` on, in the C locale; the acceptance
 * suite's expected values were produced by bash itself.
 */

export interface MatchOptions {
  /**
   * Compare letters case-insensitively, including letters inside bracket sets
   * and ranges. POSIX classes such as `[[:upper:]]` are unaffected. Default false.
   */
  nocase?: boolean;
}

/**
 * Whether `input` matches `pattern` in its entirety, with the semantics of
 * bash's `[[ input == pattern ]]` and `extglob` enabled: `*`, `?`, bracket
 * expressions, backslash escapes, and the extended operators `?()`, `*()`,
 * `+()`, `@()`, `!()`. Braces are ordinary characters here. Never throws.
 */
export declare function match(input: string, pattern: string, options?: MatchOptions): boolean;

/**
 * Bash brace expansion of one word: comma lists, numeric and alphabetic
 * ranges with optional step, nesting. Returns `[pattern]` when nothing
 * expands. Backslashes are preserved. Never throws.
 */
export declare function expandBraces(pattern: string): string[];

/** `expandBraces(pattern)`, then `match(input, alternative, options)` for any alternative. */
export declare function matchAny(input: string, pattern: string, options?: MatchOptions): boolean;
