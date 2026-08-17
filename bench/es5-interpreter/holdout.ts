#!/usr/bin/env node
/**
 * Held-out check for a finished run: runs fresh programs — none in the
 * acceptance suite — through the run's packed artifact and compares
 * {output, error} with the reference (acorn ecmaVersion 5 for validity, Node's
 * vm for a valid program's behaviour).
 *
 *     node bench/es5-interpreter/holdout.ts runs/<id>
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
  "function fib(n){ return n < 2 ? n : fib(n-1) + fib(n-2) } print(fib(12))",
  "var o = { a: 1, b: 2 }; var t = 0; for (var k in o) t += o[k]; print(t)",
  "try { null.foo() } catch (e) { print(e.name) }",
  "print([5,3,8,1].sort(function(a,b){ return a-b }).join(','))",
  "var a = 1\nvar b = 2\nprint(a\n+\nb)",
  "// comment\nprint(/* inline */ 3 + 4)",
  "print(0xFF, 010, 1e3, .5, \"a\\tb\".length)",
  "function C(n){ this.n = n } C.prototype.d = function(){ return this.n * 2 }; print(new C(21).d())",
  "var x = 3; print(x++ + ++x)",
  "print('racecar'.split('').reverse().join(''))",
  "switch (2 + 1) { case 3: print('three'); break; default: print('other') }",
  "var acc = ''; try { throw new Error('e') } catch (err) { acc += err.message } finally { acc += '!' } print(acc)",
  "print(1 + '2' + 3, 1 + 2 + '3', +'5' + 5)",
  "label: for (var i = 0; i < 5; i++) { if (i === 3) break label; print(i) }",
  "var counter = (function(){ var n = 0; return function(){ return ++n } })(); print(counter(), counter(), counter())",
  "print(typeof null, typeof [], typeof function(){}, typeof undefined)",
  "print([1,2,3].map(function(x){ return x*x }).filter(function(x){ return x > 1 }).join(','))",
  "print(Math.max(3,7,2), Math.min(3,7,2), Math.floor(3.9), Math.abs(-4))",
  "var o = {}; o['x' + 1] = 'a'; print(o.x1)",
  "let y = 1",
  "const z = 2",
  "var f = (a) => a + 1",
  "for (var x of [1,2,3]) print(x)",
  "print(`template ${1}`)",
  "function f(a = 5){ return a }",
  "var { a, b } = obj",
  "print(1;",
  "var = 5",
  "function () {}",
];

type Verdict = { output: string[]; error: string | null };
function toStr(v: unknown): string { return typeof v === "symbol" ? (v as symbol).toString() : String(v); }
function reference(source: string): Verdict {
  try { acorn.parse(source, { ecmaVersion: 5, sourceType: "script" }); } catch { return { output: [], error: "SyntaxError" }; }
  const output: string[] = [];
  const sandbox = { print: (...a: unknown[]) => output.push(a.map(toStr).join(" ")) };
  try { vm.runInNewContext(source, sandbox, { timeout: 2000 }); return { output, error: null }; }
  catch (e) { const t = e as { name?: unknown }; return { output, error: e && typeof e === "object" && typeof t.name === "string" ? t.name : toStr(e) }; }
}

async function main(runDir: string): Promise<number> {
  const artifactDir = path.join(runDir, "artifact");
  const tgz = fs.readdirSync(artifactDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no artifact in ${artifactDir}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es5-interpreter-holdout-"));
  execFileSync("tar", ["-xzf", path.join(artifactDir, tgz), "-C", tmp]);
  const pkgDir = path.join(tmp, "package");
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const entry = typeof pkg.exports === "string" ? pkg.exports : (pkg.exports?.["."]?.import ?? pkg.exports?.["."]?.default ?? pkg.exports?.["."] ?? pkg.main);
  const mod = await import(pathToFileURL(path.join(pkgDir, entry)).href);
  const run = mod.run as (source: string) => Verdict;
  if (typeof run !== "function") throw new Error("artifact exports no run function");
  let agree = 0; const disagreements: string[] = [];
  for (const source of HELD_OUT) {
    const expected = reference(source);
    let actual: Verdict;
    try { actual = run(source); } catch (e) { actual = { output: ["<threw>"], error: e instanceof Error ? e.message : String(e) }; }
    if (JSON.stringify(expected) === JSON.stringify(actual)) agree++;
    else disagreements.push(`${JSON.stringify(source)}\n  ref:      ${JSON.stringify(expected)}\n  artifact: ${JSON.stringify(actual)}`);
  }
  console.log(`${agree}/${HELD_OUT.length} held-out programs agree with the reference (acorn ${(acorn as unknown as { version: string }).version} + Node vm)`);
  for (const d of disagreements) console.log(d);
  fs.rmSync(tmp, { recursive: true, force: true });
  return disagreements.length ? 1 : 0;
}
process.exit(await main(process.argv[2]));
