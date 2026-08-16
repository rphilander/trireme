/**
 * Purpose: classify how a run ended, and say what a caller should do about it.
 *
 * The grouping is the point: a caller running many jobs continues past a
 * `failed:*`, stops on `aborted:infra`, and fixes its own inputs on
 * `error:usage`. Exit codes are that grouping made visible to a shell.
 */
import { describe, expect, it } from "vitest";
import { OUTCOMES, exitCodeFor, isFailure, isTerminalForCampaign } from "./outcome.ts";

describe("exit codes group outcomes by what the caller should do", () => {
  it("maps success to 0", () => {
    expect(exitCodeFor("success")).toBe(0);
  });

  it("maps every job failure to 1", () => {
    expect(exitCodeFor("failed:cost_cap")).toBe(1);
    expect(exitCodeFor("failed:wall_clock")).toBe(1);
    expect(exitCodeFor("failed:no_progress")).toBe(1);
    expect(exitCodeFor("failed:iteration_cap")).toBe(1);
  });

  it("maps an infrastructure abort to 2", () => {
    expect(exitCodeFor("aborted:infra")).toBe(2);
  });

  it("maps misuse to 3", () => {
    expect(exitCodeFor("error:usage")).toBe(3);
  });

  it("has a code for every outcome the contract declares", () => {
    expect(OUTCOMES).toHaveLength(7);
    for (const outcome of OUTCOMES) {
      expect([0, 1, 2, 3]).toContain(exitCodeFor(outcome));
    }
  });
});

describe("classification helpers", () => {
  it("treats only the failed:* family as job failure", () => {
    expect(isFailure("failed:cost_cap")).toBe(true);
    expect(isFailure("failed:iteration_cap")).toBe(true);
    expect(isFailure("aborted:infra")).toBe(false);
    expect(isFailure("success")).toBe(false);
  });

  it("tells a campaign to stop only for an infrastructure abort", () => {
    expect(isTerminalForCampaign("aborted:infra")).toBe(true);
    expect(isTerminalForCampaign("failed:wall_clock")).toBe(false);
    expect(isTerminalForCampaign("success")).toBe(false);
  });
});
