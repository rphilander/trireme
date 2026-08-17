#!/usr/bin/env node
/**
 * Generates es5-evaluator's acceptance suite.
 *
 * A test program is written as ES5 *source*. From it we produce two things:
 *   - the INPUT: acorn's ESTree tree for the program (`ecmaVersion: 5`, script,
 *     positions removed), embedded in the test as a literal — the evaluator
 *     takes a tree, never source;
 *   - the EXPECTED: what the program observably does, taken from Node's own
 *     evaluator (`vm.runInNewContext`) — the lines it `print`s and the name of
 *     any exception that escapes to the top.
 *
 * Cases are authored; neither the tree nor the result is. Re-running must
 * reproduce acceptance/ byte for byte.
 *
 *     node bench/es5-evaluator/generate.ts            # regenerate
 *     node bench/es5-evaluator/generate.ts --check    # verify acceptance/ is up to date
 *
 * The observable contract is `print` and thrown errors only, so nothing
 * depends on a completion value or on how a function stringifies. Guards:
 *   - every program parses under ecmaVersion 5 (the input is a real ES5 tree);
 *   - the oracle is deterministic — Date, Math.random and other clocks are
 *     refused, and a program that hits the 2s vm timeout is a generator error;
 *   - no program's expected output contains a raw function's source text
 *     (implementation-formatted) unless the case explicitly opts in;
 *   - no source appears twice in one file.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as acorn from "acorn";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "acceptance");
const PACKAGE = "es5-evaluator";
const ACORN_VERSION: string = (acorn as unknown as { version: string }).version;
const WIDTH = 200;
const READ_LIMIT = 80_000;

// ---------------------------------------------------------------------------
// The oracle: Node evaluates the source; we capture print() and any escape.
// ---------------------------------------------------------------------------

type EvalResult = { output: string[]; error: string | null };

function toStr(value: unknown): string {
  return typeof value === "symbol" ? (value as symbol).toString() : String(value);
}

function oracle(source: string): EvalResult {
  const output: string[] = [];
  const sandbox = { print: (...args: unknown[]) => output.push(args.map(toStr).join(" ")) };
  try {
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    return { output, error: null };
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : toStr(error);
    return { output, error: name };
  }
}

function tree(source: string): unknown {
  return strip(acorn.parse(source, { ecmaVersion: 5, sourceType: "script" }));
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
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

// ---------------------------------------------------------------------------
// Rendering a tree, and an EvalResult, as TypeScript source
// ---------------------------------------------------------------------------

function str(value: string): string {
  return JSON.stringify(value).replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function num(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function flat(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return str(value);
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${flat(v)}`);
    return `{${entries.join(", ")}}`;
  }
  throw new Error(`cannot render ${typeof value}`);
}

function pretty(value: unknown, indent: number): string {
  const one = flat(value);
  if (one.length + indent <= WIDTH) return one;
  const pad = " ".repeat(indent + 2);
  const close = " ".repeat(indent);
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => pad + pretty(v, indent + 2)).join(",\n")},\n${close}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const lines = Object.entries(record).map(([k, v]) => `${pad}${k}: ${pretty(v, indent + 2)}`);
    return `{\n${lines.join(",\n")},\n${close}}`;
  }
  return one;
}

function renderResult(result: EvalResult): string {
  return `{ output: ${flat(result.output)}, error: ${result.error === null ? "null" : str(result.error)} }`;
}

// ---------------------------------------------------------------------------
// Cases. A file is a list of groups; a group is a title and its programs.
// Every program is authored as source; the tree and the result come from the
// oracle. Programs `print` what they mean to assert.
// ---------------------------------------------------------------------------

type Group = { title: string; programs: string[] };

const FILES: Record<string, Group[]> = {
  "primitives-and-arithmetic": [
    { title: "number literals and arithmetic", programs: [
      "print(1)", "print(1 + 2)", "print(2 * 3 + 4)", "print(2 + 3 * 4)", "print((2 + 3) * 4)", "print(10 - 3 - 2)", "print(10 / 4)", "print(10 % 3)", "print(-5 % 3)", "print(5 % -3)",
      "print(2 * 3 * 4)", "print(1 + 2 - 3 + 4)", "print(-3)", "print(-(2 + 3))", "print(+\"5\")", "print(0.1 + 0.2)", "print(1 / 3)", "print(1e3)", "print(1e21)", "print(1e-7)",
      "print(0xff)", "print(010)", "print(3.14)", "print(.5)", "print(100 / 0)", "print(-100 / 0)", "print(0 / 0)", "print(Infinity)", "print(-Infinity)", "print(NaN)", "print(2 * 2 * 2 * 2)",
    ] },
    { title: "bitwise and shift operators coerce to int32", programs: [
      "print(5 & 3)", "print(5 | 2)", "print(5 ^ 1)", "print(~5)", "print(1 << 4)", "print(256 >> 2)", "print(-1 >>> 28)", "print(-8 >> 1)", "print(3.9 & 3.9)", "print(2147483647 + 1 | 0)",
      "print(0xffffffff | 0)", "print(NaN | 0)", "print(Infinity | 0)", "print(\"5\" & \"3\")", "print(1 << 31)", "print((1 << 31) >>> 0)", "print(~~3.7)", "print(5 & 3 | 8)",
    ] },
    { title: "unary operators", programs: [
      "print(typeof 1)", "print(typeof \"a\")", "print(typeof true)", "print(typeof undefined)", "print(typeof null)", "print(typeof {})", "print(typeof [])", "print(typeof print)",
      "print(!true)", "print(!0)", "print(!\"\")", "print(!\"a\")", "print(!null)", "print(!!\"x\")", "print(void 0)", "print(void \"anything\")", "print(-\"3\")", "print(+true)", "print(+null)", "print(+undefined)",
      "print(- -5)", "print(typeof typeof 1)", "print(!!!true)",
    ] },
    { title: "string concatenation and the plus operator", programs: [
      "print(\"a\" + \"b\")", "print(\"a\" + 1)", "print(1 + \"a\")", "print(1 + 2 + \"a\")", "print(\"a\" + 1 + 2)", "print(true + \"!\")", "print(null + \"\")", "print(undefined + \"\")", "print([] + [])",
      "print([1,2] + [3,4])", "print({} + \"\")", "print(\"\" + {})", "print(\"n=\" + 5 * 2)", "print(\"\" + true + false)", "print(\"x\" + null + undefined)", "print(NaN + \"\")", "print(Infinity + \"\")",
    ] },
  ],
  "equality-and-relational": [
    { title: "strict equality", programs: [
      "print(1 === 1)", "print(1 === 2)", "print(1 === \"1\")", "print(null === null)", "print(undefined === undefined)", "print(null === undefined)", "print(NaN === NaN)", "print(0 === -0)",
      "print(\"a\" === \"a\")", "print(true === true)", "print(true === 1)", "print({} === {})", "print([] === [])", "print(1 !== 2)", "print(1 !== \"1\")", "var o = {}; print(o === o)",
    ] },
    { title: "abstract equality with coercion", programs: [
      "print(1 == 1)", "print(1 == \"1\")", "print(null == undefined)", "print(null == 0)", "print(undefined == 0)", "print(NaN == NaN)", "print(0 == false)", "print(1 == true)", "print(2 == true)",
      "print(\"\" == 0)", "print(\"\" == false)", "print(\" \" == 0)", "print(\"0\" == false)", "print([] == false)", "print([] == 0)", "print([0] == false)", "print([1] == true)", "print(\"1\" == 1)", "print(null == false)",
      "print(\"abc\" == \"abc\")", "print(1 != 2)", "print(0 != \"\")",
    ] },
    { title: "relational operators", programs: [
      "print(1 < 2)", "print(2 < 1)", "print(1 <= 1)", "print(2 >= 3)", "print(\"a\" < \"b\")", "print(\"b\" < \"a\")", "print(\"abc\" < \"abd\")", "print(\"10\" < \"9\")", "print(10 < 9)", "print(\"10\" < 9)",
      "print(1 < \"2\")", "print(null < 1)", "print(undefined < 1)", "print(NaN < 1)", "print(NaN > 1)", "print(NaN >= NaN)", "print(\"\" < \"a\")", "print(3 > 2 > 1)", "print(1 < 2 < 3)",
    ] },
    { title: "logical operators short-circuit and return operands", programs: [
      "print(true && false)", "print(1 && 2)", "print(0 && 2)", "print(1 || 2)", "print(0 || 2)", "print(\"\" || \"default\")", "print(null || 0 || \"x\")", "print(1 && 2 && 3)", "print(1 && 0 && 3)",
      "var c = 0; function bump(){ c++; return true } false && bump(); print(c)", "var c = 0; function bump(){ c++; return true } true || bump(); print(c)",
      "print(null && null.x)", "print(undefined || \"safe\")", "print(!(1 && 0))", "print((1 || 0) && 2)",
    ] },
    { title: "conditional and comma", programs: [
      "print(true ? \"y\" : \"n\")", "print(1 > 2 ? \"a\" : \"b\")", "print(0 ? \"a\" : 1 ? \"b\" : \"c\")", "print((1, 2, 3))", "var x = (1, 2); print(x)", "print(true ? 1 : 2, false ? 1 : 2)",
      "var n = 5; print(n > 0 ? \"pos\" : n < 0 ? \"neg\" : \"zero\")",
    ] },
  ],
  "variables-and-scope": [
    { title: "var declarations and assignment", programs: [
      "var x = 5; print(x)", "var x; print(x)", "var a = 1, b = 2; print(a + b)", "var x = 1; x = 2; print(x)", "var x = 1; x += 4; print(x)", "var x = 10; x -= 3; x *= 2; print(x)",
      "var x = 8; x /= 2; x %= 3; print(x)", "var x = 1; x <<= 3; print(x)", "var s = \"a\"; s += \"b\"; s += \"c\"; print(s)", "var a = b = 5; print(a, b)", "var x = 1; var x = 2; print(x)",
      "var x = 3; print(x++, x)", "var x = 3; print(++x, x)", "var x = 3; print(x--, --x)", "var o = {n:1}; o.n++; print(o.n)",
    ] },
    { title: "hoisting", programs: [
      "print(x); var x = 5;", "print(typeof x); var x = 5;", "print(f()); function f(){ return 42 }", "var g = function(){ return 1 }; print(g())",
      "function outer(){ return inner(); function inner(){ return 7 } } print(outer())", "print(hoisted); var hoisted = 1; print(hoisted);",
      "function f(){ print(x); var x = 2; print(x) } f()", "var x = 1; function f(){ x = 2; var x = 3; } f(); print(x)",
    ] },
    { title: "function scope and closures", programs: [
      "function make(){ var n = 0; return function(){ return ++n } } var c = make(); print(c(), c(), c())",
      "function adder(x){ return function(y){ return x + y } } print(adder(3)(4))",
      "var fns = []; for (var i = 0; i < 3; i++) { fns.push((function(k){ return function(){ return k } })(i)) } print(fns[0](), fns[1](), fns[2]())",
      "var x = \"global\"; function f(){ var x = \"local\"; function g(){ return x } return g() } print(f(), x)",
      "function counter(){ var n = 0; return { inc: function(){ return ++n }, get: function(){ return n } } } var c = counter(); c.inc(); c.inc(); print(c.get())",
      "var a = 1; function f(){ return a } a = 2; print(f())",
    ] },
    { title: "the global object and undeclared reads", programs: [
      "x = 5; print(x)", "print(typeof undeclaredName)", "try { readUndeclared } catch (e) { print(e.name) }", "foo = 1; print(typeof foo); var bar; print(typeof bar)",
    ] },
  ],
  "control-flow": [
    { title: "if / else", programs: [
      "if (true) print(\"a\")", "if (false) print(\"a\"); else print(\"b\")", "var x = 5; if (x > 0) print(\"pos\"); else if (x < 0) print(\"neg\"); else print(\"zero\")",
      "if (0) print(\"a\"); else print(\"b\")", "if (\"x\") print(\"truthy\")", "if (null) print(\"a\"); else print(\"b\")", "var x = 3; if (x) { print(\"one\"); print(\"two\") }",
      "if (1) if (0) print(\"a\"); else print(\"b\")",
    ] },
    { title: "while and do-while", programs: [
      "var i = 0; while (i < 5) { print(i); i++ }", "var i = 0, s = 0; while (i < 10) { s += i; i++ } print(s)", "var i = 0; do { print(i); i++ } while (i < 3)", "var i = 10; do { print(i) } while (false)",
      "var n = 1; while (n < 100) n *= 2; print(n)", "var i = 0; while (true) { if (i >= 3) break; print(i); i++ }",
    ] },
    { title: "for loops", programs: [
      "for (var i = 0; i < 5; i++) print(i)", "var s = 0; for (var i = 1; i <= 100; i++) s += i; print(s)", "for (var i = 0, j = 10; i < j; i++, j--) print(i, j)", "for (var i = 5; i > 0; i--) print(i)",
      "var s = 0; for (var i = 0; i < 10; i++) { if (i % 2 === 0) continue; s += i } print(s)", "for (;;) { print(\"once\"); break }", "var i = 0; for (; i < 3;) { print(i); i++ }",
      "for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) if (i === j) print(i, j)",
    ] },
    { title: "for-in over object keys", programs: [
      "var o = {a:1, b:2, c:3}; var s = 0; for (var k in o) s += o[k]; print(s)", "var o = {x:1, y:2}; var ks = []; for (var k in o) ks.push(k); print(ks.join(\",\"))",
      "var o = {a:1}; var proto = {b:2}; function O(){} O.prototype = proto; var obj = new O(); obj.a = 1; var ks = []; for (var k in obj) ks.push(k); ks.sort(); print(ks.join(\",\"))",
      "var count = 0; for (var k in {}) count++; print(count)", "var a = [10,20,30]; var idx = []; for (var i in a) idx.push(i); print(idx.join(\",\"))",
    ] },
    { title: "switch", programs: [
      "switch (2) { case 1: print(\"a\"); break; case 2: print(\"b\"); break; default: print(\"d\") }", "switch (9) { case 1: print(\"a\"); break; default: print(\"d\") }",
      "switch (1) { case 1: print(\"a\"); case 2: print(\"b\"); break; case 3: print(\"c\") }", "var x = \"b\"; switch (x) { case \"a\": print(1); break; case \"b\": print(2); break }",
      "switch (1) { default: print(\"d\"); case 1: print(\"one\") }", "switch (3) { case 1: case 2: case 3: print(\"low\"); break; default: print(\"high\") }", "switch (\"1\") { case 1: print(\"num\"); break; default: print(\"str\") }",
    ] },
    { title: "labels, break and continue", programs: [
      "outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (j === 1) continue outer; print(i, j) } }",
      "outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) { if (i === 1 && j === 1) break outer; print(i, j) } }",
      "var i = 0; loop: while (true) { i++; if (i < 3) continue loop; break loop } print(i)", "block: { print(\"a\"); break block; print(\"b\") } print(\"c\")",
    ] },
  ],
  "exceptions": [
    { title: "try / catch / finally", programs: [
      "try { print(\"a\") } catch (e) { print(\"b\") } print(\"c\")", "try { throw \"x\" } catch (e) { print(e) }", "try { throw new Error(\"boom\") } catch (e) { print(e.message) }",
      "try { print(\"a\"); throw 1; print(\"unreached\") } catch (e) { print(\"caught\") } finally { print(\"finally\") }", "try { print(\"a\") } finally { print(\"b\") }",
      "function f(){ try { return \"try\" } finally { print(\"finally ran\") } } print(f())", "try { try { throw \"inner\" } finally { print(\"inner finally\") } } catch (e) { print(\"outer\", e) }",
      "var log = []; try { log.push(1); throw 0 } catch (e) { log.push(2) } finally { log.push(3) } print(log.join(\",\"))",
      "function f(){ for (var i = 0; i < 5; i++) { try { if (i === 2) throw i } catch (e) { continue } print(i) } } f()",
    ] },
    { title: "runtime errors and their names", programs: [
      "try { null.x } catch (e) { print(e.name) }", "try { undefined.x } catch (e) { print(e.name) }", "try { undeclaredThing } catch (e) { print(e.name) }", "try { var f = 5; f() } catch (e) { print(e.name) }",
      "try { null.x } catch (e) { print(e instanceof TypeError, e instanceof Error) }", "try { throw new RangeError(\"r\") } catch (e) { print(e.name, e.message) }",
      "try { (void 0)() } catch (e) { print(e.name) }", "try { var o = {}; o.a.b } catch (e) { print(e.name) }",
    ] },
    { title: "exceptions propagate across calls", programs: [
      "function a(){ b() } function b(){ c() } function c(){ throw new Error(\"deep\") } try { a() } catch (e) { print(e.message) }",
      "function risky(){ throw new TypeError(\"nope\") } function safe(){ try { risky() } catch (e) { return \"handled \" + e.name } } print(safe())",
      "null.x", "undeclaredAtTop", "throw new Error(\"escapes to the top\")", "throw \"a bare string\"", "function f(){ throw new RangeError(\"x\") } f()",
    ] },
  ],
  "functions": [
    { title: "parameters, arguments and return", programs: [
      "function add(a, b){ return a + b } print(add(2, 3))", "function f(a, b){ return a + b } print(f(2))", "function f(a){ return a } print(f(1, 2, 3))", "function f(){ return } print(f())", "function f(){} print(f())",
      "function f(){ return arguments.length } print(f(), f(1), f(1, 2, 3))", "function sum(){ var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return s } print(sum(1, 2, 3, 4))",
      "function f(a, b){ arguments[0] = 99; return a } print(f(1, 2))", "function f(){ return f.length } print(f())", "function fact(n){ return n <= 1 ? 1 : n * fact(n - 1) } print(fact(5))",
      "function fib(n){ return n < 2 ? n : fib(n - 1) + fib(n - 2) } print(fib(10))", "function id(x){ return x } print(id(id(id(7))))",
    ] },
    { title: "function expressions and immediate invocation", programs: [
      "var f = function(x){ return x * 2 }; print(f(21))", "print((function(){ return 42 })())", "print((function(x){ return x + 1 })(9))", "var r = (function(){ var secret = 7; return secret })(); print(r)",
      "var f = function fac(n){ return n <= 1 ? 1 : n * fac(n - 1) }; print(f(4))", "print([1,2,3].map(function(x){ return x + 10 }).join(\",\"))", "!function(){ print(\"iife\") }()",
    ] },
    { title: "this and call/apply", programs: [
      "var o = { n: 10, get: function(){ return this.n } }; print(o.get())", "var o = { n: 5, f: function(){ return this.n } }; var g = o.f; print(typeof (function(){ try { return g() } catch(e){ return e.name } })())",
      "function f(){ return this.x } print(f.call({x: 1}))", "function f(a, b){ return this.x + a + b } print(f.call({x: 10}, 2, 3))", "function f(a, b){ return this.x + a + b } print(f.apply({x: 100}, [2, 3]))",
      "var o = { items: [1,2,3], sum: function(){ var t = 0; for (var i = 0; i < this.items.length; i++) t += this.items[i]; return t } }; print(o.sum())",
      "var o1 = { n: 1, f: function(){ return this.n } }; var o2 = { n: 2 }; print(o1.f.call(o2))",
    ] },
  ],
  "objects": [
    { title: "object literals and property access", programs: [
      "var o = {a: 1, b: 2}; print(o.a, o.b)", "var o = {}; o.x = 5; print(o.x)", "var o = {a: 1}; o[\"b\"] = 2; print(o.a + o.b)", "var o = {\"a b\": 1}; print(o[\"a b\"])", "var o = {1: \"one\", 2: \"two\"}; print(o[1], o[2])",
      "var o = {a: {b: {c: 42}}}; print(o.a.b.c)", "var o = {a: 1}; print(o.missing)", "var o = {a: 1}; print(typeof o.missing)", "var k = \"dyn\"; var o = {}; o[k] = 9; print(o.dyn)", "var o = {get: 1, if: 2, class: 3}; print(o.get, o.if, o.class)",
      "var o = {a: 1, b: 2}; delete o.a; print(o.a, o.b, \"a\" in o)", "var o = {n: 0}; o.n = o.n + 1; o.n += 10; print(o.n)", "var o = {a: 1}; var p = o; p.a = 2; print(o.a)",
    ] },
    { title: "in, hasOwnProperty and prototype chains", programs: [
      "var o = {a: 1}; print(\"a\" in o, \"b\" in o, \"toString\" in o)", "var o = {a: 1}; print(o.hasOwnProperty(\"a\"), o.hasOwnProperty(\"toString\"))",
      "function Animal(){} Animal.prototype.legs = 4; var a = new Animal(); print(a.legs, a.hasOwnProperty(\"legs\"))", "var base = {greet: function(){ return \"hi\" }}; var o = Object.create(base); print(o.greet())",
      "function A(){} A.prototype.x = 1; function B(){} B.prototype = new A(); var b = new B(); print(b.x)", "var o = {a: 1}; print(o.toString())", "var o = {a: 1}; print(o.valueOf() === o)",
      "print(Object.prototype.toString.call([]))", "print(Object.keys({a: 1, b: 2, c: 3}).length)", "var o = {b: 2, a: 1}; print(Object.keys(o).join(\",\"))", "print(Object.getPrototypeOf([]) === Array.prototype)",
    ] },
    { title: "constructors and new", programs: [
      "function Point(x, y){ this.x = x; this.y = y } var p = new Point(3, 4); print(p.x, p.y)", "function Point(x, y){ this.x = x; this.y = y } Point.prototype.dist = function(){ return Math.sqrt(this.x*this.x + this.y*this.y) }; print(new Point(3, 4).dist())",
      "function C(){ this.v = 1 } var o = new C(); print(o instanceof C, o instanceof Object)", "function C(){ return 5 } print(typeof new C())", "function C(){ this.a = 1; return {b: 2} } print(new C().a, new C().b)",
      "function C(){} print(new C().constructor === C)", "function Stack(){ this.items = [] } Stack.prototype.push = function(x){ this.items.push(x); return this }; Stack.prototype.size = function(){ return this.items.length }; var s = new Stack(); s.push(1).push(2).push(3); print(s.size())",
      "function Base(n){ this.n = n } function Derived(n){ Base.call(this, n) } Derived.prototype = new Base(); var d = new Derived(7); print(d.n)",
    ] },
    { title: "getters, setters and accessor semantics", programs: [
      "var o = { _n: 1, get n(){ return this._n }, set n(v){ this._n = v * 2 } }; o.n = 5; print(o.n)", "var o = { get x(){ return 42 } }; print(o.x)", "var calls = 0; var o = { get x(){ calls++; return 1 } }; o.x; o.x; print(calls)",
      "var o = { first: \"a\", last: \"b\", get full(){ return this.first + \" \" + this.last } }; print(o.full)",
    ] },
  ],
  "arrays": [
    { title: "array literals, indexing and length", programs: [
      "var a = [1, 2, 3]; print(a[0], a[1], a[2], a.length)", "var a = []; a[0] = \"x\"; a[5] = \"y\"; print(a.length, a[0], a[5], a[2])", "var a = [1, 2, 3]; a.length = 1; print(a.join(\",\"), a.length)",
      "var a = [1, 2, 3]; a[10] = 4; print(a.length)", "var a = [1, , 3]; print(a.length, a[1])", "var a = [[1, 2], [3, 4]]; print(a[0][1], a[1][0])", "var a = [1, 2, 3]; a[1] = 20; print(a.join(\",\"))", "print([].length, [1].length, [1, 2, 3, 4].length)",
      "var a = [1, 2, 3]; print(a instanceof Array, Array.isArray(a), Array.isArray({}))", "var a = [1, 2, 3]; print(\"length\" in a, 0 in a, 5 in a)",
    ] },
    { title: "mutating methods: push pop shift unshift splice reverse sort", programs: [
      "var a = [1, 2]; a.push(3, 4); print(a.join(\",\"), a.length)", "var a = [1, 2, 3]; print(a.pop(), a.join(\",\"))", "var a = [1, 2, 3]; print(a.shift(), a.join(\",\"))", "var a = [2, 3]; a.unshift(0, 1); print(a.join(\",\"))",
      "var a = [1, 2, 3, 4, 5]; var r = a.splice(1, 2); print(a.join(\",\"), r.join(\",\"))", "var a = [1, 2, 3]; a.splice(1, 0, \"a\", \"b\"); print(a.join(\",\"))", "var a = [1, 2, 3]; a.reverse(); print(a.join(\",\"))",
      "var a = [3, 1, 2]; a.sort(); print(a.join(\",\"))", "var a = [10, 2, 33, 4]; a.sort(); print(a.join(\",\"))", "var a = [10, 2, 33, 4]; a.sort(function(x, y){ return x - y }); print(a.join(\",\"))",
      "var a = [\"banana\", \"apple\", \"cherry\"]; a.sort(); print(a.join(\",\"))",
    ] },
    { title: "non-mutating methods: slice concat join indexOf", programs: [
      "var a = [1, 2, 3, 4, 5]; print(a.slice(1, 3).join(\",\"))", "var a = [1, 2, 3, 4, 5]; print(a.slice(-2).join(\",\"))", "var a = [1, 2, 3]; print(a.concat([4, 5], 6).join(\",\"))", "print([1, 2, 3].join(\"-\"))", "print([1, 2, 3].join(\"\"))", "print([1, 2, 3].indexOf(2), [1, 2, 3].indexOf(9))",
      "print([1, 2, 3, 2].lastIndexOf(2))", "var a = [1, 2, 3]; a.slice(); print(a.length)", "print([\"a\", \"b\", \"c\"].join())",
    ] },
    { title: "iteration methods: forEach map filter reduce every some", programs: [
      "var s = 0; [1, 2, 3].forEach(function(x){ s += x }); print(s)", "print([1, 2, 3].map(function(x){ return x * x }).join(\",\"))", "print([1, 2, 3, 4].filter(function(x){ return x % 2 === 0 }).join(\",\"))",
      "print([1, 2, 3, 4].reduce(function(a, b){ return a + b }))", "print([1, 2, 3, 4].reduce(function(a, b){ return a + b }, 100))", "print([1, 2, 3].reduceRight(function(a, b){ return a + \"\" + b }))",
      "print([1, 2, 3].every(function(x){ return x > 0 }), [1, 2, 3].every(function(x){ return x > 1 }))", "print([1, 2, 3].some(function(x){ return x > 2 }), [1, 2, 3].some(function(x){ return x > 5 }))",
      "var idx = []; [10, 20, 30].forEach(function(x, i){ idx.push(i) }); print(idx.join(\",\"))", "print([1, 2, 3].map(function(x, i){ return x + i }).join(\",\"))",
    ] },
  ],
  "builtins": [
    { title: "Math", programs: [
      "print(Math.floor(3.7), Math.ceil(3.2), Math.round(3.5), Math.round(2.4))", "print(Math.abs(-5), Math.abs(5))", "print(Math.max(1, 5, 3), Math.min(1, 5, 3))", "print(Math.pow(2, 10), Math.sqrt(144))",
      "print(Math.max(), Math.min())", "print(Math.floor(-3.2), Math.ceil(-3.7))", "print(Math.round(-2.5))", "print(Math.PI > 3.14 && Math.PI < 3.15)", "print(Math.max.apply(null, [3, 1, 4, 1, 5, 9]))", "print(Math.sqrt(-1))",
    ] },
    { title: "String methods", programs: [
      "print(\"hello\".length)", "print(\"hello\".charAt(0), \"hello\".charAt(4), \"hello\".charAt(10))", "print(\"hello\".charCodeAt(0))", "print(String.fromCharCode(72, 105))", "print(\"hello\".indexOf(\"l\"), \"hello\".lastIndexOf(\"l\"))",
      "print(\"hello world\".slice(0, 5), \"hello world\".slice(6))", "print(\"hello\".substring(1, 3), \"hello\".substr(1, 3))", "print(\"Hello\".toUpperCase(), \"Hello\".toLowerCase())", "print(\"a,b,c\".split(\",\").join(\"|\"))", "print(\"abc\".split(\"\").join(\"-\"))",
      "print(\"hello\".replace(\"l\", \"L\"))", "print(\"  trim me  \".length)", "print(\"abc\".concat(\"def\", \"ghi\"))", "print(\"hello\"[1])", "print((\"x\" + \"y\").length)", "print(\"racecar\".split(\"\").reverse().join(\"\"))",
    ] },
    { title: "Number, parseInt, parseFloat and coercion functions", programs: [
      "print(parseInt(\"42\"), parseInt(\"42px\"), parseInt(\"  10  \"))", "print(parseInt(\"0x1f\"), parseInt(\"10\", 2), parseInt(\"z\", 36))", "print(parseInt(\"abc\"))", "print(parseFloat(\"3.14\"), parseFloat(\"3.14abc\"), parseFloat(\".5\"))",
      "print(Number(\"42\"), Number(\"3.14\"), Number(\"\"), Number(\"  7 \"), Number(\"x\"))", "print(Number(true), Number(false), Number(null), Number([]), Number([5]))", "print(String(42), String(true), String(null), String([1, 2]))",
      "print(Boolean(0), Boolean(1), Boolean(\"\"), Boolean(\"x\"), Boolean(null))", "print(isNaN(NaN), isNaN(5), isNaN(\"x\"), isFinite(5), isFinite(Infinity))", "print((255).toString(16), (8).toString(2))", "print((3.14159).toFixed(2), (3.14159).toFixed(0))", "print((1000000).toString())",
    ] },
    { title: "Object and Array constructors and statics", programs: [
      "var o = Object(); o.x = 1; print(o.x)", "print(Object.keys({a: 1, b: 2}).sort().join(\",\"))", "var proto = {shared: 1}; var o = Object.create(proto); print(o.shared, o.hasOwnProperty(\"shared\"))",
      "var a = new Array(3); print(a.length)", "var a = new Array(1, 2, 3); print(a.join(\",\"))", "print(Array.isArray([]), Array.isArray(\"\"))", "print(Array.prototype.slice.call({0: \"a\", 1: \"b\", length: 2}).join(\",\"))",
      "function f(){ return Array.prototype.join.call(arguments, \"-\") } print(f(1, 2, 3))",
    ] },
  ],
  "programs": [
    { title: "small whole programs", programs: [
      "function gcd(a, b){ while (b) { var t = b; b = a % b; a = t } return a } print(gcd(48, 36))",
      "function isPrime(n){ if (n < 2) return false; for (var i = 2; i * i <= n; i++) if (n % i === 0) return false; return true } var primes = []; for (var i = 2; i < 20; i++) if (isPrime(i)) primes.push(i); print(primes.join(\",\"))",
      "function reverse(s){ var r = \"\"; for (var i = s.length - 1; i >= 0; i--) r += s.charAt(i); return r } print(reverse(\"hello\"))",
      "var memo = {}; function fib(n){ if (n < 2) return n; if (memo[n]) return memo[n]; return memo[n] = fib(n - 1) + fib(n - 2) } print(fib(20))",
      "function Queue(){ this.items = [] } Queue.prototype.enqueue = function(x){ this.items.push(x) }; Queue.prototype.dequeue = function(){ return this.items.shift() }; var q = new Queue(); q.enqueue(1); q.enqueue(2); q.enqueue(3); print(q.dequeue(), q.dequeue(), q.items.length)",
      "function bubbleSort(a){ for (var i = 0; i < a.length; i++) for (var j = 0; j < a.length - 1 - i; j++) if (a[j] > a[j + 1]) { var t = a[j]; a[j] = a[j + 1]; a[j + 1] = t } return a } print(bubbleSort([5, 2, 8, 1, 9, 3]).join(\",\"))",
      "function range(n){ var a = []; for (var i = 0; i < n; i++) a.push(i); return a } print(range(5).map(function(x){ return x * x }).filter(function(x){ return x % 2 === 0 }).join(\",\"))",
      "function Counter(start){ this.count = start || 0 } Counter.prototype.inc = function(by){ this.count += by || 1; return this }; var c = new Counter(10); c.inc().inc(5).inc(); print(c.count)",
      "var tree = { value: 1, children: [{ value: 2, children: [] }, { value: 3, children: [{ value: 4, children: [] }] }] }; function sum(node){ var s = node.value; for (var i = 0; i < node.children.length; i++) s += sum(node.children[i]); return s } print(sum(tree))",
      "function compose(f, g){ return function(x){ return f(g(x)) } } var addOne = function(x){ return x + 1 }; var double = function(x){ return x * 2 }; print(compose(addOne, double)(5))",
      "var acc = []; var i = 1; while (i <= 15) { var out = \"\"; if (i % 3 === 0) out += \"Fizz\"; if (i % 5 === 0) out += \"Buzz\"; acc.push(out || String(i)); i++ } print(acc.join(\" \"))",
      "function wordCount(s){ var words = s.split(\" \"); var counts = {}; for (var i = 0; i < words.length; i++) { var w = words[i]; counts[w] = (counts[w] || 0) + 1 } return counts } var c = wordCount(\"a b a c b a\"); print(c.a, c.b, c.c)",
    ] },
  ],
};

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const HEADER = `// Generated by generate.ts (trees from acorn ${ACORN_VERSION} at ecmaVersion 5; results from Node's vm); do not edit by hand.\n`;

const HELPERS = `/** The tree the evaluator receives, derived from its own signature so the package need only export \`evaluate\`. */
type Program = Parameters<typeof evaluate>[0];
/** Types an embedded literal as that program. */
const program = (node: unknown): Program => node as Program;
`;

const seen = new Set<string>();
const problems: string[] = [];

function forbid(source: string): void {
  if (/\b(Date|Math\s*\.\s*random|Math\.random|setTimeout|setInterval|process|require|globalThis|eval|Function\s*\()/.test(source)) {
    problems.push(`${JSON.stringify(source)}: uses a nondeterministic or out-of-scope global`);
  }
}

function emitFile(name: string, groups: Group[]): { content: string; count: number } {
  const lines = [
    HEADER,
    'import { describe, expect, it } from "vitest";',
    `import { evaluate } from "${PACKAGE}";`,
    "",
    HELPERS,
  ];
  let count = 0;
  for (const group of groups) {
    lines.push(`describe(${str(group.title)}, () => {`);
    lines.push("  const cases: Array<[string, Program, { output: string[]; error: string | null }]> = [");
    for (const source of group.programs) {
      if (seen.has(`${name}:${source}`)) {
        problems.push(`${JSON.stringify(source)} listed twice in ${name}`);
        continue;
      }
      seen.add(`${name}:${source}`);
      forbid(source);
      let ast: unknown;
      try {
        ast = tree(source);
      } catch (error) {
        problems.push(`${name}: acorn rejects ${JSON.stringify(source)}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const result = oracle(source);
      count++;
      const literal = pretty(ast, 6);
      lines.push(`    [${str(source)},`, `      program(${literal}),`, `      ${renderResult(result)}],`);
    }
    lines.push("  ];");
    lines.push('  it.each(cases)("%s", (_source, ast, expected) => {');
    lines.push("    expect(evaluate(ast)).toEqual(expected);");
    lines.push("  });");
    lines.push("});");
    lines.push("");
  }
  return { content: lines.join("\n"), count };
}

function generate(): { files: Record<string, string>; total: number } {
  seen.clear();
  problems.length = 0;
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, groups] of Object.entries(FILES)) {
    const { content, count } = emitFile(name, groups);
    files[`${name}.test.ts`] = content;
    total += count;
  }
  return { files, total };
}

function main(argv: string[]): number {
  const { files, total } = generate();
  const largest = Math.max(...Object.values(files).map((f) => f.length));
  const oversized = Object.entries(files).filter(([, f]) => f.length > READ_LIMIT).map(([n]) => n);
  for (const n of oversized) problems.push(`${n} is ${files[n]!.length} chars, over the ${READ_LIMIT} read limit — split it`);
  if (problems.length) throw new Error(`case problems:\n  ${problems.join("\n  ")}`);
  if (argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([n, c]) => !fs.existsSync(path.join(OUT, n)) || fs.readFileSync(path.join(OUT, n), "utf8") !== c)
      .map(([n]) => n);
    const strays = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((n) => n.endsWith(".test.ts") && !(n in files)) : [];
    const issues = [...stale, ...strays.map((s) => `${s} (stray)`)];
    console.log(`${total} programs; ${issues.length ? "STALE: " + issues.join(", ") : "up to date"}`);
    return issues.length ? 1 : 0;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const stray of fs.readdirSync(OUT)) {
    if (stray.endsWith(".test.ts") && !(stray in files)) fs.unlinkSync(path.join(OUT, stray));
  }
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);
  console.log(`wrote ${Object.keys(files).length} files, ${total} programs, largest ${largest} chars, oracle: node vm + acorn ${ACORN_VERSION}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
