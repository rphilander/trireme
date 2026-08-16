#!/usr/bin/env python3
"""Generates glob-lite's acceptance suite by asking bash.

The oracle is bash 5.2 itself: `[[ "$input" == $pattern ]]` with extglob (and
nocasematch where a case says so), in the C locale; and `printf '%s\n' {…}` for
brace expansion. Cases are authored here; expected values are never authored.
Re-running this script must reproduce acceptance/ byte for byte.

    bench/glob-lite/generate.py            # regenerate
    bench/glob-lite/generate.py --check    # verify acceptance/ is up to date

One derived check exists: bash prints brace expansions after quote removal, so
for the few patterns containing backslashes the expected value is stated here
(the library preserves backslashes) and verified against bash after removing
them. Everything else is bash's answer verbatim.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "acceptance"
ENV = {"LC_ALL": "C", "PATH": "/usr/bin:/bin"}
PACKAGE = "glob-lite"


# ---------------------------------------------------------------------------
# The oracle
# ---------------------------------------------------------------------------

def bash_match(text: str, pattern: str, nocase: bool = False) -> bool:
    cmd = ["bash", "-O", "extglob"]
    if nocase:
        cmd += ["-O", "nocasematch"]
    cmd += ["-c", '[[ "$1" == $2 ]]', "_", text, pattern]
    r = subprocess.run(cmd, env=ENV, capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise RuntimeError(f"bash refused {text!r} == {pattern!r}: {r.stderr.strip()}")
    return r.returncode == 0


SAFE_BRACE = re.compile(r"^[A-Za-z0-9{},.\-_\\/+=:@^*?\[\]!]*$")


SENTINEL = "%"


def bash_expand(pattern: str) -> list[str]:
    # The pattern is spliced into shell source unquoted, which is the only way
    # brace expansion happens. The character set is restricted so nothing else
    # in the shell's grammar can fire; `set -f` keeps globbing out of it.
    #
    # The word is wrapped in a sentinel because the shell discards empty words
    # after expansion: `{,a}` really expands to "" and "a", but printf would
    # only ever see "a". Braces are matched within the word regardless of what
    # surrounds them, so the sentinel changes nothing about the expansion.
    assert SAFE_BRACE.match(pattern), f"unsafe brace case: {pattern!r}"
    assert SENTINEL not in pattern, f"brace case contains the sentinel: {pattern!r}"
    r = subprocess.run(
        ["bash", "-c", f"set -f; printf '%s\\n' {SENTINEL}{pattern}{SENTINEL}"],
        env=ENV,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"bash refused brace case {pattern!r}: {r.stderr.strip()}")
    words = r.stdout.split("\n")[:-1]
    for w in words:
        assert w.startswith(SENTINEL) and w.endswith(SENTINEL) and len(w) >= 2, (pattern, w)
    return [w[1:-1] for w in words]


INERT = {"(": "QQLPQQ", ")": "QQRPQQ", "|": "QQBARQQ"}


def bash_expand_any(pattern: str) -> list[str]:
    """Brace-expands a pattern that also contains extglob syntax.

    Parentheses and bars are shell grammar when unquoted, but brace expansion
    never looks at them, so they are swapped for inert letters around the call.
    """
    tokenized = pattern
    for char, token in INERT.items():
        assert token not in pattern
        tokenized = tokenized.replace(char, token)
    out = bash_expand(tokenized)
    for char, token in INERT.items():
        out = [w.replace(token, char) for w in out]
    return out


def dequote(word: str) -> str:
    """Bash quote removal for an unquoted word: a backslash escapes the next character."""
    return re.sub(r"\\(.)", r"\1", word)


# ---------------------------------------------------------------------------
# Cases: match(input, pattern). Files → describe blocks → (input, pattern) rows.
# ---------------------------------------------------------------------------

A40 = "a" * 40

MATCH_CASES: dict[str, list[tuple[str, list[tuple[str, str]]]]] = {
    "wildcards": [
        ("literal patterns match themselves and nothing else", [
            ("abc", "abc"), ("abc", "abd"), ("", ""), ("a", ""), ("", "a"), ("abc", "ab"),
            ("ab", "abc"), ("a b", "a b"), ("ABC", "abc"), ("abc", "ABC"),
        ]),
        ("* matches any run of characters, including none", [
            ("abc", "*"), ("", "*"), ("abc", "a*"), ("abc", "*c"), ("abc", "*b*"), ("abc", "x*"),
            ("abc", "*x"), ("a", "a*"), ("abc", "a*c"), ("ac", "a*c"), ("abbbc", "a*c"),
            ("abcabc", "*abc"), ("abcabc", "abc*abc"), ("abc", "**"), ("abc", "*abc*"),
            ("aaa", "a*a*a"), ("aa", "a*a*a"), ("aaaa", "a*a*a"), ("abc", "*?"), ("abc", "*??"),
            ("abc", "*???"), ("abc", "*????"),
        ]),
        ("* has no path or dotfile semantics: / and a leading . are ordinary characters", [
            (".hidden", "*"), (".hidden", ".*"), ("a/b", "*"), ("a/b", "a*b"), ("a/b/c", "*/*"),
            ("a/b", "*/*/*"), ("foo/bar", "foo/*"), ("foo/bar", "*/bar"), ("/", "*"),
        ]),
        ("? matches exactly one character", [
            ("a", "?"), ("", "?"), ("ab", "?"), ("ab", "??"), ("abc", "??"), ("abc", "a?c"),
            ("ac", "a?c"), ("a/c", "a?c"), ("/", "?"), (".", "?"), ("a b", "a?b"), ("a", "??"),
        ]),
        ("wildcards combine", [
            ("abc", "?*"), ("", "?*"), ("a", "?*"), ("abcd", "a?*d"), ("ad", "a?*d"),
            ("acd", "a?*d"), ("abcd", "?b*"), ("abcd", "*c?"), ("abcd", "?*?*"),
        ]),
        ("many stars do not cause catastrophic backtracking", [
            (A40, "*a*a*a*a*a*a*a*a*a*a*b"), (A40 + "b", "*a*a*a*a*a*a*a*a*a*a*b"),
            (A40, "*a*a*a*a*a*a*a*a*a*a*a"), (A40 + "c", "*a*a*a*a*a*a*a*a*a*a*b*"),
        ]),
        ("braces are not expanded by match; they are literal characters", [
            ("a", "{a,b}"), ("b", "{a,b}"), ("{a,b}", "{a,b}"), ("1", "{1..3}"), ("{1..3}", "{1..3}"),
        ]),
    ],
    "classes": [
        ("a bracket expression matches one character from a set", [
            ("b", "[abc]"), ("d", "[abc]"), ("", "[abc]"), ("ab", "[abc]"), ("a", "[a]"),
            ("b", "[a]"), ("abc", "a[b]c"), ("aXc", "a[b]c"), ("aXc", "a[X]c"), ("aXbc", "a[X]bc"),
        ]),
        ("ranges are inclusive and compare character codes", [
            ("b", "[a-c]"), ("d", "[a-c]"), ("a", "[a-c]"), ("c", "[a-c]"), ("a", "[a-a]"),
            ("b", "[b-a]"), ("5", "[0-9]"), ("a", "[0-9]"), ("B", "[a-z]"), ("b", "[A-Za-z]"),
            ("_", "[A-Za-z_]"), ("_", "[A-Za-z]"), ("-", "[a-c-e]"), ("d", "[a-c-e]"),
            ("e", "[a-c-e]"), (".", "[--0]"), ("/", "[--0]"), ("1", "[--0]"), ("-", "[--0]"),
        ]),
        ("! or ^ first negates the set", [
            ("d", "[!abc]"), ("a", "[!abc]"), ("d", "[^abc]"), ("a", "[^abc]"), ("", "[!a]"),
            ("ab", "[!a]"), ("]", "[!]a]"), ("b", "[!]a]"), ("a", "[!]a]"), ("b", "[^]a]"),
            ("]", "[^]a]"), ("!", "[!!]"), ("a", "[!!]"), ("^", "[^^]"), ("a", "[^^]"),
        ]),
        ("] first and - first or last are literal", [
            ("]", "[]abc]"), ("a", "[]abc]"), ("d", "[]abc]"), ("]", "[]-]"), ("-", "[]-]"),
            ("a", "[]-]"), ("-", "[a-]"), ("a", "[a-]"), ("b", "[a-]"), ("-", "[-a]"), ("b", "[-a]"),
            ("a-b", "a[-]b"), ("a]b", "a[]]b"), ("ab", "a[]]b"), ("a", "[]a]"), ("b", "[]a]"),
        ]),
        ("POSIX character classes", [
            ("b", "[[:alpha:]]"), ("5", "[[:alpha:]]"), ("5", "[[:digit:]]"), ("a", "[[:digit:]]"),
            ("B", "[[:upper:]]"), ("b", "[[:upper:]]"), ("b", "[[:lower:]]"), ("B", "[[:lower:]]"),
            ("5", "[[:alnum:]]"), ("_", "[[:alnum:]]"), (" ", "[[:space:]]"), ("\t", "[[:space:]]"),
            ("a", "[[:space:]]"), ("!", "[[:punct:]]"), ("a", "[[:punct:]]"), ("f", "[[:xdigit:]]"),
            ("g", "[[:xdigit:]]"), ("F", "[[:xdigit:]]"), (" ", "[[:blank:]]"), ("\t", "[[:blank:]]"),
            ("a", "[[:blank:]]"),
        ]),
        ("classes, ranges and characters combine in one expression", [
            ("5", "[[:digit:][:alpha:]]"), ("q", "[[:digit:][:alpha:]]"), ("_", "[[:digit:][:alpha:]]"),
            ("5", "[![:alpha:]]"), ("a", "[![:alpha:]]"), ("x5", "x[[:digit:]]"),
            ("5", "[[:digit:]a-c]"), ("b", "[[:digit:]a-c]"), ("d", "[[:digit:]a-c]"),
            ("_", "[[:alpha:]_]"), ("-", "[[:alpha:]-]"), ("b", "[a[:digit:]c]"), ("5", "[a[:digit:]c]"),
        ]),
        ("a backslash inside a bracket expression escapes the next character", [
            ("]", "[\\]]"), ("\\", "[\\]]"), ("a", "[\\a]"), ("\\", "[\\\\]"), ("a", "[\\\\]"),
            ("b", "[a\\-c]"), ("-", "[a\\-c]"), ("a", "[a\\-c]"), ("!", "[\\!a]"), ("b", "[\\!a]"),
        ]),
        ("wildcards inside a bracket expression are literal", [
            ("*", "[*]"), ("a", "[*]"), ("?", "[?]"), ("a", "[?]"), ("*", "[a*]"), ("b", "[a*]"),
        ]),
        ("an unclosed bracket expression is matched literally", [
            ("[a", "[a"), ("a", "[a"), ("[abc", "[abc"), ("a[", "a["), ("a", "a["), ("[]", "[]"),
            ("a", "[]"), ("a[]b", "a[]b"), ("ab", "a[]b"), ("[", "["), ("", "["), ("[!", "[!"),
            ("[!]", "[!]"), ("!", "[!]"), ("a", "[!]"), ("[^]", "[^]"),
        ]),
    ],
    "escapes": [
        ("a backslash makes the next character literal", [
            ("a*", "a\\*"), ("ab", "a\\*"), ("a*b", "a\\*b"), ("axb", "a\\*b"), ("a?", "a\\?"),
            ("ab", "a\\?"), ("*", "\\*"), ("", "\\*"), ("?", "\\?"), ("a", "\\?"),
            ("a[", "a\\["), ("a[b]", "a\\[b]"), ("ab", "a\\[b]"), ("a]", "a\\]"), ("a-b", "a\\-b"),
            ("a{", "a\\{"), ("{a}", "\\{a}"), ("a", "\\a"), ("\\a", "\\a"), ("\\", "\\\\"),
            ("a\\b", "a\\\\b"), ("ab", "a\\\\b"), ("a\\", "a\\"), ("a", "a\\"),
        ]),
        ("escaping the operator character disables an extended pattern", [
            ("?(a)", "\\?(a)"), ("a", "\\?(a)"), ("!(a)", "\\!(a)"), ("b", "\\!(a)"),
            ("@(a)", "@\\(a)"), ("a", "@\\(a)"), ("*(a)", "\\*(a)"), ("aaa", "\\*(a)"),
            ("+(a)", "\\+(a)"), ("a", "\\+(a)"),
        ]),
    ],
    "extglob": [
        ("?(list) matches zero or one occurrence", [
            ("ac", "a?(b)c"), ("abc", "a?(b)c"), ("abbc", "a?(b)c"), ("", "?(a)"), ("a", "?(a)"),
            ("aa", "?(a)"), ("", "?(a|b)"), ("a", "?(a|b)"), ("b", "?(a|b)"), ("ab", "?(a|b)"),
            ("a", "?(a)?(a)"), ("aa", "?(a)?(a)"), ("aaa", "?(a)?(a)"), ("abc", "?(ab)c"),
            ("c", "?(ab)c"), ("ac", "?(ab)c"), ("", "?()"), ("a", "?()"),
        ]),
        ("*(list) matches zero or more occurrences", [
            ("ac", "a*(b)c"), ("abc", "a*(b)c"), ("abbbc", "a*(b)c"), ("axc", "a*(b)c"),
            ("", "*(a|b)"), ("abab", "*(a|b)"), ("abac", "*(a|b)"), ("abc", "*(a|b|c)"),
            ("aabaab", "*(ab|aab)"), ("aabbaabb", "*(ab|aab)"), ("", "*()"), ("a", "*()"),
            ("aXbXc", "*(a|X|b|c)"), ("abab", "*(a?(b))"), ("aab", "*(a?(b))"), ("abb", "*(a?(b))"),
            ("file.txt", "*(*.txt)"), ("x", "*(!(x))"), ("xy", "*(!(x))"),
        ]),
        ("+(list) matches one or more occurrences", [
            ("ac", "a+(b)c"), ("abc", "a+(b)c"), ("abbc", "a+(b)c"), ("", "+(a|b)"), ("a", "+(a|b)"),
            ("ba", "+(a|b)"), ("bac", "+(a|b)"), ("abab", "+(ab)"), ("aba", "+(ab)"),
            ("123", "+([0-9])"), ("12a", "+([0-9])"), ("", "+([0-9])"), ("a1b2", "+([a-z][0-9])"),
            ("a1b", "+([a-z][0-9])"), ("ab", "+(@(a|b))"), ("file.txt.txt", "+(*.txt)"), ("", "+()"),
        ]),
        ("@(list) matches exactly one of the alternatives", [
            ("abc", "@(abc|def)"), ("def", "@(abc|def)"), ("abd", "@(abc|def)"), ("", "@(abc|def)"),
            ("ab", "@(a|)b"), ("b", "@(a|)b"), ("", "@()"), ("a", "@()"), ("ab", "@(a)@(b)"),
            ("abcd", "@(ab|a)@(cd|bcd)"), ("aXbc", "@(a|b)*"), ("Xbc", "@(a|b)*"),
            ("foo.js", "@(*.js|*.ts)"), ("foo.ts", "@(*.js|*.ts)"), ("foo.md", "@(*.js|*.ts)"),
            ("a", "@(a|a)"), ("aa", "@(a|aa)"), ("a", "@(?)"), ("ab", "@(?)"), ("abc", "a@(b|c)c"),
            ("acc", "a@(b|c)c"), ("ac", "a@(b|c)c"), ("abc", "@(a*|x)"), ("xyz", "@(a*|x)"),
            ("x", "@(a*|x)"), ("a1", "@(a[0-9]|b)"), ("aX", "@(a[0-9]|b)"),
        ]),
        ("!(list) matches anything except the alternatives", [
            ("abc", "!(abc)"), ("abd", "!(abc)"), ("", "!(abc)"), ("a", "!(a|b)"), ("b", "!(a|b)"),
            ("c", "!(a|b)"), ("ab", "!(a|b)"), ("abc", "!(*.txt)"), ("x.txt", "!(*.txt)"),
            ("x.txt.bak", "!(*.txt)"), ("foo.js", "!(*.js|*.ts)"), ("foo.md", "!(*.js|*.ts)"),
            ("a", "!()"), ("", "!()"), ("", "!(a)"), ("a", "!(?)"), ("aa", "!(?)"), ("", "!(?)"),
            ("a", "!(*)"), ("", "!(*)"), (".hidden", "!(.*)"), ("visible", "!(.*)"),
        ]),
        ("!(list) inside a larger pattern must still leave the rest matchable", [
            ("ab", "!(a)b"), ("b", "!(a)b"), ("aab", "!(a)b"), ("xb", "!(a)b"), ("aXb", "a!(X)b"),
            ("ab", "a!(X)b"), ("axxb", "a!(x)b"), ("axb", "a!(x)b"), ("abc", "a!(b)c"), ("ac", "a!(b)c"),
            ("axc", "a!(b)c"), ("abbc", "a!(b)c"), ("a.b.c", "*.!(c)"), ("a.b.d", "*.!(c)"),
            ("a.c", "*.!(c)"), ("test.js", "!(test).js"), ("main.js", "!(test).js"),
            ("test.ts", "!(test).js"), ("xtest.js", "!(test).js"),
        ]),
        ("extended patterns nest", [
            ("c", "@(a|@(b|c))"), ("d", "@(a|@(b|c))"), ("a", "!(!(a))"), ("b", "!(!(a))"),
            ("a", "!(!(!(a)))"), ("b", "!(!(!(a)))"), ("abd", "a@(b|c)?(d)"), ("ab", "a@(b|c)?(d)"),
            ("acd", "a@(b|c)?(d)"), ("ad", "a@(b|c)?(d)"), ("ab", "@(a|b)@(a|b)"), ("aab", "*(a)@(a|b)b"),
        ]),
        ("an unbalanced or stray parenthesis is an ordinary character", [
            ("?(a", "?(a"), ("x(a", "?(a"), ("a)", "a)"), ("a", "a)"), ("!(a", "!(a"), ("x(a", "!(a"),
            ("@(a", "@(a"), ("(a)", "(a)"), ("a", "(a)"), ("*(", "*("), ("x(", "*("), ("(", "*("),
            ("a)", "?(a))"), ("a", "?(a))"), ("a))", "?(a))"),
        ]),
    ],
}

NOCASE_CASES: list[tuple[str, list[tuple[str, str]]]] = [
    ("letters compare case-insensitively", [
        ("ABC", "abc"), ("abc", "ABC"), ("aBc", "AbC"), ("ABC", "a*"), ("ABC", "*C"), ("ABC", "a?c"),
        ("ABD", "abc"), ("A.TXT", "*.txt"), ("A.txt", "*.TXT"),
    ]),
    ("bracket sets and ranges fold too", [
        ("ABC", "a[b]c"), ("ABC", "a[B]c"), ("B", "[a-c]"), ("b", "[A-C]"), ("Z", "[a-c]"),
        ("a", "[!a]"), ("a", "[!A]"), ("A", "[!a]"), ("D", "[!a-c]"),
    ]),
    ("POSIX classes are not folded", [
        ("A", "[[:lower:]]"), ("a", "[[:upper:]]"), ("a", "[[:alpha:]]"), ("A", "[[:alpha:]]"),
    ]),
    ("extended patterns fold their alternatives", [
        ("ABC", "@(abc|x)"), ("ABC", "!(abc)"), ("ABD", "!(abc)"), ("ABC", "+(a|b|c)"),
        ("aBc", "*(A|B|C)"), ("AB", "?(ab)"),
    ]),
]

# ---------------------------------------------------------------------------
# Cases: expandBraces(pattern)
# ---------------------------------------------------------------------------

BRACE_CASES: list[tuple[str, list[str]]] = [
    ("comma lists", [
        "{a,b}", "{a,b,c}", "{,a}", "{a,}", "{,}", "{,,}", "{a,,b}", "{a,b,}", "x{a,b}y",
        "{a,b}{1,2}", "{a,b}{1,2}{x,y}", "a{b,c}d{e,f}g", "{a,b}c{d,e}", "{a,b}x{,}", "{a,b}{,}",
    ]),
    ("a lone or empty brace is literal, and so is text without braces", [
        "{a}", "{}", "abc", "", "{a,b}{}", "{}{a,b}", "{{}}", "a{}b",
    ]),
    ("unmatched braces are literal", [
        "{a,b}}", "{{a,b}", "{a,b", "a,b}", "{", "}", "{a", "a}", "{,", "{a,b}}}",
    ]),
    ("lists nest", [
        "{a,b{1,2}}", "{a,{b,c}}", "{{a,b}}", "{{a,b},c}", "{a,{b,{c,d}}}", "{,{a,b}}",
        "{a{b,c},d}", "x{a{1,2},b}y", "{a,{1..2}}", "{{1..2},{a..b}}",
    ]),
    ("numeric ranges", [
        "{1..3}", "{3..1}", "{1..1}", "{0..0}", "{-1..1}", "{1..-1}", "{-3..-1}", "{1..10}",
        "{9..11}", "{-2..2}",
    ]),
    ("numeric ranges with a step; the step's sign is ignored and zero means one", [
        "{1..10..3}", "{10..1..3}", "{1..10..4}", "{1..3..0}", "{1..3..-1}", "{3..1..-1}",
        "{1..2..5}", "{5..1..2}", "{1..1..0}", "{0..10..5}",
    ]),
    ("zero-padded ranges keep the width of the widest endpoint", [
        "{01..3}", "{001..10..3}", "{01..-2}", "{1..03}", "{00..2}", "{-01..1}", "{008..10}", "{-3..-01}",
    ]),
    ("alphabetic ranges walk character codes", [
        "{a..c}", "{c..a}", "{a..a}", "{A..C}", "{a..e..2}", "{e..a..2}", "{a..z..5}", "{a..z..7}", "{X..Z}",
    ]),
    ("a range that is not a range is literal", [
        "{1..a}", "{a..1}", "{aa..b}", "{a..bb}", "{1..2..x}", "{1..}", "{..2}", "{1.2}", "{1...3}",
        "{ab,cd..ef}", "{1..2..}", "{a..b..c}", "{1..2..3..4}",
    ]),
    ("ranges combine with lists and text", [
        "{a..b}{1..2}", "{1..2}{a..b}", "{a..c}x", "{1..3}.txt", "file{,.bak}", "{1..3}{,}",
        "img{1..3}.{png,jpg}", "{a,b}{1..2}", "v{1..2}.{0..1}",
    ]),
]

# Backslash cases: (pattern, expected) — expected is stated, then checked against bash after dequoting.
BRACE_ESCAPE_CASES: list[tuple[str, list[str]]] = [
    ("\\{a,b}", ["\\{a,b}"]),
    ("{a\\,b}", ["{a\\,b}"]),
    ("{a\\,b,c}", ["a\\,b", "c"]),
    ("{a,b}\\{c,d}", ["a\\{c,d}", "b\\{c,d}"]),
    ("\\{a,b\\}", ["\\{a,b\\}"]),
    ("{a,b\\}", ["{a,b\\}"]),
    ("{a,b}\\,c", ["a\\,c", "b\\,c"]),
]

# ---------------------------------------------------------------------------
# Cases: matchAny(input, pattern) — bash for both halves, composed.
# ---------------------------------------------------------------------------

COMPOSE_CASES: list[tuple[str, list[tuple[str, str]]]] = [
    ("expands braces, then matches any alternative", [
        ("a", "{a,b}"), ("b", "{a,b}"), ("c", "{a,b}"), ("file.js", "*.{js,ts}"), ("file.ts", "*.{js,ts}"),
        ("file.md", "*.{js,ts}"), ("a1", "{a,b}{1,2}"), ("b2", "{a,b}{1,2}"), ("c1", "{a,b}{1,2}"),
        ("3", "{1..5}"), ("6", "{1..5}"), ("img3.png", "img{1..3}.png"), ("img4.png", "img{1..3}.png"),
        ("v1.0", "v{1..2}.{0..1}"), ("v3.0", "v{1..2}.{0..1}"),
    ]),
    ("without braces it is just match", [
        ("x", "x"), ("y", "x"), ("foo", "!(bar)"), ("bar", "!(bar)"), ("abc", "a*"), ("", "*"),
    ]),
    ("extended patterns and classes still apply inside each alternative", [
        ("foo", "{!(bar),x}"), ("bar", "{!(bar),x}"), ("x", "{!(bar),x}"), ("a5", "{a[0-9],b}"),
        ("aX", "{a[0-9],b}"), ("ab", "{a@(b|c),x}"), ("ad", "{a@(b|c),x}"),
    ]),
]

COMPOSE_NOCASE_CASES: list[tuple[str, str]] = [
    ("ABC", "{abc,x}"), ("ABC", "{x,y}"), ("FILE.JS", "*.{js,ts}"), ("B", "{a..c}"),
]


# ---------------------------------------------------------------------------
# Emission
# ---------------------------------------------------------------------------

def ts(value) -> str:
    return json.dumps(value, ensure_ascii=True)


HEADER = "// Generated by generate.py from bash 5.2; do not edit by hand.\n"


def emit_match_file(name: str, groups, nocase: bool) -> str:
    lines = [HEADER, 'import { describe, expect, it } from "vitest";', f'import {{ match }} from "{PACKAGE}";', ""]
    opts = ", { nocase: true }" if nocase else ""
    for title, rows in groups:
        lines.append(f"describe({ts(title)}, () => {{")
        lines.append("  const cases: Array<[string, string, boolean]> = [")
        for text, pattern in rows:
            lines.append(f"    [{ts(text)}, {ts(pattern)}, {ts(bash_match(text, pattern, nocase))}],")
        lines.append("  ];")
        lines.append(f'  it.each(cases)("match(%j, %j{", nocase" if nocase else ""}) is %j", (input, pattern, expected) => {{')
        lines.append(f"    expect(match(input, pattern{opts})).toBe(expected);")
        lines.append("  });")
        lines.append("});")
        lines.append("")
    return "\n".join(lines)


def emit_braces_file() -> str:
    lines = [HEADER, 'import { describe, expect, it } from "vitest";', f'import {{ expandBraces }} from "{PACKAGE}";', ""]
    for title, patterns in BRACE_CASES:
        lines.append(f"describe({ts(title)}, () => {{")
        lines.append("  const cases: Array<[string, string[]]> = [")
        for pattern in patterns:
            lines.append(f"    [{ts(pattern)}, {ts(bash_expand(pattern))}],")
        lines.append("  ];")
        lines.append('  it.each(cases)("expandBraces(%j) is %j", (pattern, expected) => {')
        lines.append("    expect(expandBraces(pattern)).toEqual(expected);")
        lines.append("  });")
        lines.append("});")
        lines.append("")
    lines.append('describe("a backslash protects a brace or comma from being syntax, and is kept", () => {')
    lines.append("  const cases: Array<[string, string[]]> = [")
    for pattern, expected in BRACE_ESCAPE_CASES:
        seen = bash_expand(pattern)
        assert [dequote(e) for e in expected] == seen, f"{pattern!r}: stated {expected} but bash prints {seen}"
        lines.append(f"    [{ts(pattern)}, {ts(expected)}],")
    lines.append("  ];")
    lines.append('  it.each(cases)("expandBraces(%j) is %j", (pattern, expected) => {')
    lines.append("    expect(expandBraces(pattern)).toEqual(expected);")
    lines.append("  });")
    lines.append("});")
    lines.append("")
    return "\n".join(lines)


def emit_compose_file() -> str:
    lines = [HEADER, 'import { describe, expect, it } from "vitest";', f'import {{ matchAny }} from "{PACKAGE}";', ""]
    for title, rows in COMPOSE_CASES:
        lines.append(f"describe({ts(title)}, () => {{")
        lines.append("  const cases: Array<[string, string, boolean]> = [")
        for text, pattern in rows:
            expected = any(bash_match(text, alt) for alt in bash_expand_any(pattern))
            lines.append(f"    [{ts(text)}, {ts(pattern)}, {ts(expected)}],")
        lines.append("  ];")
        lines.append('  it.each(cases)("matchAny(%j, %j) is %j", (input, pattern, expected) => {')
        lines.append("    expect(matchAny(input, pattern)).toBe(expected);")
        lines.append("  });")
        lines.append("});")
        lines.append("")
    lines.append('describe("options pass through to every alternative", () => {')
    lines.append("  const cases: Array<[string, string, boolean]> = [")
    for text, pattern in COMPOSE_NOCASE_CASES:
        expected = any(bash_match(text, alt, nocase=True) for alt in bash_expand_any(pattern))
        lines.append(f"    [{ts(text)}, {ts(pattern)}, {ts(expected)}],")
    lines.append("  ];")
    lines.append('  it.each(cases)("matchAny(%j, %j, nocase) is %j", (input, pattern, expected) => {')
    lines.append("    expect(matchAny(input, pattern, { nocase: true })).toBe(expected);")
    lines.append("  });")
    lines.append("});")
    lines.append("")
    return "\n".join(lines)


def generate() -> dict[str, str]:
    files: dict[str, str] = {}
    for name, groups in MATCH_CASES.items():
        files[f"{name}.test.ts"] = emit_match_file(name, groups, nocase=False)
    files["nocase.test.ts"] = emit_match_file("nocase", NOCASE_CASES, nocase=True)
    files["braces.test.ts"] = emit_braces_file()
    files["compose.test.ts"] = emit_compose_file()
    return files


def main(argv: list[str]) -> int:
    version = subprocess.run(["bash", "--version"], capture_output=True, text=True).stdout.splitlines()[0]
    files = generate()
    total = sum(f.count("\n    [") for f in files.values())
    if "--check" in argv:
        stale = [n for n, c in files.items() if (OUT / n).read_text() != c] if OUT.exists() else list(files)
        print(f"{total} cases; {'up to date' if not stale else 'STALE: ' + ', '.join(stale)}")
        return 1 if stale else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for stray in OUT.glob("*.test.ts"):
        if stray.name not in files:
            stray.unlink()
    for name, content in files.items():
        (OUT / name).write_text(content)
    print(f"wrote {len(files)} files, {total} cases, oracle: {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
