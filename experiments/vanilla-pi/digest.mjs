#!/usr/bin/env node
/**
 * digest.mjs — mechanical, uninterpreted digest of the control runs, built for
 * feeding back to a model for independent analysis.
 *
 * Deliberately contains NO analytic labels or conclusions: per run, a timeline
 * of what happened (5-minute activity buckets; every test invocation with its
 * scope and result), the ending, and the externally graded outcome. The point
 * is to see what dynamics a model extracts from the raw record on its own.
 *
 *   node experiments/vanilla-pi/digest.mjs ~/control-runs ctl-1 ctl-2 ... > digest.md
 */
import fs from "node:fs";
import path from "node:path";

const [rootArg, ...names] = process.argv.slice(2);
if (!rootArg || !names.length) throw new Error("usage: digest.mjs <control-runs-root> <name>...");
const root = path.resolve(rootArg);

// Externally graded outcomes (gate: vitest over the pristine suite + tsc).
const GRADES = {
  "ctl-1": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 55.1, cost: 0.62 },
  "ctl-2": { outcome: "killed at the 90-minute cap", graded: "2112/2367 passing, typecheck ok", wall: 90.0, cost: 0.47 },
  "ctl-3": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 63.0, cost: 0.95 },
  "ctl-4": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 62.7, cost: 0.69 },
  "ctl-5": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 50.4, cost: 0.59 },
  "ctl-6": { outcome: "killed at the 90-minute cap", graded: "0/2367 (the entry module fails to import: it references a file that does not exist)", wall: 90.0, cost: 0.56 },
  "ctl-7": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 62.3, cost: 0.81 },
  "ctl-8": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 42.6, cost: 0.49 },
  "ctl-9": { outcome: "finished by itself", graded: "2367/2367 passing, typecheck ok", wall: 57.2, cost: 0.71 },
};

function findSession(runDir) {
  const stack = [path.join(runDir, "home", ".pi", "agent", "sessions")];
  while (stack.length) {
    const d = stack.pop();
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".jsonl")) return p;
    }
  }
  return null;
}

function classifyBash(cmd) {
  if (/vitest|npm test/.test(cmd)) return "TEST";
  if (/\bnode -e\b|\bnode --input-type/.test(cmd)) return "node-probe";
  if (/python3/.test(cmd)) return "python-script";
  if (/\btsc\b|typecheck/.test(cmd)) return "typecheck";
  if (/grep|head|tail|cat|wc |ls |find /.test(cmd)) return "inspect";
  return "other-bash";
}

function digestRun(name) {
  const runDir = path.join(root, name);
  const sess = findSession(runDir);
  const lines = fs.readFileSync(sess, "utf8").split("\n").filter((l) => l.trim());
  let t0 = null;
  const buckets = new Map(); // bucketMinute -> {counts, tests: [...]}
  const testEvents = []; // chronological {min, scope, result}
  let pendingTest = null;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;
    if (ts && t0 === null) t0 = ts;
    const min = ts && t0 !== null ? (ts - t0) / 60000 : null;
    const m = ev.message ?? {};
    for (const blk of Array.isArray(m.content) ? m.content : []) {
      if (blk && typeof blk === "object" && blk.type === "toolCall") {
        const nm = blk.name ?? "";
        const args = blk.arguments ?? blk.input ?? {};
        const b = Math.floor((min ?? 0) / 5) * 5;
        const bucket = buckets.get(b) ?? { counts: {}, note: "" };
        let kind = nm;
        if (nm === "bash") {
          kind = classifyBash(args.command ?? "");
          if (kind === "TEST") {
            const cmd = (args.command ?? "").replace(/\n/g, " ");
            const scopeMatch = /vitest run\s+([^\s|>&]+)/.exec(cmd);
            pendingTest = { min: min ?? 0, scope: scopeMatch ? scopeMatch[1] : "(suite)" };
          }
        }
        bucket.counts[kind] = (bucket.counts[kind] ?? 0) + 1;
        buckets.set(b, bucket);
      }
      const txt = blk && typeof blk === "object" && typeof blk.text === "string" ? blk.text : null;
      if (txt && pendingTest) {
        const fp = /Tests\s+(\d+) failed \| (\d+) passed \((\d+)\)/.exec(txt);
        const pOnly = /Tests\s+(\d+) passed \((\d+)\)/.exec(txt);
        if (fp) { testEvents.push({ ...pendingTest, result: `${fp[2]}/${fp[3]} passed` }); pendingTest = null; }
        else if (pOnly) { testEvents.push({ ...pendingTest, result: `${pOnly[1]}/${pOnly[2]} passed` }); pendingTest = null; }
      }
    }
  }

  const out = [];
  const g = GRADES[name];
  out.push(`### Run ${name}`);
  out.push(`Ending: ${g.outcome} at ${g.wall} min. Cost $${g.cost.toFixed(2)}.`);
  out.push(`Externally graded final state: ${g.graded}.`);
  out.push(`Activity timeline (5-minute buckets; counts of actions by kind):`);
  for (const b of [...buckets.keys()].sort((a, c) => a - c)) {
    const c = buckets.get(b).counts;
    const parts = Object.entries(c).map(([k, v]) => `${k}×${v}`).join(", ");
    out.push(`  min ${String(b).padStart(2)}–${b + 5}: ${parts}`);
  }
  out.push(`Every test invocation (minute, scope, result as the agent saw it):`);
  if (!testEvents.length) out.push("  (none)");
  for (const t of testEvents) {
    out.push(`  min ${t.min.toFixed(0).padStart(3)}: ${t.scope}  →  ${t.result}`);
  }
  out.push("");
  return out.join("\n");
}

console.log(`# Nine runs: raw activity digests`);
console.log("");
for (const n of names) console.log(digestRun(n));
