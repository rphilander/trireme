import { describe, expect, it } from "vitest";
import { satisfies } from "semver-lite";

describe("the wildcard range", () => {
  it("matches any release", () => {
    expect(satisfies("0.0.1", "*")).toBe(true);
    expect(satisfies("99.0.0", "*")).toBe(true);
  });
});

describe("an exact range", () => {
  it("matches only the same version", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  });

  it("matches by precedence, so build metadata is irrelevant", () => {
    expect(satisfies("1.2.3+other", "1.2.3")).toBe(true);
  });
});

describe("caret ranges hold the leftmost non-zero component", () => {
  it("allows minor and patch increases above 1.x.x", () => {
    expect(satisfies("1.2.3", "^1.2.3")).toBe(true);
    expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "^1.2.3")).toBe(true);
  });

  it("excludes the next major", () => {
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
  });

  it("excludes anything below the floor", () => {
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
    expect(satisfies("0.9.9", "^1.2.3")).toBe(false);
  });

  it("holds the minor when major is zero", () => {
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
  });

  it("holds the patch when major and minor are zero", () => {
    expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
  });
});

describe("tilde ranges allow patch increases only", () => {
  it("allows a higher patch", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
  });

  it("excludes the next minor", () => {
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  });

  it("excludes a lower patch", () => {
    expect(satisfies("1.2.2", "~1.2.3")).toBe(false);
  });
});

describe("comparator ranges", () => {
  it("handles >= and >", () => {
    expect(satisfies("1.2.3", ">=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", ">1.2.3")).toBe(false);
    expect(satisfies("1.2.4", ">1.2.3")).toBe(true);
  });

  it("handles <= and <", () => {
    expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "<1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "<1.2.3")).toBe(true);
  });

  it("handles an explicit =", () => {
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "=1.2.3")).toBe(false);
  });

  it("treats a space-separated series as a conjunction", () => {
    expect(satisfies("1.5.0", ">=1.2.0 <2.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.2.0 <2.0.0")).toBe(false);
    expect(satisfies("1.1.0", ">=1.2.0 <2.0.0")).toBe(false);
  });
});

describe("prereleases are excluded unless the range asks for them", () => {
  it("does not match a prerelease against a plain caret range", () => {
    expect(satisfies("1.2.3-alpha", "^1.0.0")).toBe(false);
  });

  it("does not match a prerelease against a comparator with no prerelease", () => {
    expect(satisfies("1.2.3-alpha", ">=1.0.0")).toBe(false);
  });

  it("matches when the range names a prerelease of the same version", () => {
    expect(satisfies("1.2.3-beta", "^1.2.3-alpha")).toBe(true);
  });

  it("still respects precedence among prereleases of that version", () => {
    expect(satisfies("1.2.3-alpha", "^1.2.3-beta")).toBe(false);
  });

  it("does not extend the exemption to a different version", () => {
    // The range mentions a prerelease of 1.2.3, which says nothing about 1.3.0.
    expect(satisfies("1.3.0-alpha", "^1.2.3-alpha")).toBe(false);
  });

  it("matches ordinary releases inside such a range as usual", () => {
    expect(satisfies("1.9.0", "^1.2.3-alpha")).toBe(true);
  });
});

describe("satisfies refuses input it cannot evaluate", () => {
  it("throws for an invalid version", () => {
    expect(() => satisfies("1.2", "^1.0.0")).toThrow(TypeError);
  });

  it("throws for an unsupported range syntax", () => {
    expect(() => satisfies("1.2.3", "1.2.x")).toThrow(TypeError);
    expect(() => satisfies("1.2.3", "1.0.0 || 2.0.0")).toThrow(TypeError);
    expect(() => satisfies("1.2.3", "")).toThrow(TypeError);
  });
});
