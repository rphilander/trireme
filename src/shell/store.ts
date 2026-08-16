/**
 * Every filesystem effect the harness has.
 *
 * Isolated here so that the core modules above it stay pure and the paths a run
 * touches are enumerable in one place. Nothing in this file decides anything;
 * it reads, writes and copies what it is told to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashEntries } from "../core/hash.ts";
import { ACCEPTANCE_DIR, CONTRACT_FILE } from "../core/job.ts";
import { MANIFEST_FILE } from "../core/manifest.ts";
import { SPEC_FILE } from "../core/spec.ts";
import { scaffoldWorkspace } from "../core/scaffold.ts";
import type { JobInput } from "../core/job.ts";
import type { Manifest } from "../core/types.ts";

export function readIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function listFilesRecursively(dir: string, prefix = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursively(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** The four parts of a job, read but not judged. */
export function readJob(jobDir: string): JobInput {
  const input: JobInput = {};
  const manifestText = readIfPresent(path.join(jobDir, MANIFEST_FILE));
  if (manifestText !== undefined) input.manifestText = manifestText;
  const specText = readIfPresent(path.join(jobDir, SPEC_FILE));
  if (specText !== undefined) input.specText = specText;
  const contractText = readIfPresent(path.join(jobDir, CONTRACT_FILE));
  if (contractText !== undefined) input.contractText = contractText;

  const acceptanceDir = path.join(jobDir, ACCEPTANCE_DIR);
  if (fs.existsSync(acceptanceDir) && fs.statSync(acceptanceDir).isDirectory()) {
    input.acceptanceFiles = listFilesRecursively(acceptanceDir);
  }
  return input;
}

/** A stable identity for the job, so benchmark numbers can be compared. */
export function hashJob(jobDir: string): string {
  const files = listFilesRecursively(jobDir);
  return hashEntries(
    files.map((relative) => [relative, fs.readFileSync(path.join(jobDir, relative))] as [string, Uint8Array]),
  );
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export interface Workspace {
  /** Absolute path to the workspace root. */
  root: string;
  /** Names of the acceptance test files, as copied in. */
  acceptanceFiles: string[];
}

/**
 * Builds the workspace: generated files, then the job's contract and suite
 * copied in unchanged, then the toolchain linked in so vitest and tsc resolve.
 */
export function materializeWorkspace(options: {
  runDir: string;
  jobDir: string;
  manifest: Manifest;
  triremeRoot: string;
}): Workspace {
  const root = path.join(options.runDir, "workspace");
  fs.mkdirSync(root, { recursive: true });

  for (const file of scaffoldWorkspace(options.manifest)) {
    writeFile(path.join(root, file.path), file.content);
  }

  fs.copyFileSync(path.join(options.jobDir, CONTRACT_FILE), path.join(root, CONTRACT_FILE));

  const acceptanceSource = path.join(options.jobDir, ACCEPTANCE_DIR);
  const acceptanceTarget = path.join(root, ACCEPTANCE_DIR);
  fs.cpSync(acceptanceSource, acceptanceTarget, { recursive: true });

  linkToolchain(root, options.triremeRoot);

  return { root, acceptanceFiles: listFilesRecursively(acceptanceTarget) };
}

/**
 * The workspace lives in a temporary directory with no package tree above it,
 * so vitest and its own dependencies would not resolve. Trireme owns the test
 * framework, so it lends the workspace its node_modules rather than installing.
 */
export function linkToolchain(workspace: string, triremeRoot: string): void {
  const source = path.join(triremeRoot, "node_modules");
  if (!fs.existsSync(source)) {
    throw new Error(
      `trireme's node_modules is missing at ${source}; the harness owns the test toolchain and cannot run without it.`,
    );
  }
  const target = path.join(workspace, "node_modules");
  if (fs.existsSync(target)) return;
  fs.symlinkSync(source, target, "junction");
}

/** Walks up from this file to the package root. */
export function findTriremeRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === "trireme") return dir;
      } catch {
        // Keep walking; a malformed package.json above us is not ours.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate trireme's package root from its own source path.");
}

export function readTriremeVersion(triremeRoot: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(triremeRoot, "package.json"), "utf8")) as {
      version?: string;
    };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function ensureRunDir(runsDir: string, runId: string): string {
  const runDir = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

/** Appends one JSON object per line. The event log is the run's narrative. */
export class EventLog {
  private readonly stream: fs.WriteStream;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.stream = fs.createWriteStream(file, { flags: "a" });
  }

  write(event: Record<string, unknown>): void {
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }

  get path(): string {
    return this.file;
  }
}

export { writeFile, listFilesRecursively };
