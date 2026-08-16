# es5-parser

## Purpose

A parser for ECMAScript 5 source text — the *script* goal, non-strict — that
returns an ESTree abstract syntax tree, or throws a `SyntaxError` for input
that is not a valid ES5 script. Source in, tree out; nothing is evaluated.

The reference is acorn (8.18, `ecmaVersion: 5`). Every expected tree in the
acceptance suite is acorn's own output with the `start` and `end` positions
removed, and every "throws" case is a program acorn rejects; where this
document and acorn disagree, acorn is right and the suite says what acorn
said. This document exists so the behaviour can be implemented deliberately
rather than discovered a case at a time. Where it says a matter is
*unspecified*, the suite does not exercise it.

The tree is exactly what acorn emits at this version — including a few fields
that are not in the ES5 chapter of the ESTree specification but that every
ESTree producer emits in practice: `sourceType: "script"` on the Program,
`raw` on every Literal, `regex` on regular-expression literals, `directive` on
prologue statements, and `expression: false` on every function.

## Public API

One function, exactly as `contract.d.ts` declares it:

- `parse(source)` — parses `source` as an ES5 script and returns a `Program`.
  Throws a `SyntaxError` (or a subclass of it) if the source is not a valid
  ES5 script. What the error's message says and where it points are not
  specified; only that it is thrown, and that it is a `SyntaxError`.

`contract.d.ts` also declares every node type. Nodes are plain objects. A node
carries the fields the contract lists for its type and no others: no
positions, no `loc`, no `range`, no `parent`, no comments. Fields whose value
is "nothing" are `null`, never omitted or `undefined`, with one exception:
`directive` is present only on directive statements.

## Behavior

### Source text and white space

Source is a JavaScript string; characters are UTF-16 code units. **White
space** — TAB (U+0009), VT (U+000B), FF (U+000C), SP, NBSP (U+00A0), the byte
order mark (U+FEFF, anywhere, not only at the start) and every character in
Unicode category Zs (such as U+2000–U+200A, U+202F, U+205F, U+3000, U+1680) —
separates tokens and is otherwise ignored. **Line terminators** are LF
(U+000A), CR (U+000D), LS (U+2028) and PS (U+2029); CR LF is one line
terminator. Line terminators separate tokens, matter to automatic semicolon
insertion, may not appear inside string or regular-expression literals, and
are the only place a token boundary is "on a new line". Any other character
outside a literal or comment — a zero-width space (U+200B), a Mongolian vowel
separator (U+180E), `@`, `#`, a stray backslash — is a `SyntaxError`.

**Comments.** `//` runs to the end of the line and does not include the line
terminator. `/* … */` may span lines; a multi-line comment that contains a
line terminator counts as a line terminator for the purposes of automatic
semicolon insertion and restricted productions (`a /*\n*/ ++b` is two
statements; `a /* */ ++b` is an error). An unterminated `/*` is a
`SyntaxError`. Comments produce nothing in the tree. HTML-like comments
(`<!--`, and `-->` at the start of a line) are unspecified.

### Tokens

**Identifiers and keywords.** An identifier starts with a Unicode letter
(categories Lu, Ll, Lt, Lm, Lo, Nl — `π`, `ǅ`, `ʰ`, `日`, `Ⅳ`), `$` or `_`, and
continues with those or combining marks (Mn, Mc), decimal digits of any script
(Nd — `٣`), connector punctuation (Pc — `‿`), ZWNJ (U+200C) or ZWJ (U+200D).
The precise sets are Unicode's ID_Start and ID_Continue (what `\p{ID_Start}` and
`\p{ID_Continue}` match in a `u`-flag regular expression), restricted to the
Basic Multilingual Plane: a surrogate pair — an astral character such as `𝑥`
(U+1D465) — is never an identifier character in ES5, so `𝑥` and `a𝑥` are
errors. `\uXXXX` may spell any character of an identifier and is decoded in the
tree (`\u0061bc` is the identifier `abc`), but the escaped character must
itself be legal in that position: `\u0020` and `\u0031a` are errors, and
`\u{…}` is not ES5. Whether an escape may spell a reserved word — as an
identifier, or where a keyword is meant — is unspecified; as a property name
after `.` or in an object literal it may (`a.\u0069f` is `a.if`).

The **reserved words** may not be identifiers: the keywords `break case catch
continue debugger default delete do else finally for function if in
instanceof new return switch this throw try typeof var void while with`, the
literals `null true false`, and the future reserved words `class const enum
export extends import super`. Every one of them *is* allowed as a property
name after `.` and as a key in an object literal (`a.class`, `{if: 1}`), and
`this`, `null`, `true`, `false` are of course expressions. Words reserved only
in strict mode — `implements interface let package private protected public
static yield` — and every later addition to the language — `async await of
get set` — are ordinary identifiers here: `var let = 1`, `let[0] = 1`,
`for (of in y)` and `yield\nx` (two statements) all parse. `arguments`, `eval`,
`undefined`, `NaN` and `Infinity` are ordinary identifiers.

**Punctuators** are the usual ES5 set, matched longest first: `{ } ( ) [ ] .
; , < > <= >= == != === !== + - * % ++ -- << >> >>> & | ^ ! ~ && || ? : = +=
-= *= %= <<= >>= >>>= &= |= ^= / /=`. `a-->b` is `(a--) > b`; `a+++b` is
`(a++) + b`; `a---b` is `(a--) - b`. Anything ES5 does not have — `=>`, `**`,
`??`, `?.`, `...`, `` ` `` — is an error.

**Numeric literals.** Decimal: digits with an optional fraction and exponent
(`1`, `1.5`, `.5`, `5.`, `1e3`, `1E+3`, `1.e3`, `.5e1`); hexadecimal `0x`/`0X`
followed by hex digits; and legacy octal — a `0` followed only by digits 0–7
(`010` is 8, `0777` is 511, `00` is 0). A `0` followed by digits that include
an 8 or 9 is decimal (`08` is 8, `09.5` is 9.5, `0128` is 128). A legacy octal
literal has no fraction or exponent, so `01.5` is an error. The `value` is the
number the literal denotes (`1e400` is `Infinity`, `5e-324` is the smallest
denormal, `9007199254740993` rounds as JavaScript rounds it,
`0x10000000000000000` is 2⁶⁴), and `raw` is the source text. The character
after a numeric literal may not be an identifier start or a digit: `3in x`,
`1a`, `0x1g`, `1_000`, `0b1`, `0o7` and `1.toString()` are errors, while
`1..toString()`, `1 .toString()`, `1.5.toFixed` and `0x10.a` are member
accesses. `0x` alone, `1e`, `1e+`, `1.2.3` are errors. Numbers are never
negative: `-1` is a `UnaryExpression`.

**String literals.** Delimited by `"` or `'`; a raw line terminator inside is
an error. Escapes: `\n \r \t \b \f \v` and `\0`; `\xHH`; `\uHHHH`; a
backslash before a line terminator is a *line continuation* that contributes
nothing (`"a\<LF>b"` is `ab`; CR LF counts as one line terminator); the
legacy octal escapes `\1`–`\377` (`"\101"` is `A`) — at most three octal
digits, and only two when the first is 4–7, so `"\400"` is a space followed by
`0` and `"\1234"` is `S4`; and a backslash before any other character is that
character (`\a` is `a`, `\'`, `\"`, `\\`, `\/`). `\x` and `\u` with too few
hex digits (`"\x4"`, `"\u12"`) and `\u{…}` are errors. `\8`, `\9`, `\08` and
`\09` are unspecified. `value` is the decoded string and `raw` is the source
text including the quotes.

**Regular expression literals.** `/` *body* `/` *flags*. The body runs to the
next `/` that is not preceded by a backslash and not inside a `[…]` class
(`/[/]/` and `/a\/b/` are single literals; `/[//]/` has the body `[//]`, and
`/[\]/]/` the body `[\]/]` — a backslash escapes the next character inside a
class too, without leaving it); a line terminator inside the body is an error
even after a backslash, and so is an unterminated literal. The body is *not*
validated: whether `/(/` is an error is unspecified, and the suite contains
only well-formed bodies. The flags are the identifier characters that
immediately follow, taken literally — an escape is not decoded, so `/a/\u0067`
is an error — and must be a subset of `g`, `i`, `m` with no character
repeated: `/a/x`, `/a/gg`, `/a/s`, `/a/u`, `/a/y` are errors. The literal is
a `Literal` whose `regex` is `{pattern, flags}`, whose `raw` is the source
text, and whose `value` is `new RegExp(pattern, flags)` — or `null` if the
host refuses to construct it. `//` never starts a regular expression; it is a
comment.

**Slash: division or regular expression.** The lexer cannot decide on its own.
Where the grammar expects an *operand* — at the start of a statement or
expression, after an operator, after `(`, `[`, `{`, `,`, `;`, `:`, `?`,
after `return`, `throw`, `case`, `typeof`, `void`, `delete`, `new`, `in`,
`instanceof`, and after the `)` that closes the head of `if`, `while`, `for`
or `with` — a `/` begins a regular expression. Where it expects an *operator*
— after an identifier, a literal, `this`, a `)` that closed a parenthesized
expression or a call, a `]`, a `}` that closed an object literal or a function
*expression*, and after a postfix `++`/`--` — it is division or `/=`. This is
a property of the parse, not of the previous token: `{} /a/` is an empty block
followed by a regular expression, but `x = {} / a` is a division; `if (a)
/b/.test(c)` tests a regular expression, but `(a) / b` divides; `a\n/b/g` is
`a / b / g`; `x = function() {} / 2` divides. Implement the decision from the
parser's state, not from a table of previous tokens, and the corners come out
right.

### Automatic semicolon insertion

A `;` is required after expression statements, `var`, `do … while (…)`,
`continue`, `break`, `return`, `throw` and `debugger`, and is supplied
automatically only under ES5's three rules:

1. When the next token is not allowed by the grammar and is either separated
   from the previous token by at least one line terminator or is `}`, a `;`
   is inserted before it (`a\nb` is two statements; `{ a }` is fine).
2. At the end of the input.
3. After a *restricted production*: `return`, `break`, `continue` and `throw`
   followed by a line terminator, and an operand followed by a line
   terminator before a postfix `++`/`--`. `return\na` is `return; a`, and
   `a\n++b` is `a; ++b`. `throw\na` is an error, because `throw ;` is not a
   statement.

Insertion never happens when the next token *can* continue the statement:
`a\n(b)` is a call, `a\n[b]` a member access, `a\n+ b` an addition, `a\n/b/g`
a double division, `var a\n, b` two declarators, `f\n(a)` a call, and `new a\n(1)`
passes an argument. It never produces an empty statement (`if (a)\nelse b` is
an error) and never happens inside a `for` header (`for (a\nb\nc) ;` is an
error). It does happen after `do … while (…)` when the next token is on a new
line or is `}` (`do {} while (0)\nx`), but not on the same line
(`do {} while (0) x` is an error, as it was in ES5). A `}` closes what it
closes: `{ a\nb }` is a block of two statements.

### Expressions

Grouping parentheses leave no trace in the tree: `(a)` is the `Identifier`
`a`, `((a + b))` is the `BinaryExpression`. `(a, b)` is a
`SequenceExpression`, and `a, b, c` is one `SequenceExpression` with three
expressions; a parenthesized sequence inside a sequence stays its own node.

**Primary.** `this` → `ThisExpression`. An identifier → `Identifier` with its
decoded `name`. Literals as above; `null`, `true`, `false` → `Literal` with
`raw` `"null"`, `"true"`, `"false"`.

**Array literals** → `ArrayExpression`. Elisions are `null` elements: `[,]`
has one, `[,,]` two, `[1,,2]` three with a `null` in the middle. A single
trailing comma adds nothing: `[1,]` has one element, `[1,,]` has two. Elements
are assignment expressions, so `[a = 1]` and `[(a, b)]` are single elements.

**Object literals** → `ObjectExpression` with `Property` nodes in source
order. A key is an `Identifier` (any IdentifierName, reserved words included:
`{if: 1}`), or a `Literal` for a string or number key (`{"a": 1}`, `{1: a}`,
`{1.5: a}`, `{0x10: a}` — with `raw` as written and `value` as decoded). Every
property has `kind: "init"` except accessors: `get name() { … }` is a
`Property` with `kind: "get"` whose value is a `FunctionExpression` with
`id: null` and no parameters; `set name(v) { … }` has `kind: "set"` and
exactly one parameter. A getter with parameters or a setter without exactly
one is an error. `get` and `set` are ordinary keys when followed by `:`, `,` or
`}` (`{get: 1}`), and a line terminator between `get` and the name is
allowed. A trailing comma is allowed (`{a: 1,}`). Duplicate data properties
are allowed (`{a: 1, a: 2}`, `{__proto__: 1, __proto__: 2}`), but a name may
not have both a data property and an accessor, nor two getters, nor two
setters: `{get a() {}, a: 1}`, `{a: 1, get a() {}}` and `{get a() {}, get a()
{}}` are errors, while `{get a() {}, set a(v) {}}` is fine. Names are compared
as strings, whatever the key's spelling: `1`, `1.0`, `0x1` and `"1"` are the
same name (`{"1": 1, get 1() {}}` is an error) and `1` and `1.5` are not.
Values are
assignment expressions: `{a: b = c}` and `{a: (b, c)}` are single properties.
Shorthand, computed keys, methods, and spread are not ES5.

**Function expressions** → `FunctionExpression` with `id` (an `Identifier`,
or `null` when anonymous), `params` (a list of `Identifier`; duplicates are
allowed), `body` (a `BlockStatement`) and `expression: false`. Parameters may
be any non-reserved names, including `let` and `yield`. Defaults, rest,
destructuring, arrows, generators and `async` are not ES5.

**Member, call and `new`.** `a.b` → `MemberExpression` with `computed: false`
and `property` an `Identifier` (again any IdentifierName: `a.if`); `a[b]` →
`computed: true` with `property` any expression (`a[b, c]` has a
`SequenceExpression`). `f(a, b)` → `CallExpression` with `arguments` a list of
assignment expressions; `f((a, b))` passes one sequence. `new` binds tighter
than a call and takes an optional argument list: `new A` and `new A()` are
both `NewExpression` with `arguments: []`; `new a.b.c(1)(2)` is a
`CallExpression` whose callee is `NewExpression(a.b.c, [1])`; `new a()()` is
a call of a `new`; `new new a` is `NewExpression(NewExpression(a))`; `new
(a())` calls first; `new a\n(1)` passes an argument (no insertion). Member
accesses chain left to right: `a.b().c[d]()` is a call of a computed member of
a member of a call. Trailing commas in argument lists (`f(a,)`) are errors.

**Unary and update.** `+ - ! ~ typeof void delete` → `UnaryExpression` with
`prefix: true`; they nest right to left (`!-+~a`, `typeof typeof a`). `++`
and `--` → `UpdateExpression` with `prefix` `true` or `false`; the operand
must be an `Identifier` or a `MemberExpression`, optionally parenthesized —
`(a)++`, `(a.b)++`, `++a[0]` are fine, `1++`, `++1`, `a()++`, `(a + b)++`,
`a++++` and `++a++` are errors. Prefix operators apply to postfix ones:
`-a++` is `-(a++)`, `typeof a++` is `typeof (a++)`.

**Binary and logical**, from loosest to tightest, all left-associative:

| level | operators | node |
|---|---|---|
| 1 | `\|\|` | `LogicalExpression` |
| 2 | `&&` | `LogicalExpression` |
| 3 | `\|` | `BinaryExpression` |
| 4 | `^` | `BinaryExpression` |
| 5 | `&` | `BinaryExpression` |
| 6 | `== != === !==` | `BinaryExpression` |
| 7 | `< > <= >= instanceof in` | `BinaryExpression` |
| 8 | `<< >> >>>` | `BinaryExpression` |
| 9 | `+ -` | `BinaryExpression` |
| 10 | `* / %` | `BinaryExpression` |

So `a || b && c` is `a || (b && c)`, `a | b ^ c & d` is `a | (b ^ (c & d))`,
`a & b == c` is `a & (b == c)`, `a < b instanceof c in d` is
`((a < b) instanceof c) in d`, `a - b - c` is `(a - b) - c`. Unary operators
bind tighter than all of these (`-a * b` is `(-a) * b`, `typeof a == "x"`
compares a `typeof`).

**Conditional** `a ? b : c` → `ConditionalExpression`; the two branches are
assignment expressions (`a ? b = 1 : c = 2` assigns in both), and it
associates right: `a ? b : c ? d : e` nests in the alternate. Its test may be
any logical expression: `a || b ? c : d` is `(a || b) ? c : d`.

**Assignment** `= += -= *= /= %= <<= >>= >>>= &= ^= |=` →
`AssignmentExpression`, right-associative (`a = b = c` is `a = (b = c)`,
`a += b -= c` is `a += (b -= c)`). The left side must be an `Identifier` or a
`MemberExpression`, optionally parenthesized — `(a) = b` and `(a.b) = c` are
fine — and anything else is an error: `1 = 2`, `a + b = c`, `f() = 1`, `new a
= 1`, `-a = 1`, `(a, b) = 1`, `(a ? b : c) = 1`, `this = 1`, `null = 1`,
`a = b = 1 = 2`. `x = a ? b : c = d` is `x = (a ? b : (c = d))`.

**Comma** → `SequenceExpression`, loosest of all: `a = 1, b = 2` is a
sequence of two assignments.

**`in` inside a `for` head.** In the initializer of a `for (…;…;…)` — both
the expression form and the `var` form — the `in` operator is not allowed at
the top level, because it would read as a `for-in`; inside parentheses,
brackets, braces, a nested function, or the *consequent* of a conditional
(between `?` and `:`) it is fine: `for (var i = (a in b);;)`, `for (var i = [a
in b];;)`, `for (var i = f(a in b);;)`, `for (var f = function() { return a in
b };;)` and `for (var i = a ? b in c : d;;)` all parse, while `for (var i = a
? b : c in d;;)` does not. The restriction covers only the initializer: `for
(; a in b; c in d)` is fine, and everywhere else `in` is an ordinary operator
(`var a = b in c`, `if (a in b) c`).

### Statements

The `Program` is a list of statements (`body`), possibly empty. Function
declarations are statements here and may appear wherever a statement may —
in blocks, as the body of `if`, `while` or a label (`if (a) function f() {}`,
`{ function f() {} }`, `a: function f() {}`) — as acorn allows in non-strict
code.

- **Expression statement** → `ExpressionStatement`. A statement cannot start
  with `{` or with `function`: `{ a: 1 }` is a block containing a labelled
  statement, `{ a: 1, b: 2 }` is an error, `({a: 1})` is an object, and
  `function() {}` at statement level is an error (a declaration needs a
  name) while `(function() {})()` and `!function() {}()` are expressions.
  `function f() {}(1)` is a declaration followed by the expression statement
  `(1)`.
- **Directives.** In the *directive prologue* of a Program or function body —
  the leading run of expression statements that are unparenthesized string
  literals — each such statement carries `directive`: the literal's raw
  characters between the quotes (`"use strict"` → `"use strict"`, `"\101"` →
  `"\\101"`). `("a")`, `"a" + b`, and a string after any other statement are
  not directives. `"use strict"` is recorded like any other directive and
  **changes nothing** — this parser does not implement strict mode, and the
  suite never depends on strictness.
- **Block** `{ … }` → `BlockStatement`. **Empty** `;` → `EmptyStatement`.
  **`debugger`** → `DebuggerStatement`.
- **`var`** → `VariableDeclaration` with `kind: "var"` and one
  `VariableDeclarator` per name, `init` `null` when absent (`var a, b = 2`).
  Initializers are assignment expressions (`var a = b = c`, `var a = (1,
  2)`). `let`/`const` are not ES5: `let x = 1` is two identifiers and an
  error, but `let\nx = 1` is the identifier `let` then an assignment.
- **`if`** → `IfStatement` with `alternate` `null` when there is no `else`.
  `else` binds to the nearest `if`. `if (a) b else c` without a `;` or line
  break before `else` is an error; `if (a) b\nelse c` and `if (a) b; else c`
  are fine.
- **`while`**, **`do … while`** → `WhileStatement`, `DoWhileStatement`.
- **`for (init; test; update)`** → `ForStatement`; each of `init`, `test`,
  `update` is `null` when empty; `init` is a `VariableDeclaration` (any
  number of declarators) or an expression. **`for (left in right)`** →
  `ForInStatement`; `left` is a `VariableDeclaration` with exactly one
  declarator and no initializer, or an `Identifier` or `MemberExpression`
  (parenthesized allowed); `for (var a, b in c)`, `for (var a = 1 in b)`,
  `for (a() in b)`, `for (a, b in c)`, `for (a = 1 in b)` and `for (1 in a)`
  are errors. `right` is any expression including `in` (`for (var a in b in
  c)`). `for (x of y)` is not ES5.
- **`continue`**, **`break`** → `ContinueStatement`, `BreakStatement` with
  `label` an `Identifier` or `null`. `break` without a label must be inside a
  loop or a `switch`; `continue` without a label inside a loop; `continue
  label` must name a label of an enclosing *iteration statement* (a label
  that wraps another label that wraps a loop counts: `a: b: while (1) {
  continue a }`); `break label` may name any enclosing labelled statement (`a:
  { break a }`, `a: if (b) break a`). Labels are scoped to their function:
  `a: while (1) { function f() { break a } }` is an error. Everything else is
  an error: `break` at top level, `while (1) { break a }` with no such label,
  `switch (a) { case 1: continue }` outside a loop, `a: { continue a }`.
- **`return`** → `ReturnStatement` with `argument` `null` when absent; only
  inside a function body, anywhere in it (`function f() { while (a) return
  }`). At the top level it is an error.
- **`with`** → `WithStatement`. **`throw`** → `ThrowStatement`; the argument
  is required and must start on the same line.
- **`switch`** → `SwitchStatement` with `cases` in source order; each
  `SwitchCase` has `test` (`null` for `default`) and `consequent`, a list of
  statements that may be empty (`case 1: case 2: b` is two cases). At most
  one `default`, in any position; a second is an error. `case` tests are
  expressions (`case c, d:` is a sequence).
- **Labels** → `LabeledStatement` with `label` and `body`; labels nest (`a: b:
  c` is a label wrapping a label). Redeclaring a label inside its own body is
  an error (`a: a: b`, `a: { a: b }`); reusing a label after the first has
  closed is fine (`a: 1; a: 2`). Any non-reserved identifier is a label,
  `let: 1` and `yield: 1` included.
- **`try`** → `TryStatement` with `block`, `handler` (a `CatchClause` with an
  `Identifier` param and a `BlockStatement` body, or `null`) and `finalizer`
  (a `BlockStatement` or `null`); at least one of `handler` and `finalizer`
  is present, so `try {}` alone is an error, as are `catch {}` without a
  parameter and `catch (e.x)`.
- **Function declaration** → `FunctionDeclaration` with `id` an
  `Identifier`, `params`, `body`, `expression: false`.

### Errors

`parse` throws a `SyntaxError` for anything this document calls an error, and
for every construct not in the ES5 grammar — including everything ECMAScript
added later (`let`, `const`, classes, arrows, template literals, generators,
`async`, destructuring, spread and rest, default parameters, `for-of`, `**`,
`??`, `?.`, logical assignment, binary and octal literals, numeric
separators, BigInt, `import`/`export`, `new.target`, trailing commas in
argument and parameter lists, optional `catch` bindings, `\u{…}`). Being
valid in a later edition of the language does not make something valid here.

The parser reports the first problem it meets; there is no recovery and no
partial tree. Once a `SyntaxError` has been thrown for a source, `parse` must
throw for that source every time; it must never return a tree for one call
and throw for the next.

### Departures from ES5, following acorn

A few verdicts above are acorn's rather than the letter of ES5, and every one
of them is what real engines and parsers do; they are collected here so nobody
implements the letter and is surprised:

- `for (var a = 1 in b)` is an error. ES5's grammar allowed the initializer;
  acorn (below ecmaVersion 8) and every later edition of the language reject
  it.
- `08`, `09.5`, `0128` are decimal numbers. ES5's grammar had no such literals;
  every engine accepts them (they became Annex B in ES2015).
- `f() = 1`, `a()++`, `for (a() in b)` are errors. ES5 made a call expression on
  the left of an assignment a run-time `ReferenceError`; acorn (like esprima
  and babel) rejects it at parse time.
- A function declaration may appear wherever a statement may (`if (a)
  function f() {}`). ES5 allowed declarations only at the top level and in
  function bodies; every engine and acorn accept them in statement position.
- U+180E (Mongolian vowel separator) is not white space. It was category Zs
  when ES5 was written and no longer is; acorn rejects it.
- Reserved words spelled with escapes: unspecified, see *Identifiers*.

## Constraints

Pure: no I/O, no dependencies, no global state between calls; the same source
always yields a structurally identical tree. `parse` never mutates its input
and never evaluates any of it.

The tree is made of plain objects and arrays with exactly the fields the
contract lists (in any order); numbers are numbers, strings are strings, and
the only non-plain value anywhere is the `RegExp` in a regular-expression
literal's `value`.

Comparison in the suite is deep structural equality against acorn's tree.
Extra fields with defined values fail; missing fields fail; `undefined` where
`null` is expected fails. When a tree differs, the failure message names the
path of the first difference and the two values there.

Performance: linear in the length of the input for ordinary programs. The
suite parses about two thousand small sources and two dozen programs of a few
hundred characters; the whole of it should run in well under a second of
parser time. No test source is adversarial in size.

## Non-goals

No ECMAScript 2015 or later syntax; no module goal (`sourceType` is always
`"script"`). No strict-mode restrictions — octal literals, `with`, `eval =`,
duplicate parameters, strict-only reserved words are all accepted regardless
of any `"use strict"`. No positions, `loc` or `range`; no comment or token
collection; no error messages or error locations that anyone should rely on;
no error recovery. No validation of regular-expression *bodies* (flags are
validated). No HTML-like comments. No evaluation, no scope analysis, no early
errors beyond the syntactic ones listed above (assignment targets, labels,
`break`/`continue`/`return` placement, object-literal accessor rules,
regular-expression flags, duplicate `default`).

## Examples

```ts
import { parse } from "es5-parser";

parse("a + 1");
// { type: "Program", sourceType: "script", body: [
//   { type: "ExpressionStatement", expression: {
//     type: "BinaryExpression", operator: "+",
//     left: { type: "Identifier", name: "a" },
//     right: { type: "Literal", value: 1, raw: "1" } } } ] }

parse("var re = /a\\/b/gi;").body[0].declarations[0].init;
// { type: "Literal", value: /a\/b/gi, raw: "/a\\/b/gi", regex: { pattern: "a\\/b", flags: "gi" } }

parse("'use strict'; f()").body[0];
// { type: "ExpressionStatement", expression: { type: "Literal", value: "use strict", raw: "'use strict'" }, directive: "use strict" }

parse("a\n++b").body.length;              // 2 — a; ++b
parse("a\n(b)").body.length;              // 1 — a(b)
parse("{} /x/").body[1].expression.regex; // { pattern: "x", flags: "" }
parse("x = {} / 2").body[0].expression.right.operator; // "/"

parse("if (a) b else c");   // throws SyntaxError
parse("let x = 1");         // throws SyntaxError — `let` is an identifier in ES5
parse("({get a(x) {}})");   // throws SyntaxError — a getter takes no parameters
```
