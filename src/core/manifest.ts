/**
 * Parsing and validation of `trireme.json`.
 *
 * Pure: it is handed the file's bytes, never a path, so validation is testable
 * without a filesystem and the same code answers both `readManifest` and the
 * check that runs before a job starts.
 */
import type { Diagnostic, Manifest, ManifestResult, Overrides, ThinkingLevel } from "./types.ts";

const THINKING_LEVELS: readonly string[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const MANIFEST_FILE = "trireme.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  field: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const value = source[field];
  if (typeof value === "string" && value.length > 0) return value;
  diagnostics.push({
    field,
    message:
      value === undefined
        ? `${MANIFEST_FILE} is missing "${field}".`
        : `${MANIFEST_FILE} field "${field}" must be a non-empty string.`,
  });
  return undefined;
}

function requirePositive(
  source: Record<string, unknown> | undefined,
  parent: string,
  field: string,
  diagnostics: Diagnostic[],
): number | undefined {
  const path = `${parent}.${field}`;
  const value = source?.[field];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  diagnostics.push({
    field: path,
    message:
      value === undefined
        ? `${MANIFEST_FILE} is missing "${path}".`
        : `${MANIFEST_FILE} field "${path}" must be a number greater than zero.`,
  });
  return undefined;
}

/** Parses and validates a manifest. `undefined` means the file was not there. */
export function parseManifest(text: string | undefined): ManifestResult {
  if (text === undefined) {
    return { ok: false, diagnostics: [{ message: `${MANIFEST_FILE} is missing from the job directory.` }] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, diagnostics: [{ message: `${MANIFEST_FILE} is not valid JSON: ${detail}` }] };
  }

  if (!isRecord(raw)) {
    return { ok: false, diagnostics: [{ message: `${MANIFEST_FILE} must contain a JSON object.` }] };
  }

  const diagnostics: Diagnostic[] = [];
  const name = requireString(raw, "name", diagnostics);
  const version = requireString(raw, "version", diagnostics);
  const model = requireString(raw, "model", diagnostics);

  const limitsRaw = raw["limits"];
  if (limitsRaw !== undefined && !isRecord(limitsRaw)) {
    diagnostics.push({ field: "limits", message: `${MANIFEST_FILE} field "limits" must be an object.` });
  }
  const limits = isRecord(limitsRaw) ? limitsRaw : undefined;
  const costUsd = requirePositive(limits, "limits", "costUsd", diagnostics);
  const wallClockMinutes = requirePositive(limits, "limits", "wallClockMinutes", diagnostics);

  const safetyRaw = raw["safety"];
  if (safetyRaw !== undefined && !isRecord(safetyRaw)) {
    diagnostics.push({ field: "safety", message: `${MANIFEST_FILE} field "safety" must be an object.` });
  }
  const safety = isRecord(safetyRaw) ? safetyRaw : undefined;
  const maxIterations = requirePositive(safety, "safety", "maxIterations", diagnostics);

  let thinking: ThinkingLevel | undefined;
  const thinkingRaw = raw["thinking"];
  if (thinkingRaw !== undefined) {
    if (typeof thinkingRaw === "string" && THINKING_LEVELS.includes(thinkingRaw)) {
      thinking = thinkingRaw as ThinkingLevel;
    } else {
      diagnostics.push({
        field: "thinking",
        message: `${MANIFEST_FILE} field "thinking" must be one of ${THINKING_LEVELS.join(", ")}.`,
      });
    }
  }

  let description: string | undefined;
  const descriptionRaw = raw["description"];
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw === "string") {
      description = descriptionRaw;
    } else {
      diagnostics.push({
        field: "description",
        message: `${MANIFEST_FILE} field "description" must be a string.`,
      });
    }
  }

  const dependenciesRaw = raw["dependencies"];
  let dependencies: Record<string, string> = {};
  if (dependenciesRaw !== undefined) {
    if (!isRecord(dependenciesRaw)) {
      diagnostics.push({
        field: "dependencies",
        message: `${MANIFEST_FILE} field "dependencies" must be an object.`,
      });
    } else if (Object.keys(dependenciesRaw).length > 0) {
      diagnostics.push({
        field: "dependencies",
        message:
          "This version of trireme does not install dependencies; the manifest's dependencies must be empty.",
      });
    } else {
      dependencies = {};
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const manifest: Manifest = {
    name: name!,
    version: version!,
    model: model!,
    limits: { costUsd: costUsd!, wallClockMinutes: wallClockMinutes! },
    safety: { maxIterations: maxIterations! },
    dependencies,
  };
  if (description !== undefined) manifest.description = description;
  if (thinking !== undefined) manifest.thinking = thinking;
  return { ok: true, manifest };
}

/** Returns a new manifest with per-run overrides applied. */
export function applyOverrides(manifest: Manifest, overrides: Overrides | undefined): Manifest {
  const next: Manifest = {
    ...manifest,
    limits: { ...manifest.limits },
    safety: { ...manifest.safety },
    dependencies: { ...manifest.dependencies },
  };
  if (!overrides) return next;
  if (overrides.model !== undefined) next.model = overrides.model;
  if (overrides.thinking !== undefined) next.thinking = overrides.thinking;
  if (overrides.costUsd !== undefined) next.limits.costUsd = overrides.costUsd;
  if (overrides.wallClockMinutes !== undefined) next.limits.wallClockMinutes = overrides.wallClockMinutes;
  if (overrides.maxIterations !== undefined) next.safety.maxIterations = overrides.maxIterations;
  return next;
}
