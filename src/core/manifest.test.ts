/**
 * Purpose: turn the bytes of `trireme.json` into a manifest, or into every
 * reason it is not one.
 *
 * Diagnostics are plural on purpose. The caller is often a generator that
 * authored the job, and it can fix five fields as cheaply as one — but only if
 * it is told about all five.
 */
import { describe, expect, it } from "vitest";
import { applyOverrides, parseManifest } from "./manifest.ts";
import type { Manifest } from "./types.ts";

const VALID = {
  name: "adder",
  version: "0.1.0",
  model: "scripted/scripted-1",
  thinking: "off",
  limits: { costUsd: 1, wallClockMinutes: 5 },
  safety: { maxIterations: 10 },
  dependencies: {},
};

const text = (value: unknown) => JSON.stringify(value);

function manifestOf(value: unknown): Manifest {
  const result = parseManifest(text(value));
  if (!result.ok) throw new Error(`expected a valid manifest: ${JSON.stringify(result.diagnostics)}`);
  return result.manifest;
}

describe("a well-formed manifest", () => {
  it("resolves every required field", () => {
    const manifest = manifestOf(VALID);
    expect(manifest.name).toBe("adder");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.model).toBe("scripted/scripted-1");
    expect(manifest.limits.costUsd).toBe(1);
    expect(manifest.limits.wallClockMinutes).toBe(5);
    expect(manifest.safety.maxIterations).toBe(10);
  });

  it("keeps optional fields optional", () => {
    const manifest = manifestOf({ ...VALID, thinking: undefined, description: undefined });
    expect(manifest.thinking).toBeUndefined();
    expect(manifest.description).toBeUndefined();
  });

  it("accepts a description when one is given", () => {
    expect(manifestOf({ ...VALID, description: "Adds." }).description).toBe("Adds.");
  });
});

describe("a manifest that is not there at all", () => {
  it("names the file rather than complaining about parsing", () => {
    const result = parseManifest(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.message).toContain("trireme.json");
    }
  });

  it("names the file when it is not JSON", () => {
    const result = parseManifest("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]!.message).toContain("trireme.json");
  });

  it("rejects JSON that is not an object", () => {
    for (const value of ["[]", "42", "null", '"adder"']) {
      expect(parseManifest(value).ok).toBe(false);
    }
  });
});

describe("missing and malformed fields", () => {
  const diagnosticsFor = (value: unknown) => {
    const result = parseManifest(text(value));
    return result.ok ? [] : result.diagnostics;
  };

  it("reports the field it is talking about", () => {
    const diagnostics = diagnosticsFor({ ...VALID, model: undefined });
    expect(diagnostics.some((d) => d.field === "model")).toBe(true);
  });

  it("uses a dotted path for a nested field", () => {
    expect(diagnosticsFor({ ...VALID, limits: { wallClockMinutes: 5 } })).toContainEqual(
      expect.objectContaining({ field: "limits.costUsd" }),
    );
    expect(diagnosticsFor({ ...VALID, safety: {} })).toContainEqual(
      expect.objectContaining({ field: "safety.maxIterations" }),
    );
  });

  it("reports every problem at once", () => {
    const diagnostics = diagnosticsFor({ ...VALID, name: undefined, model: undefined, limits: undefined });
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
    const fields = diagnostics.map((d) => d.field);
    expect(fields).toContain("name");
    expect(fields).toContain("model");
  });

  it("rejects a limit that is not a positive number", () => {
    expect(diagnosticsFor({ ...VALID, limits: { costUsd: -1, wallClockMinutes: 5 } }).length).toBe(1);
    expect(diagnosticsFor({ ...VALID, limits: { costUsd: "1", wallClockMinutes: 5 } }).length).toBe(1);
    expect(diagnosticsFor({ ...VALID, safety: { maxIterations: 0 } }).length).toBe(1);
  });

  it("rejects a thinking level outside the known set", () => {
    expect(diagnosticsFor({ ...VALID, thinking: "ludicrous" })).toContainEqual(
      expect.objectContaining({ field: "thinking" }),
    );
  });

  it("rejects declared dependencies, which v1 does not install", () => {
    const diagnostics = diagnosticsFor({ ...VALID, dependencies: { lodash: "^4" } });
    expect(diagnostics.some((d) => /dependenc/i.test(d.message))).toBe(true);
  });

  it("treats an absent dependencies key as no dependencies", () => {
    expect(manifestOf({ ...VALID, dependencies: undefined }).dependencies).toEqual({});
  });
});

describe("overrides take precedence over the manifest", () => {
  it("replaces only what it names", () => {
    const manifest = applyOverrides(manifestOf(VALID), { model: "openrouter/x/y", costUsd: 0.5 });
    expect(manifest.model).toBe("openrouter/x/y");
    expect(manifest.limits.costUsd).toBe(0.5);
    expect(manifest.limits.wallClockMinutes).toBe(5);
    expect(manifest.safety.maxIterations).toBe(10);
  });

  it("leaves the manifest untouched when nothing is overridden", () => {
    const base = manifestOf(VALID);
    expect(applyOverrides(base, {})).toEqual(base);
    expect(applyOverrides(base, undefined)).toEqual(base);
  });

  it("does not mutate its input", () => {
    const base = manifestOf(VALID);
    applyOverrides(base, { costUsd: 99, maxIterations: 2 });
    expect(base.limits.costUsd).toBe(1);
    expect(base.safety.maxIterations).toBe(10);
  });
});
