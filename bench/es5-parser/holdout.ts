#!/usr/bin/env node
/**
 * Held-out check for a finished run: parses fresh sources — none of them in
 * the acceptance suite — with the run's packed artifact and compares each
 * result with acorn's. A pass means the artifact generalises beyond the
 * cases it was built against; a disagreement is printed with both trees.
 *
 *     node bench/es5-parser/holdout.ts runs/<id>
 *
 * Unpacks runs/<id>/artifact/es5-parser-*.tgz into a temporary directory and
 * imports its built entry point, so `#module` imports resolve the way a
 * consumer's would.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as acorn from "acorn";

const HELD_OUT: string[] = [
  "var i = 0; while (i < 10) { i += 2; if (i === 6) break; }",
  "function f(a, b) { return arguments.length > 1 ? a + b : a; }",
  "x = y ? /re/g : z / 2 / w;",
  "for (var k in o) if (o.hasOwnProperty(k)) delete o[k];",
  "a = { \"b\": [1, , 3], get c() { return 1 }, 'd': null };",
  "label: for (;;) { switch (x) { case 1: continue label; default: break label } }",
  "try { throw new Error('e') } catch (err) { log(err.message) } finally { done = true }",
  "if (a)\n  b()\nelse\n  c()\n",
  "var s = \"line\\\ncontinued\" + '\\u00e9' + \"\\x41\\101\";",
  "(function () { var self = this; return function () { return self }; })()",
  "n = 0x1F + 010 + 1e3 + .5;",
  "while (a--) b[a] = c(a) >>> 1;",
  "a\n++\nb\n--c",
  "with (obj) { x = y }",
  "switch (a) {}\n/x/.test(y)",
  "while (x) function g() { return }",
  "x = a /= b / c;",
  "f(a)\n(b)\n[c]",
  "var re = /[/]\\//gim, r2 = /=/;",
  "new new a.b(c)(d).e",
  "'use strict'\nfunction g() { \"use strict\"; return typeof this }",
  "o = { if: 1, class: 2, get: 3, set: function () {}, get set() { return 4 } };",
  "if (a) b(); else if (c) d() else e()",
  "const y = 2",
  "a => a",
  "({set a() {}, b: 1})",
  "throw\n1",
  "for (var q = 0 in obj) count++",
  "y = [] \n/re/i",
  "outer: for (;;) { g = function () { continue outer } }",
];

type Verdict = { ok: true; ast: unknown } | { ok: false };

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node instanceof RegExp) return { pattern: node.source, flags: node.flags };
  if (node && typeof node === "object") {
    // Keys sorted so the comparison is structural, not order-of-insertion.
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node).sort()) {
      if (key === "start" || key === "end") continue;
      const value = (node as Record<string, unknown>)[key];
      if (value === undefined) continue;
      out[key] = strip(value);
    }
    return out;
  }
  if (typeof node === "number" && !Number.isFinite(node)) return `<${String(node)}>`;
  return node;
}

function verdict(fn: (source: string) => unknown, source: string): Verdict {
  try {
    return { ok: true, ast: strip(fn(source)) };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false };
    throw error;
  }
}

async function main(runDir: string): Promise<number> {
  const artifactDir = path.join(runDir, "artifact");
  const tgz = fs.readdirSync(artifactDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no artifact in ${artifactDir}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "es5-parser-holdout-"));
  execFileSync("tar", ["-xzf", path.join(artifactDir, tgz), "-C", tmp]);
  const pkgDir = path.join(tmp, "package");
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const entry = typeof pkg.exports === "string" ? pkg.exports : (pkg.exports?.["."]?.import ?? pkg.exports?.["."]?.default ?? pkg.exports?.["."] ?? pkg.main);
  const mod = await import(pathToFileURL(path.join(pkgDir, entry)).href);
  const parse = mod.parse as (source: string) => unknown;
  if (typeof parse !== "function") throw new Error("artifact exports no parse function");

  let agree = 0;
  const disagreements: string[] = [];
  for (const source of HELD_OUT) {
    const expected = verdict((s) => acorn.parse(s, { ecmaVersion: 5, sourceType: "script" }), source);
    const actual = verdict(parse, source);
    const same = JSON.stringify(expected) === JSON.stringify(actual);
    if (same) agree++;
    else disagreements.push(`${JSON.stringify(source)}\n  acorn:    ${JSON.stringify(expected).slice(0, 400)}\n  artifact: ${JSON.stringify(actual).slice(0, 400)}`);
  }
  console.log(`${agree}/${HELD_OUT.length} held-out sources agree with acorn ${(acorn as unknown as { version: string }).version}`);
  for (const d of disagreements) console.log(d);
  fs.rmSync(tmp, { recursive: true, force: true });
  return disagreements.length ? 1 : 0;
}

process.exit(await main(process.argv[2]));
