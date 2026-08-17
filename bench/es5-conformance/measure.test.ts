import { describe, expect, it } from "vitest";
import { score } from "./measure.ts";
import { LIVENESS, SENTINEL, type Case, type EvalResult } from "./test262.ts";

const H = "HARNESS;\n";
const cases: Case[] = [
  { chapter: "addition", id: "addition/a", body: "A;\n", expected: null, phase: null },
  { chapter: "addition", id: "addition/b", body: "B;\n", expected: null, phase: null },
  { chapter: "modulus", id: "modulus/c", body: "C;\n", expected: null, phase: null },
];

// A run that "really executes": for a positive assembly it echoes the sentinel
// (present because LIVENESS was appended), for a negative it echoes nothing.
const correct = (s: string): EvalResult =>
  s.includes(SENTINEL) ? { output: [SENTINEL], error: null } : { output: [], error: null };

describe("score", () => {
  it("scores a correct run at 100% with per-chapter counts", () => {
    const s = score(correct, H, cases);
    expect(s.passed).toBe(3);
    expect(s.total).toBe(3);
    expect(s.byChapter.addition).toEqual({ n: 2, pass: 2 });
    expect(s.byChapter.modulus).toEqual({ n: 1, pass: 1 });
  });

  it("scores the no-op interpreter at 0% (the liveness guard)", () => {
    const s = score(() => ({ output: [], error: null }), H, cases);
    expect(s.passed).toBe(0);
    expect(s.byChapter.addition.pass).toBe(0);
  });

  it("attributes partial credit to the right chapter", () => {
    // passes only bodies from the modulus chapter
    const partial = (s: string): EvalResult =>
      s.includes("C;") && s.includes(SENTINEL) ? { output: [SENTINEL], error: null } : { output: [], error: null };
    const s = score(partial, H, cases);
    expect(s.passed).toBe(1);
    expect(s.byChapter.addition).toEqual({ n: 2, pass: 0 });
    expect(s.byChapter.modulus).toEqual({ n: 1, pass: 1 });
  });

  it("appends LIVENESS to positive assemblies the run receives", () => {
    const seen: string[] = [];
    score((s) => { seen.push(s); return { output: [SENTINEL], error: null }; }, H, cases.slice(0, 1));
    expect(seen[0]).toBe(H + "A;\n" + LIVENESS);
  });
});
