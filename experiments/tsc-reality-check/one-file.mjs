// one-file.mjs <abs-ts-file> — transpile one file inside the engine, byte-diff vs real tsc.
import fs from "node:fs";
import path from "node:path";
import { run } from "/home/rodrigo/control-runs/trunk/current/src/engine/index.ts";
import tsNode from "./node_modules/typescript/lib/typescript.js";

const dir = path.dirname(new URL(import.meta.url).pathname);
const prelude = fs.readFileSync(path.join(dir, "prelude.js"), "utf8");
const tscSrc = fs.readFileSync(path.join(dir, "node_modules/typescript/lib/typescript.js"), "utf8");
const f = process.argv[2];
const rel = f.replace(/^.*trunk\/current\//, "");
const source = fs.readFileSync(f, "utf8");
const OPTS = { target: 1 /*ES5*/, module: 1 /*CommonJS*/, newLine: 1 /*LF*/ };
const driver = `
var source = ${JSON.stringify(source)};
var t0 = new Date().getTime();
try {
  var out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed } });
  print("MS:" + (new Date().getTime() - t0));
  print("DIAG:" + out.diagnostics.length);
  print(out.outputText);
} catch (e) { print("FAILED:" + e.name + ":" + e.message); }
`;
const t0 = Date.now();
const res = run(prelude + "\n" + tscSrc + "\n" + driver);
const wall = ((Date.now() - t0) / 1000).toFixed(1);
if (res.error !== null || res.output.length < 3 || String(res.output[0]).startsWith("FAILED")) {
  console.log(`FAIL  ${rel}  wall=${wall}s  ${res.error ?? res.output[0] ?? "no output"}`);
  process.exit(0);
}
const ms = res.output[0].slice(3);
const engineOut = res.output.slice(2).join("\n");
const nodeOut = tsNode.transpileModule(source, { compilerOptions: OPTS }).outputText;
if (engineOut === nodeOut) {
  console.log(`MATCH ${rel}  transpile=${ms}ms wall=${wall}s out=${engineOut.length}b`);
} else {
  const tag = rel.replace(/\//g, "_");
  fs.writeFileSync(path.join(dir, "mismatch-" + tag + ".engine"), engineOut);
  fs.writeFileSync(path.join(dir, "mismatch-" + tag + ".node"), nodeOut);
  console.log(`DIFF  ${rel}  transpile=${ms}ms wall=${wall}s engine=${engineOut.length}b node=${nodeOut.length}b`);
}
