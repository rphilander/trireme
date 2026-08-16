#!/usr/bin/env python3
"""Tabulate trireme runs from their report.json + events.jsonl.

Usage: bench/tabulate.py runs/<id> [runs/<id> ...]

Not a campaign runner — that is deliberately out of scope. This reads what
runs already left behind and lines them up, so a change to the harness can be
seen against the runs that preceded it.
"""
import json
import statistics
import sys
from collections import Counter
from pathlib import Path


def load(run_dir: Path):
    report = json.loads((run_dir / "report.json").read_text())
    events = [json.loads(l) for l in (run_dir / "events.jsonl").read_text().splitlines() if l.strip()]
    msgs = [e for e in events if e["type"] == "assistant_message"]
    calls = Counter(e["tool"] for e in events if e["type"] == "tool_call")
    errors = sum(1 for e in events if e["type"] == "tool_result" and not e.get("ok", True))
    gates = [e for e in events if e["type"] == "gate"]
    return {
        "id": run_dir.name,
        "outcome": report["outcome"],
        "iter": report["ledger"]["iterations"],
        "msgs": len(msgs),
        "calls": sum(calls.values()),
        "errors": errors,
        "cost": report["ledger"]["costUsd"],
        "out_tok": report["ledger"]["tokens"]["output"],
        "wall_s": report["ledger"]["wallClockMs"] / 1000,
        "tests": f'{report["tests"]["passed"]}/{report["tests"]["total"]}' if report.get("tests") else "-",
        "modules": ",".join(m["name"] for m in report.get("modules", [])) or "-",
        "mod_tests": sum(len(m["tests"]) for m in report.get("modules", [])),
        "prompt": report["provenance"]["systemPromptHash"][:8],
        "model": report["provenance"]["model"].split("/")[-1],
        # Requested thinking level, and what the model actually received when
        # the report records it (runs before 2026-08-16 22:00 UTC do not).
        "thinking": (
            report["provenance"]["thinking"]
            if report["provenance"].get("thinkingEffective") in (None, report["provenance"]["thinking"])
            else f'{report["provenance"]["thinking"]}>{report["provenance"]["thinkingEffective"]}'
        ),
        "gates": len(gates),
        "top_calls": ", ".join(f"{k}×{v}" for k, v in calls.most_common(4)),
    }


def main(argv):
    rows = [load(Path(p)) for p in argv]
    cols = ["id", "prompt", "model", "thinking", "outcome", "tests", "iter", "msgs", "calls", "errors", "cost", "wall_s", "modules", "mod_tests"]
    widths = {c: max(len(c), *(len(f"{r[c]:.3f}" if isinstance(r[c], float) else str(r[c])) for r in rows)) for c in cols}
    fmt = lambda r, c: (f"{r[c]:.3f}" if isinstance(r[c], float) else str(r[c])).ljust(widths[c])
    print("  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows:
        print("  ".join(fmt(r, c) for c in cols))
    print()
    for r in rows:
        print(f"{r['id']}: {r['top_calls']}")
    same = [r for r in rows if r["prompt"] == rows[-1]["prompt"] and r["outcome"] == "success"]
    if len(same) >= 2:
        print()
        print(f"across {len(same)} successful runs on prompt {rows[-1]['prompt']}:")
        for c in ("cost", "msgs", "calls", "wall_s"):
            vals = [r[c] for r in same]
            print(f"  {c:6s} min {min(vals):8.3f}  median {statistics.median(vals):8.3f}  max {max(vals):8.3f}")


if __name__ == "__main__":
    main(sys.argv[1:])
