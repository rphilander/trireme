import { describe, expect, it } from "vitest";
import { compare, sort } from "semver-lite";

describe("compare orders by the numeric components first", () => {
  it("orders by major", () => {
    expect(compare("2.0.0", "1.9.9")).toBe(1);
  });

  it("orders by minor when major is equal", () => {
    expect(compare("1.2.0", "1.10.0")).toBe(-1);
  });

  it("orders by patch when major and minor are equal", () => {
    expect(compare("1.2.3", "1.2.10")).toBe(-1);
  });

  it("compares numerically, not as strings", () => {
    // The string comparison that people reach for first gets this backwards.
    expect(compare("1.10.0", "1.9.0")).toBe(1);
  });

  it("returns 0 for identical versions", () => {
    expect(compare("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("a prerelease has lower precedence than the release", () => {
  it("puts alpha before the release", () => {
    expect(compare("1.0.0-alpha", "1.0.0")).toBe(-1);
  });

  it("is symmetric", () => {
    expect(compare("1.0.0", "1.0.0-alpha")).toBe(1);
  });

  it("applies per version, not across them", () => {
    expect(compare("1.0.0", "1.0.1-alpha")).toBe(-1);
  });
});

describe("prerelease identifiers compare left to right", () => {
  it("compares numeric identifiers numerically", () => {
    expect(compare("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
  });

  it("compares alphanumeric identifiers in ASCII order", () => {
    expect(compare("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });

  it("ranks a numeric identifier below an alphanumeric one", () => {
    expect(compare("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  it("ranks more identifiers above fewer when the prefix is equal", () => {
    expect(compare("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  });

  it("does not compare numbers as strings", () => {
    // "11" < "2" as strings; 11 > 2 as numbers.
    expect(compare("1.0.0-11", "1.0.0-2")).toBe(1);
  });
});

describe("build metadata is ignored", () => {
  it("treats differing build metadata as equal precedence", () => {
    expect(compare("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });

  it("ignores build metadata when a prerelease is present", () => {
    expect(compare("1.0.0-alpha+a", "1.0.0-alpha+b")).toBe(0);
  });

  it("still honours the prerelease alongside build metadata", () => {
    expect(compare("1.0.0-alpha+z", "1.0.0+a")).toBe(-1);
  });
});

describe("the canonical ordering from the specification", () => {
  const ascending = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];

  it("holds for every adjacent pair", () => {
    for (let i = 0; i < ascending.length - 1; i += 1) {
      expect(compare(ascending[i]!, ascending[i + 1]!)).toBe(-1);
    }
  });

  it("is what sort produces from a shuffled input", () => {
    const shuffled = [...ascending].reverse();
    expect(sort(shuffled)).toEqual(ascending);
  });
});

describe("compare refuses input it cannot compare", () => {
  it("throws for an invalid left argument", () => {
    expect(() => compare("nope", "1.0.0")).toThrow(TypeError);
  });

  it("throws for an invalid right argument", () => {
    expect(() => compare("1.0.0", "1.2")).toThrow(TypeError);
  });

  it("does not quietly return 0", () => {
    // Returning 0 would make an unsortable list look sorted.
    let returned: unknown;
    try {
      returned = compare("bad", "worse");
    } catch {
      returned = "threw";
    }
    expect(returned).toBe("threw");
  });
});

describe("sort", () => {
  it("orders ascending by precedence", () => {
    expect(sort(["1.10.0", "1.2.0", "1.2.0-rc.1"])).toEqual(["1.2.0-rc.1", "1.2.0", "1.10.0"]);
  });

  it("does not modify its argument", () => {
    const input = ["2.0.0", "1.0.0"];
    sort(input);
    expect(input).toEqual(["2.0.0", "1.0.0"]);
  });

  it("returns a new array", () => {
    const input = ["1.0.0"];
    expect(sort(input)).not.toBe(input);
  });

  it("is stable for versions of equal precedence", () => {
    // Same precedence, distinguishable only by build metadata.
    expect(sort(["1.0.0+second", "1.0.0+first"])).toEqual(["1.0.0+second", "1.0.0+first"]);
  });

  it("handles an empty array", () => {
    expect(sort([])).toEqual([]);
  });

  it("throws if any element is invalid", () => {
    expect(() => sort(["1.0.0", "oops"])).toThrow(TypeError);
  });
});
