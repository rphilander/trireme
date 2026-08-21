/**
 * Public API contract for the engine.
 *
 * The subject evaluates JavaScript source text (the script goal) and reports
 * what the program observably did: the lines it `print`ed and the name of any
 * exception that escaped to the top.
 */

/**
 * The observable result of running a program.
 *
 * `output` is one entry per `print(...)` call, in order: the call's arguments
 * each converted to a string with the language's ToString and joined by a
 * single space. `error` is `null` when the program ran to completion; when an
 * exception propagates to the top it is that exception's `name` (a string) if
 * the thrown value is an object with a string `name`, and otherwise the thrown
 * value converted with ToString. When the source fails to parse, `error` is
 * `"SyntaxError"` and `output` is empty. Output printed before a runtime
 * exception is retained.
 */
export interface EvalResult {
  output: string[];
  error: string | null;
}

/**
 * Parses `source` as a script and evaluates it, returning what it observably
 * did. Never throws for any string: a parse failure is reported as
 * `{ output: [], error: "SyntaxError" }`, and a script-level runtime exception
 * through `error`, not propagated. The host `print` is the only ambient
 * binding beyond the language's standard globals; it appends one line to
 * `output`.
 */
export declare function run(source: string): EvalResult;
