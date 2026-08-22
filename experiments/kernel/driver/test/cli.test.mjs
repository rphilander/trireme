// cli.test.mjs — the driver CLI's argument parser: pairs, bare flags
// (--from-grading), and flags adjacent to pairs must not shift each other.
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../driver.mjs";

test("pairs parse as key/value", () => {
  assert.deepEqual(parseArgs(["--entry", "entry-9", "--cycles", "2"]), { entry: "entry-9", cycles: "2" });
});
test("bare flag between pairs does not shift parsing", () => {
  assert.deepEqual(
    parseArgs(["--entry", "entry-10", "--from-grading", "--max-wall", "18000"]),
    { entry: "entry-10", "from-grading": true, "max-wall": "18000" }
  );
});
test("bare flag at the end", () => {
  assert.deepEqual(parseArgs(["--entry", "entry-9", "--from-grading"]), { entry: "entry-9", "from-grading": true });
});
