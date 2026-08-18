#!/usr/bin/env node
/**
 * setup.mjs — build a control-run directory for the vanilla-pi experiment.
 *
 * The control: an UNMODIFIED pi coding agent (default system prompt, default
 * read/bash/edit/write tools) gets the same job trireme runs — same scaffolded
 * workspace, spec, contract, acceptance suite, same model and caps — inside an
 * srt sandbox. This script prepares everything that must exist before the
 * sandbox closes around the agent:
 *
 *   <run>/workspace/   scaffold (trireme's own scaffoldWorkspace) + acceptance/
 *                      + spec.md + contract.d.ts + vitest/typescript devDeps
 *                      installed (the sandbox has no npm registry access)
 *   <run>/home/        a CLEAN pi home (models.json pricing only — the real
 *                      ~/.pi carries auth.json and must stay unreadable)
 *   <run>/settings.json  srt config: workspace writable; acceptance/, spec.md,
 *                      contract.d.ts read-only; ~/src, ~/.ssh, dotfiles with
 *                      credentials unreadable; network = api.deepseek.com only
 *
 *   node experiments/vanilla-pi/setup.mjs bench/es5-language ~/control-runs/<id>
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldWorkspace } from "../../src/core/scaffold.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRIREME = path.resolve(HERE, "../..");
const HOME = os.homedir();

const [jobArg, runArg] = process.argv.slice(2);
if (!jobArg || !runArg) throw new Error("usage: setup.mjs <job-dir> <run-dir>");
const jobDir = path.resolve(jobArg);
const runDir = path.resolve(runArg.replace(/^~/, HOME));
const ws = path.join(runDir, "workspace");

const manifest = JSON.parse(fs.readFileSync(path.join(jobDir, "trireme.json"), "utf8"));

// --- workspace: trireme's own scaffold, verbatim ---
fs.mkdirSync(ws, { recursive: true });
for (const f of scaffoldWorkspace(manifest)) {
  fs.mkdirSync(path.dirname(path.join(ws, f.path)), { recursive: true });
  fs.writeFileSync(path.join(ws, f.path), f.content);
}
fs.cpSync(path.join(jobDir, "acceptance"), path.join(ws, "acceptance"), { recursive: true });
fs.copyFileSync(path.join(jobDir, "spec.md"), path.join(ws, "spec.md"));
fs.copyFileSync(path.join(jobDir, "contract.d.ts"), path.join(ws, "contract.d.ts"));

// devDeps at trireme's own versions, plus scripts so `npm test` works offline.
const triremePkg = JSON.parse(fs.readFileSync(path.join(TRIREME, "package.json"), "utf8"));
const pkgPath = path.join(ws, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.devDependencies = {
  // Trireme workspaces resolve these through the trireme repo's node_modules;
  // the control workspace stands alone, so it carries its own (same versions).
  "@types/node": triremePkg.devDependencies["@types/node"],
  typescript: triremePkg.devDependencies.typescript,
  vitest: triremePkg.devDependencies.vitest,
};
pkg.scripts = { test: "vitest run acceptance/", typecheck: "tsc --noEmit" };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
execFileSync("pnpm", ["install", "--ignore-workspace"], { cwd: ws, stdio: "inherit" });

// --- clean pi home: pricing overrides only, never auth ---
const piAgent = path.join(runDir, "home", ".pi", "agent");
fs.mkdirSync(piAgent, { recursive: true });
fs.copyFileSync(path.join(HOME, ".pi", "agent", "models.json"), path.join(piAgent, "models.json"));

// --- srt settings ---
const settings = {
  filesystem: {
    denyRead: [
      path.join(HOME, "src"),          // trireme repo: prior runs hold complete solutions
      path.join(HOME, ".ssh"),
      path.join(HOME, ".pi"),          // real pi home: auth.json
      path.join(HOME, ".bashrc"),
      path.join(HOME, ".profile"),
      path.join(HOME, ".npmrc"),
      path.join(HOME, ".gitconfig"),
      path.join(HOME, ".git-credentials"),
      path.join(HOME, ".claude"),
      path.join(HOME, ".claude.json"),
      path.join(HOME, ".config"),
    ],
    allowWrite: [runDir, "/tmp"],
    denyWrite: [
      path.join(ws, "acceptance"),
      path.join(ws, "spec.md"),
      path.join(ws, "contract.d.ts"),
      path.join(runDir, "settings.json"),
    ],
  },
  network: { allowedDomains: ["api.deepseek.com"], deniedDomains: [] },
};
fs.writeFileSync(path.join(runDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");

fs.mkdirSync(path.join(runDir, "snapshots"), { recursive: true });
console.log(`control run prepared at ${runDir}`);
console.log(`model ${manifest.model} thinking ${manifest.thinking}; caps $${manifest.limits.costUsd} / ${manifest.limits.wallClockMinutes}m`);
