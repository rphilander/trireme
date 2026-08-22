// driver.mjs — the cycle driver's loop and CLI. Alternates the pure state
// machine (machine.mjs) with real effects (effects.mjs); persists state
// after every step so a crash leaves a readable record; on escalation it
// writes ESCALATION.md and exits nonzero — v1 never intervenes and never
// retries, it stops for the operator (wall caps are the only enforcement).
//
//   node driver.mjs --entry entry-9 [--cycles 1] [--cap 5400]
//        [--retro-cap 5400] [--max-wall S] [--pristine P] [--control D]
//        [--kernel D] [--plan D] [--out D]

import fs from "node:fs";
import path from "node:path";
import { initialState, nextAction, reduce } from "./machine.mjs";
import { makeCtx, makeEffects } from "./effects.mjs";

export async function runDriver(config, ctx, { outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, "driver.log");
  const line = (s) => {
    const msg = `${new Date().toISOString()} ${s}`;
    fs.appendFileSync(logPath, msg + "\n");
    ctx.logLine?.(s);
  };
  const effects = makeEffects(makeCtx({ ...ctx, logLine: line }));

  let state = initialState(config);
  const persist = () =>
    fs.writeFileSync(path.join(outDir, "state.json"), JSON.stringify(state, null, 1));
  persist();

  for (;;) {
    const action = nextAction(state);
    if (action === null) break;
    line(`[cycle ${state.cycle} ${state.entry}] ${action.type}` +
      (action.run ? ` ${action.run}` : action.retro ? ` ${action.retro}` : ""));
    let result = null;
    if (!action.internal) {
      const t0 = Date.now();
      try {
        result = await effects[action.type](action);
      } catch (err) {
        // an effect that throws is a driver bug, not a cohort outcome —
        // surface it as its own escalation rather than mislabeling the run
        result = null;
        state = {
          ...state,
          step: "ESCALATED",
          escalation: { reason: "driver-error", detail: `${action.type}: ${err?.stack ?? err}`, entry: state.entry, cycle: state.cycle },
        };
        persist();
        break;
      }
      result.elapsedS = (Date.now() - t0) / 1000;
    }
    if (state.step !== "ESCALATED") state = reduce(state, action, result);
    persist();
  }

  // terminal artifacts
  if (state.step === "ESCALATED") {
    const e = state.escalation;
    fs.writeFileSync(
      path.join(outDir, "ESCALATION.md"),
      [
        `# Driver escalation — ${e.entry} (cycle ${e.cycle})`,
        "",
        `**Reason: \`${e.reason}\`**`,
        "",
        "```json",
        JSON.stringify(e.detail, null, 2),
        "```",
        "",
        `Banked before stopping: ${state.banked.length ? state.banked.map((b) => `${b.entry}←${b.winner}`).join(", ") : "none"}.`,
        `Wall used: ${Math.round(state.wallUsedS)}s. State: state.json; log: driver.log.`,
        "",
        "The driver stopped here by design (v1: no interventions, no retries).",
      ].join("\n")
    );
    line(`ESCALATED: ${e.reason}`);
  } else {
    fs.writeFileSync(
      path.join(outDir, "SUMMARY.md"),
      [
        `# Driver summary — DONE`,
        "",
        ...state.banked.map((b) => `- ${b.entry}: banked \`${b.winner}\``),
        "",
        `Cycles completed: ${state.banked.length}/${state.config.cycles}. Wall used: ${Math.round(state.wallUsedS)}s.`,
      ].join("\n")
    );
    line(`DONE: ${state.banked.map((b) => b.entry).join(", ")} banked`);
  }
  return state;
}

// ---- CLI ------------------------------------------------------------------

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out[k] = true; // bare flag (e.g. --from-grading)
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.entry) {
    console.error("usage: node driver.mjs --entry entry-N [--cycles 1] [--cap 5400] [--retro-cap 5400] [--max-wall S] ...");
    process.exit(64);
  }
  const ctx = makeCtx({
    ...(a.kernel ? { kernelDir: a.kernel } : {}),
    ...(a.control ? { controlDir: a.control } : {}),
    ...(a.plan ? { planRepo: a.plan } : {}),
    ...(a.pristine ? { pristine: a.pristine } : {}),
    logLine: (s) => console.log(s),
  });
  const config = {
    entry: a.entry,
    fromGrading: "from-grading" in a,
    cycles: Number(a.cycles ?? 1),
    capS: Number(a.cap ?? 5400),
    retroCapS: Number(a["retro-cap"] ?? 5400),
    maxWallS: a["max-wall"] ? Number(a["max-wall"]) : null,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = a.out ?? path.join(ctx.controlDir, "driver", `${a.entry}-${stamp}`);
  runDriver(config, ctx, { outDir }).then((state) => {
    console.log(`driver: ${state.step} — artifacts in ${outDir}`);
    process.exit(state.step === "DONE" ? 0 : 2);
  });
}
