import { describe, expect, it } from "vitest";
import { parse, valid } from "semver-lite";

describe("parse accepts well-formed versions", () => {
  it("reads the three numeric components", () => {
    expect(parse("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [], build: [] });
  });

  it("accepts zeros", () => {
    expect(parse("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0, prerelease: [], build: [] });
  });

  it("accepts large components", () => {
    const parsed = parse("999.888.777");
    expect(parsed).toMatchObject({ major: 999, minor: 888, patch: 777 });
  });

  it("splits prerelease identifiers on dots", () => {
    expect(parse("1.0.0-alpha.beta")?.prerelease).toEqual(["alpha", "beta"]);
  });

  it("returns numeric prerelease identifiers as numbers", () => {
    expect(parse("1.0.0-beta.11")?.prerelease).toEqual(["beta", 11]);
  });

  it("keeps build identifiers as strings even when they look numeric", () => {
    expect(parse("1.0.0+21.007")?.build).toEqual(["21", "007"]);
  });

  it("reads prerelease and build together", () => {
    expect(parse("1.2.3-rc.1+build.5")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["rc", 1],
      build: ["build", "5"],
    });
  });

  it("accepts hyphens inside identifiers", () => {
    expect(parse("1.0.0-alpha-1")?.prerelease).toEqual(["alpha-1"]);
  });

  it("accepts a prerelease identifier of zero", () => {
    expect(parse("1.0.0-0")?.prerelease).toEqual([0]);
  });
});

describe("parse rejects malformed versions without throwing", () => {
  const bad = [
    "",
    "1",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "-1.2.3",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-+build",
    "1.2.3-01",
    "1.2.3-a..b",
    "1.2.3-a.",
    "1.2.3+a..b",
    "1.2.3 ",
    " 1.2.3",
    "v1.2.3",
    "1.2.3-beta!",
    "a.b.c",
  ];

  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parse(input)).toBeNull();
    });
  }
});

describe("valid is the predicate form of parse", () => {
  it("agrees with parse on well-formed input", () => {
    expect(valid("1.2.3-rc.1+build")).toBe(true);
  });

  it("agrees with parse on malformed input", () => {
    expect(valid("1.2.3-01")).toBe(false);
  });
});

describe("parse does not leak mutable state", () => {
  it("returns independent results for repeated calls", () => {
    const first = parse("1.0.0-alpha.1");
    const second = parse("1.0.0-alpha.1");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
