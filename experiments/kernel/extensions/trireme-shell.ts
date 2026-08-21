/**
 * trireme-shell.ts — pi extension: shell time budgeting (+ optional ambient
 * time/cost stamp). Settled design 2026-08-21 (wiki harness/pipeline.md).
 *
 * - bash `timeout` (seconds, builtin param) defaults to 1s when the agent
 *   does not pass one; values beyond the session's remaining wall are
 *   clamped. The timeout error gains a policy line (the teaching surface).
 * - If TRIREME_STAMP=1, every tool result gets an ambient stamp:
 *   `took Xs · MM:SS of MM:SS remaining · $Y.YY spent`. No behavior change
 *   near the wall — the stamp is the same shape throughout.
 *
 * Env (set by launch-world.sh): TRIREME_WALL_CAP_S, TRIREME_STAMP.
 */
const CAP_S = Number(process.env.TRIREME_WALL_CAP_S ?? "5400");
const STAMP = process.env.TRIREME_STAMP === "1";
const START = Date.now();
const remaining = () => Math.max(0, CAP_S - (Date.now() - START) / 1000);
const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default (pi: any) => {
  let cost = 0;
  const started = new Map<string, number>();

  pi.on("message_end", (event: any) => {
    const c = event?.message?.usage?.cost?.total;
    if (typeof c === "number") cost += c;
  });

  pi.on("tool_call", (event: any) => {
    if (event.toolCallId) started.set(event.toolCallId, Date.now());
    if (event.toolName !== "bash") return;
    const input = event.input ?? (event.input = {});
    const rem = Math.max(1, Math.floor(remaining()));
    if (input.timeout === undefined || input.timeout === null) input.timeout = 1;
    else if (input.timeout > rem) input.timeout = rem;
  });

  pi.on("tool_result", (event: any) => {
    const extra: any[] = [];
    const t0 = started.get(event.toolCallId);
    started.delete(event.toolCallId);

    if (event.toolName === "bash" && event.isError) {
      const text = (event.content ?? [])
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("\n");
      if (/timeout:|timed out/i.test(text)) {
        const t = event.input?.timeout;
        extra.push({
          type: "text",
          text:
            `[policy] the command hit its ${t}s budget. bash commands here ` +
            `default to a 1s timeout; pass timeout (seconds) explicitly for ` +
            `longer work. Session wall remaining: ${mmss(remaining())}.`,
        });
      }
    }
    if (STAMP) {
      const took = t0 ? `took ${((Date.now() - t0) / 1000).toFixed(1)}s · ` : "";
      extra.push({
        type: "text",
        text: `⏱ ${took}${mmss(remaining())} of ${mmss(CAP_S)} remaining · $${cost.toFixed(3)} spent`,
      });
    }
    if (!extra.length) return;
    return { content: [...(event.content ?? []), ...extra] };
  });
};
