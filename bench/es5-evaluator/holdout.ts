#!/usr/bin/env node
/**
 * Held-out check for a finished run: runs fresh programs — none in the
 * acceptance suite — through the run's packed artifact and compares the
 * {output, error} with Node's. A pass means the evaluator generalises beyond
 * the cases it was built against.
 *
 *     node bench/es5-evaluator/holdout.ts runs/<id>
 *
 * The programs are parsed with acorn (ecmaVersion 5) to feed the evaluator its
 * tree, and run in a fresh vm to get the oracle result.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import * as acorn from "acorn";

const HELD_OUT: string[] = [
  "var s = 0; for (var i = 1; i <= 10; i++) s += i; print(s)",
  "function twice(f){ return function(x){ return f(f(x)) } } print(twice(function(n){ return n + 3 })(10))",
  "print([5,3,8,1].sort(function(a,b){ return a - b }).join(','))",
  "var o = { a: 1, b: 2 }; var t = 0; for (var k in o) t += o[k]; print(t)",
  "try { var x = null; x.foo() } catch (e) { print(e.name) }",
  "print('abcdef'.split('').filter(function(c){ return c > 'c' }).join(''))",
  "function C(n){ this.n = n } C.prototype.dbl = function(){ return this.n * 2 }; print(new C(21).dbl())",
  "var a = []; (function(){ for (var i = 0; i < 3; i++) a.push(i * i) })(); print(a.join(','))",
  "print(1 + 2 + '3' + 4 + 5)",
  "print(typeof null, typeof [], typeof function(){}, typeof 'x')",
  "var n = 5, r = 1; while (n > 1) { r *= n; n-- } print(r)",
  "print([1,2,3,4,5].reduce(function(a,b){ return a + b }, 0))",
  "switch (2 + 1) { case 1: print('a'); break; case 3: print('b'); break; default: print('c') }",
  "print('Hello, World'.toUpperCase().indexOf('WORLD'))",
  "var counter = 0; function inc(){ counter++ } inc(); inc(); inc(); print(counter)",
  "print(Math.max(3, 7, 2), Math.min(3, 7, 2), Math.abs(-9))",
  "var o = {}; o['x' + 1] = 'a'; o['x' + 2] = 'b'; print(o.x1, o.x2)",
  "print((function(){ return arguments.length })(1, 2, 3, 4))",
  "print([10, 20, 30].map(function(v, i){ return i + ':' + v }).join(' '))",
  "print(0.1 + 0.2 === 0.3, 0.5 + 0.5 === 1)",
  "label: for (var i = 0; i < 5; i++) { if (i === 3) break label; print(i) }",
  "function Stack(){ this.items = [] } Stack.prototype.push = function(x){ this.items.push(x) }; Stack.prototype.peek = function(){ return this.items[this.items.length - 1] }; var s = new Stack(); s.push(1); s.push(2); print(s.peek())",
  "print('a,b,,c'.split(',').length)",
  "print(parseInt('  0x2A  '), parseFloat('  6.28xyz'))",
  "var acc = ''; try { throw new Error('e1') } catch (e) { acc += e.message } finally { acc += '!' } print(acc)",
  "print([1,2,3].concat(4, [5, 6]).length)",
  "var f = function g(n){ return n <= 0 ? 'done' : g(n - 1) }; print(f(3))",
  "print(('' + [1, [2, [3, 4]]]))",
  "var x = 10; function outer(){ var x = 20; return function(){ return x } } print(outer()())",
  "print(5 > 3 ? 3 > 1 ? 'both' : 'first' : 'neither')",
];

type Verdict = { output: string[]; error: string | null };

function toStr(v: unknown): string { return typeof v === "symbol" ? (v as symbol).toString() : String(v); }

function nodeResult(source: string): Verdict {
  const output: string[] = [];
  const sandbox = { print: (...a: unknown[]) => output.push(a.map(toStr).join(" ")) };
  try {
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    return { output, error: null };
  } catch (e) {
    return { output, error: e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : toStr(e) };
  }
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) { if (k === "start" || k === "end") continue; out[k] = strip(v); }
    return out;
  }
  return node;
}

async function main(runDir: string): Promise<number> {
  const artifactDir = path.join(runDir, "artifact");
  const tgz = fs.readdirSync(artifactDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no artifact in ${artifactDir}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es5-evaluator-holdout-"));
  execFileSync("tar", ["-xzf", path.join(artifactDir, tgz), "-C", tmp]);
  const pkgDir = path.join(tmp, "package");
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const entry = typeof pkg.exports === "string" ? pkg.exports : (pkg.exports?.["."]?.import ?? pkg.exports?.["."]?.default ?? pkg.exports?.["."] ?? pkg.main);
  const mod = await import(pathToFileURL(path.join(pkgDir, entry)).href);
  const evaluate = mod.evaluate as (program: unknown) => Verdict;
  if (typeof evaluate !== "function") throw new Error("artifact exports no evaluate function");

  let agree = 0;
  const disagreements: string[] = [];
  for (const source of HELD_OUT) {
    const expected = nodeResult(source);
    let actual: Verdict;
    try {
      actual = evaluate(strip(acorn.parse(source, { ecmaVersion: 5, sourceType: "script" })));
    } catch (e) {
      actual = { output: ["<threw>"], error: e instanceof Error ? e.message : String(e) };
    }
    if (JSON.stringify(expected) === JSON.stringify(actual)) agree++;
    else disagreements.push(`${JSON.stringify(source)}\n  node:     ${JSON.stringify(expected)}\n  artifact: ${JSON.stringify(actual)}`);
  }
  console.log(`${agree}/${HELD_OUT.length} held-out programs agree with Node (acorn ${(acorn as unknown as { version: string }).version})`);
  for (const d of disagreements) console.log(d);
  fs.rmSync(tmp, { recursive: true, force: true });
  return disagreements.length ? 1 : 0;
}

process.exit(await main(process.argv[2]));
