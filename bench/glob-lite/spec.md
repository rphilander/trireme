# glob-lite

## Purpose

Bash's pattern matching and brace expansion, as a pure library: a string and a
pattern go in, a verdict or a list of words comes out. No filesystem, no
paths, no shell — only the two algorithms, with the semantics of bash 5.2 with
`extglob` enabled, in the C locale.

The reference is bash itself. Every expected value in the acceptance suite was
produced by running `[[ "$input" == $pattern ]]` or `printf '%s\n' {…}` in
bash; where this document and bash disagree, bash is right and the suite says
what bash said. This document exists to describe the shape of that behaviour so
it can be implemented deliberately rather than discovered case by case.

## Public API

Three functions and one options type, exactly as `contract.d.ts` declares them.

- `match(input, pattern, options?)` — whether `input` matches `pattern` in its
  entirety. Never throws; there is no such thing as an invalid pattern, only
  characters that end up literal.
- `expandBraces(pattern)` — the list of words `pattern` expands to, in bash's
  order, duplicates included. `[pattern]` when nothing expands.
- `matchAny(input, pattern, options?)` — `expandBraces` first, then `match`
  against each result; true if any matches. `options` reach every `match`.

`MatchOptions.nocase` makes `match` compare letters case-insensitively.

## Behavior

### Matching

A pattern is matched against the whole input, not searched for within it. The
empty pattern matches only the empty input.

**Wildcards.** `*` matches any run of characters, including none. `?` matches
exactly one character. Neither is aware of paths or dotfiles: `/` and a leading
`.` are ordinary characters, so `*` matches `a/b` and `.hidden` alike. A run of
many `*` must not cause catastrophic backtracking; the suite includes a
forty-character input against a pattern with eleven stars, and it must return
promptly.

**Bracket expressions.** `[…]` matches one character from a set. Inside: a
plain character names itself; `a-c` is an inclusive range by character code
(`[b-a]` is empty and matches nothing); `[:alpha:]`, `[:digit:]`, `[:alnum:]`,
`[:upper:]`, `[:lower:]`, `[:space:]`, `[:blank:]`, `[:punct:]`, `[:xdigit:]`
are POSIX classes; a leading `!` or `^` negates the whole set; a `]` first
(after any negation) is literal; a `-` first or last is literal; a backslash
escapes the next character; `*` and `?` are literal. A `[` that never closes is
an ordinary character, so `[a` matches only the two-character string `[a`.

**Extended patterns.** With a list of alternatives separated by `|`:
`?(list)` matches zero or one occurrence, `*(list)` zero or more, `+(list)`
one or more, `@(list)` exactly one, and `!(list)` anything that is *not*
matched by any alternative — including the empty string, and including strings
that merely contain an alternative. Alternatives may themselves contain
wildcards, brackets and nested extended patterns; an empty alternative (`@(a|)`)
matches the empty string, and an empty list (`@()`) matches only the empty
string while `!()` matches everything but it. `!(list)` inside a larger
pattern must still leave the rest of the pattern matchable: `!(a)b` matches
`aab` and `xb` but not `ab`, because the only way to match `ab` would be for
`!(a)` to match `a`. An operator character followed by `(` that never closes,
or a stray `)`, is an ordinary character.

**Escapes.** A backslash makes the next character literal, including `*`,
`?`, `[`, `\` itself and the extended-pattern operator characters — `\?(a)`
matches the literal string `?(a)`. A trailing backslash is a literal backslash.

**Case folding.** With `nocase`, letters compare case-insensitively wherever
they appear — in literals, inside bracket sets and ranges (`[a-c]` matches `B`),
and inside extended-pattern alternatives. POSIX classes are not folded:
`[[:upper:]]` does not match `a`.

**No brace expansion in `match`.** `{a,b}` in a pattern is three literal
characters and two ordinary ones. Expansion is `expandBraces`'s job.

### Brace expansion

A brace expression is `{` … `}` containing either a comma-separated list or a
range; a `{…}` with neither an unescaped comma nor a valid range is literal, as
is any unmatched `{` or `}`. Text before and after is prefixed and suffixed to
every result. Several brace expressions in one word combine left to right, as
a Cartesian product. Nested expressions are expanded innermost first.

**Lists.** `{a,b,c}` yields `a`, `b`, `c` in order. Empty alternatives are
real: `{,a}` yields `""` then `a`, and `{,,}` yields three empty strings.
Duplicates are preserved: `{a,b}x{,}` yields `ax`, `ax`, `bx`, `bx`. `{a}` and
`{}` do not expand.

**Ranges.** `{x..y}` with two integers yields the integers from `x` to `y`
inclusive, counting down when `y < x`; negative numbers are allowed. `{x..y..s}`
steps by `|s|` — the step's sign is ignored and a zero step means one. If either
endpoint has a leading zero, every result is zero-padded to the width of the
wider endpoint, sign included: `{01..-2}` yields `01`, `00`, `-1`, `-2`. Two
single letters yield the characters between them by character code, in either
direction, with the same optional step. Anything else — mixed letter and number,
multi-character letters, a non-integer step, a missing endpoint — is not a range
and the expression is literal.

**Escapes.** A backslash before `{`, `}` or `,` stops it being syntax, and the
backslash is kept in the output: `expandBraces("{a\\,b,c}")` is `["a\\,b", "c"]`.
This is what makes the result usable as a `match` pattern, where the backslash
continues to escape.

## Constraints

Pure functions with no dependencies and no I/O. Inputs and patterns are
JavaScript strings; comparison is by UTF-16 code unit, which agrees with bash's
byte-wise C-locale behaviour for the ASCII inputs the suite uses. Behaviour on
non-ASCII input is not specified.

`match` and `expandBraces` never throw for any string. There is no notion of an
invalid pattern; unbalanced or malformed constructs degrade to literal
characters exactly as bash's do.

Matching must be efficient on inputs of ordinary length; the star-backtracking
cases in the suite are the operational bound.

## Non-goals

No filesystem, no globbing of directories, no `**`/globstar, no dotfile rule,
no path separator awareness. No `nullglob`, `dotglob`, `globstar` or `nocaseglob`
options — only `nocase`, which is bash's `nocasematch`. No tilde expansion,
parameter expansion or quoting beyond the backslash. No locale support beyond
C. Brace expansion of an entire command line with word splitting is not
modelled — one word in, its expansions out.

## Examples

```ts
import { match, expandBraces, matchAny } from "glob-lite";

match("foo.js", "*.js");                       // true
match("foo.js", "!(*.js|*.ts)");               // false
match("aab", "!(a)b");                         // true — !(a) matches "aa"
match("B", "[a-c]", { nocase: true });         // true

expandBraces("img{1..3}.{png,jpg}");
// ["img1.png", "img1.jpg", "img2.png", "img2.jpg", "img3.png", "img3.jpg"]
expandBraces("{01..-2}");                      // ["01", "00", "-1", "-2"]
expandBraces("{a}");                           // ["{a}"]

matchAny("file.ts", "*.{js,ts}");              // true
```
