# es5-language

## Purpose

An interpreter for ECMAScript 5 — the *script* goal, non-strict — that takes a
program as *source text*, parses it and runs it, reporting what the program
observably did: the lines it `print`ed and the name of any exception that
escaped to the top, including a `"SyntaxError"` when the source is not valid
ES5. Source in, observable behaviour out; the package owns both halves, the
parser and the evaluator. It is the same engine as a general ES5 interpreter;
what is new at this rung is the yardstick.

The yardstick is the **language chapter of a standard conformance suite**, in
its ES5, non-strict subset: a large body of
small programs, each of which checks one corner of the language and is written
to **throw when the language behaves wrongly and complete silently when it is
right**. Every case the suite hands to `run` is one assembled program — a small
assertion library (which defines an error class and helpers like `assert`,
`assert.sameValue`, `assert.throws`) followed by a test body that exercises one
feature and asserts the result. There is **no external oracle and nothing to
match against**: a case *passes* exactly when the program runs to completion
with no exception escaping, i.e. `run(program).error === null`, and *fails* when
any assertion inside it throws (or the engine itself throws). These programs do
not `print`; they assert. `output` is beside the point here — `error` is the
whole signal.

This means the interpreter must be complete and correct enough that the
assertion library *and* each test body both run: the library leans on ordinary
ES5 — `Object`, `String`, `Number`, `Boolean`, `typeof`, function objects and
their prototypes, `throw`, `switch`, `arguments`, `hasOwnProperty` — and the
bodies lean on whatever feature they test. A single missing coercion rule or
prototype method turns a case red. The subset for this rung is the **whole
language chapter**: every operator and its coercions, every statement form,
automatic semicolon insertion, line terminators and white space, comments,
identifiers and reserved words, literals, `arguments`, scope and resolution,
and the types' conversions — thousands of small programs, each pinning one
corner exactly. The assertions are exact and unforgiving.

A minority of the cases are **negative**: their expected result is not a silent
completion but a named error. Most are parse-negative — the source is not valid
ES5 (a malformed form, a later-edition construct, a reserved word misused), and
`run` must report `{ output: [], error: "SyntaxError" }` exactly as the API
below describes. A few are runtime-negative and must end with the named error
(`TypeError`, `ReferenceError`, …) in `error`. The suite states the expected
error per case; everything needed to satisfy them is already in this document.

The language to implement is unchanged from a full ES5 interpreter, and the
reference for what ES5 *is* remains the standard as **acorn at
`ecmaVersion: 5`** decides validity and a correct ES5 engine decides behaviour;
what follows describes that language. Where this document and a correct engine
disagree, the engine is right and the suite says what it said.

## Public API

One function, exactly as `contract.d.ts` declares it:

- `run(source)` — parses `source` as an ES5 script and evaluates it, returning
  an `EvalResult`: `output`, one string per `print(...)` call in order, and
  `error`, `null` on normal completion or the escaping exception's name
  otherwise. **`run` never throws for any string.** Source that is not valid
  ES5 returns `{ output: [], error: "SyntaxError" }`; a runtime exception is
  reported through `error`, not propagated.

### The observable model

The evaluator's world is exactly two things: what the program prints, and
whether an exception reached the top.

- **`print`** is a host function, the one binding beyond the standard globals
  below. `print(a, b, c)` converts each argument to a string with the
  language's ToString and appends `ToString(a) + " " + ToString(b) + " " +
  ToString(c)` — the arguments joined by a single space — as one entry of
  `output`. `print()` appends `""`. It returns `undefined`.
- **`error`** is `null` unless something stops the program. A **parse failure**
  — source that is not valid ES5 — makes it `"SyntaxError"` with an empty
  `output`, before any evaluation happens. A **runtime exception** that
  propagates out of the whole program makes it: the thrown value's `name`
  property converted with ToString, when the thrown value is an object with such
  a property (a thrown `Error` gives `"Error"`, a `TypeError` gives
  `"TypeError"`); otherwise the thrown value itself converted with ToString
  (`throw "boom"` gives `"boom"`, `throw 42` gives `"42"`). Whatever was printed
  before a runtime throw stays in `output`.

Completion values are never observed, and neither is how a function or a
non-standard object stringifies beyond what the cases below print. To assert
something, a program prints it.

## Behavior

Once the source has parsed, the interpreter implements ES5 semantics for the program. What follows
is organised by what a program can contain; throughout, "ToNumber",
"ToString", "ToBoolean", "ToPrimitive", "ToInt32", "ToUint32" and
"ToObject" are ES5's abstract operations, and the suite pins them through
their observable effects.

### Parsing

`run` first parses the source as an ES5 script. The accepted language is
exactly ECMAScript 5's grammar (as acorn accepts at `ecmaVersion: 5`): the full
lexical grammar — identifiers and keywords, decimal/hex/legacy-octal numbers,
single- and double-quoted strings with their escapes, comments, automatic
semicolon insertion — and every ES5 statement and expression form. Source that
is not valid ES5 is a `SyntaxError`, reported as `{ output: [], error:
"SyntaxError" }` with nothing evaluated. This includes everything ECMAScript
added later — `let`/`const`, arrow functions, classes, template literals,
generators, destructuring, default/rest parameters, `**`, `?.`, `??`, spread,
`for…of`, binary/octal `0b`/`0o` literals — which a real ES5 implementation
rejects even though a newer engine would run it, as well as ordinary malformed
source (an unbalanced paren, a missing operand, a `return` outside a function).
Regular-expression literals, `with` and `debugger` do not appear in the suite;
whether you parse them is unspecified.

A parse failure is the only place `run` reports `"SyntaxError"`; once a program
parses, everything below is evaluation.

### Values and coercion

The language values are `undefined`, `null`, booleans, numbers (IEEE-754
doubles, one `NaN`, a `+0` and a `-0`, `Infinity`), strings (UTF-16), and
objects (including arrays and functions). `typeof` yields `"undefined"`,
`"object"` (for `null` and non-callable objects), `"boolean"`, `"number"`,
`"string"`, and `"function"` for callables.

- **ToBoolean:** `false`, `+0`, `-0`, `NaN`, `""`, `null`, `undefined` are
  falsy; every other value, every object included, is truthy.
- **ToNumber:** `undefined`→`NaN`, `null`→`+0`, `true`→`1`, `false`→`+0`; a
  string is parsed as a numeric literal after trimming white space (`"  5 "`→
  `5`, `"0x1f"`→`31`, `""`→`+0`, `"x"`→`NaN`); an object is `ToNumber(ToPrimitive(o, Number))`.
- **ToString:** `undefined`→`"undefined"`, `null`→`"null"`, booleans→`"true"`/
  `"false"`, numbers by the Number-to-String algorithm (`NaN`→`"NaN"`, `-0`→
  `"0"`, `Infinity`→`"Infinity"`, `1e21`→`"1e+21"`, `100000000000000000000`→
  `"100000000000000000000"`, `0.1+0.2`→`"0.30000000000000004"`); an object is
  `ToString(ToPrimitive(o, String))`.
- **ToPrimitive:** for a `Number` hint tries `valueOf` then `toString`; for a
  `String` hint tries `toString` then `valueOf`; the default hint is `Number`
  except for `Date` (not in scope). An array's `toString` is its `join(",")`;
  a plain object's is `"[object Object]"`.

### Expressions

- **Literals** evaluate to their value; `this` at the top level and in a
  function called plain is the global object (non-strict), so `this.x` reads a
  global; a method call `o.f()` has `this === o`.
- **Arithmetic** `+ - * / %` operate on numbers after ToNumber, except `+`:
  if either operand ToPrimitive is a string, `+` concatenates ToString of both,
  else it adds ToNumber of both (`1 + "a"`→`"1a"`, `[] + []`→`""`, `[1,2] +
  [3,4]`→`"1,23,4"`, `{} + ""`→`"[object Object]"`). `/` by zero is `Infinity`
  or `-Infinity`; `0/0` and any operation with a `NaN` operand is `NaN`; `%` is
  the IEEE remainder toward zero (`-5 % 3`→`-2`, `5 % -3`→`2`).
- **Bitwise** `& | ^ ~ << >> ` coerce with ToInt32 and `>>>` with ToUint32,
  operating on 32-bit integers (`~5`→`-6`, `1 << 31`→`-2147483648`,
  `-1 >>> 28`→`15`, `NaN | 0`→`0`, `3.9 & 3.9`→`3`).
- **Unary** `- +` are ToNumber then negate/identity; `!` is `!ToBoolean`;
  `typeof` as above (and `typeof undeclared` is `"undefined"`, never an error);
  `void` evaluates its operand and yields `undefined`; `delete o.p` removes an
  own property and yields `true`.
- **Comparison.** `===`/`!==` are the Strict Equality (same type and value;
  `NaN !== NaN`; `+0 === -0`; objects by identity). `==`/`!=` are the Abstract
  Equality with its coercions: `null == undefined` (and neither equals anything
  else, so `null == 0` is `false`); a number and a string compare as numbers; a
  boolean is converted to a number first; an object compared with a primitive
  is ToPrimitive'd (`[] == false`→`true`, `[0] == false`→`true`, `"" == 0`→
  `true`, `" " == 0`→`true`). `< > <= >=` are the Abstract Relational: both
  sides ToPrimitive with a Number hint, then compared as numbers unless both
  are strings, in which case by UTF-16 code unit (`"10" < "9"`→`true`,
  `"10" < 9`→`false`); any comparison with a `NaN` operand is `false`.
- **Logical** `&&`/`||` evaluate the left operand, ToBoolean it to decide, and
  return one of the *operands* (not a boolean), short-circuiting (`1 && 2`→`2`,
  `0 || "x"`→`"x"`, `null && null.x`→`null` without touching `null.x`). `?:`
  chooses a branch by ToBoolean of the test. The comma operator evaluates both
  and yields the right.
- **Member access** `o.p` and `o[e]` read a property, following the prototype
  chain; a missing property is `undefined`; reading a property of `null` or
  `undefined` is a `TypeError`. A computed key is ToString'd (numbers included).
- **Assignment** `=` and the compound forms (`+= -= *= /= %= <<= >>= >>>= &=
  |= ^=`) write to a variable, an object property, or an array index and yield
  the assigned value; a chain (`a = b = 5`) associates to the right. Each
  assignment resolves its target reference before evaluating the right-hand
  side, as ES5 does. Assigning to an undeclared name
  creates a global. `++`/`--`, prefix and postfix, read, coerce with ToNumber,
  write back, and yield the new or old number respectively.
- **Calls.** `f(a, b)` evaluates the callee and arguments and invokes; calling
  a non-callable is a `TypeError`. Inside, `arguments` is an array-like of the
  actual arguments with a `length`; extra arguments are ignored, missing
  parameters are `undefined`; a function's `length` is its declared parameter
  count. `f.call(thisArg, a, b)` and `f.apply(thisArg, argsArray)` invoke with
  an explicit `this`.
- **`new`.** `new C(a)` creates an object whose prototype is `C.prototype`,
  runs `C` with `this` bound to it, and yields that object — unless `C` returns
  an object, which replaces it (a returned primitive is ignored). `o instanceof
  C` walks `o`'s prototype chain for `C.prototype`. `"p" in o` tests for a
  property including inherited ones.

### Statements

- **Expression statements** evaluate for effect. A **block** runs its
  statements in order. **`var`** declares (hoisted to the top of the enclosing
  function or the global scope, initialised to `undefined`) and optionally
  assigns where written. The **empty statement** does nothing.
- **`if`/`else`**, **`while`**, **`do…while`**, and **`for(init; test; update)`**
  behave as in ES5; `for` parts may be empty. **`for (k in o)`** iterates the
  enumerable property names of `o` and its prototype chain, as strings, binding
  `k` each time; array indices enumerate as their string names. Iteration order
  is insertion order for string keys, which the suite relies on only where Node
  is deterministic.
- **`break`** and **`continue`**, bare or with a label, exit or restart the
  nearest matching loop (or, for a labelled `break`, any enclosing labelled
  statement). **Labels** wrap a statement; `continue label` targets a labelled
  loop.
- **`switch`** evaluates the discriminant and compares it with each `case` test
  using strict equality (`switch ("1")` does not match `case 1`), then runs
  from the first match through the end unless a `break` intervenes; `default`
  runs when no case matched, in its written position within the fall-through.
- **`return`** yields from the current function (bare `return` yields
  `undefined`). **`throw`** raises its value.
- **`try`/`catch`/`finally`.** The `try` block runs; if it throws, the `catch`
  binding takes the thrown value and the `catch` block runs; the `finally`
  block, if present, always runs — after normal completion, after a caught
  throw, and while an uncaught throw or a `return`/`break`/`continue` propagates
  through it. A `finally` that completes abruptly (its own `return`/`throw`)
  overrides the pending completion.
- **Function declarations** are hoisted whole (callable before their line in
  the source); **function expressions** are values, and a named function
  expression's name is bound only inside its own body.

### Functions, scope and `this`

Scope is lexical and function-level: a `var` or function declaration belongs to
the nearest enclosing function (or the global scope), and inner functions close
over the *variables*, not their values at capture time. A function called as
`f()` sees `this` as the global object; called as `o.f()`, `this` is `o`;
constructed with `new`, `this` is the fresh object; called through
`call`/`apply`, `this` is the given value. Re-declaring a `var` is a no-op on
the binding; assigning to a name that was never declared creates a global.

### Objects, arrays and the standard library

Objects are property bags with a prototype link; property access reads through
the chain, assignment creates or updates an own property. **Getters and
setters** in an object literal (`{ get x(){…}, set x(v){…} }`) run on read and
write. **Arrays** are objects with a magic `length`: assigning past the end
grows it, setting `length` smaller truncates, and the array methods below
behave as in ES5. Sparse arrays have holes that read as `undefined`.

The evaluator provides these standard globals, and no others beyond `print`:

- **`Object`** — as a constructor and with `Object.keys`, `Object.create`,
  `Object.getPrototypeOf`; `Object.prototype` with `hasOwnProperty`,
  `toString`, `valueOf`, `isPrototypeOf`, `propertyIsEnumerable`.
- **`Array`** — constructor (`new Array(n)` makes a length-`n` array,
  `new Array(a, b)` an array of those elements), `Array.isArray`, and on
  `Array.prototype`: `push pop shift unshift splice slice concat join reverse
  sort indexOf lastIndexOf forEach map filter reduce reduceRight every some`.
  `sort` with no comparator orders by ToString; with a comparator uses its
  sign. These methods are generic enough to be `call`ed on array-likes
  (`Array.prototype.slice.call(arguments)`).
- **`String`** — as a function (`String(x)` is ToString) and on
  `String.prototype`: `charAt charCodeAt indexOf lastIndexOf slice substring
  substr toUpperCase toLowerCase split concat replace` (with a string search,
  replacing the first occurrence), plus `length` and index access on strings;
  `String.fromCharCode`.
- **`Number`** — as a function (ToNumber) and on `Number.prototype`:
  `toString(radix)`, `toFixed`, `valueOf`.
- **`Boolean`** — as a function (ToBoolean).
- **`Math`** — `abs floor ceil round max min pow sqrt` and the constants `PI`,
  `E`. (No `random` — the suite is deterministic.)
- **`parseInt` / `parseFloat`** with ES5 semantics (`parseInt("0x1f")`→`31`,
  `parseInt("42px")`→`42`, `parseInt("z", 36)`→`35`, a radix argument, leading
  white space; `parseFloat("3.14abc")`→`3.14`), **`isNaN`**, **`isFinite`**.
- The error constructors **`Error TypeError RangeError ReferenceError
  SyntaxError EvalError URIError`**, each producing an object with `name` and
  `message`, an `instanceof` chain up to `Error`, and the right `name` when the
  runtime itself throws (a bad property access is a `TypeError`, an undeclared
  read a `ReferenceError`).

## Constraints

The package parses and interprets the source itself. It must not delegate
either half to the host: no `eval`, no `new Function`, no `node:vm`, no host
parser (the platform's own `SyntaxError` detection included) — the point of the
rung is to build an ES5 parser and evaluator, not to call the one the runtime
already has. Both a hand-written lexer/parser and a tree-walking evaluator are
expected.

Pure with respect to the outside world: no real I/O, no clock, no randomness,
no dependencies. The same source always produces the same `EvalResult`. `print`
is the only side channel and it only appends to `output`.

The result is a plain object `{ output: string[], error: string | null }`.
Each conformance case is graded on `error` alone: a case passes when
`run(program).error === null` — the assembled program ran to completion with no
exception escaping — and fails otherwise, because the program throws (a
`Test262Error`, a real `TypeError`, and so on) to signal a wrong result. The
exact error string on a failing case is not checked, only that it is not
`null`; correctness is "did nothing throw". Source that is not valid ES5 still
yields `{ output: [], error: "SyntaxError" }`, and `run` never throws for any
string.

Evaluation must terminate for the suite's programs (deep recursion such as
`fib(20)` and loops summing to 100 run well within a second); the suite
contains nothing adversarial in size, and no program depends on stack-overflow
behaviour.

## Non-goals

The parser accepts ES5 and only ES5; ECMAScript 2015+ syntax is a
`SyntaxError`, not something to support. No ECMAScript 2015 or later semantics. No
strict mode (octal literals, `with`, duplicate parameters and the rest are
accepted; `this` in a plain call is the global object). No `RegExp` engine, no
`Date`, no `JSON`, no `console`, no timers, no module system. No completion
values in the result, and no dependence on `Function.prototype.toString`
output. No property attributes beyond what getters/setters and `hasOwnProperty`
/`Object.keys` observe; no `Object.defineProperty`, no `Object.freeze`, no
sealed or non-enumerable user properties. No `eval` or `new Function` in the evaluated program. No `with` statement,
`debugger` statement, or regular-expression literal appears in the suite; their
evaluation is unspecified (the input contract permits the nodes, but nothing
requires you to run them). Numeric formatting follows Node's (ES5
Number-to-String), which the suite treats as authoritative.

## Examples

```ts
import { run } from "es5-language";

run("print(1 + 2)");
// { output: ["3"], error: null }

// A conformance case is an assertion program: it defines a small library and a
// body, and completes silently when the language is right.
run("function Test262Error(m){ this.message = m } " +
    "if ((1 + 2) !== 3) { throw new Test262Error('bad') } print('ok')");
// { output: ["ok"], error: null }   // passes: nothing threw

run("function Test262Error(m){ this.message = m } " +
    "Test262Error.prototype.toString = function(){ return 'Test262Error: ' + this.message } " +
    "if ((0.1 + 0.2) === 0.3) { throw new Test262Error('should differ') }");
// { output: [], error: "Test262Error: should differ" }   // fails: an assertion threw

run("var c = (function(){ var n = 0; return function(){ return ++n } })(); print(c(), c())");  // fine to build with print too
// { output: ["1 2"], error: null }

run("try { null.x } catch (e) { print(e.name) }");
// { output: ["TypeError"], error: null }

run("print('a'); throw new Error('boom')");
// { output: ["a"], error: "Error" }

run("let x = 1");                 // ES2015 syntax is not ES5
// { output: [], error: "SyntaxError" }

run("print(");                    // malformed source
// { output: [], error: "SyntaxError" }
```
