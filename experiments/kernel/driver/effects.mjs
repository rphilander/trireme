// effects.mjs — the impure half of the cycle driver: every action type from
// machine.mjs mapped to real kernel-script invocations and file I/O. All
// paths come from ctx so the seam tests can point this at a sandbox of stub
// scripts (test/effects.test.mjs) — the same substitution trick as the
// scripted-provider tests, one level up.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzeGate, recheckOutcome, mergeRecheck } from "./grade.mjs";

export function makeCtx(overrides = {}) {
  const HOME = process.env.HOME;
  const controlDir = overrides.controlDir ?? path.join(HOME, "control-runs");
  return {
    kernelDir: overrides.kernelDir ?? path.join(HOME, "src/trireme/experiments/kernel"),
    controlDir,
    planRepo: overrides.planRepo ?? path.join(controlDir, "plan"),
    trunkDir: overrides.trunkDir ?? path.join(controlDir, "trunk"),
    pristine: overrides.pristine ?? path.join(HOME, "control-runs/planner-2/workspace"),
    logLine: overrides.logLine ?? (() => {}),
  };
}

function sh(cmd, args, { cwd, timeoutS, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const cap = (d) => { out = (out + d).slice(-20000); };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    let timer = null;
    if (timeoutS) {
      timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 30000).unref();
      }, timeoutS * 1000);
    }
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 124, signal, out });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, out: String(err) });
    });
  });
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readOr = (p, fallback = null) => { try { return fs.readFileSync(p, "utf8"); } catch { return fallback; } };

function readRunLog(runDir) {
  const log = readOr(path.join(runDir, "run.log"), "");
  const exits = [...log.matchAll(/^exit=(\d+)/gm)];
  const exit = exits.length ? Number(exits[exits.length - 1][1]) : null;
  const spends = [...log.matchAll(/\$([0-9]+(?:\.[0-9]+)?) spent/g)];
  const spend = spends.length ? spends[spends.length - 1][1] : null;
  return { exit, spend };
}

function editablePaths(planRepo, entry) {
  const f = readOr(path.join(planRepo, entry, "editable.txt"), "");
  return f.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
}

function countLayers(planRepo, entry) {
  let n = 0;
  while (exists(path.join(planRepo, entry, `layer-${n + 1}`))) n++;
  return n;
}

async function gateInvoke(ctx, subject, casesFile, outFile, timeoutS) {
  return sh("node", ["bridge/run.mjs", "--subject", subject, "--cases", casesFile, "--out", outFile],
    { cwd: ctx.pristine, timeoutS });
}

export function makeEffects(ctx) {
  const CR = ctx.controlDir;
  const K = ctx.kernelDir;
  const script = (name) => path.join(K, name);
  const runDir = (name) => path.join(CR, name);

  return {
    async VALIDATE_PHASE(a) {
      const r = await sh("bash", [script("validate-phase.sh"), ctx.planRepo, a.entry], { timeoutS: 60 });
      if (r.code !== 0) return { ok: false, error: r.out.trim().slice(-500) };
      const layers = countLayers(ctx.planRepo, a.entry);
      return { ok: true, layered: layers > 0, layers: layers || 1 };
    },

    async RUN_COHORT(a) {
      const runs = [];
      if (a.layered) {
        const outerS = a.layers * a.capS + 1800;
        await Promise.all(
          a.runs.map(async (name) => {
            const startedAt = new Date().toISOString();
            ctx.logLine(`lineage ${name}: starting (${a.layers} layers, cap ${a.capS}s/layer)`);
            const r = await sh("bash", [script("run-lineage.sh"), name, ctx.pristine, a.entry, String(a.capS)], { timeoutS: outerS });
            const endedAt = new Date().toISOString();
            const status = readOr(path.join(CR, `${name}.lineage-status`), "").trim();
            let lineage = null;
            let error = null;
            let m;
            if ((m = status.match(/^COMPLETE layers=(\d+) final=(\S+)/))) {
              lineage = { status: "COMPLETE", layers: Number(m[1]), finalWorkspace: m[2] };
            } else if ((m = status.match(/^HALTED layer=(\d+)/))) {
              const hl = Number(m[1]);
              lineage = {
                status: "HALTED", haltedLayer: hl, layers: a.layers,
                finalWorkspace: path.join(CR, `${name}-L${hl}`, "workspace"),
              };
            } else {
              error = `run-lineage exit=${r.code}, no lineage-status (${r.out.trim().slice(-200)})`;
            }
            // spend: sum of the per-layer sessions' final stamps
            let spend = null;
            let sum = 0, seen = false;
            for (let i = 1; i <= a.layers; i++) {
              const { spend: s } = readRunLog(path.join(CR, `${name}-L${i}`));
              if (s != null) { sum += Number(s); seen = true; }
            }
            if (seen) spend = sum.toFixed(3);
            runs.push({ name, exit: r.code, capOut: r.code === 124, spend, startedAt, endedAt, lineage, error });
          })
        );
      } else {
        const editable = editablePaths(ctx.planRepo, a.entry);
        for (const name of a.runs) {
          const r = await sh("bash", [script("compose-module-world.sh"), name, ctx.pristine, a.entry, ...editable], { timeoutS: 600 });
          if (r.code !== 0) {
            runs.push({ name, exit: null, error: `compose failed: ${r.out.trim().slice(-200)}` });
          }
        }
        const composed = a.runs.filter((n) => !runs.some((r) => r.name === n));
        await Promise.all(
          composed.map(async (name) => {
            const startedAt = new Date().toISOString();
            ctx.logLine(`run ${name}: launching (cap ${a.capS}s)`);
            await sh("bash", [script("launch-world.sh"), name, String(a.capS)], { timeoutS: a.capS + 900 });
            const endedAt = new Date().toISOString();
            const { exit, spend } = readRunLog(runDir(name));
            const error = exists(path.join(runDir(name), "workspace/src")) ? null : "no workspace/src after run";
            runs.push({ name, exit, capOut: exit === 124, spend, startedAt, endedAt, lineage: null, error });
          })
        );
      }
      // keep cohort order stable
      runs.sort((x, y) => a.runs.indexOf(x.name) - a.runs.indexOf(y.name));
      return { runs };
    },

    async ASSEMBLE_LINEAGE(a) {
      try {
        const dst = runDir(a.run);
        if (!a.finalWorkspace || !exists(a.finalWorkspace)) {
          return { ok: false, error: `final workspace missing: ${a.finalWorkspace}` };
        }
        fs.rmSync(dst, { recursive: true, force: true });
        const relay = path.join(dst, "home/.pi/agent/sessions/relay");
        fs.mkdirSync(relay, { recursive: true });
        fs.cpSync(a.finalWorkspace, path.join(dst, "workspace"), { recursive: true });
        for (let i = 1; i <= a.layers; i++) {
          const sess = path.join(CR, `${a.run}-L${i}`, "home/.pi/agent/sessions");
          if (!exists(sess)) continue;
          for (const f of fs.readdirSync(sess, { recursive: true })) {
            const p = path.join(sess, String(f));
            if (p.endsWith(".jsonl") && fs.statSync(p).isFile()) {
              fs.copyFileSync(p, path.join(relay, path.basename(p)));
            }
          }
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async GATE_RUN(a) {
      const d = runDir(a.run);
      const casesFile = path.join(d, "gate-cases.txt");
      const accepted = readOr(path.join(ctx.trunkDir, "ACCEPTED.txt"), "");
      const entryCases = readOr(path.join(ctx.planRepo, a.entry, "cases.txt"), "");
      const ids = [...new Set((accepted + "\n" + entryCases).split("\n").map((s) => s.trim()).filter(Boolean))].sort();
      fs.writeFileSync(casesFile, ids.join("\n") + "\n");
      const outFile = path.join(d, "gate.json");
      const r = await gateInvoke(ctx, path.join(d, "workspace", a.subjectRel ?? "src/engine/index.ts"), casesFile, outFile, 2400);
      let gate = null;
      try { gate = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
      if (r.code !== 0 || !gate) {
        // leave an honest artifact so the retro world can still be composed
        if (!gate) fs.writeFileSync(outFile, JSON.stringify({ results: [], gateError: `exit=${r.code}` }));
        return { ok: false, gateExit: r.code, hasChallenges: exists(path.join(d, "workspace/CHALLENGES.md")) };
      }
      const an = analyzeGate(gate);
      const hasChallenges = exists(path.join(d, "workspace/CHALLENGES.md"));
      if (!an.ok) return { ok: false, gateExit: r.code, hasChallenges };
      return { ok: true, total: an.total, nonPassIds: an.nonPassIds, hasChallenges };
    },

    async RECHECK_RUN(a) {
      const d = runDir(a.run);
      const idsFile = path.join(d, "recheck-ids.txt");
      fs.writeFileSync(idsFile, a.ids.join("\n") + "\n");
      const outFile = path.join(d, "gate-recheck.json");
      ctx.logLine(`recheck ${a.run}: ${a.ids.length} id(s) in isolation`);
      const r = await gateInvoke(ctx, path.join(d, "workspace", a.subjectRel ?? "src/engine/index.ts"), idsFile, outFile, 1200);
      let recheck = null;
      try { recheck = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
      if (r.code !== 0 || !recheck) {
        return { passedIds: [], failedIds: a.ids }; // conservative: recheck tooling failure never upgrades a run
      }
      const outcome = recheckOutcome(a.ids, recheck);
      // rewrite gate.json as the merged, annotated artifact for the retro
      try {
        const gate = JSON.parse(fs.readFileSync(path.join(d, "gate.json"), "utf8"));
        fs.writeFileSync(path.join(d, "gate.json"), JSON.stringify(mergeRecheck(gate, recheck), null, 1));
      } catch {}
      return outcome;
    },

    async WRITE_KERNEL_LOG(a) {
      try {
        const dir = path.join(CR, "kernel-logs");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${a.entry}.md`), a.content);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async COMPOSE_RETRO(a) {
      const r = await sh("bash", [script("compose-retro-world.sh"), a.retro, ctx.pristine, a.entry, ...a.runs], { timeoutS: 900 });
      return r.code === 0 ? { ok: true } : { ok: false, error: r.out.trim().slice(-500) };
    },

    async LAUNCH_RETRO(a) {
      ctx.logLine(`retro ${a.retro}: launching (cap ${a.capS}s)`);
      await sh("bash", [script("launch-world.sh"), a.retro, String(a.capS)], { timeoutS: a.capS + 900 });
      const { exit, spend } = readRunLog(runDir(a.retro));
      return { exit, capOut: exit === 124, spend };
    },

    async CHECK_DELIVERABLES(a) {
      const W = path.join(runDir(a.retro), "workspace");
      const missingCore = [];
      for (const f of ["RETRO.md", "DECISION.md", "REVISION.md"]) {
        if (!exists(path.join(W, f))) missingCore.push(f);
      }
      const nd = path.join(W, "plan", a.nextEntry);
      const singleDecl = exists(path.join(nd, "BRIEF.md")) && exists(path.join(nd, "editable.txt"));
      const layerDecl = exists(path.join(nd, "layer-1", "BRIEF.md")) && exists(path.join(nd, "layer-1", "editable.txt"));
      const nextDeclared = exists(path.join(nd, "cases.txt")) && (singleDecl || layerDecl);
      return { missingCore, nextDeclared, decisionText: readOr(path.join(W, "DECISION.md")) };
    },

    async FOLD_PLAN(a) {
      const r = await sh("bash", [script("commit-plan.sh"), a.retro], { timeoutS: 300 });
      return { ok: r.code === 0, output: r.out.trim().slice(-800) };
    },

    async BANK(a) {
      // plan-workspace = the RETRO's workspace: it carries the post-fold
      // plan (the delta the retro may have re-derived) plus bridge+corpus.
      // Passing a stale world here was the v1 bug — never reintroduce it.
      const planWorkspace = path.join(runDir(a.retro), "workspace");
      const r = await sh("bash", [script("bank-trunk.sh"), a.entry, a.winner, planWorkspace, a.subjectRel], { timeoutS: 2400 });
      return { ok: r.code === 0, output: r.out.trim().slice(-800) };
    },

    async REUSE_COHORT(a) {
      // --from-grading: the cohort already ran (e.g. before an escalation);
      // recover the same facts RUN_COHORT would have returned, from disk.
      const sessionSpan = (dir) => {
        // first/last event timestamps across the run's session files
        let t0 = null, t1 = null;
        const sess = path.join(dir, "home/.pi/agent/sessions");
        if (!exists(sess)) return { startedAt: null, endedAt: null };
        for (const f of fs.readdirSync(sess, { recursive: true })) {
          const fp = path.join(sess, String(f));
          if (!fp.endsWith(".jsonl") || !fs.statSync(fp).isFile()) continue;
          const lines = fs.readFileSync(fp, "utf8").split("\n").filter(Boolean);
          for (const line of [lines[0], lines[lines.length - 1]]) {
            const m = line?.match(/"timestamp":(\d{10,})/);
            if (m) {
              const t = Number(m[1]);
              if (t0 == null || t < t0) t0 = t;
              if (t1 == null || t > t1) t1 = t;
            }
          }
        }
        return {
          startedAt: t0 ? new Date(t0).toISOString() : null,
          endedAt: t1 ? new Date(t1).toISOString() : null,
        };
      };
      const runs = a.runs.map((name) => {
        if (a.layered) {
          const status = readOr(path.join(CR, `${name}.lineage-status`), "").trim();
          let m;
          let lineage = null, error = null;
          if ((m = status.match(/^COMPLETE layers=(\d+) final=(\S+)/))) {
            lineage = { status: "COMPLETE", layers: Number(m[1]), finalWorkspace: m[2] };
          } else if ((m = status.match(/^HALTED layer=(\d+)/))) {
            const hl = Number(m[1]);
            lineage = { status: "HALTED", haltedLayer: hl, layers: a.layers, finalWorkspace: path.join(CR, `${name}-L${hl}`, "workspace") };
          } else {
            error = "no lineage-status on disk";
          }
          let sum = 0, seen = false;
          for (let i = 1; i <= a.layers; i++) {
            const { spend } = readRunLog(path.join(CR, `${name}-L${i}`));
            if (spend != null) { sum += Number(spend); seen = true; }
          }
          return { name, ...sessionSpan(path.join(CR, `${name}-L1`)), exit: null, capOut: false, spend: seen ? sum.toFixed(3) : null, lineage, error };
        }
        if (!exists(path.join(runDir(name), "workspace/src"))) {
          return { name, error: "no run on disk to reuse" };
        }
        const { exit, spend } = readRunLog(runDir(name));
        return { name, exit, capOut: exit === 124, spend, ...sessionSpan(runDir(name)), lineage: null, error: null };
      });
      return { runs };
    },

    async CHECK_NEXT(a) {
      return { declared: exists(path.join(ctx.planRepo, a.nextEntry, "cases.txt")) };
    },
  };
}
