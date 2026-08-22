import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdict } from "../verdict.mjs";

test("plain BANK", () => {
  assert.deepEqual(parseVerdict("BANK: entry9-2\n\nrationale..."), { kind: "BANK", run: "entry9-2" });
});
test("BANK with markdown dressing", () => {
  assert.equal(parseVerdict("**BANK: `entry9-1`**\nrest").run, "entry9-1");
  assert.equal(parseVerdict("# BANK: entry9-3").run, "entry9-3");
  assert.equal(parseVerdict("BANK: entry9-2.").run, "entry9-2");
  assert.equal(parseVerdict("  BANK:entry10-1  ").run, "entry10-1");
});
test("BANK with parenthetical aside is accepted", () => {
  assert.equal(parseVerdict("BANK: entry9-2 (unanimous on the gate)").run, "entry9-2");
  assert.equal(parseVerdict("BANK: entry9-2 — cleanest surface").run, "entry9-2");
});
test("BANK with wordy trailer is INVALID (contract: exactly one form)", () => {
  assert.equal(parseVerdict("BANK: entry9-2 because it was best").kind, "INVALID");
});
test("REDO with reason", () => {
  const v = parseVerdict("REDO: brief mis-scoped the module boundary\n...");
  assert.equal(v.kind, "REDO");
  assert.match(v.reason, /mis-scoped/);
});
test("bare REDO", () => {
  assert.equal(parseVerdict("REDO:").kind, "REDO");
  assert.equal(parseVerdict("REDO").kind, "REDO");
});
test("old-style heading first line is INVALID", () => {
  assert.equal(parseVerdict("# DECISION — entry-8 winner: `entry8-3`").kind, "INVALID");
});
test("empty / missing text is INVALID", () => {
  assert.equal(parseVerdict("").kind, "INVALID");
  assert.equal(parseVerdict(null).kind, "INVALID");
});
test("BANK is not read from a later line", () => {
  assert.equal(parseVerdict("winner below\nBANK: entry9-2").kind, "INVALID");
});
