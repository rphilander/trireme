/**
 * Purpose: check that a job's `spec.md` is a specification and not a sketch.
 *
 * The check is structural, not semantic — trireme cannot tell whether a
 * paragraph is any good. What it can insist on is that the sections a spec
 * needs are present and have something in them, and it says which one is
 * missing rather than that the spec is bad.
 */
import { describe, expect, it } from "vitest";
import { REQUIRED_SECTIONS, sectionsOf, validateSpec } from "./spec.ts";

const COMPLETE = `# adder

## Purpose

Adds numbers.

## Public API

\`add(a, b)\`.

## Behavior

Total over finite numbers.

## Constraints

Pure, no dependencies.

## Non-goals

No arbitrary precision.
`;

describe("a complete spec", () => {
  it("passes", () => {
    expect(validateSpec(COMPLETE)).toEqual([]);
  });

  it("tolerates extra sections", () => {
    expect(validateSpec(`${COMPLETE}\n## Examples\n\nSee the tests.\n`)).toEqual([]);
  });

  it("reads the sections out in order", () => {
    expect(sectionsOf(COMPLETE).map((s) => s.title)).toEqual([
      "Purpose",
      "Public API",
      "Behavior",
      "Constraints",
      "Non-goals",
    ]);
  });

  it("does not mistake a top-level title for a section", () => {
    expect(sectionsOf(COMPLETE).some((s) => s.title === "adder")).toBe(false);
  });
});

describe("a spec that is not there", () => {
  it("names the file", () => {
    const diagnostics = validateSpec(undefined);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("spec.md");
  });
});

describe("a section that is missing", () => {
  it("names the section rather than saying the spec is bad", () => {
    const without = COMPLETE.replace(/## Constraints[\s\S]*?(?=## Non-goals)/, "");
    const diagnostics = validateSpec(without);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Constraints");
    expect(diagnostics[0]!.field).toBe("Constraints");
  });

  it("names each missing section separately", () => {
    const diagnostics = validateSpec("# adder\n\n## Purpose\n\nAdds.\n");
    expect(diagnostics).toHaveLength(REQUIRED_SECTIONS.length - 1);
  });
});

describe("a section that is present but empty", () => {
  it("is refused, because an empty heading specifies nothing", () => {
    const empty = COMPLETE.replace(/## Constraints[\s\S]*?(?=## Non-goals)/, "## Constraints\n\n");
    const diagnostics = validateSpec(empty);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("Constraints");
  });

  it("treats whitespace as empty", () => {
    const empty = COMPLETE.replace(/## Constraints[\s\S]*?(?=## Non-goals)/, "## Constraints\n\n   \n\n");
    expect(validateSpec(empty)).toHaveLength(1);
  });

  it("counts a subsection as content", () => {
    const nested = COMPLETE.replace(
      /## Constraints[\s\S]*?(?=## Non-goals)/,
      "## Constraints\n\n### Purity\n\nNo I/O.\n\n",
    );
    expect(validateSpec(nested)).toEqual([]);
  });
});

describe("heading matching", () => {
  it("ignores case and surrounding whitespace", () => {
    const shouted = COMPLETE.replace("## Public API", "##   PUBLIC API   ");
    expect(validateSpec(shouted)).toEqual([]);
  });

  it("does not match a heading mentioned inside a fenced code block", () => {
    const fenced = `# adder

## Purpose

\`\`\`md
## Public API
\`\`\`

## Public API

Real one.

## Behavior

x

## Constraints

x

## Non-goals

x
`;
    expect(validateSpec(fenced)).toEqual([]);
    expect(sectionsOf(fenced).filter((s) => s.title === "Public API")).toHaveLength(1);
  });
});
