/**
 * The twenty-one tools the agent has, and no others.
 *
 * Each is named for the thing it addresses rather than taking a path or a
 * polymorphic target, so its description carries its own meaning and invalid
 * states are not representable: there is no tool that writes an acceptance
 * test, so the suite is immutable structurally rather than by a check.
 *
 * Where a call cannot be honoured the tool throws with a message naming what to
 * do instead. That becomes an error tool result; it does not end the run.
 *
 * Every mutating tool carries a status footer: the harness runs the cheap
 * checks itself the moment the workspace changes, so the agent learns where it
 * stands without spending a turn to ask.
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  ACCEPTANCE_PATH,
  ENTRY_PATH,
  MODULES_DIR,
  moduleDir,
  moduleFilePath,
  moduleImportSpecifier,
  normalizeImplFile,
  normalizeModuleName,
  normalizeTestFile,
  resolveAcceptanceFile,
} from "../core/layout.ts";
import type { Resolution } from "../core/layout.ts";
import type { BuildGraph } from "../core/graph.ts";
import { renderStatus } from "../core/status.ts";
import type { TestSummary } from "../core/types.ts";

const READ_LIMIT = 80_000;

export type TestScope = { kind: "acceptance" } | { kind: "module"; module: string };

/** What the tools need from the runner: the checks, nothing about processes. */
export interface Checker {
  typecheck(): Promise<{ ok: boolean; diagnostics: string[] }>;
  runTests(scope: TestScope): Promise<{ ok: boolean; summary: TestSummary; error?: string }>;
}

export interface ToolContext {
  workspace: string;
  spec: string;
  contract: string;
  acceptanceFiles: string[];
  graph: BuildGraph;
  checker: Checker;
  /** Called whenever a tool changed the workspace. Feeds the no-progress rule. */
  onMutation: () => void;
  /** Called when a module was declared or deleted, so the layout can follow. */
  onGraphChange: () => void;
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: {} });

function unwrap<T>(resolution: Resolution<T>): T {
  if (!resolution.ok) throw new Error(resolution.message);
  return resolution.value;
}

function readFile(root: string, relative: string): string {
  let content: string;
  try {
    content = fs.readFileSync(path.join(root, relative), "utf8");
  } catch {
    throw new Error(`There is no file called "${relative.split("/").pop()}" yet.`);
  }
  return content.length > READ_LIMIT ? `${content.slice(0, READ_LIMIT)}\n… (truncated)` : content;
}

function writeFile(root: string, relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function applyEdit(current: string, find: string, replace: string, replaceAll: boolean): string {
  if (find === "") throw new Error("The text to find must not be empty.");
  const occurrences = current.split(find).length - 1;
  if (occurrences === 0) {
    throw new Error("That text does not appear in the file. Read it again and match it exactly.");
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `That text appears ${occurrences} times. Include more surrounding context, or pass replaceAll.`,
    );
  }
  return replaceAll ? current.split(find).join(replace) : current.replace(find, replace);
}

function requireModule(context: ToolContext, raw: string): string {
  const name = unwrap(normalizeModuleName(raw));
  if (!context.graph.has(name)) {
    const known = context.graph.list().map((m) => m.name);
    throw new Error(
      `There is no module called "${name}". Declare it first with declare_module.` +
        (known.length > 0 ? ` Declared modules: ${known.join(", ")}.` : ""),
    );
  }
  return name;
}

function renderSummary(label: string, summary: TestSummary): string {
  const lines = [`${label}: ${summary.passed}/${summary.total} passing, ${summary.failed} failing.`];
  for (const failure of summary.failures) {
    const where = failure.line === undefined ? failure.file : `${failure.file}:${failure.line}`;
    lines.push("", `- ${where} — ${failure.name}`);
    for (const line of failure.message.split("\n")) lines.push(`    ${line}`);
  }
  if (summary.truncated > 0) {
    lines.push("", `${summary.truncated} further failures were not listed.`);
  }
  return lines.join("\n");
}

const didNotRun = (what: string, error: unknown): TestSummary => ({
  total: 0,
  passed: 0,
  failed: 1,
  truncated: 0,
  failures: [
    {
      file: what,
      name: "(did not run)",
      message: error instanceof Error ? error.message : String(error),
    },
  ],
});

/**
 * The checks the harness runs after every mutation, concurrently: they are
 * independent subprocesses and the slowest of them bounds the wait. A check
 * that fails to run reports that; it never fails the write it rides on.
 */
async function statusAfter(context: ToolContext, touchedModule: string | undefined): Promise<string> {
  const [typecheck, acceptance, moduleTests] = await Promise.all([
    context.checker.typecheck().catch((error: unknown) => ({
      ok: false,
      diagnostics: [`typecheck did not run: ${error instanceof Error ? error.message : String(error)}`],
    })),
    context.checker
      .runTests({ kind: "acceptance" })
      .then((run) => run.summary)
      .catch((error: unknown) => didNotRun("acceptance", error)),
    touchedModule === undefined
      ? Promise.resolve(undefined)
      : context.checker
          .runTests({ kind: "module", module: touchedModule })
          .then((run) => run.summary)
          .catch((error: unknown) => didNotRun(touchedModule, error)),
  ]);
  return renderStatus({
    typecheck,
    acceptance,
    ...(touchedModule !== undefined && moduleTests
      ? { module: { name: touchedModule, tests: moduleTests } }
      : {}),
  });
}

const EDIT_PARAMS = {
  find: Type.String({ description: "Exact text to find. Must appear in the file." }),
  replace: Type.String({ description: "Text to put in its place." }),
  replaceAll: Type.Optional(Type.Boolean({ description: "Replace every occurrence instead of one." })),
};

const MODULE_PARAM = Type.String({ description: "Name of a module you declared." });
const FILE_PARAM = Type.String({ description: "File name within the module. No paths." });

export function createTools(context: ToolContext): ToolDefinition[] {
  const { workspace } = context;

  /**
   * Runs a mutation, then appends the status footer. `touched` names the module
   * whose tests belong in the footer, or nothing when the module no longer
   * exists or the entry point was the target.
   */
  async function mutate(
    message: string,
    touched: string | undefined,
    apply: () => void,
  ): Promise<ReturnType<typeof text>> {
    apply();
    context.onMutation();
    const footer = await statusAfter(context, touched);
    return text(`${message}\n${footer}`);
  }

  const readSpec = defineTool({
    name: "read_spec",
    label: "read spec",
    description: "Read the job's specification: what the package must be and mean.",
    promptSnippet: "read_spec — the job's specification",
    parameters: Type.Object({}),
    async execute() {
      return text(context.spec);
    },
  });

  const readContract = defineTool({
    name: "read_contract",
    label: "read contract",
    description: "Read contract.d.ts: the exact public API the package must export.",
    promptSnippet: "read_contract — the public API the package must export",
    parameters: Type.Object({}),
    async execute() {
      return text(context.contract);
    },
  });

  const listAcceptanceTests = defineTool({
    name: "list_acceptance_tests",
    label: "list acceptance tests",
    description: "List the acceptance suite's files by name. The suite decides when the job is finished.",
    promptSnippet: "list_acceptance_tests — the names of the files that decide done",
    parameters: Type.Object({}),
    async execute() {
      return text(
        context.acceptanceFiles.length === 0
          ? "The acceptance suite is empty."
          : context.acceptanceFiles.join("\n"),
      );
    },
  });

  const readAcceptanceTest = defineTool({
    name: "read_acceptance_test",
    label: "read acceptance test",
    description: "Read one acceptance test file. You cannot change these files.",
    promptSnippet: "read_acceptance_test — read one of them",
    parameters: Type.Object({ file: Type.String({ description: "Name from list_acceptance_tests." }) }),
    async execute(_id, params) {
      const file = unwrap(resolveAcceptanceFile(params.file, context.acceptanceFiles));
      return text(readFile(workspace, `${ACCEPTANCE_PATH}/${file}`));
    },
  });

  const readEntry = defineTool({
    name: "read_entry",
    label: "read entry point",
    description: "Read the package's entry point, which exports its public API.",
    promptSnippet: "read_entry — the package's entry point",
    parameters: Type.Object({}),
    async execute() {
      return text(readFile(workspace, ENTRY_PATH));
    },
  });

  const writeEntry = defineTool({
    name: "write_entry",
    label: "write entry point",
    description: "Replace the entry point's contents. Prefer edit_entry for a small change.",
    promptSnippet: "write_entry / edit_entry — write it",
    parameters: Type.Object({ content: Type.String() }),
    execute(_id, params) {
      return mutate("Wrote the entry point.", undefined, () => {
        writeFile(workspace, ENTRY_PATH, params.content);
      });
    },
  });

  const editEntry = defineTool({
    name: "edit_entry",
    label: "edit entry point",
    description: "Replace an exact fragment of the entry point.",
    parameters: Type.Object(EDIT_PARAMS),
    execute(_id, params) {
      const current = readFile(workspace, ENTRY_PATH);
      const next = applyEdit(current, params.find, params.replace, params.replaceAll ?? false);
      return mutate("Edited the entry point.", undefined, () => {
        writeFile(workspace, ENTRY_PATH, next);
      });
    },
  });

  const listModules = defineTool({
    name: "list_modules",
    label: "list modules",
    description: "List the modules you have declared: purpose, import name, files and tests.",
    promptSnippet: "list_modules / declare_module — decompose the work",
    parameters: Type.Object({}),
    async execute() {
      const modules = context.graph.list();
      if (modules.length === 0) return text("No modules have been declared yet.");
      return text(
        modules
          .map((module) =>
            [
              `${module.name} — ${module.purpose}`,
              `  import: ${moduleImportSpecifier(module.name)}`,
              `  files: ${module.files.join(", ") || "none"}`,
              `  tests: ${module.tests.join(", ") || "none"}`,
            ].join("\n"),
          )
          .join("\n"),
      );
    },
  });

  const declareModule = defineTool({
    name: "declare_module",
    label: "declare module",
    description:
      "Declare a module and say what it is for. A module is a flat directory of files with its own tests; " +
      "its public surface is its index.ts, and it is imported anywhere by name.",
    parameters: Type.Object({
      name: Type.String({ description: "Lowercase, dashes allowed." }),
      purpose: Type.String({ description: "One or two sentences: what this module is responsible for." }),
    }),
    execute(_id, params) {
      const name = unwrap(normalizeModuleName(params.name));
      if (params.purpose.trim().length === 0) {
        throw new Error("A module needs a stated purpose; that is what makes it a module and not a file.");
      }
      let created = false;
      return mutate("", undefined, () => {
        created = context.graph.declare(name, params.purpose.trim()).created;
        fs.mkdirSync(path.join(workspace, moduleDir(name)), { recursive: true });
        context.onGraphChange();
      }).then((result) => {
        const specifier = moduleImportSpecifier(name);
        const head = created
          ? `Declared module "${name}". Its public surface is index.ts; import it anywhere as \`${specifier}\`. ` +
            `Files inside the module import each other as "./file.js".`
          : `Updated the purpose of module "${name}". It is still imported as \`${specifier}\`.`;
        return text(`${head}${result.content[0]!.text}`);
      });
    },
  });

  const readModuleFile = defineTool({
    name: "read_module_file",
    label: "read module file",
    description: "Read an implementation file inside a module.",
    promptSnippet: "read/write/edit/delete_module_file — a module's implementation files",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM }),
    async execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeImplFile(params.file));
      return text(readFile(workspace, moduleFilePath(module, file)));
    },
  });

  const writeModuleFile = defineTool({
    name: "write_module_file",
    label: "write module file",
    description: "Write an implementation file inside a module. Use write_module_test for its tests.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM, content: Type.String() }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeImplFile(params.file));
      return mutate(`Wrote ${file} in module "${module}".`, module, () => {
        writeFile(workspace, moduleFilePath(module, file), params.content);
        context.graph.addFile(module, file);
      });
    },
  });

  const editModuleFile = defineTool({
    name: "edit_module_file",
    label: "edit module file",
    description: "Replace an exact fragment of an implementation file inside a module.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM, ...EDIT_PARAMS }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeImplFile(params.file));
      const relative = moduleFilePath(module, file);
      const next = applyEdit(readFile(workspace, relative), params.find, params.replace, params.replaceAll ?? false);
      return mutate(`Edited ${file} in module "${module}".`, module, () => {
        writeFile(workspace, relative, next);
      });
    },
  });

  const deleteModuleFile = defineTool({
    name: "delete_module_file",
    label: "delete module file",
    description: "Delete an implementation file from a module.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeImplFile(params.file));
      const target = path.join(workspace, moduleFilePath(module, file));
      if (!fs.existsSync(target)) throw new Error(`Module "${module}" has no file called ${file}.`);
      return mutate(`Deleted ${file} from module "${module}".`, module, () => {
        fs.rmSync(target);
        context.graph.removeFile(module, file);
      });
    },
  });

  const readModuleTest = defineTool({
    name: "read_module_test",
    label: "read module test",
    description: "Read a module's test file.",
    promptSnippet: "read/write/edit/delete_module_test — a module's own test suite",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM }),
    async execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeTestFile(params.file));
      return text(readFile(workspace, moduleFilePath(module, file)));
    },
  });

  const writeModuleTest = defineTool({
    name: "write_module_test",
    label: "write module test",
    description:
      "Write a test file for a module. These are yours to write and run; they are not the acceptance suite.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM, content: Type.String() }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeTestFile(params.file));
      return mutate(`Wrote ${file} in module "${module}".`, module, () => {
        writeFile(workspace, moduleFilePath(module, file), params.content);
        context.graph.addTest(module, file);
      });
    },
  });

  const editModuleTest = defineTool({
    name: "edit_module_test",
    label: "edit module test",
    description: "Replace an exact fragment of a module's test file.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM, ...EDIT_PARAMS }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeTestFile(params.file));
      const relative = moduleFilePath(module, file);
      const next = applyEdit(readFile(workspace, relative), params.find, params.replace, params.replaceAll ?? false);
      return mutate(`Edited ${file} in module "${module}".`, module, () => {
        writeFile(workspace, relative, next);
      });
    },
  });

  const deleteModuleTest = defineTool({
    name: "delete_module_test",
    label: "delete module test",
    description: "Delete a test file from a module.",
    parameters: Type.Object({ module: MODULE_PARAM, file: FILE_PARAM }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      const file = unwrap(normalizeTestFile(params.file));
      const target = path.join(workspace, moduleFilePath(module, file));
      if (!fs.existsSync(target)) throw new Error(`Module "${module}" has no test called ${file}.`);
      return mutate(`Deleted ${file} from module "${module}".`, module, () => {
        fs.rmSync(target);
        context.graph.removeTest(module, file);
      });
    },
  });

  const deleteModule = defineTool({
    name: "delete_module",
    label: "delete module",
    description: "Delete a module and everything in it.",
    parameters: Type.Object({ module: MODULE_PARAM }),
    execute(_id, params) {
      const module = requireModule(context, params.module);
      return mutate(`Deleted module "${module}".`, undefined, () => {
        fs.rmSync(path.join(workspace, moduleDir(module)), { recursive: true, force: true });
        context.graph.remove(module);
        context.onGraphChange();
      });
    },
  });

  const runAcceptanceTests = defineTool({
    name: "run_acceptance_tests",
    label: "run acceptance tests",
    description:
      "Run the acceptance suite and see every failure in detail. The score already appears after each change; " +
      "this is for the detail. It decides nothing — the harness runs its own gate.",
    promptSnippet: "run_acceptance_tests / run_module_tests / typecheck — the detail behind the status",
    parameters: Type.Object({}),
    async execute() {
      const run = await context.checker.runTests({ kind: "acceptance" });
      return text(renderSummary("Acceptance suite", run.summary));
    },
  });

  const runModuleTests = defineTool({
    name: "run_module_tests",
    label: "run module tests",
    description: "Run one module's own test suite and see every failure in detail.",
    parameters: Type.Object({ module: MODULE_PARAM }),
    async execute(_id, params) {
      const module = requireModule(context, params.module);
      const run = await context.checker.runTests({ kind: "module", module });
      if (run.summary.total === 0 && run.summary.failed === 0) {
        return text(`Module "${module}" has no tests yet.`);
      }
      return text(renderSummary(`Module "${module}"`, run.summary));
    },
  });

  const typecheck = defineTool({
    name: "typecheck",
    label: "typecheck",
    description:
      "Typecheck the implementation, the acceptance suite and the contract together, and see every diagnostic.",
    parameters: Type.Object({}),
    async execute() {
      const check = await context.checker.typecheck();
      if (check.ok) return text("The typecheck passes.");
      return text(
        [`The typecheck reports ${check.diagnostics.length} problem(s):`, "", ...check.diagnostics].join("\n"),
      );
    },
  });

  return [
    readSpec,
    readContract,
    listAcceptanceTests,
    readAcceptanceTest,
    readEntry,
    writeEntry,
    editEntry,
    listModules,
    declareModule,
    readModuleFile,
    writeModuleFile,
    editModuleFile,
    deleteModuleFile,
    readModuleTest,
    writeModuleTest,
    editModuleTest,
    deleteModuleTest,
    deleteModule,
    runAcceptanceTests,
    runModuleTests,
    typecheck,
  ] as ToolDefinition[];
}

export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "write_entry",
  "edit_entry",
  "declare_module",
  "write_module_file",
  "edit_module_file",
  "delete_module_file",
  "write_module_test",
  "edit_module_test",
  "delete_module_test",
  "delete_module",
]);

export { MODULES_DIR };
