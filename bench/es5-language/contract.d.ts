/**
 * es5-interpreter — public API contract.
 *
 * Parses ECMAScript 5 source text (the script goal, non-strict) and evaluates
 * it, reporting what the program observably did: the lines it `print`ed and the
 * name of any exception that escaped — including a `"SyntaxError"` when the
 * source is not valid ES5. Source in, observable behaviour out; the package
 * owns both halves, the parser and the evaluator.
 */

/**
 * The observable result of running a program.
 *
 * `output` is one entry per `print(...)` call, in order: the call's arguments
 * each converted to a string with the language's ToString and joined by a
 * single space. `error` is `null` when the program ran to completion; when an
 * exception propagates to the top it is that exception's `name` (a string) if
 * the thrown value is an object with a string `name` — `"TypeError"`,
 * `"ReferenceError"`, and so on — and otherwise the thrown value converted with
 * ToString. When the source is not a valid ES5 script, `error` is
 * `"SyntaxError"` and `output` is empty. Output printed before a runtime
 * exception is retained.
 */
export interface EvalResult {
  output: string[];
  error: string | null;
}

/**
 * Parses `source` as an ES5 script and evaluates it, returning what it
 * observably did. Never throws for any string: a parse failure is reported as
 * `{ output: [], error: "SyntaxError" }`, and a script-level runtime exception
 * through `error`, not propagated. The host `print` is the only ambient binding
 * beyond the standard globals the spec lists; it appends one line to `output`.
 */
export declare function run(source: string): EvalResult;
