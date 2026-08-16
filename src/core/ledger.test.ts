/**
 * Purpose: account for what a run consumed, and know when it cannot.
 *
 * The agent runtime prices each message itself, so the ledger sums rather than
 * computes. The load-bearing distinction is between a run that cost nothing and
 * a run whose cost is unknowable: a flat-rate plan reports zero per message,
 * and recording that as $0.00 would quietly turn a cost cap into no cap at all.
 */
import { describe, expect, it } from "vitest";
import { RunLedger } from "./ledger.ts";

const usage = (input: number, output: number, costTotal: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
});

describe("a metered provider", () => {
  it("accumulates tokens by kind", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add(usage(1000, 200, 0.006));
    ledger.add(usage(1000, 200, 0.006));
    expect(ledger.tokens).toEqual({
      input: 2000,
      output: 400,
      cacheRead: 0,
      cacheWrite: 0,
      total: 2400,
    });
  });

  it("counts cached tokens in the total, since they were consumed", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 1 } });
    expect(ledger.tokens.total).toBe(100);
  });

  it("sums the cost the runtime reported for each message", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add(usage(1000, 200, 0.006));
    ledger.add(usage(1000, 200, 0.004));
    expect(ledger.costUsd).toBeCloseTo(0.01, 10);
    expect(ledger.priced).toBe(true);
  });

  it("starts at zero rather than at nothing", () => {
    const ledger = new RunLedger({ priced: true });
    expect(ledger.costUsd).toBe(0);
    expect(ledger.tokens.total).toBe(0);
  });
});

describe("a flat-rate provider", () => {
  it("reports no cost at all rather than a cost of zero", () => {
    const ledger = new RunLedger({ priced: false });
    ledger.add(usage(1000, 200, 0));
    expect(ledger.priced).toBe(false);
    expect(ledger.costUsd).toBeNull();
  });

  it("still counts tokens, because those are always real", () => {
    const ledger = new RunLedger({ priced: false });
    ledger.add(usage(1000, 200, 0));
    expect(ledger.tokens.total).toBe(1200);
  });
});

describe("the cost cap", () => {
  it("binds once the accumulated cost reaches it", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add(usage(1000, 200, 0.006));
    expect(ledger.exceeds(0.00005)).toBe(true);
    expect(ledger.exceeds(1)).toBe(false);
  });

  it("cannot bind at all when cost is unpriced", () => {
    // The alternative — treating unpriced as zero — makes the cap infinite
    // without saying so.
    const ledger = new RunLedger({ priced: false });
    ledger.add(usage(1_000_000, 1_000_000, 0));
    expect(ledger.exceeds(0.00001)).toBe(false);
  });
});

describe("a snapshot is what the caller and the report both read", () => {
  it("carries the run's shape as well as its consumption", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add(usage(1000, 200, 0.006));
    const snapshot = ledger.snapshot({ iterations: 3, wallClockMs: 4321, stalledMs: 1000 });
    expect(snapshot).toEqual({
      tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, total: 1200 },
      costUsd: 0.006,
      priced: true,
      iterations: 3,
      wallClockMs: 4321,
      stalledMs: 1000,
    });
  });

  it("does not alias the ledger's own counters", () => {
    const ledger = new RunLedger({ priced: true });
    const snapshot = ledger.snapshot({ iterations: 0, wallClockMs: 0, stalledMs: 0 });
    ledger.add(usage(1000, 200, 0.006));
    expect(snapshot.tokens.total).toBe(0);
  });
});

describe("usage the runtime reported incompletely", () => {
  it("treats a missing field as zero rather than as NaN", () => {
    const ledger = new RunLedger({ priced: true });
    ledger.add({ output: 200 } as never);
    expect(ledger.tokens.total).toBe(200);
    expect(ledger.costUsd).toBe(0);
  });
});
