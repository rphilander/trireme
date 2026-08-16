/**
 * Purpose: turn a successful build into the run's artifact — a tarball another
 * job could depend on.
 *
 * Written by hand rather than by shelling out to npm, because the artifact must
 * be byte-reproducible: two runs of the same build produce the same bytes, so a
 * content hash can identify it. That rules out embedding a timestamp.
 */
import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { packWorkspace } from "./packer.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trireme-pack-"));
  made.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), content);
  }
  return dir;
}

/** A deliberately independent reader, so the test does not trust the writer. */
function entriesOf(tarball: string): Map<string, string> {
  const raw = zlib.gunzipSync(fs.readFileSync(tarball));
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name === "") break;

    const stored = Number.parseInt(header.subarray(148, 156).toString("utf8").replace(/[\0 ].*$/, ""), 8);
    const zeroed = Buffer.from(header);
    zeroed.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of zeroed) sum += byte;
    expect(sum).toBe(stored);
    expect(header.subarray(257, 262).toString("utf8")).toBe("ustar");

    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/[\0 ].*$/, ""), 8);
    const body = raw.subarray(offset + 512, offset + 512 + size);
    if (header[156] === 0x30) entries.set(name, body.toString("utf8"));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const BUILT = {
  "dist/index.js": "export function add(a, b) { return a + b; }\n",
  "dist/index.d.ts": "export declare function add(a: number, b: number): number;\n",
  "dist/modules/arith/index.js": "export const two = 2;\n",
  "src/index.ts": "export function add(a: number, b: number) { return a + b; }\n",
};

const MANIFEST = { name: "adder", version: "0.1.0" };

describe("what goes into the artifact", () => {
  it("packs the build output under the conventional package/ prefix", () => {
    const dir = workspace(BUILT);
    const tarball = packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST });
    const entries = entriesOf(tarball);
    expect([...entries.keys()]).toContain("package/dist/index.js");
    expect(entries.get("package/dist/index.js")).toBe(BUILT["dist/index.js"]);
  });

  it("keeps nested build output", () => {
    const dir = workspace(BUILT);
    const tarball = packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST });
    expect([...entriesOf(tarball).keys()]).toContain("package/dist/modules/arith/index.js");
  });

  it("leaves the source, the tests and the harness's scaffolding out", () => {
    const dir = workspace({ ...BUILT, "acceptance/x.test.ts": "x", "conformance.ts": "y" });
    const entries = entriesOf(
      packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST }),
    );
    const names = [...entries.keys()].join(" ");
    expect(names).not.toContain("acceptance");
    expect(names).not.toContain("conformance");
    expect(names).not.toContain("package/src/");
  });

  it("remaps module imports to the build output, so #name resolves in the artifact too", () => {
    const dir = workspace(BUILT);
    const entries = entriesOf(
      packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST, modules: ["arith"] }),
    );
    const packaged = JSON.parse(entries.get("package/package.json")!);
    expect(packaged.imports).toEqual({ "#arith": "./dist/modules/arith/index.js" });
  });

  it("omits the imports key when there are no modules", () => {
    const dir = workspace(BUILT);
    const entries = entriesOf(
      packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST }),
    );
    expect("imports" in JSON.parse(entries.get("package/package.json")!)).toBe(false);
  });

  it("writes a manifest that points at the build, not at the source", () => {
    const dir = workspace(BUILT);
    const entries = entriesOf(
      packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST }),
    );
    const packaged = JSON.parse(entries.get("package/package.json")!);
    expect(packaged.name).toBe("adder");
    expect(packaged.version).toBe("0.1.0");
    expect(JSON.stringify(packaged.exports)).toContain("./dist/index.js");
    expect(JSON.stringify(packaged.exports)).not.toContain("src/index.ts");
  });
});

describe("the file it produces", () => {
  it("is named after the package and its version", () => {
    const dir = workspace(BUILT);
    const tarball = packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST });
    expect(path.basename(tarball)).toBe("adder-0.1.0.tgz");
    expect(fs.existsSync(tarball)).toBe(true);
  });

  it("is gzip, as the extension claims", () => {
    const dir = workspace(BUILT);
    const tarball = packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST });
    const magic = fs.readFileSync(tarball).subarray(0, 2);
    expect([...magic]).toEqual([0x1f, 0x8b]);
  });

  it("is byte-identical for identical input", () => {
    const first = workspace(BUILT);
    const second = workspace(BUILT);
    const a = fs.readFileSync(
      packWorkspace({ workspace: first, outDir: path.join(first, "out"), manifest: MANIFEST }),
    );
    const b = fs.readFileSync(
      packWorkspace({ workspace: second, outDir: path.join(second, "out"), manifest: MANIFEST }),
    );
    expect(a.equals(b)).toBe(true);
  });
});

describe("a build that produced nothing", () => {
  it("refuses to pretend it packed a package", () => {
    const dir = workspace({ "src/index.ts": "export {};\n" });
    expect(() => packWorkspace({ workspace: dir, outDir: path.join(dir, "out"), manifest: MANIFEST })).toThrow(
      /dist/,
    );
  });
});
