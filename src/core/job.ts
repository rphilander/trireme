/**
 * What a job directory must contain, checked before anything is created.
 *
 * Pure: the caller reads the four parts and this decides. Every problem is
 * reported, never just the first, because the author of a job is usually a
 * generator that can fix them all at once.
 */
import { MANIFEST_FILE, parseManifest } from "./manifest.ts";
import { SPEC_FILE, validateSpec } from "./spec.ts";
import type { Diagnostic, Manifest } from "./types.ts";

export const CONTRACT_FILE = "contract.d.ts";
export const ACCEPTANCE_DIR = "acceptance";

export interface JobInput {
  /** `undefined` when the file is absent. */
  manifestText?: string;
  specText?: string;
  contractText?: string;
  /** Names of the files in `acceptance/`. `undefined` when the directory is absent. */
  acceptanceFiles?: string[];
}

export type JobResult = { ok: true; manifest: Manifest } | { ok: false; diagnostics: Diagnostic[] };

export function validateJob(input: JobInput): JobResult {
  const diagnostics: Diagnostic[] = [];

  const manifest = parseManifest(input.manifestText);
  if (!manifest.ok) diagnostics.push(...manifest.diagnostics);

  diagnostics.push(...validateSpec(input.specText));

  if (input.contractText === undefined) {
    diagnostics.push({ message: `${CONTRACT_FILE} is missing from the job directory.` });
  } else if (input.contractText.trim().length === 0) {
    diagnostics.push({ message: `${CONTRACT_FILE} is empty; it must declare the package's public API.` });
  }

  if (input.acceptanceFiles === undefined) {
    diagnostics.push({ message: `${ACCEPTANCE_DIR}/ is missing from the job directory.` });
  } else if (input.acceptanceFiles.length === 0) {
    diagnostics.push({ message: `${ACCEPTANCE_DIR}/ is empty; a job is defined by its acceptance suite.` });
  } else if (!input.acceptanceFiles.some((file) => file.endsWith(".test.ts"))) {
    diagnostics.push({
      message: `${ACCEPTANCE_DIR}/ contains no *.test.ts file; a job is defined by its acceptance suite.`,
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  if (!manifest.ok) {
    // Unreachable: a failed parse always contributes at least one diagnostic.
    return { ok: false, diagnostics: [{ message: `${MANIFEST_FILE} could not be resolved.` }] };
  }
  return { ok: true, manifest: manifest.manifest };
}
