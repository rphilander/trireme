# es5-evaluator

## Purpose

An evaluator for ECMAScript 5 — the *script* goal, non-strict — that takes a
program as an ESTree abstract syntax tree and runs it, reporting what the
program observably did: the lines it `print`ed and the name of any exception
that escaped to the top. Tree in, observable behaviour out; nothing is parsed.

The reference is Node's own evaluator: every expected result in the acceptance
suite is what the program produces when Node runs the same source in a fresh
`vm` context with the same `print`. Where this document and Node disagree, Node
is right and the suite says what Node did. This document exists so the
behaviour can be implemented deliberately rather than discovered a case at a
time. Where it says a matter is *unspecified*, the suite does not exercise it.

The input tree is exactly the shape acorn produces at `ecmaVersion: 5` with
positions removed — the same `Program` the es5-parser rung emits. Every node
type is declared in `contract.d.ts`; the evaluator is built against that shape,
not against source text.

## Public API

One function, exactly as `contract.d.ts` declares it:

- `evaluate(program)` — runs `program` (an ESTree `Program`) as an ES5 script
  and returns an `EvalResult`: `output`, one string per `print(...)` call in
  order, and `error`, `null` on normal completion or the escaping exception's
  name otherwise. **`evaluate` never throws for a program it can run** — a
  script-level exception is reported through `error`, not propagated. (It may
  throw for an input that is not a well-formed ES5 tree; the suite passes only
  well-formed trees.)

### The observable model

The evaluator's world is exactly two things: what the program prints, and
whether an exception reached the top.

- **`print`** is a host function, the one binding beyond the standard globals
  below. `print(a, b, c)` converts each argument to a string with the
  language's ToString and appends `ToString(a) + " " + ToString(b) + " " +
  ToString(c)` — the arguments joined by a single space — as one entry of
  `output`. `print()` appends `""`. It returns `undefined`.
- **`error`** is `null` unless an exception propagates out of the whole
  program. Then it is: the thrown value's `name` property converted with
  ToString, when the thrown value is an object with such a property (so a
  thrown `Error` gives `"Error"`, a `TypeError` gives `"TypeError"`); otherwise
  the thrown value itself converted with ToString (so `throw "boom"` gives
  `"boom"`, `throw 42` gives `"42"`). Whatever was printed before the throw
  stays in `output`.

Completion values are never observed, and neither is how a function or a
non-standard object stringifies beyond what the cases below print. To assert
something, a program prints it.

## Behavior

The evaluator implements ES5 semantics for the tree it is given. What follows
is organised by what a program can contain; throughout, "ToNumber",
"ToString", "ToBoolean", "ToPrimitive", "ToInt32", "ToUint32" and
"ToObject" are ES5's abstract operations, and the suite pins them through
their observable effects.

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
  |= ^=`) evaluate right-to-left, write to a variable, an object property, or an
  array index, and yield the assigned value. Assigning to an undeclared name
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

Pure with respect to the outside world: no real I/O, no clock, no randomness,
no dependencies. The same tree always produces the same `EvalResult`. `print`
is the only side channel and it only appends to `output`.

The result is a plain object `{ output: string[], error: string | null }`
compared by deep equality against Node's. A wrong printed line, a missing or
extra line, or the wrong error name fails.

Evaluation must terminate for the suite's programs (deep recursion such as
`fib(20)` and loops summing to 100 run well within a second); the suite
contains nothing adversarial in size, and no program depends on stack-overflow
behaviour.

## Non-goals

No parsing — the input is a tree. No ECMAScript 2015 or later semantics. No
strict mode (octal literals, `with`, duplicate parameters and the rest are
accepted; `this` in a plain call is the global object). No `RegExp` engine, no
`Date`, no `JSON`, no `console`, no timers, no module system. No completion
values in the result, and no dependence on `Function.prototype.toString`
output. No property attributes beyond what getters/setters and `hasOwnProperty`
/`Object.keys` observe; no `Object.defineProperty`, no `Object.freeze`, no
sealed or non-enumerable user properties. No `eval` or `new Function`. Numeric
formatting follows Node's (ES5 Number-to-String), which the suite treats as
authoritative.

## Examples

```ts
import { evaluate } from "es5-evaluator";
// `program` is an ESTree tree, e.g. from es5-parser or acorn at ecmaVersion 5.

evaluate(parse("print(1 + 2)"));
// { output: ["3"], error: null }

evaluate(parse("print('a' + 1, 1 + 2 + 'a')"));
// { output: ["a1 3a"], error: null }

evaluate(parse("var c = (function(){ var n = 0; return function(){ return ++n } })(); print(c(), c())"));
// { output: ["1 2"], error: null }

evaluate(parse("try { null.x } catch (e) { print(e.name) }"));
// { output: ["TypeError"], error: null }

evaluate(parse("print('a'); throw new Error('boom')"));
// { output: ["a"], error: "Error" }

evaluate(parse("function fib(n){ return n < 2 ? n : fib(n-1) + fib(n-2) } print(fib(10))"));
// { output: ["55"], error: null }
```
