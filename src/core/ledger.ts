/**
 * What a run consumed.
 *
 * The agent runtime prices every message from its own model registry, so this
 * sums what it is told rather than keeping a price table that would drift. When
 * the provider publishes no per-token prices the ledger says so instead of
 * recording zero — a cost cap that cannot be enforced must be visible, not
 * silently infinite.
 */
import type { Ledger, TokenCounts } from "./types.ts";

/** The parts of an assistant message's usage that the ledger reads. */
export interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

const finite = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export class RunLedger {
  readonly priced: boolean;
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private cost = 0;
  private messages = 0;

  constructor(options: { priced: boolean }) {
    this.priced = options.priced;
  }

  add(usage: UsageLike | undefined): void {
    if (!usage) return;
    this.messages += 1;
    this.input += finite(usage.input);
    this.output += finite(usage.output);
    this.cacheRead += finite(usage.cacheRead);
    this.cacheWrite += finite(usage.cacheWrite);
    this.cost += finite(usage.cost?.total);
  }

  /** How many assistant messages have been charged. */
  get messageCount(): number {
    return this.messages;
  }

  get tokens(): TokenCounts {
    return {
      input: this.input,
      output: this.output,
      cacheRead: this.cacheRead,
      cacheWrite: this.cacheWrite,
      total: this.input + this.output + this.cacheRead + this.cacheWrite,
    };
  }

  get costUsd(): number | null {
    return this.priced ? this.cost : null;
  }

  /** False when unpriced: an unenforceable cap must never read as satisfied-by-accident. */
  exceeds(capUsd: number): boolean {
    return this.priced && this.cost >= capUsd;
  }

  snapshot(shape: { iterations: number; wallClockMs: number; stalledMs: number }): Ledger {
    return {
      tokens: this.tokens,
      costUsd: this.costUsd,
      priced: this.priced,
      iterations: shape.iterations,
      wallClockMs: shape.wallClockMs,
      stalledMs: shape.stalledMs,
    };
  }
}
