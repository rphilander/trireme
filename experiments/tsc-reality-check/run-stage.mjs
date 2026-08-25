// run-stage.mjs <driver.js> — prelude + typescript.js + driver through run()
import fs from "node:fs";
import { run } from "/home/rodrigo/control-runs/trunk/current/src/engine/index.ts";
const dir = new URL(".", import.meta.url);
const prelude = fs.readFileSync(new URL("prelude.js", dir), "utf8");
const tsc = fs.readFileSync(new URL("node_modules/typescript/lib/typescript.js", dir), "utf8");
const driver = fs.readFileSync(new URL(process.argv[2], dir), "utf8");
const src = prelude + "\ntry {\n" + tsc + "\n} catch (e) { print('TSC-LOAD-CAUGHT ' + e.name + ': ' + e.message); }\n" + driver;
const t0 = Date.now();
const res = run(src);
console.log("wall:", ((Date.now()-t0)/1000).toFixed(1)+"s", "| top-level error:", res.error);
for (const l of res.output) console.log("OUT:", String(l).slice(0, 400));
