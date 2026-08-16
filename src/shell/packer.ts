/**
 * The run's artifact: a gzipped tar of the build output, laid out the way npm
 * lays one out.
 *
 * Written by hand so the bytes are reproducible — same build in, same tarball
 * out — which is what lets a future job pin a dependency by content hash rather
 * than by hope. Nothing here reads the clock.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { listFilesRecursively } from "./store.ts";

/** npm's own reproducible-build timestamp; any fixed value would do. */
const FIXED_MTIME = 499_162_500;
const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number): Buffer {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`Path too long for a tar entry: ${name}`);
  }
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "utf8");
  block.write(octal(0o644, 8), 100, 8, "utf8");
  block.write(octal(0, 8), 108, 8, "utf8");
  block.write(octal(0, 8), 116, 8, "utf8");
  block.write(octal(size, 12), 124, 12, "utf8");
  block.write(octal(FIXED_MTIME, 12), 136, 12, "utf8");
  block.fill(0x20, 148, 156); // checksum field is spaces while it is computed
  block.write("0", 156, 1, "utf8"); // regular file
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return block;
}

function pad(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

export function tar(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(header(entry.name, entry.content.length), entry.content, pad(entry.content.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

export interface PackOptions {
  workspace: string;
  outDir: string;
  manifest: { name: string; version: string; description?: string };
}

/** The manifest that ships, as opposed to the one the test run resolves against. */
function publishedManifest(manifest: PackOptions["manifest"]): string {
  const value: Record<string, unknown> = { name: manifest.name, version: manifest.version };
  if (manifest.description !== undefined) value["description"] = manifest.description;
  value["type"] = "module";
  value["main"] = "./dist/index.js";
  value["types"] = "./dist/index.d.ts";
  value["exports"] = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } };
  value["files"] = ["dist"];
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function packWorkspace(options: PackOptions): string {
  const distDir = path.join(options.workspace, "dist");
  const built = listFilesRecursively(distDir);
  if (built.length === 0) {
    throw new Error("The build produced no dist/ output, so there is nothing to pack.");
  }

  const entries = [
    { name: "package/package.json", content: Buffer.from(publishedManifest(options.manifest)) },
    ...built
      .slice()
      .sort()
      .map((relative) => ({
        name: `package/dist/${relative}`,
        content: fs.readFileSync(path.join(distDir, relative)),
      })),
  ];

  fs.mkdirSync(options.outDir, { recursive: true });
  const file = path.join(options.outDir, `${options.manifest.name}-${options.manifest.version}.tgz`);
  fs.writeFileSync(file, zlib.gzipSync(tar(entries), { level: 9 }));
  return file;
}
