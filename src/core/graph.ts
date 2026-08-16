/**
 * The build graph: the modules the agent declared and what they hold.
 *
 * Trireme keeps this rather than inferring it from the directory tree so that a
 * module has a stated purpose as well as files — the same pair (purpose, tests)
 * that makes a package a package, one level down.
 */

export interface ModuleRecord {
  name: string;
  purpose: string;
  files: string[];
  tests: string[];
}

function insert(list: string[], name: string): void {
  if (!list.includes(name)) {
    list.push(name);
    list.sort();
  }
}

export class BuildGraph {
  private readonly modules = new Map<string, ModuleRecord>();

  declare(name: string, purpose: string): { created: boolean } {
    const existing = this.modules.get(name);
    if (existing) {
      existing.purpose = purpose;
      return { created: false };
    }
    this.modules.set(name, { name, purpose, files: [], tests: [] });
    return { created: true };
  }

  has(name: string): boolean {
    return this.modules.has(name);
  }

  get(name: string): ModuleRecord | undefined {
    return this.modules.get(name);
  }

  list(): ModuleRecord[] {
    return [...this.modules.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private require(name: string): ModuleRecord {
    const module = this.modules.get(name);
    if (!module) throw new Error(`Module "${name}" has not been declared.`);
    return module;
  }

  addFile(name: string, file: string): void {
    insert(this.require(name).files, file);
  }

  addTest(name: string, file: string): void {
    insert(this.require(name).tests, file);
  }

  removeFile(name: string, file: string): void {
    const module = this.require(name);
    module.files = module.files.filter((f) => f !== file);
  }

  removeTest(name: string, file: string): void {
    const module = this.require(name);
    module.tests = module.tests.filter((f) => f !== file);
  }

  remove(name: string): boolean {
    return this.modules.delete(name);
  }

  toJSON(): { modules: ModuleRecord[] } {
    return { modules: this.list() };
  }
}
