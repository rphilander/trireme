#!/usr/bin/env node
/**
 * Generates es5-parser's acceptance suite by asking acorn.
 *
 * The oracle is acorn (pinned in package.json) at `ecmaVersion: 5`, script
 * goal, non-strict. Cases are authored here; expected values are never
 * authored: every AST is acorn's own output with `start`/`end` removed, and
 * every "throws" case is one acorn rejects. Re-running this script must
 * reproduce acceptance/ byte for byte.
 *
 *     node bench/es5-parser/generate.ts            # regenerate
 *     node bench/es5-parser/generate.ts --check    # verify acceptance/ is up to date
 *
 * Guards, so the suite cannot drift from what spec.md promises:
 *   - every valid case parses and every error case throws (a SyntaxError);
 *   - a case that mentions "use strict" must parse or fail identically when
 *     the directive is spelled so that it is not one — strictness never
 *     decides a verdict, because the parser does not implement strict mode;
 *   - error groups marked `modern` contain only sources that acorn accepts at
 *     its latest ecmaVersion, so "rejects later syntax" cases are real syntax
 *     and not garbage;
 *   - no case contains an HTML-like comment (`<!--`, or `-->` where acorn
 *     would treat it as one), which is left unspecified;
 *   - no source is listed twice in one file (the same source may appear under
 *     two features in two files; those repeats are counted and reported);
 *   - every generated file stays under the harness's 80,000-character read
 *     limit, so the agent always sees a whole file.
 *
 * Failure legibility: the harness shows the agent at most 20 failures with
 * messages cut at 1024 characters, and vitest's own message for a deep
 * inequality names no path. Each test therefore computes the first point of
 * difference itself and passes it as the assertion message.
 */
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "acceptance");
const PACKAGE = "es5-parser";
const ACORN_VERSION: string = (acorn as unknown as { version: string }).version;

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

type Oracle = { ok: true; ast: unknown } | { ok: false; message: string };

function oracle(source: string): Oracle {
  try {
    return { ok: true, ast: strip(acorn.parse(source, { ecmaVersion: 5, sourceType: "script" })) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, message: error.message };
  }
}

/** Removes acorn's positions; keeps every other field, including RegExp values. */
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node instanceof RegExp) return node;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      out[key] = strip(value);
    }
    return out;
  }
  return node;
}

function parsesAtLatest(source: string): boolean {
  for (const sourceType of ["script", "module"] as const) {
    try {
      acorn.parse(source, { ecmaVersion: "latest", sourceType });
      return true;
    } catch {
      /* try the other goal */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cases. A file is a list of groups; a group is a title and its sources.
// Valid groups get ASTs; error groups get `throws SyntaxError`.
// ---------------------------------------------------------------------------

type Group = { title: string; cases: string[] };
type ErrorGroup = { title: string; cases: string[]; modern?: boolean };

const LS = "\u2028";
const PS = "\u2029";
const NBSP = "\u00a0";
const BOM = "\ufeff";

const VALID: Record<string, Group[]> = {
  "literals-numbers": [
    { title: "decimal integers and fractions", cases: [
      "0", "1", "42", "123456789", "1.5", "0.5", ".5", "5.", "1.", "0.0", "10.25", "9007199254740993", "1234567890123456789012345678901234567890", "0.1", "0.30000000000000004", "1000000",
    ] },
    { title: "exponents", cases: [
      "1e3", "1E3", "1e+3", "1e-3", "1.5e3", ".5e1", "1.e3", "2e0", "0e1", "1e21", "1e400", "5e-324", "1e-400", "123e-2", "6.02e23",
    ] },
    { title: "hexadecimal", cases: [
      "0x0", "0x1F", "0X1f", "0xff", "0xFFFFFFFF", "0x10000000000000000", "0xabcdef", "0x10.a",
    ] },
    { title: "legacy octal integers and leading zeros", cases: [
      "010", "0777", "00", "07", "08", "09.5", "0128", "01",
    ] },
    { title: "numbers in expressions keep their raw text", cases: [
      "1 + 2", "0x10 + 010", "1e3 * 2", "-1", "-0", "1..toString", "1 .toString", "1.5.toFixed", "(1).toString()", "1..toString()", "1e3.toString()",
    ] },
  ],
  "literals-strings": [
    { title: "quotes and plain content", cases: [
      "\"abc\"", "'abc'", "\"\"", "''", "\"a'b\"", "'a\"b'", "\"it's\"", "'say \"hi\"'", "\"1\"", "\" \"", "\"日本語\"", "\"😀\"", "\"//\"", "\"/*\"", "'*/'",
    ] },
    { title: "single-character escapes", cases: [
      "\"\\n\"", "\"\\t\"", "\"\\r\"", "\"\\b\"", "\"\\f\"", "\"\\v\"", "\"\\0\"", "\"\\\\\"", "\"\\\"\"", "'\\''", "\"\\'\"", "'\\\"'", "\"a\\nb\"", "\"\\a\"", "\"\\q\"", "\"\\/\"", "\"\\ \"", "\"\\d\"", "\"\\n\\t\\r\"", "'\\\\n'",
    ] },
    { title: "hexadecimal and unicode escapes", cases: [
      "\"\\x41\"", "\"\\x4a\\x4A\"", "\"\\u0041\"", "\"\\u00e9\"", "\"\\u2028\"", "\"\\u2029\"", "\"\\uD83D\\uDE00\"", "\"\\x00\"", "\"\\u0000\"", "\"a\\u0062c\"", "\"\\uFFFF\"", "'\\u0027'",
    ] },
    { title: "legacy octal escapes", cases: [
      "\"\\101\"", "\"\\1\"", "\"\\12\"", "\"\\377\"", "\"\\7\"", "'\\101\\102'", "\"a\\0b\"", "\"\\400\"", "\"\\1234\"", "\"\\477\"",
    ] },
    { title: "line continuations", cases: [
      "\"a\\\nb\"", "\"a\\\r\nb\"", "\"a\\\rb\"", `"a\\${LS}b"`, `"a\\${PS}b"`, "\"\\\n\"", "'a\\\nb\\\nc'", "\"a\\\n  b\"",
    ] },
    { title: "strings as directives", cases: [
      "\"use strict\"", "'use strict'", "\"use strict\";", "\"use strict\"; a", "\"use strict\"\na", "\"a\"; \"b\"; c", "\"use\\x20strict\"", "\"a\\\\b\"",
      "function f() { \"use strict\" }", "function f() { \"use strict\"; return 1 }", "function f() { 'a'; \"b\"; c }", "function f() { \"a\"\n\"b\" }",
      "(\"a\")", "\"a\" + b", "a; \"b\"", "; \"a\"", "(\"a\"); \"b\"", "\"a\"; a; \"b\"", "\"a\", b", "\"a\".length", "function f(a) { a; \"b\" }", "{ \"a\" }", "if (a) \"b\"",
    ] },
  ],
  "literals-other": [
    { title: "regular expression literals", cases: [
      "/a/", "/a/g", "/a/i", "/a/m", "/a/gim", "/a/mig", "/[/]/", "/\\//", "/[\\]]/", "/a\\/b/", "/(a|b)*c+d?/", "/^\\d{3}-\\d{4}$/", "/[a-z]/i", "/\\\\/",
      "/(?:)/", "/[//]/", "/a[/]b/", "/[\\]/]/", "/=/", "/=a/g", "/[.*+?^${}()|[\\]\\\\]/g", "/'/", "/\"/", "/[\"']/",
      "x = /a/", "x = /=/g", "/a/;", "/a/g.lastIndex", "/a/ instanceof RegExp", "/a/ + /b/", "/a/.test(b)", "[/a/, /b/g]",
    ] },
    { title: "this, null, true, false", cases: [
      "this", "null", "true", "false", "[null, true, false, this]", "this.a", "this[a]", "null.a", "a = null", "a = this",
    ] },
    { title: "array literals", cases: [
      "[]", "[1]", "[1, 2]", "[a, b]", "[[]]", "[[1], [2, [3]]]", "[1,]", "[,]", "[,,]", "[1,,2]", "[,1]", "[1,,]", "[,,1]", "[a, , b, , ]",
      "[f(), a.b, c + d]", "[function(){}]", "[/re/]", "[{}]", "[[], {}]", "[\"a\", 'b']", "[1, \"a\", null, true, undefined]", "[a = 1]", "[(a, b)]", "[1].length",
    ] },
    { title: "object literals", cases: [
      "({})", "({a: 1})", "({a: 1, b: 2})", "({a: 1,})", "({\"a\": 1})", "({'a': 1})", "({1: a})", "({1.5: a})", "({0x10: a})", "({\"\": 1})", "({a: {b: {c: 1}}})", "({a: [1, 2]})",
      "({a: function(){}})", "({a: b ? c : d})", "({a: (b, c)})", "({a: 1, a: 2})", "({__proto__: null})", "({__proto__: 1, __proto__: 2})", "({$: 1, _: 2})", "x = {a: 1}", "f({a: 1})",
      "({a: 1}).a", "({}).a", "({}).a = 1", "({\"a b\": 1})", "({\"1\": 1, 1: 2})", "({a: b = c})", "({a: 1, b: {c: 2, d: [3, {e: 4}]}})",
    ] },
    { title: "getters and setters", cases: [
      "({get a() {}})", "({set a(v) {}})", "({get a() {}, set a(v) {}})", "({set a(v) {}, get a() {}})", "({get a() { return 1 }})", "({set a(v) { this._a = v }})",
      "({get \"a\"() {}})", "({get 1() {}})", "({get get() {}})", "({get set() {}})", "({set get(v) {}})", "({get if() {}})", "({get\na() {}})", "({set\na(v) {}})",
      "({get: 1})", "({set: 1})", "({get: function() {}})", "({get a() {}, b: 1})", "({a: 1, get b() {}})", "({get a() {}, get b() {}, set b(v) {}})", "({set a(let) {}})", "({1: 1, get 1.5() {}})", "({\"a\": 1, get b() {}})",
    ] },
  ],
  "identifiers": [
    { title: "identifier names", cases: [
      "a", "abc", "_", "$", "_a", "$a", "a1", "a_b", "A", "aBc", "$$", "__proto__", "a1b2", "_1", "$1", "veryLongIdentifierName_with$Signs", "Z9",
    ] },
    { title: "unicode letters and marks", cases: [
      "π", "café", "日本語", "Ω", "ａ", "a\u0300", "x\u200dy", "x\u200cy", "über", "Δx", "a\u0903", "\u2163", "a\u0663", "a\u203fb", "\u01c5", "\u02b0", "\u2163 + a\u0663",
    ] },
    { title: "unicode escapes in identifiers", cases: [
      "\\u0061", "a\\u0062", "\\u0061\\u0062\\u0063", "\\u0024", "\\u005f", "a\\u0031", "a\\u0024b", "\\u00e9", "caf\\u00e9", "\\u03c0", "\\u0061 = 1", "var \\u0061", "\\u0061.b", "a.\\u0062",
    ] },
    { title: "names that are not reserved in non-strict ES5", cases: [
      "let = 1", "yield = 1", "static = 1", "implements = 1", "interface = 1", "package = 1", "private = 1", "protected = 1", "public = 1", "async = 1", "await = 1", "of = 1",
      "get = 1", "set = 1", "arguments = 1", "eval = 1", "undefined = 1", "NaN = 1", "Infinity = 1", "var let, yield, static, implements, interface, package, private, protected, public;",
      "var async, await, of, get, set, arguments, eval;", "let\nx = 1", "yield\nx", "async\nfunction f() {}", "let[0] = 1", "let [a] = b", "let.a", "for (of in y) ;", "for (x in of) ;",
      "function let() {}", "function f(let, yield) {}", "try {} catch (let) {}", "let: 1", "yield: 1", "a.let", "({let: 1})",
    ] },
    { title: "keywords and reserved words are allowed as property names", cases: [
      "a.if", "a.class", "a.enum", "a.this", "a.null", "a.true", "a.false", "a.new", "a.delete", "a.typeof", "a.in", "a.instanceof", "a.function", "a.var", "a.default", "a.super",
      "a.import", "a.export", "a.debugger", "a.void", "a.return", "a.throw", "a.for.while.do", "a.const", "a.extends", "a.with", "a.try.catch.finally", "a.switch.case.break.continue",
      "({if: 1})", "({class: 1, enum: 2})", "({null: 1, true: 2, false: 3})", "({new: 1, delete: 2})", "({function: 1, var: 2, return: 3})", "({default: 1, case: 2, switch: 3})",
      "({this: 1, typeof: 2, void: 3})", "({import: 1, export: 2, super: 3})", "a.if.else", "a.\\u0069f", "new a.new", "({get if() {}, set class(v) {}})",
    ] },
  ],
  "whitespace-comments": [
    { title: "white space between tokens", cases: [
      "a+b", "a + b", "a\t+\tb", "a\u000b+\u000cb", `a${NBSP}+${NBSP}b`, `a${BOM}+${BOM}b`, `${BOM}a`, "a\u2000+\u3000b", "a\u1680+b", "  a  ", "\t\ta", "a\u2003+\u205fb", "a\u202f+b", "\n\n  a  \n\n",
    ] },
    { title: "line terminators", cases: [
      "a\nb", "a\rb", "a\r\nb", `a${LS}b`, `a${PS}b`, "1\n\n\n2", "\n\na\n\n", "a\n\r\nb", "a;\nb;\n", "\r\na\r\nb\r\n",
    ] },
    { title: "comments", cases: [
      "a // c\nb", "a /* c */ + b", "/* c */ a", "a /* c */", "// only", "/* only */", "", "/**/a", "a/**/+/**/b", "a /* multi\nline */ b", "a//c\n+b", "a\n// c\n// d\nb", "/*/ a */ b",
      "x = \"a\" // \"b\"", "x = /a/ // c", "a /* c */ // d\nb", "// c\n// d\n", "/* c\n * d\n */", "a /* one */ /* two */ + b", "a // one\n// two\n+ b", "/**\n * doc\n */\nfunction f() {}",
      "a /* */\n++b", "a /*\n*/ ++b", "function f() { return /*\n*/ a }", "function f() { return /* */ a }", "/* a *//* b */c", "a//\nb", "a/*\r\n*/b",
    ] },
  ],
  "operators-unary": [
    { title: "unary operators", cases: [
      "+a", "-a", "!a", "~a", "typeof a", "void a", "delete a.b", "delete a", "delete a[b]", "- -a", "-(-a)", "!!a", "!-+~a", "typeof typeof a", "typeof void delete a", "void 0",
      "+\"1\"", "-a.b", "-a[0]", "-f()", "typeof (a + b)", "-(a + b)", "!(a && b)", "- - -a", "typeof a()", "!a.b()", "-new a", "-new a()", "typeof new a", "!function() {}()", "void function() {}()",
    ] },
    { title: "update operators", cases: [
      "a++", "a--", "++a", "--a", "a.b++", "a[0]--", "++a.b", "--a[0]", "(a)++", "(a.b)++", "((a))++", "-a++", "!a--", "typeof a++", "++a + b", "a + ++b", "a+++b", "a++ + b", "a - --b",
      "a-- - b", "a---b", "a-->b", "a++<b", "++a.b.c", "a[0][1]++", "-a++ + b", "a++, b--", "f(a++, --b)", "x = a++", "x = ++a", "a++ * 2", "-++a",
    ] },
    { title: "multiplicative and additive", cases: [
      "a * b", "a / b", "a % b", "a + b", "a - b", "a * b + c", "a + b * c", "a - b - c", "a / b / c", "a * b / c % d", "a + b - c + d", "(a + b) * c", "a * (b + c)", "a % b % c",
      "1 + 2 * 3 - 4 / 5", "a + -b", "a - -b", "a - +b", "a * -b", "a-b", "a*b", "-a * b", "-(a * b)", "a * -b + c", "\"a\" + 1", "a + b + c + d + e",
    ] },
    { title: "shift, relational and equality", cases: [
      "a << b", "a >> b", "a >>> b", "a << b >> c >>> d", "a < b", "a > b", "a <= b", "a >= b", "a instanceof b", "a in b", "a < b instanceof c in d", "a == b", "a != b", "a === b",
      "a !== b", "a == b != c", "a === b !== c", "a < b == c > d", "a + b < c - d", "a << b < c", "a in b in c", "\"x\" in a", "a << 1 + 2", "a >> b >> c",
      "a < b < c", "!(a in b)", "a instanceof b instanceof c", "typeof a == \"string\"", "a == null", "1 < 2 == true", "a >>> 0",
    ] },
    { title: "bitwise and logical", cases: [
      "a & b", "a ^ b", "a | b", "a | b ^ c & d", "a & b | c", "a && b", "a || b", "a || b && c", "a && b || c", "a && b && c", "a || b || c", "a == b && c != d", "a | b && c",
      "a & b == c", "a ^ b | c", "a && !b", "!a || b", "a || b || c && d", "(a || b) && c", "a && (b || c)", "a & b & c", "a == b == c", "a && b == c", "a & ~b", "a || b && c || d", "a << b & c", "a & b << c",
    ] },
  ],
  "operators-assignment": [
    { title: "conditional", cases: [
      "a ? b : c", "a ? b : c ? d : e", "a ? b ? c : d : e", "a || b ? c : d", "a ? b : c || d", "a ? b : c, d", "a ? (b, c) : d", "a ? b : (c, d)", "(a ? b : c) + d", "a + (b ? c : d)",
      "a == b ? c : d", "!a ? b : c", "a ? b() : c()", "a ? function() {} : null", "a ? [] : {}", "a ? b : c ? d : e ? f : g", "a ? b ? c ? d : e : f : g",
    ] },
    { title: "assignment", cases: [
      "a = b", "a = b = c", "a += b", "a -= b", "a *= b", "a /= b", "a %= b", "a <<= b", "a >>= b", "a >>>= b", "a &= b", "a ^= b", "a |= b", "a += b -= c", "a = b ? c : d", "a ? b = 1 : c = 2",
      "a = b || c", "a.b = c", "a[b] = c", "a.b.c = d", "(a) = b", "a = b + c * d", "a = (b, c)", "a = b, c", "x = a ? b : c = d", "a = b == c", "a = -b", "a = typeof b",
      "a = b = c = d", "a.b[c] = d", "a[b][c] = d", "a[0] = 1", "a.b += 1", "a[b] -= 1", "((a)) = 1", "(a.b) = 1", "a = function() {}", "a = new b", "a = b++", "a = ++b",
      "a = b in c", "a /= b / c", "x = a /= 2", "a = b = c ? d : e", "a = (b = c)", "this.a = 1", "this.a.b = c", "a[b + c] = d",
    ] },
    { title: "comma", cases: [
      "a, b", "a, b, c", "(a, b)", "a = 1, b = 2", "f(a, (b, c))", "a, b = c, d", "(a, b) + c", "a + (b, c)", "(a, b, c)", "((a, b), c)", "a, (b, c)", "a = (b, c), d",
      "a[b, c]", "new (a, b)", "a, b ? c : d", "typeof (a, b)", "(a, b)()", "(a, b).c",
    ] },
    { title: "grouping", cases: [
      "(a)", "((a))", "(((a)))", "(a + b) * c", "(a)()", "(a).b", "(a)[b]", "(function() {})", "(a) + (b)", "(a ? b : c)", "(a = b)", "((a = b))",
      "(-a)", "(typeof a)", "(a in b)", "(new a)", "(new a)()", "(a.b)()", "(f)()", "((a))()", "(a)(b)(c)", "(a).b.c", "(a + b).c", "(a || b).c", "([])", "({})",
    ] },
  ],
  "members-calls-new": [
    { title: "member access", cases: [
      "a.b", "a.b.c", "a[b]", "a[0]", "a[\"b\"]", "a[b][c]", "a.b[c].d", "a[b + c]", "a[a[b]]", "\"abc\".length", "a.$", "a._", "a.b1", "a[0][1][2]", "a.b.c.d.e", "a[b].c[d].e",
      "a[\"b\"][\"c\"]", "a[1.5]", "a[null]", "a[this]", "a[b ? c : d]", "a[b = c]", "(a.b).c",
    ] },
    { title: "calls", cases: [
      "f()", "f(a)", "f(a, b)", "f(a, b, c)", "f()()", "f(a)(b)", "a.b()", "a.b().c", "a.b().c()", "a[b]()", "a()[b]", "a().b", "f(g())", "f(g(), h())", "f(a + b, c ? d : e)", "f((a, b))",
      "f(function() {})", "f({})", "f([])", "a.b().c[d]()", "f\n(a)", "f(a)\n(b)", "f()()()", "a.b.c(d).e", "f(a = 1)", "f(a, b = 2)",
      "f(a++)", "f(-a)", "f(typeof a)", "f(new a)", "f(new a())", "f(a.b, c[d])", "f(1, \"a\", null)", "f(f(f()))", "a.b(c)(d)", "a().b().c()", "f()\n.then()", "f\n(a)\n(b)",
      "f(a in b)", "f(a || b)", "f(a, (b), ((c)))", "f(this)", "this.f()", "this[f]()", "a[\"b\"]()", "a[0]()", "f(/a/)", "f(/a/, /b/g)",
    ] },
    { title: "new", cases: [
      "new A", "new A()", "new A(1)", "new A(1, 2)", "new a.B", "new a.B()", "new a.b.C(1)", "new (a.b)()", "new (a())", "new (a.b())", "new a()()", "new a().b", "new a().b()", "new new a",
      "new new a()", "new new a()()", "new a[0]", "new a[0]()", "new (a[0]())", "new a\n(1)", "new (function() {})", "new function() {}", "new this", "new a.b().c", "new new a.b().c",
      "new a.b.c(1)(2)", "new a(b, c)", "new a(new b)", "new a(b())", "new (a.b.c)", "new a[b].c", "new a.b[c]", "new a()[b]", "new a()[b]()", "x = new a", "f(new a, new b())", "new a().b = c",
      "new (new a())", "new (a)()", "new ((a))", "new a.b()()", "new a\n.b", "new a\n[0]", "new a\n(1)\n(2)",
    ] },
  ],
  "functions": [
    { title: "function declarations", cases: [
      "function f() {}", "function f(a) {}", "function f(a, b) {}", "function f(a, b, c) {}", "function f() { return }", "function f() { return 1 }", "function f() { return; }",
      "function f(a) { return a + 1; }", "function f() { var a; }", "function f() { function g() {} }", "function f() { return function() {} }", "function f($, _) {}", "function $() {}",
      "function f() {}\nfunction g() {}", "function f() {} f()", "function f() {}(1)", "function f() { f() }", "function f(a) { a = 1 }", "function f() { arguments }", "function f() { this }",
      "function f() { return this.a }", "function f() { return }\nf()", "function f() {};", "function f() {}\n;", "function f(a) { return function(b) { return a + b } }",
      "function f() { if (a) return 1; return 2 }", "function f() { while (a) return }", "function f() { for (;;) return }", "function f() { try { return } finally {} }", "function f() { switch (a) { case 1: return } }",
      "function f() { return\na }", "function f() { return\n}", "function f() { return\n1 + 2 }", "function f() { return\n{} }", "function f() { return\n(a) }", "function f() { return /re/ }", "function f() { return {} }",
      "function f() { return a, b }", "function f() { return a\nb }", "function f() { if (a) return; b }", "function f() { return a }\n(b)", "function f() { function g() { return } return g }",
    ] },
    { title: "function expressions", cases: [
      "(function() {})", "(function f() {})", "(function(a, b) {})", "x = function() {}", "x = function f() {}", "x = function() { return 1 }", "f(function() {})", "(function() {})()",
      "(function(a) {})(1)", "(function() {}())", "!function() {}()", "void function() {}()", "+function() {}()", "x = function() {}()", "x = function() {}.call(this)", "(function() {}).call(this)",
      "a = b || function() {}", "[function() {}]", "({f: function() {}})", "new function() {}", "function f() { return function g() { return 1 } }", "x = function() { return function() {} }",
      "(function() { function inner() {} return inner })()", "x = function() {}\n(y)", "x\n= function() {}\n(y)", "(function f(a) { return f(a) })", "(function(f) { return f })(function() {})",
      "x = function() {} / 2", "x = function() {}, y", "typeof function() {}", "(function() {}) + 1", "x = function() {}.a", "x = function() {}[0]", "a ? function() {} : function() {}",
      "function f() { (function() {})() }", "x = function let() {}", "x = function(let, yield) {}", "x = function() { return this }", "x = function() { return arguments }",
    ] },
    { title: "parameters and bodies", cases: [
      "function f(a) { return a }", "function f(a, b, c, d, e) {}", "function f(a) { var a }", "function f(a) { function a() {} }", "function f(a, a) {}", "function f() { var a = 1, b = 2; return a + b }",
      "function f() { a(); b(); c() }", "function f() { a()\nb()\nc() }", "function f() {\n  return 1\n}", "function f() { {} }", "function f() { ; }", "function f() { ;; }",
      "function f(a) { if (a) { return a } else { return f(a - 1) } }", "function f(n) { return n < 2 ? n : f(n - 1) + f(n - 2) }", "function f() { var f = 1 }", "function f(f) { return f }",
    ] },
  ],
  "statements-declarations": [
    { title: "variable declarations", cases: [
      "var a", "var a = 1", "var a, b", "var a = 1, b", "var a, b = 2", "var a = 1, b = 2, c = 3", "var a = b = c", "var a = (1, 2)", "var a = b ? c : d", "var a = function() {}", "var a = [1], b = {}",
      "var $, _", "var a;", "var a = b in c", "var a = 1\nvar b = 2", "var a\n, b", "var a =\n1", "var a\n= 1", "var a = 1, b = 2\nvar c", "var a = -1", "var a = !b", "var a = new b",
      "var a = b.c", "var a = f()", "var a = /re/g", "var a = \"s\"", "var a = null, b = true, c = false", "var a = this", "var a = a", "var let", "var yield = 1",
      "var a = function f() { return f }", "var a = {b: function() {}}", "var a = 1, b = a + 1, c = b + 1", "var a=1,b=2", "var\na\n=\n1",
    ] },
    { title: "blocks and empty statements", cases: [
      "{}", "{ }", "{ a }", "{ a; b }", "{ a; b; }", "{ { } }", "{ { a } }", ";", ";;", "; a ;", "{;}", "{ a: 1 }", "{ a: b }", "{} {}", "{}\n{}", "{ var a }", "{ function f() {} }", "{ a\nb }",
      "{ {} {} }", "{ a } { b }", "{{{}}}", "{ ; }", "{}\n;", "{} ;", "{ /a/ }", "{}\n/a/", "{} /a/", ";/a/", "{ a\n}", "{\na\n}", "{ 1 }", "{ null }",
    ] },
    { title: "if", cases: [
      "if (a) b", "if (a) b;", "if (a) b; else c", "if (a) b; else c;", "if (a) {}", "if (a) {} else {}", "if (a) { b } else { c }", "if (a) ;", "if (a) ; else ;", "if (a) b; else if (c) d; else e",
      "if (a) if (b) c; else d", "if (a) { if (b) c } else d", "if (a, b) c", "if (a = b) c", "if ((a)) b", "if (a) b\nelse c", "if (a) function f() {}", "if (a) b; else function f() {}", "while (1) function f() {}", "for (;;) function f() {}", "do function f() {} while (0)", "with (a) function f() {}", "if (a) var b = 1",
      "if (a) { } b", "if (a) {} else {} c", "if (a) {} else if (b) {} else if (c) {} else {}", "if (a) if (b) if (c) d", "if (a) b\nelse if (c) d\nelse e", "if (!a) b", "if (a && b) c", "if (a in b) c",
      "if (a) { b; c } else { d; e }", "if (a) b; c", "if (a) ; else b", "if (a) debugger", "if (a) /b/", "if (a) /b/.test(c)", "if (a) /b/; else /c/", "if (a) throw b",
    ] },
  ],
  "statements-loops": [
    { title: "while and do-while", cases: [
      "while (a) ;", "while (a) b", "while (a) b;", "while (a) {}", "while (a) { b }", "while (a) { b; c }", "while (a) while (b) c", "while (a, b) c", "while (1) { break }", "while (1) { continue }",
      "while (1) if (a) break; else continue", "do ; while (a)", "do b; while (a)", "do b; while (a);", "do {} while (a)", "do { b } while (a)", "do { b } while (a);", "do b\nwhile (a)",
      "do {} while (0)\nx", "do {} while (0); x", "do { break } while (1)", "do { continue } while (1)", "do {} while (a)\n;", "do {} while (a) ;", "while (a) /b/", "do /a/; while (b)", "while (a) {} b",
      "while (a) b\nc", "do a; while (b) ;", "do a\nwhile (b)\nc", "while (a) do b; while (c)", "do while (a) b; while (c)", "while (a) { while (b) { break } continue }", "do { do {} while (a) } while (b)",
    ] },
    { title: "for", cases: [
      "for (;;) ;", "for (;;) {}", "for (;;) break", "for (a;;) ;", "for (;a;) ;", "for (;;a) ;", "for (a; b; c) ;", "for (a; b; c) d", "for (a; b; c) { d }", "for (var i = 0; i < n; i++) ;",
      "for (var i = 0, j = n; i < j; i++, j--) ;", "for (var i;;) ;", "for (var i, j;;) ;", "for (i = 0, j = 1; ; ) ;", "for (var i = 0; ; ) { if (i) break; }", "for (;;) for (;;) ;", "for (a in b) ;", "for ((a) in b) ;", "for ((a.b) in c) ;",
      "for (a in b) c", "for (a in b) { c }", "for (var a in b) ;", "for (var a in b) c", "for (a.b in c) ;", "for (a[0] in c) ;", "for (a in b, c) ;", "for (a in b ? c : d) ;", "for ((a in b);;) ;",
      "for (var i = (a in b);;) ;", "for (var i = [a in b];;) ;", "for (var i = f(a in b);;) ;", "for (var i = {x: a in b};;) ;", "for (var f = function() { return a in b };;) ;", "for (var i = a ? b in c : d;;) ;", "for (a ? b in c : d;;) ;", "for (; a in b; c in d) ;", "for (a in b) for (c in d) ;",
      "for (var i = 0; i < 1; i++) for (var j in k) ;", "for (a\nin b) ;", "for (var a in b in c) ;", "for (;;) /b/", "for (a in /b/) ;", "for (var i = 0\n; i < n\n; i++) ;",
      "for (a in b) { break }", "for (a in b) { continue }", "for (;;) { continue }", "for (var i = 0; i < 10; ++i) {}", "for (this.a in b) ;", "for (a in this) ;",
      "for (a(); b(); c()) ;", "for (var i = f();;) ;", "for (;;) ;\nfor (;;) ;", "for (a in b) for (;;) ;", "for (;;) for (a in b) ;", "for (var i = 0; i < 1; i++)\n{}", "for (var x = 1;;) ;",
    ] },
    { title: "switch", cases: [
      "switch (a) {}", "switch (a) { case 1: }", "switch (a) { case 1: b }", "switch (a) { case 1: b; }", "switch (a) { case 1: b; break; }", "switch (a) { case 1: case 2: b }", "switch (a) { case 1: b; case 2: c }",
      "switch (a) { default: }", "switch (a) { default: b }", "switch (a) { case 1: b; default: c }", "switch (a) { default: b; case 1: c }", "switch (a) { case 1: b; default: c; case 2: d }", "switch (a) { case b + 1: c }",
      "switch (a) { case \"x\": case 'y': z }", "switch (a, b) { case c, d: e }", "switch (a) { case 1: { b } }", "switch (a) { case 1: var b }", "switch (a) { case 1: function f() {} }", "switch (a) { case 1: switch (b) { case 2: c } }",
      "function f() { switch (a) { case 1: break; case 2: return } }", "while (1) switch (a) { case 1: continue }", "switch (a) { case /b/: }", "switch (a) { case 1: b; c; d }", "switch (a) { case 1:\nb\nc }",
      "switch (a) { case 1: while (1) { break } }", "switch (a) {\n  case 1:\n    b;\n    break;\n  default:\n    c;\n}", "switch (a) { case null: case true: case this: }", "switch (f()) { case g(): h() }",
      "switch (a) { case 1: default: }", "switch (a) { default: case 1: }", "switch (a) { case 1: case 2: case 3: }", "switch (a) { case a = b: c }", "switch (a) { case (b, c): d }",
    ] },
  ],
  "statements-control": [
    { title: "labels, break and continue", cases: [
      "a: ;", "a: b", "a: {}", "a: { break a }", "a: b: c", "a: while (1) break a", "a: while (1) { break a }", "a: while (1) { continue a }",
      "a: while (1) { b: while (1) { break a } }", "a: while (1) { b: while (1) { continue a } }", "a: while (1) { b: while (1) { break b } }", "a: b: while (1) { continue a }", "a: for (;;) break a",
      "a: for (b in c) continue a", "a: do break a; while (1)", "a: switch (b) { case 1: break a }", "a: if (b) break a", "a: 1; a: 2", "a: { b: { break a } }", "while (1) { a: { break a } }",
      "a: while (1) { function f() { a: while (1) break a } }", "a: function f() {}", "while (1) { if (a) break; else continue; }", "for (;;) { for (;;) { break } continue }",
      "while (1) { switch (a) { case 1: break } b }", "a: /b/", "a: b: c: d", "a: while (1) { b: for (;;) { c: do { continue a } while (1) } }", "a: { b: { c: { break b } } }", "a: while (1) { break }",
      "a: while (1) { continue }", "while (1) { break\na }", "a: while (1) { break\na }", "a: while (1) { continue\na }", "$: 1", "\\u0061: 1", "outer: for (;;) { inner: for (;;) { continue outer } }",
      "a: while (1) { while (1) { break a } }", "a: while (1) { switch (b) { case 1: continue a } }", "a: while (1) { switch (b) { case 1: break a } }", "a: while (1) { try { break a } finally {} }",
    ] },
    { title: "throw, with, debugger", cases: [
      "throw a", "throw a;", "throw a, b", "throw new Error(\"x\")", "throw {}", "throw a ? b : c", "throw /a/", "throw a\nb", "throw a\n", "throw (a)", "throw a + b", "throw a = b", "throw typeof a", "throw function() {}",
      "with (a) b", "with (a) b;", "with (a) {}", "with (a) { b }", "with (a, b) c", "with (a) with (b) c", "with (a) /b/", "with (a.b) c", "with (a) b\nc", "with (a) { b } c", "with (a) if (b) c", "with (a) var b = 1",
      "debugger", "debugger;", "debugger\na", "{ debugger }", "while (a) debugger", "a: debugger", "debugger; debugger", "function f() { debugger }",
    ] },
    { title: "try", cases: [
      "try {} catch (e) {}", "try {} finally {}", "try {} catch (e) {} finally {}", "try { a } catch (e) { b }", "try { a } finally { b }", "try { a } catch (e) { b } finally { c }", "try {} catch (e) { throw e }",
      "try { throw a } catch (e) {}", "try {} catch (e) { try {} catch (f) {} }", "try { try {} finally {} } catch (e) {}", "try {} catch ($) {}", "try {} catch (e) { e = 1 }",
      "function f() { try { return a } finally { b } }", "while (1) { try { break } finally {} }", "try {}\ncatch (e) {}\nfinally {}", "try { a; b } catch (e) { c; d } finally { e; f }", "try {} catch (e) {} a",
      "try {} finally {} a", "try {} catch (e) {}\na", "try { try { a } catch (e) { b } } finally { c }", "try {} catch (e) { var e }", "try { var a } catch (e) {}", "try {} catch (e) { function f() {} }",
      "try {} catch (e) { throw new Error(e) }", "try {} catch (arguments) {}", "try {} catch (eval) {}", "try {\n} catch (e) {\n}",
    ] },
    { title: "expression statements", cases: [
      "a;", "\"a\"", "a()", "a = 1", "a; b", "a; b; c", "a;\nb;", "f(); g()", "a++; b--", "new a", "[a]", "function f() {} a", "a\nfunction f() {}", "a = b\nc = d", "\"a\"; \"b\"", "a.b(); c.d()", "x = y\n;z", "a\n\nb", "a\n;\nb",
    ] },
  ],
  "asi": [
    { title: "a line terminator ends a statement when the next token cannot continue it", cases: [
      "a\nb\nc", "a = 1\nb = 2", "var a\nvar b", "a()\nb()", "x\n{}", "{}\nx", "a\n{}\nb", "1\n2", "\"a\"\n\"b\"", "a\nvar b", "var a\nb",
      "function f() {}\na", "a\nif (b) c", "if (a) b\nc", "a\n;b", "a;\nb", "a\ndebugger", "a\nthrow b", "a\ntry {} catch (e) {}", "a\nwhile (b) c", "a\nfor (;;) ;", "a\nswitch (b) {}",
      "a\n++b", "a\n--b", "a\n++\nb", "a++\nb", "a--\nb", "a\n++\n\nb", "x = a\n++b", "a\n++ b", "a\n!b", "a\n~b", "a\ntypeof b", "a\nnew b", "a\n\"b\"", "a\n1",
      "x = a\n/b/i.test(c)", "a\n{ b }", "a\n;(b)", "a\nvoid b", "a\ndelete b.c", "a\nnull", "a\nthis", "a\n\\u0062",
      "a /*\n*/ b", "a //\nb", "a /* */\nb", "a\n/*\n*/\nb", "a // b\n++c", `a // c${LS}b`, `a /*${PS}*/ ++b`,
    ] },
    { title: "no insertion when the next token continues the expression", cases: [
      "a\n(b)", "a\n[b]", "a\n.b", "a\n+ b", "a +\nb", "a\n= b", "a\n? b : c", "a ?\nb\n: c", "a\n&& b", "a\n|| b", "a\n, b", "a\n/ b", "a\n/b/g", "a\n= b\n= c", "x = a\n+ b", "x = a\n(b)",
      "a\n. b", "a\n in b", "a\ninstanceof b", "a\n* b", "a\n- b", "a\n< b", "a\n== b", "a\n& b", "a\n| b", "a\n^ b", "a\n<< b", "a\n+= b",
      "a\n/= b", "a\n%= b", "a\n:\nb", "a ?\nb :\nc", "a\n[0]\n[1]", "a\n.b\n.c", "a\n\n\n+ b", "a /* c */\n+ b", "a\n// c\n+ b", "a\n(b)\n.c", "x = a\n(b)\n[c]", "a\n= b\n+ c", "a\n?\nb\n:\nc",
      "var a = b\n, c = d", "a\n= function() {}", "a\n= /b/", "a\n= [b]", "a\n= {b: c}", "a\n= new b", "a\n= typeof b", "a\n= -b", "a\n= !b", "a\n= b ? c : d",
    ] },
    { title: "restricted productions: return, break, continue, throw and postfix operators", cases: [
      "function f() { return\n/re/g }", "function f() { return\n\na }", "function f() { return // c\na }", "function f() { return\r\na }", `function f() { return${LS}a }`, "function f() { return\n[a] }", "function f() { return\n-a }",
      "while (1) { continue\nb }", "while (1) { break\n}", "while (1) { continue\n}", "a: while (1) { break /*\n*/ a }",
      "a\n--\nb", "a++\n++b", "a\n++b\n++c", "a\n\n++\n\nb", "a // c\n++b",
      "throw a /* */ + b", "throw a\n+ b", "throw a\n(b)", "throw a\n[b]", "throw a\n.b", "throw a\n, b",
    ] },
    { title: "insertion at the end of the input and before a closing brace", cases: [
      "a\n", "{ a\n}", "if (a) { b }", "f(function() { return 1 })",
      "{ a\n\n}", "{ a } b", "{ a }\nb", "function f() { a\n}", "function f() { a } b", "do a; while (b)", "do a\nwhile (b)", "do {} while (a)\nb", "do {} while (a); b", "do a; while (b)\nc",
      "if (a) { b }\nelse { c }", "if (a) b;\nelse c;", "if (a) {} else {}\nb", "switch (a) { case 1: b\ncase 2: c }", "switch (a) { case 1: b\n}", "try { a\n} catch (e) { b\n}",
      "var a = 1\n", "a = 1\n\n", "{}\n", "function f() {}\n", "a: b\n", "debugger\n", "a++\n", "a\n++b\n",
    ] },
  ],
  "regex-division": [
    { title: "a slash where an operand is expected starts a regular expression", cases: [
      "f(/a/)", "f(/a/, /b/)", "[/a/, /b/]", "({a: /b/})", "a ? /b/ : /c/", "a || /b/", "a && /b/", "a, /b/", "!/a/", "-/a/", "+/a/", "typeof /a/", "void /a/", "delete /a/.x", "~/a/",
      "x = a ? /b/ : c", "function f() { return /a/ }", "function f() { return /a/.test(b) }", "throw /a/", "switch (a) { case /b/: }", "if (a) /b/", "if (a) /b/.test(c)", "if (a) /b/; else /c/", "while (a) /b/",
      "for (;;) /b/", "for (a in /b/) ;", "with (a) /b/", "do /a/; while (b)", "a: /b/", "{}\n/a/", "{} /a/", "{ /a/ }", ";/a/", "/a/ / /b/", "/a/.test(b) / 2", "/=/.test(x)",
      "a /= 2", "a /= b / c", "f(/=/)", "[/=/]", "a = b;\n/c/.test(d)", "a in /b/", "a instanceof /b/", "a = b ? c : /d/",
      "x = {};\n/a/g", "a ? b : c ? /d/ : /e/", "function f() { return\n/a/ }", "(/a/)", "(/a/).test(b)", "new /a/", "new /a/.constructor",
      "a = /b/ / c", "/a/ / b / c", "x = /a/ / /b/ / /c/", "/a/\n/ b", "f();\n/a/g", "a++;\n/b/", "/\\/[/]\\//", "function f() {} /a/", "{a: {} /b/}", "a: {} /b/", "do {} while (a)\n/b/", "if (a) {} /b/", "function f() {}\n/a/g",
    ] },
    { title: "a slash where an operator is expected is division", cases: [
      "a / b / c", "a /b/ c", "1 / 2", "a() / b", "a[0] / b", "a.b / c", "(a) / b", "a++ / b", "a-- / b", "\"a\" / b", "/a/ / b", "this / a", "null / a", "true / a", "x = function() {} / a", "x = {} / a",
      "[] / a", "a /b/g", "a / /b/", "a /= b", "f() /b/ c", "a\n/ b\n/ c", "1 /2/ 3", "+{} / 2", "a /*x*/ / b",
      "a / /*x*/ b", "a // x\n/ b", "a\n/ /b/", "a.b.c / d.e.f", "a[b] / c[d]", "a(b) / c(d)", "new a / b", "new a() / b", "a-- / --b", "a++ / ++b", "a / -b", "a / +b", "a / !b", "a / typeof b", "a / /b/g / c",
      "a /b/ c /d/ e", "1 / 2 / 3 / 4", "a.in / b / c", "a.void / b", "a.if / b", "yield /a/g", "let /a/g", "of / a", "x = a ? b : {} / c", "({a: {} / 1})", "x = {a: 1} / 2", "(function() {}) / 2", "x = function() {}\n/ 2", "a\n/= b\n/= c", "(a + b) / (c + d)", "a / (b / c)", "(a / b) / c", "a % b / c", "a / b % c", "a * b / c", "a / b * c", "a /\nb", "a\n/\nb",
    ] },
  ],
};

// Realistic programs: multi-line, mixed features. Sources are written as they
// would be found in a file; the AST is whatever acorn says. Split in two files
// so each stays under the harness's read limit.
const PROGRAMS_A: Group[] = [
  { title: "programs", cases: [
    "function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\nfib(10);",
    "function factorial(n) {\n  var result = 1;\n  for (var i = 2; i <= n; i++) {\n    result *= i;\n  }\n  return result;\n}",
    "var sum = 0;\nfor (var i = 0; i < arr.length; i++) {\n  if (arr[i] % 2 === 0) continue;\n  sum += arr[i];\n}",
    "function Point(x, y) {\n  this.x = x;\n  this.y = y;\n}\nPoint.prototype.dist = function () {\n  return Math.sqrt(this.x * this.x + this.y * this.y);\n};\nvar p = new Point(3, 4);",
    "var counter = (function () {\n  var count = 0;\n  return {\n    inc: function () { return ++count; },\n    dec: function () { return --count; },\n    get value() { return count; }\n  };\n})();",
    "var module = (function (exports) {\n  'use strict';\n  var privateVar = 42;\n  function helper(x) { return x * 2; }\n  exports.publicFn = function (y) { return helper(y) + privateVar; };\n  return exports;\n})({});",
    "try {\n  riskyOperation();\n} catch (err) {\n  if (err instanceof TypeError) {\n    handleTypeError(err);\n  } else {\n    throw err;\n  }\n} finally {\n  cleanup();\n}",
    "function classify(x) {\n  switch (typeof x) {\n    case 'number':\n      return x !== x ? 'nan' : 'number';\n    case 'string':\n    case 'boolean':\n      return typeof x;\n    default:\n      return x === null ? 'null' : 'object';\n  }\n}",
    "outer:\nfor (var i = 0; i < 10; i++) {\n  for (var j = 0; j < 10; j++) {\n    if (j === 5) continue outer;\n    if (i * j > 20) break outer;\n  }\n}",
    "function reverse(s) {\n  var out = '';\n  var i = s.length;\n  while (i--) out += s.charAt(i);\n  return out;\n}",
    "var config = {\n  name: \"app\",\n  version: 1.2,\n  debug: false,\n  paths: [\"src\", \"lib\"],\n  server: { host: \"localhost\", port: 8080, \"use-tls\": true },\n  onError: null\n};",
    "element.addEventListener('click', function (event) {\n  event.preventDefault();\n  var target = event.target || event.srcElement;\n  while (target && target.nodeName !== 'A') target = target.parentNode;\n  if (target) navigate(target.href);\n}, false);",
    "function sumAll() {\n  var total = 0;\n  for (var i = 0, n = arguments.length; i < n; i++) total += arguments[i];\n  return total;\n}",
  ] },
];

const PROGRAMS_B: Group[] = [
  { title: "programs", cases: [
    "var Animal = function (name) { this.name = name; };\nAnimal.prototype.speak = function () { return this.name + ' makes a sound'; };\nvar Dog = function (name) { Animal.call(this, name); };\nDog.prototype = Object.create(Animal.prototype);\nDog.prototype.constructor = Dog;\nDog.prototype.speak = function () { return Animal.prototype.speak.call(this) + ': woof'; };",
    "function tokenize(input) {\n  var tokens = [], i = 0, ch;\n  while (i < input.length) {\n    ch = input.charAt(i);\n    if (ch === ' ') { i++; continue; }\n    if (/[0-9]/.test(ch)) {\n      var start = i;\n      while (i < input.length && /[0-9]/.test(input.charAt(i))) i++;\n      tokens.push({ type: 'num', value: +input.slice(start, i) });\n    } else {\n      tokens.push({ type: 'op', value: ch });\n      i++;\n    }\n  }\n  return tokens;\n}",
    "for (var key in obj) {\n  if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;\n  result[key] = typeof obj[key] === 'object' && obj[key] !== null ? clone(obj[key]) : obj[key];\n}",
    "// Compute the greatest common divisor.\n/* Uses Euclid's algorithm. */\nfunction gcd(a, b) {\n  while (b !== 0) { // loop until remainder is zero\n    var t = b;\n    b = a % b;\n    a = t;\n  }\n  return a; /* done */\n}",
    "var x = 1\nvar y = 2\nfunction add(a, b) {\n  return a + b\n}\nvar z = add(x, y)\nz++\nif (z > 3) {\n  z = 0\n} else {\n  z = -z\n}",
    "var isValid = /^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i.test(email) && email.length < 255;\nvar ratio = total / count / 2;\nvar re = ok ? /yes/ : /no/;",
    "function debounce(fn, wait) {\n  var timer = null;\n  return function () {\n    var ctx = this, args = arguments;\n    if (timer) clearTimeout(timer);\n    timer = setTimeout(function () {\n      timer = null;\n      fn.apply(ctx, args);\n    }, wait);\n  };\n}",
    "var queue = [];\nfunction enqueue(item) { queue.push(item); }\nfunction dequeue() { return queue.length ? queue.shift() : undefined; }\nfunction drain(handler) {\n  var item;\n  while ((item = dequeue()) !== undefined) {\n    try { handler(item); } catch (e) { report(e); }\n  }\n}",
    "with (Math) {\n  var r = sqrt(pow(x, 2) + pow(y, 2));\n}\ndebugger;\nlabel: {\n  if (r > 10) break label;\n  r = 10;\n}",
    "var obj = {\n  'quoted-key': 1,\n  2: 'two',\n  get computed() { return this['quoted-key'] + this[2].length; },\n  set computed(v) { this['quoted-key'] = v; },\n  nested: { deep: { deeper: [1, [2, [3]]] } }\n};\ndelete obj[2];\nvoid obj.nested;",
    "if (typeof define === 'function' && define.amd) {\n  define([], factory);\n} else if (typeof module === 'object' && module.exports) {\n  module.exports = factory();\n} else {\n  root.lib = factory();\n}",
    "function memoize(fn) {\n  var cache = {};\n  return function (key) {\n    if (key in cache) return cache[key];\n    return cache[key] = fn(key);\n  };\n}\nvar slowSquare = function (n) { return n * n; };\nvar fastSquare = memoize(slowSquare);\nfastSquare(4), fastSquare(4);",
  ] },
];

const ERRORS: Record<string, ErrorGroup[]> = {
  "errors-lexical": [
    { title: "unterminated and malformed tokens", cases: [
      "\"abc", "'abc", "\"a\nb\"", `'a${LS}b'`, `"a${PS}b"`, "\"a\rb\"", "/* c", "a /*/ b", "/a", "/a\nb/", "/[a/", "\"\\x4\"", "\"\\xg1\"", "\"\\u12\"", "\"\\u{41}\"", "\"\\u\"", "\"\\x\"", "0x", "0xg", "1e", "1e+", "1.2.3",
      "1.toString()", "3in x", ".", "..", "@", "#", "\\", "a\\u", "\\u0020", "\\u0031a", "\\u{61}", "a\\u00", "a\\u00zz", "\\u", "`", "01.5", "0x1.5", "1ea", "1a", "1$", "0x1g", "1e1e1", "a\u200bb", "a\u180eb", "\ud835\udc65", "a\ud835\udc65", "…", "»",
    ] },
    { title: "regular expression flags", cases: [
      "/a/x", "/a/gg", "/a/ii", "/a/mm", "/a/G", "/a/g1", "/a/s", "/a/u", "/a/y", "/a/d", "/a/v", "/a/gimg", "/a/_", "x = /a/z", "f(/a/gx)", "/a/\\u0067", "/a\\\nb/", `/a${LS}b/`,
    ] },
    { title: "misplaced line terminators and white space", cases: [
      "throw\na", "throw\n\na", "throw /*\n*/ a", `throw${LS}a`, "a\n++", "x = a++\n/b/", "x = a\n++/b/", "x = a\n/b/", "x = {}\n/a/", "if (a)\nelse b", "for (a\nb\nc) ;", "for (a\nb;) ;", "a ++b", "a\n++ ++b",
      "do {} while (0) x", "do a; while (b) c", "do a while (b)", "do {} while (a) /b/", "{a: {} / 1}", "a\n++\n", "x = {} /a/", "a\n/b/", "/a/\n/b/", "x = a\n/b/g\n/c/", "(a\n++b)", "f(a\n++b)", "function f() { return\n} a b", "a b", "a\tb", `a${NBSP}b`, "1 2", "\"a\" \"b\"", "a /* */ b", "a /**/ b",
    ] },
  ],
  "errors-syntax": [
    { title: "ES2015 and later syntax is not ES5", modern: true, cases: [
      "let x = 1", "const x = 1", "class A {}", "class A extends B {}", "x => x", "(a, b) => a + b", "() => {}", "`template`", "`a${b}c`", "function* g() {}", "async function f() {}", "[a, b] = c", "({a} = c)",
      "({a})", "({a, b})", "({a() {}})", "({[a]: 1})", "({get [a]() {}})", "f(...a)", "[...a]", "function f(a = 1) {}", "function f(...a) {}", "function f({a}) {}", "function f([a]) {}", "for (x of y) ;", "for (var x of y) ;",
      "a ** b", "a **= b", "a ?? b", "a?.b", "a?.[0]", "a?.()", "a &&= b", "a ||= b", "a ??= b", "0b1", "0o7", "0B1", "0O7", "1_000", "1n", "\"\\u{41}\"", "'\\u{1F600}'", "import x from \"y\"", "import \"y\"", "export var a",
      "export default 1", "export {}", "function f() { new.target }", "f(a,)", "try {} catch {}", "let {a} = b", "var {a} = b", "var [a] = b", "for (let i = 0;;) ;", "for (const x in y) ;", "for (let x of y) ;",
      "x = { ...a }", "async () => {}", "x = y => 1", "class A { m() {} }", "class A { static m() {} }", "class A { get x() {} }", "x = class {}",
      "({ async f() {} })", "({ *g() {} })", "({ get [x]() {} })", "if (a) { let b }", "{ const a = 1 }", "function f() { let a }", "var a = () => 1", "var f = function* () {}", "var f = async function () {}",
      "a = b => c", "(a || b) ?? c", "\"use strict\"; let x", "for (a of b) c", "for (var [a] in b) ;", "for ({a} in b) ;", "for ([a] in b) ;", "for ([a] of b) ;", "for (const a = 1;;) break",
    ] },
    { title: "reserved words are not identifiers", cases: [
      "class", "var class", "class = 1", "enum", "var enum", "enum = 1", "const", "var const", "export = 1", "import = 1", "extends", "var extends", "super", "var super", "super = 1", "var if", "var for", "var function",
      "var new", "var this", "var null", "var true", "var false", "var typeof", "var void", "var delete", "var in", "var instanceof", "var do", "var while", "var with", "var switch", "var case", "var default", "var break",
      "var continue", "var return", "var throw", "var try", "var catch", "var finally", "var debugger", "var else", "var var", "function if() {}", "function class() {}", "function f(class) {}", "function f(if) {}",
      "a.b = class", "if = 1", "typeof = 1", "new = 1", "a: class", "class: 1", "enum: 1", "if: 1", "for: 1", "x = function class() {}", "x = function(enum) {}",
      "try {} catch (class) {}", "try {} catch (if) {}", "for (class in a) ;", "for (var enum in a) ;", "a = {b: class}", "f(class)", "f(enum)", "new class", "typeof class", "delete enum", "[enum]", "(super)", "this++", "null++",
      "var import", "var export", "import.a", "export.a", "class.a", "enum.a", "super.a", "const.a", "extends.a",
    ] },
    { title: "malformed expressions", cases: [
      "a +", "+", "a b c", "(a", "a)", "(", ")", "[", "]", "{", "}", "a[", "a.", "a..b", ".a", "a ? b", "a ? b :", "? a", "a =", "= a", "a += ", "f(", "f(a", "f(,)", "f(,a)", "({a: 1, b})",
      "({a 1})", "({a: })", "({: 1})", "({1})", "({a: 1 b: 2})", "[1 2]", "new", "new )", "a.1", "a.+", "a.if.", "typeof", "void", "delete", "!", "~", "a in", "in a", "a instanceof", "instanceof a", "a ==", "== a",
      "a &&", "|| a", "a,", ", a", "a, , b", "(a, )", "(a,)", "()", "(())", "x = ()", "f(()", "a =>", "* a", "a / ", "a *", "a %", "a <<", "a >>>", "a &", "a |", "a ^", "a <", "a >=", "a ===", "a !==",
      "a ? : b", "a ?: b", "a[]", "a[b", "a[b c]", "a(b c)", "a(b,,c)", "new a(", "new a(b", "new a(b,)", "{a: 1, b: 2}", "{ a: 1, b: 2 }", "[a b]", "[,a b]", "({a: 1,,})", "({,})", "({a,})", "({a: 1, , b: 2})",
      "a.b.", "a[b].", "f().", "a . . b", "a - - - ", "a ++ ++", "typeof typeof", "void void", "delete delete", "a ? b ? c : d", "a ? b : c ? d", "((a)", "(a))", "[[a]", "[a]]", "{{}", "{}}", "({}", "({)}",
      "a = b = ", "a += b +=", "1 +", "\"a\" +", "/a/ +", "null +", "this +", "a.b +", "a[b] +", "f() +", "new a +", "-", "-a -", "a - -", "a--- -", "a++ ++", "++", "--", "++ a ++", "typeof ++",
    ] },
    { title: "invalid assignment and update targets", cases: [
      "1 = 2", "\"a\" = b", "a + b = c", "a() = 1", "f() = 1", "new a = 1", "-a = 1", "!a = 1", "typeof a = 1", "a++ = 1", "++a = 1", "(a, b) = 1", "(a ? b : c) = 1", "a = b = 1 = 2", "this = 1", "null = 1", "1++",
      "++1", "\"a\"++", "a()++", "++a()", "a++++", "(a++)++", "++a++", "++(a++)", "1 += 2", "a.b() += 1", "(a + b)++", "++(a + b)", "for (1 in a) ;", "for (a() in b) ;", "for (a + b in c) ;", "for ((a, b) in c) ;",
      "for (a = 1 in b) ;", "for (a, b in c) ;", "for (var a = 1 in b) ;", "for (var a = b in c) ;", "for (var a, b in c) ;", "for (new a in b) ;", "for (-a in b) ;", "for (a++ in b) ;", "for (this in a) ;", "for (null in a) ;",
      "for (\"a\" in b) ;", "for (var i = a ? b : c in d;;) ;", "for (;;) 1 = 2", "true = 1", "false = 1", "/a/ = 1", "[] = 1", "({}) = 1", "(1) = 2", "((a, b)) = 1", "a = (1) = 2", "(a = b) = c", "(a || b) = c",
      "(a && b) = c", "(a + b) = c", "(-a) = b", "(a++) = b", "(typeof a) = b", "(void 0) = a", "(a ? b : c)++", "(a || b)++", "(a, b)++", "--(a, b)", "--1", "--\"a\"", "--a()", "--new a", "--(a + b)", "a = 1 = b", "a += 1 += b",
      "(a).b() = 1", "a[b]() = 1", "new a() = 1", "new a.b() = 1", "delete a = 1", "void a = 1", "a in b = c", "a instanceof b = c", "a == b = c", "a && b = c", "a || b = c", "a ? b : c = d = e = 1 = 2",
    ] },
    { title: "object literals: accessor arity and conflicting definitions", cases: [
      "({get a(x) {}})", "({get a(x, y) {}})", "({set a() {}})", "({set a(x, y) {}})", "({get a() {}, get a() {}})", "({set a(v) {}, set a(v) {}})", "({get a() {}, a: 1})", "({a: 1, get a() {}})",
      "({set a(v) {}, a: 1})", "({a: 1, set a(v) {}})", "({get a() {}, set a(v) {}, a: 1})", "({get a {}})", "({get a() })", "({get \"a\" {}})", "({get 1 {}})", "({get a()})", "({set a(v)})", "({get() {}})",
      "({set(v) {}})", "({get a() {}, get \"a\"() {}})", "({\"a\": 1, get a() {}})", "({1: 1, get 1() {}})", "({\"1\": 1, get 1() {}})", "({0x1: 1, get 1() {}})", "({1.0: 1, get 1() {}})", "({get a() {}, set a(v) {}, get a() {}})", "({get a() {} b: 1})", "({get a(), b: 1})", "({get a: 1})", "({set a: 1})", "({get a})", "({set a})",
    ] },
  ],
  "errors-statements": [
    { title: "statements with missing or misplaced pieces", cases: [
      "if a b", "if (a", "if (a)", "if (a) else b", "if (a) b else c", "else b", "if () a", "if (a) {} else", "if (a) else", "while a b", "while (a)", "while ()", "while (a", "do {} while a", "do {}",
      "do {} while", "do {} while (", "do {} while ()", "do", "for (;;", "for (;) ;", "for () ;", "for (a; b) ;", "for (a; b; c; d) ;", "for (a in) ;", "for (in a) ;", "for (a in b", "for (a in b) ", "for (;;)", "for",
      "for (var;;) ;", "for (var a b;;) ;", "switch a {}", "switch (a)", "switch (a) { b }", "switch (a) { case 1 }", "switch (a) { case: b }", "switch (a) { default: a; default: b }", "switch (a) { case 1: default }",
      "switch (a) case 1: b", "switch (a) { case 1: b", "switch (a) { case 1: case }", "switch (a) { default b }", "switch (a) { default: default: }", "switch (a) { case 1: default: case 2: default: }", "switch () {}",
      "switch (a) { case 1: b: }", "switch (a) { case 1: break; default: continue }", "try", "try {}", "try {} catch", "try {} catch ()", "try {} catch (e)", "try {} catch (e.x) {}", "try {} catch (1) {}",
      "try {} catch (\"e\") {}", "try {} catch (e, f) {}", "try {} catch (e) {} catch (f) {}", "try {} finally", "try a catch (e) {}", "try {} catch (e) b", "try {} finally b", "catch (e) {}", "finally {}",
      "try {} catch (e) {} finally", "try {} finally {} catch (e) {}", "throw", "throw;", "throw }", "with a b", "with (a)", "with () a", "with (a", "with", "var", "var 1", "var a b", "var a = ", "var a =, b", "var a, ",
      "var a, ,b", "var a = 1 var b", "var a = 1 b", "var a.b", "var a[0]", "var (a)", "var a = 1,", "var ,a", "var a b = 1", "debugger a", "debugger x", "debugger 1", "label:", "a: ", "a:: b", ": b", "{ a: 1, b: 2 }",
      "return", "return 1", "return;", "function f() { return } return", "if (a) return", "while (a) return", "{ return }", "a: return", "switch (a) { case 1: return }", "function() {}", "function f", "function f(",
      "function f()", "function f() {", "function f(a b) {}", "function f(a,) {}", "function f(,a) {}", "function f(1) {}", "function f(a.b) {}", "function f() {}}", "function (a) {}", "x = function f {}", "x = function (a {}",
      "function f(a, 1) {}", "function", "function f {}", "function f() }", "function f( {}", "function f(\"a\") {}", "x = function() {", "x = function(", "x = function", "(function", "(function() {}", "(function() {})(",
      "(function f(a b) {})", "!function() {", "new function() {", "if (a) function", "a: function", "while (1) function f", "a: a: b", "a: { a: b }", "a: while (1) { a: while (1) ; }", "a: b: a: c", "a: { b: { a: c } }",
    ] },
    { title: "break, continue and labels out of place", cases: [
      "break", "break a", "continue", "continue a", "if (a) break", "if (a) continue", "a: b: continue a", "a: { continue a }", "a: continue a", "a: if (b) continue a", "while (1) { continue a }", "while (1) { break a }",
      "a: while (1) { function f() { break a } }", "a: while (1) { function f() { continue a } }", "while (1) { x = function() { break } }", "switch (a) { case 1: continue }", "a: switch (b) { case 1: continue a }", "x: if (a) continue x", "while (1) function f() { break }",
      "{ break }", "try { break } finally {}", "function f() { break }", "function f() { continue }", "function f() { a: { continue a } }", "while (1) { function f() { continue } }", "a: { break b }",
      "while (1) { break\na; break b }", "a: while (1) { } break a", "a: while (1) { }\nbreak a", "a: { } continue a", "for (;;) ; break", "for (;;) ; continue", "do ; while (a) break", "a: ; break a", "a: b; break a", "break;", "continue;",
      "a: while (1) { b: { continue b } }", "a: { b: while (1) { continue a } }", "switch (a) { case 1: a: continue a }", "a: switch (b) { case 1: while (1) { continue a } }", "while (1) { a: switch (b) { case 1: continue a } }",
      "with (a) break", "with (a) continue", "if (a) { break }", "{ { break } }", "a: { { continue a } }", "while (1) { function f() { break a } }", "a: while (1) { (function() { break a })() }", "a: while (1) { x = function() { continue a } }",
    ] },
  ],
};

// ---------------------------------------------------------------------------
// Rendering expected values as TypeScript source
// ---------------------------------------------------------------------------

const WIDTH = 220;
/** The harness truncates any file it reads for the agent beyond this many characters. */
const READ_LIMIT = 80_000;

function str(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function num(value: number): string {
  if (Number.isNaN(value)) throw new Error("NaN cannot occur in an AST");
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

/** Renders `value` as one line of TS source. */
function flat(value: unknown): string {
  if (value instanceof RegExpSpec) return `new RegExp(${str(value.pattern)}, ${str(value.flags)})`;
  if (value === null) return "null";
  if (typeof value === "string") return str(value);
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof RegExp) return `new RegExp(${str(value.source)}, ${str(value.flags)})`;
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${flat(regexValue(value as Record<string, unknown>, k, v))}`);
    return `{${entries.join(", ")}}`;
  }
  throw new Error(`cannot render ${typeof value}`);
}

/**
 * A regex Literal's `value` is a RegExp built from `regex.pattern`/`flags`;
 * render it from those so the emitted constructor call is the one the spec
 * names, not V8's re-escaped `source`.
 */
function regexValue(parent: Record<string, unknown>, key: string, value: unknown): unknown {
  if (key === "value" && value instanceof RegExp) {
    const regex = parent["regex"] as { pattern: string; flags: string } | undefined;
    if (!regex) throw new Error("RegExp value without a regex field");
    return new RegExpSpec(regex.pattern, regex.flags);
  }
  return value;
}

class RegExpSpec {
  pattern: string;
  flags: string;
  constructor(pattern: string, flags: string) {
    this.pattern = pattern;
    this.flags = flags;
  }
}

/** Renders `value` across lines at `indent` when it does not fit in one. */
function pretty(value: unknown, indent: number): string {
  if (value instanceof RegExpSpec) return `new RegExp(${str(value.pattern)}, ${str(value.flags)})`;
  const one = flatSpec(value);
  if (one.length + indent <= WIDTH) return one;
  const pad = " ".repeat(indent + 2);
  const close = " ".repeat(indent);
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => pad + pretty(v, indent + 2)).join(",\n")},\n${close}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const lines = Object.entries(record).map(([k, v]) => `${pad}${k}: ${pretty(regexValue(record, k, v), indent + 2)}`);
    return `{\n${lines.join(",\n")},\n${close}}`;
  }
  return one;
}

function flatSpec(value: unknown): string {
  if (value instanceof RegExpSpec) return `new RegExp(${str(value.pattern)}, ${str(value.flags)})`;
  return flat(value);
}

type Program = { type: "Program"; body: unknown[]; sourceType: string };

/** `expression(x)` for a lone expression statement, `program(...)` otherwise. */
function renderExpected(ast: unknown, indent: number): string {
  const program = ast as Program;
  if (program.type !== "Program" || program.sourceType !== "script") throw new Error("oracle returned something other than a script Program");
  const body = program.body as Array<Record<string, unknown>>;
  if (body.length === 1 && body[0].type === "ExpressionStatement" && !("directive" in body[0])) {
    const inner = pretty(body[0].expression, indent);
    return `expression(${inner})`;
  }
  if (body.length === 0) return "program()";
  const one = `program(${body.map(flatSpec).join(", ")})`;
  if (one.length + indent <= WIDTH) return one;
  if (body.length === 1) return `program(${pretty(body[0], indent)})`;
  const pad = " ".repeat(indent + 2);
  return `program(\n${body.map((s) => pad + pretty(s, indent + 2)).join(",\n")},\n${" ".repeat(indent)})`;
}

function renderSource(source: string): string {
  return str(source);
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const HEADER = `// Generated by generate.ts from acorn ${ACORN_VERSION} at ecmaVersion 5; do not edit by hand.\n`;

const HELPERS = `/** A Program whose body is the given statements. */
const program = (...body: unknown[]) => ({ type: "Program", body, sourceType: "script" });
/** A Program whose only statement is an ExpressionStatement of the given expression. */
const expression = (expression: unknown) => program({ type: "ExpressionStatement", expression });

function show(value: unknown): string {
  const text = value instanceof RegExp ? String(value) : JSON.stringify(value, (_, v) => (v instanceof RegExp ? String(v) : v));
  return text === undefined ? "undefined" : text.length > 160 ? text.slice(0, 160) + "..." : text;
}

/** Where \`actual\` first departs from \`expected\`, as a path and a pair of values, for the failure message. */
function firstDifference(actual: unknown, expected: unknown, path = "program"): string | null {
  if (expected instanceof RegExp || actual instanceof RegExp) {
    const same = actual instanceof RegExp && expected instanceof RegExp && actual.source === expected.source && actual.flags === expected.flags;
    return same ? null : \`\${path}: expected \${show(expected)}, got \${show(actual)}\`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return \`\${path}: expected an array, got \${show(actual)}\`;
    if (actual.length !== expected.length) return \`\${path}: expected \${expected.length} elements, got \${actual.length}: \${show(actual)}\`;
    for (let i = 0; i < expected.length; i++) {
      const d = firstDifference(actual[i], expected[i], \`\${path}[\${i}]\`);
      if (d) return d;
    }
    return null;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return \`\${path}: expected \${show(expected)}, got \${show(actual)}\`;
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!(key in a) || a[key] === undefined) return \`\${path}: missing field "\${key}" (expected \${show(e[key])})\`;
    for (const key of Object.keys(a)) if (!(key in e) && a[key] !== undefined) return \`\${path}: unexpected field "\${key}" = \${show(a[key])}\`;
    for (const key of Object.keys(e)) {
      const d = firstDifference(a[key], e[key], \`\${path}.\${key}\`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : \`\${path}: expected \${show(expected)}, got \${show(actual)}\`;
}
`;

const seen = new Map<string, Set<string>>();
const duplicates: string[] = []; // and every other case problem, reported together
let crossFileRepeats = 0;

/**
 * The same source may legitimately appear under two features in two files
 * (`if (a) /b/` is both an if-statement and a regex-context case); it is
 * counted and reported. Within one file it is a mistake.
 */
function noteSource(source: string, file: string): void {
  const files = seen.get(source) ?? new Set<string>();
  if (files.has(file)) duplicates.push(`${JSON.stringify(source)} listed twice in ${file}`);
  else if (files.size > 0) crossFileRepeats++;
  files.add(file);
  seen.set(source, files);
  // `-->` is an HTML close-comment when it starts a line — or follows a
  // multi-line comment that contains a line terminator, which acorn treats
  // the same way; `a-->b` mid-line is `(a--) > b` and fine.
  if (source.includes("<!--") || /(^|[\r\n\u2028\u2029]|\*\/)[^\S\r\n\u2028\u2029]*-->/.test(source)) {
    duplicates.push(`HTML-like comment in ${JSON.stringify(source)}: that zone is unspecified`);
  }
}

function checkStrictParity(source: string): void {
  if (!source.includes("use strict")) return;
  const relaxed = source.split("use strict").join("use  strict");
  const a = oracle(source).ok;
  const b = oracle(relaxed).ok;
  if (a !== b) duplicates.push(`strict mode decides ${JSON.stringify(source)}; the suite must not depend on it`);
}

/**
 * `%j` in a test title leaves characters above U+007E raw, so a source with
 * an NBSP, a BOM or a line separator would be invisible in the failure list.
 * Such cases get their own `it` with an explicitly escaped title.
 */
function needsExplicitTitle(source: string): boolean {
  return /[\u007f-\uffff]/.test(source);
}

const ASSERT = `    const actual = parse(source);
    expect(actual, firstDifference(actual, expected) ?? "").toEqual(expected);`;

function emitValidFile(name: string, groups: Group[]): string {
  const lines = [HEADER, 'import { describe, expect, it } from "vitest";', `import { parse } from "${PACKAGE}";`, "", HELPERS];
  for (const group of groups) {
    lines.push(`describe(${str(group.title)}, () => {`);
    lines.push("  const cases: Array<[string, unknown]> = [");
    const explicit: string[] = [];
    for (const source of group.cases) {
      noteSource(source, name);
      checkStrictParity(source);
      const result = oracle(source);
      if (!result.ok) {
        duplicates.push(`${name}: acorn rejects ${JSON.stringify(source)}: ${result.message}`);
        continue;
      }
      const src = renderSource(source);
      if (needsExplicitTitle(source)) {
        const title = str(`parse(${str(source)})`);
        explicit.push(`  it(${title}, () => {`, `    const source = ${src};`, `    const expected = ${renderExpected(result.ast, 4)};`, ASSERT, "  });");
        continue;
      }
      const expected = renderExpected(result.ast, 4);
      const one = `    [${src}, ${expected}],`;
      if (one.length <= WIDTH) lines.push(one);
      else lines.push(`    [${src},`, `      ${renderExpected(result.ast, 6)}],`);
    }
    lines.push("  ];");
    lines.push('  it.each(cases)("parse(%j)", (source, expected) => {');
    lines.push(ASSERT);
    lines.push("  });");
    lines.push(...explicit);
    lines.push("});");
    lines.push("");
  }
  return lines.join("\n");
}

function emitErrorFile(name: string, groups: ErrorGroup[]): string {
  const lines = [HEADER, 'import { describe, expect, it } from "vitest";', `import { parse } from "${PACKAGE}";`, ""];
  for (const group of groups) {
    lines.push(`describe(${str(group.title)}, () => {`);
    lines.push("  const cases: string[] = [");
    const explicit: string[] = [];
    for (const source of group.cases) {
      noteSource(source, name);
      checkStrictParity(source);
      const result = oracle(source);
      if (result.ok) duplicates.push(`${name}: acorn accepts ${JSON.stringify(source)}, which is listed as an error`);
      if (group.modern && !parsesAtLatest(source)) duplicates.push(`${name}: ${JSON.stringify(source)} is not valid at acorn's latest ecmaVersion either`);
      if (needsExplicitTitle(source)) {
        explicit.push(`  it(${str(`parse(${str(source)}) throws SyntaxError`)}, () => {`, `    expect(() => parse(${renderSource(source)})).toThrow(SyntaxError);`, "  });");
        continue;
      }
      lines.push(`    ${renderSource(source)},`);
    }
    lines.push("  ];");
    lines.push('  it.each(cases)("parse(%j) throws SyntaxError", (source) => {');
    lines.push("    expect(() => parse(source)).toThrow(SyntaxError);");
    lines.push("  });");
    lines.push(...explicit);
    lines.push("});");
    lines.push("");
  }
  return lines.join("\n");
}

function generate(): { files: Record<string, string>; valid: number; errors: number; repeats: number } {
  seen.clear();
  duplicates.length = 0;
  crossFileRepeats = 0;
  const files: Record<string, string> = {};
  let valid = 0;
  let errors = 0;
  for (const [name, groups] of Object.entries(VALID)) {
    files[`${name}.test.ts`] = emitValidFile(name, groups);
    valid += groups.reduce((n, g) => n + g.cases.length, 0);
  }
  files["programs-a.test.ts"] = emitValidFile("programs-a", PROGRAMS_A);
  files["programs-b.test.ts"] = emitValidFile("programs-b", PROGRAMS_B);
  valid += PROGRAMS_A.reduce((n, g) => n + g.cases.length, 0) + PROGRAMS_B.reduce((n, g) => n + g.cases.length, 0);
  for (const [name, groups] of Object.entries(ERRORS)) {
    files[`${name}.test.ts`] = emitErrorFile(name, groups);
    errors += groups.reduce((n, g) => n + g.cases.length, 0);
  }
  if (duplicates.length) throw new Error(`case problems:\n  ${duplicates.join("\n  ")}`);
  return { files, valid, errors, repeats: crossFileRepeats };
}

function main(argv: string[]): number {
  const { files, valid, errors, repeats } = generate();
  const total = valid + errors;
  const unique = total - repeats;
  const largest = Math.max(...Object.values(files).map((f) => f.length));
  const oversized = Object.entries(files).filter(([, f]) => f.length > READ_LIMIT).map(([n]) => n);
  if (oversized.length) throw new Error(`over the harness read limit (${READ_LIMIT} chars): ${oversized.join(", ")} — split the file`);
  if (argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([name, content]) => !fs.existsSync(path.join(OUT, name)) || fs.readFileSync(path.join(OUT, name), "utf8") !== content)
      .map(([name]) => name);
    const strays = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((n) => n.endsWith(".test.ts") && !(n in files)) : [];
    const problems = [...stale, ...strays.map((s) => `${s} (stray)`)];
    console.log(`${total} cases (${valid} valid, ${errors} errors, ${unique} distinct sources); ${problems.length ? "STALE: " + problems.join(", ") : "up to date"}`);
    return problems.length ? 1 : 0;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const stray of fs.readdirSync(OUT)) {
    if (stray.endsWith(".test.ts") && !(stray in files)) fs.unlinkSync(path.join(OUT, stray));
  }
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote ${Object.keys(files).length} files, ${total} cases (${valid} valid, ${errors} errors, ${unique} distinct sources), largest file ${largest} chars, oracle: acorn ${ACORN_VERSION}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
