// verdict.mjs — parse the machine-verdict line (RETRO-CONTRACT v1.8).
// The FIRST line of DECISION.md must be `BANK: <run>` or `REDO: <reason>`.
// Parsing is tolerant of markdown dressing (heading marks, bold, backticks,
// trailing period) but strict about substance: an unrecognizable line is
// INVALID and halts the pipeline — never guessed at.

export function parseVerdict(text) {
  const rawFirst = String(text ?? "").split("\n", 1)[0];
  // strip markdown dressing at the edges, keep interior intact
  const line = rawFirst
    .replace(/^[\s#>*_`]+/, "")
    .replace(/[\s*_`]+$/, "")
    .trim();

  let m = line.match(/^BANK:\s*`?([A-Za-z0-9._-]+)`?\s*(.*)$/i);
  if (m) {
    const run = m[1].replace(/[.,;:!]+$/, "");
    const rest = m[2].trim();
    // allow a parenthetical/dash aside after the run name, nothing wordier
    if (rest === "" || /^[(—–-]/.test(rest)) {
      return { kind: "BANK", run };
    }
    return { kind: "INVALID", line: rawFirst.trim() };
  }
  m = line.match(/^REDO:\s*(.+)$/i);
  if (m) return { kind: "REDO", reason: m[1].trim() };
  if (/^REDO:?\s*$/i.test(line)) return { kind: "REDO", reason: "" };
  return { kind: "INVALID", line: rawFirst.trim() };
}
