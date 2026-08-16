/**
 * Purpose: generate the workspace the agent works in, from the manifest alone.
 *
 * Determinism is the whole point. The same manifest must produce byte-identical
 * files, in any directory, on any machine — otherwise two benchmark runs differ
 * for a reason nobody can see, and the run identifier stops being the only
 * varying part of a run directory.
 */
import { describe, expect, it } from "vitest";
import { GENERATED_PATHS, scaffoldWorkspace } from "./scaffold.ts";
import type { Manifest } from "./types.ts";

const MANIFEST: Manifest = {
  name: "adder",
  version: "0.1.0",
  description: "Adds and multiplies two numbers.",
  model: "scripted/scripted-1",
  limits: { costUsd: 1, wallClockMinutes: 5 },
  safety: { maxIterations: 10 },
  dependencies: {},
};

const fileMap = (manifest: Manifest) =>
  new Map(scaffoldWorkspace(manifest).map((f) => [f.path, f.content]));

describe("what gets generated", () => {
  it("writes exactly the files the workspace needs", () => {
    expect([...fileMap(MANIFEST).keys()].sort()).toEqual([...GENERATED_PATHS].sort());
  });

  it("names the package after the manifest, so the suite's import resolves", () => {
    const packageJson = JSON.parse(fileMap(MANIFEST).get("package.json")!);
    expect(packageJson.name).toBe("adder");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.type).toBe("module");
  });

  it("points the package at its source, because tests run on source", () => {
    const packageJson = JSON.parse(fileMap(MANIFEST).get("package.json")!);
    expect(JSON.stringify(packageJson.exports)).toContain("./src/index.ts");
  });

  it("collects the acceptance suite and each module's own tests", () => {
    const config = fileMap(MANIFEST).get("vitest.config.ts")!;
    expect(config).toContain("acceptance/");
    expect(config).toContain("src/modules/");
  });

  it("leaves an entry point that typechecks but satisfies nothing", () => {
    const entry = fileMap(MANIFEST).get("src/index.ts")!;
    expect(entry).not.toContain("export function");
    expect(entry).toContain("export {}");
  });

  it("asserts the implementation and the contract against each other", () => {
    const conformance = fileMap(MANIFEST).get("conformance.ts")!;
    expect(conformance).toContain("./contract.d.ts");
    expect(conformance).toContain("./src/index.ts");
  });

  it("gives the build its own configuration, excluding tests from the artifact", () => {
    const build = JSON.parse(fileMap(MANIFEST).get("tsconfig.build.json")!);
    expect(build.compilerOptions.noEmit).toBe(false);
    expect(build.compilerOptions.declaration).toBe(true);
    expect(JSON.stringify(build.exclude)).toContain(".test.ts");
  });
});

describe("determinism", () => {
  it("produces byte-identical files for the same manifest", () => {
    expect(scaffoldWorkspace(MANIFEST)).toEqual(scaffoldWorkspace({ ...MANIFEST }));
  });

  it("does not embed a path, a date or a run identifier", () => {
    for (const file of scaffoldWorkspace(MANIFEST)) {
      expect(file.content).not.toMatch(/\/tmp\//);
      expect(file.content).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(file.content).not.toMatch(/[0-9a-f]{16,}/);
    }
  });

  it("differs when the manifest differs", () => {
    const other = fileMap({ ...MANIFEST, name: "subtractor" });
    expect(other.get("package.json")).not.toBe(fileMap(MANIFEST).get("package.json"));
  });

  it("emits files in a stable order", () => {
    expect(scaffoldWorkspace(MANIFEST).map((f) => f.path)).toEqual(
      scaffoldWorkspace(MANIFEST).map((f) => f.path),
    );
  });
});

describe("the manifest's optional parts", () => {
  it("carries a description through when there is one", () => {
    const packageJson = JSON.parse(fileMap(MANIFEST).get("package.json")!);
    expect(packageJson.description).toBe("Adds and multiplies two numbers.");
  });

  it("omits the key entirely when there is none", () => {
    const { description: _drop, ...withoutDescription } = MANIFEST;
    const packageJson = JSON.parse(fileMap(withoutDescription).get("package.json")!);
    expect("description" in packageJson).toBe(false);
  });
});

describe("every generated file is well formed", () => {
  it("emits parseable JSON where it claims to", () => {
    const files = fileMap(MANIFEST);
    for (const [path, content] of files) {
      if (path.endsWith(".json")) expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it("ends every file with a newline", () => {
    for (const file of scaffoldWorkspace(MANIFEST)) {
      expect(file.content.endsWith("\n")).toBe(true);
    }
  });
});
