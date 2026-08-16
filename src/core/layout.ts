/**
 * The one place that turns the agent's names into workspace paths.
 *
 * No tool accepts a filesystem path, so this module is the whole of the
 * mapping. It normalises what can be normalised — `x`, `x.ts` and `x.js` are
 * one implementation file — and where it must refuse, it names the tool that
 * was wanted instead of simply saying no.
 */

export const ENTRY_PATH = "src/index.ts";
export const CONTRACT_PATH = "contract.d.ts";
export const SPEC_PATH = "spec.md";
export const ACCEPTANCE_PATH = "acceptance";
export const MODULES_DIR = "src/modules";
export const CONFORMANCE_PATH = "conformance.ts";

export type Resolution<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Resolution<T> => ({ ok: true, value });
const no = <T>(message: string): Resolution<T> => ({ ok: false, message });

const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const BASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_MODULE_NAMES = new Set(["acceptance", "node_modules", "dist", "src", "modules"]);

function looksLikeAPath(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name.includes("..");
}

/** Strips one recognised source extension, if present. */
function stripExtension(name: string): string {
  for (const extension of SOURCE_EXTENSIONS) {
    if (name.endsWith(extension)) return name.slice(0, -extension.length);
  }
  return name;
}

interface ParsedName {
  base: string;
  isTest: boolean;
}

function parseFileName(raw: string): Resolution<ParsedName> {
  const name = raw.trim();
  if (name.length === 0) return no("A file name is required.");
  if (looksLikeAPath(name)) {
    return no(
      `"${raw}" looks like a path. Tools address files by name only; a module is one flat directory.`,
    );
  }
  let base = stripExtension(name);
  let isTest = false;
  if (base.endsWith(".test")) {
    base = base.slice(0, -".test".length);
    isTest = true;
  }
  if (!BASE_PATTERN.test(base)) {
    return no(`"${raw}" is not a usable file name. Use letters, digits, dots, dashes or underscores.`);
  }
  return ok({ base, isTest });
}

/** `x`, `x.ts` and `x.js` all name the implementation file `x.ts`. */
export function normalizeImplFile(raw: string): Resolution<string> {
  const parsed = parseFileName(raw);
  if (!parsed.ok) return parsed;
  if (parsed.value.isTest) {
    return no(
      `"${raw}" names a test file. Use write_module_test to write a module's tests; ` +
        "write_module_file is for implementation files only.",
    );
  }
  return ok(`${parsed.value.base}.ts`);
}

/** `x`, `x.ts` and `x.test.ts` all name the test file `x.test.ts`. */
export function normalizeTestFile(raw: string): Resolution<string> {
  const parsed = parseFileName(raw);
  if (!parsed.ok) return parsed;
  return ok(`${parsed.value.base}.test.ts`);
}

export function normalizeModuleName(raw: string): Resolution<string> {
  const name = raw.trim();
  if (name.length === 0) return no("A module name is required.");
  if (looksLikeAPath(name)) {
    return no(`"${raw}" looks like a path. A module is named, not located.`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return no(
      `"${raw}" is not a usable module name. Use lowercase letters, digits and dashes, starting with a letter or digit.`,
    );
  }
  if (RESERVED_MODULE_NAMES.has(name)) {
    return no(`"${name}" is reserved by the workspace layout. Choose another module name.`);
  }
  return ok(name);
}

export function moduleDir(module: string): string {
  return `${MODULES_DIR}/${module}`;
}

export function moduleFilePath(module: string, file: string): string {
  return `${moduleDir(module)}/${file}`;
}

export function acceptanceFilePath(file: string): string {
  return `${ACCEPTANCE_PATH}/${file}`;
}

/** Matches a requested name against the suite's real file names. */
export function resolveAcceptanceFile(raw: string, available: readonly string[]): Resolution<string> {
  const name = raw.trim();
  if (name.length === 0) return no("A test file name is required.");
  if (looksLikeAPath(name)) {
    return no(`"${raw}" looks like a path. Acceptance tests are addressed by file name.`);
  }
  if (available.includes(name)) return ok(name);

  const parsed = parseFileName(name);
  if (parsed.ok) {
    const candidate = `${parsed.value.base}.test.ts`;
    if (available.includes(candidate)) return ok(candidate);
  }
  return no(
    `There is no acceptance test called "${raw}". The suite is: ${available.join(", ")}.`,
  );
}
