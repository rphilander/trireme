/**
 * Purpose: decide whether a job directory is a job, before anything is created
 * or charged.
 *
 * The module is pure — it is handed the four things a job is made of, already
 * read — so the rule about what a job must contain is stated once and tested
 * without a filesystem.
 */
import { describe, expect, it } from "vitest";
import { validateJob } from "./job.ts";
import type { JobInput } from "./job.ts";

const MANIFEST = JSON.stringify({
  name: "adder",
  version: "0.1.0",
  model: "scripted/scripted-1",
  limits: { costUsd: 1, wallClockMinutes: 5 },
  safety: { maxIterations: 10 },
  dependencies: {},
});

const SPEC = `# adder

## Purpose

Adds.

## Public API

\`add\`.

## Behavior

Total.

## Constraints

Pure.

## Non-goals

Nothing else.
`;

const COMPLETE: JobInput = {
  manifestText: MANIFEST,
  specText: SPEC,
  contractText: "export declare function add(a: number, b: number): number;\n",
  acceptanceFiles: ["adder.test.ts"],
};

const diagnosticsOf = (input: JobInput) => {
  const result = validateJob(input);
  return result.ok ? [] : result.diagnostics;
};

describe("a complete job", () => {
  it("resolves to its manifest", () => {
    const result = validateJob(COMPLETE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe("adder");
  });
});

describe("each missing part is named", () => {
  it("names the manifest", () => {
    expect(diagnosticsOf({ ...COMPLETE, manifestText: undefined }).some((d) => /trireme\.json/.test(d.message))).toBe(
      true,
    );
  });

  it("names the spec", () => {
    expect(diagnosticsOf({ ...COMPLETE, specText: undefined }).some((d) => /spec\.md/.test(d.message))).toBe(true);
  });

  it("names the contract", () => {
    expect(
      diagnosticsOf({ ...COMPLETE, contractText: undefined }).some((d) => /contract\.d\.ts/.test(d.message)),
    ).toBe(true);
  });

  it("names the acceptance directory when it is absent", () => {
    expect(diagnosticsOf({ ...COMPLETE, acceptanceFiles: undefined }).some((d) => /acceptance/.test(d.message))).toBe(
      true,
    );
  });

  it("names the acceptance directory when it is empty", () => {
    expect(diagnosticsOf({ ...COMPLETE, acceptanceFiles: [] }).some((d) => /acceptance/.test(d.message))).toBe(true);
  });

  it("refuses an acceptance directory with no test file in it", () => {
    expect(diagnosticsOf({ ...COMPLETE, acceptanceFiles: ["fixtures.json"] }).some((d) => /acceptance/.test(d.message))).toBe(
      true,
    );
  });
});

describe("problems are reported together", () => {
  it("collects manifest, spec and layout problems in one pass", () => {
    const diagnostics = diagnosticsOf({
      manifestText: JSON.stringify({ version: "0.1.0" }),
      specText: "# adder\n",
      contractText: undefined,
      acceptanceFiles: [],
    });
    expect(diagnostics.some((d) => /trireme\.json/.test(d.message))).toBe(true);
    expect(diagnostics.some((d) => /spec\.md/.test(d.message))).toBe(true);
    expect(diagnostics.some((d) => /contract\.d\.ts/.test(d.message))).toBe(true);
    expect(diagnostics.some((d) => /acceptance/.test(d.message))).toBe(true);
  });

  it("reports a spec problem even when the manifest is also broken", () => {
    // A generator that fixes one file per run pays for a run per mistake.
    const diagnostics = diagnosticsOf({ ...COMPLETE, manifestText: "{", specText: "# adder\n" });
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
  });
});
