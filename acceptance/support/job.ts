/**
 * Builds throwaway job directories.
 *
 * The job is deliberately tiny — two functions — because these tests are about
 * the harness, not about anything hard to implement. Every part is overridable
 * so a test can break exactly one thing and watch validation catch it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCRIPTED_MODEL_REF } from "./scripted-provider.ts";

export const JOB_NAME = "adder";

export const DEFAULT_MANIFEST = {
  name: JOB_NAME,
  version: "0.1.0",
  description: "Adds and multiplies two numbers.",
  model: SCRIPTED_MODEL_REF,
  thinking: "off",
  limits: { costUsd: 1, wallClockMinutes: 5 },
  safety: { maxIterations: 10 },
  dependencies: {},
};

export const DEFAULT_SPEC = `# adder

## Purpose

A minimal package used to exercise the harness. It adds and multiplies numbers.

## Public API

\`add(a, b)\` returns the sum of its two arguments. \`mul(a, b)\` returns their product.

## Behavior

Both functions are total over finite numbers and have no side effects. Neither
mutates its arguments, and neither reads or writes anything outside itself.

## Constraints

Pure functions, no dependencies, no I/O.

## Non-goals

No arbitrary precision, no operations beyond addition and multiplication.
`;

export const DEFAULT_CONTRACT = `export declare function add(a: number, b: number): number;
export declare function mul(a: number, b: number): number;
`;

export const DEFAULT_ACCEPTANCE: Record<string, string> = {
  "adder.test.ts": `import { describe, expect, it } from "vitest";
import { add, mul } from "${JOB_NAME}";

describe("add", () => {
  it("sums two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
  it("handles negatives", () => {
    expect(add(-2, 3)).toBe(1);
  });
});

describe("mul", () => {
  it("multiplies two numbers", () => {
    expect(mul(2, 3)).toBe(6);
  });
});
`,
};

/** An implementation that satisfies the contract and the acceptance suite. */
export const CORRECT_IMPLEMENTATION = `export function add(a: number, b: number): number {
  return a + b;
}

export function mul(a: number, b: number): number {
  return a * b;
}
`;

/** Satisfies the contract's shape but fails the suite. */
export const WRONG_IMPLEMENTATION = `export function add(a: number, b: number): number {
  return a - b;
}

export function mul(a: number, b: number): number {
  return a * b;
}
`;

/** Passes the suite's arithmetic but omits an export the contract requires. */
export const INCOMPLETE_IMPLEMENTATION = `export function add(a: number, b: number): number {
  return a + b;
}
`;

export interface JobSpec {
  /** Merged over the default manifest. `null` omits trireme.json entirely. */
  manifest?: Record<string, unknown> | null;
  /** `null` omits spec.md. */
  spec?: string | null;
  /** `null` omits contract.d.ts. */
  contract?: string | null;
  /** `null` omits the acceptance directory; `{}` leaves it empty. */
  acceptance?: Record<string, string> | null;
}

export interface TempJob {
  dir: string;
  runsDir: string;
  cleanup: () => void;
}

let counter = 0;

export function makeJob(spec: JobSpec = {}): TempJob {
  counter += 1;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `trireme-job-${process.pid}-${counter}-`));
  const dir = path.join(root, "job");
  const runsDir = path.join(root, "runs");
  fs.mkdirSync(dir, { recursive: true });

  if (spec.manifest !== null) {
    const manifest = { ...DEFAULT_MANIFEST, ...(spec.manifest ?? {}) };
    fs.writeFileSync(path.join(dir, "trireme.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (spec.spec !== null) {
    fs.writeFileSync(path.join(dir, "spec.md"), spec.spec ?? DEFAULT_SPEC);
  }
  if (spec.contract !== null) {
    fs.writeFileSync(path.join(dir, "contract.d.ts"), spec.contract ?? DEFAULT_CONTRACT);
  }
  if (spec.acceptance !== null) {
    const acceptanceDir = path.join(dir, "acceptance");
    fs.mkdirSync(acceptanceDir, { recursive: true });
    for (const [file, content] of Object.entries(spec.acceptance ?? DEFAULT_ACCEPTANCE)) {
      fs.writeFileSync(path.join(acceptanceDir, file), content);
    }
  }

  return {
    dir,
    runsDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** A clock the test drives by hand, so wall-clock behaviour needs no waiting. */
export function fakeClock(startMs = 1_700_000_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advanceMinutes: (minutes: number) => {
      current += minutes * 60_000;
    },
  };
}

export function readIfPresent(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

export function listDir(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}
