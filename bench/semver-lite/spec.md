# semver-lite

## Purpose

A dependency-free implementation of Semantic Versioning 2.0.0 parsing and precedence, plus a deliberately small subset of the range syntax used by npm. It is the kind of package that is easy to get roughly right and hard to get exactly right: the precedence rules have several edge cases that ordinary intuition gets wrong.

Callers use it to decide which of two versions is newer, to order a list of versions, and to ask whether a version falls inside a range.

## Public API

`parse(version)` accepts a version string and returns its components, or `null` if the string is not a valid semantic version. It does not throw. A leading `v` is not accepted; the input must be exactly a version.

`compare(a, b)` returns `-1` when `a` has lower precedence than `b`, `1` when higher, and `0` when they have equal precedence. It throws a `TypeError` if either argument is not a valid version, because a comparison that cannot be made must not silently return `0`.

`sort(versions)` returns a new array ordered from lowest to highest precedence. The input array is not modified. Versions of equal precedence keep their original relative order.

`satisfies(version, range)` returns whether the version falls within the range. Both arguments must be valid, and it throws a `TypeError` otherwise.

`valid(version)` returns whether the string is a valid semantic version, and is the predicate form of `parse`.

## Behavior

### Parsing

A valid version is `major.minor.patch`, each a non-negative integer without leading zeros, optionally followed by `-prerelease` and then optionally `+build`.

The prerelease part is a dot-separated series of identifiers, each of which is either numeric or alphanumeric. Numeric identifiers must not have leading zeros. Alphanumeric identifiers may contain ASCII letters, digits and hyphens, and must not be empty. The build part is a dot-separated series of identifiers of the same alphanumeric character set, but leading zeros are permitted there because build metadata is never interpreted numerically.

`parse` returns `major`, `minor` and `patch` as numbers; `prerelease` as an array in which numeric identifiers are numbers and the rest are strings; and `build` as an array of strings. Both arrays are empty when the corresponding part is absent.

These are not valid: `1.2`, `1.2.3.4`, `01.2.3`, `1.2.3-`, `1.2.3-01`, `1.2.3-a..b`, `1.2.3+`, `1.2.3 `, the empty string.

### Precedence

Precedence compares `major`, then `minor`, then `patch`, numerically.

When those are equal, a version with a prerelease has *lower* precedence than one without: `1.0.0-alpha` precedes `1.0.0`.

When both have prereleases, identifiers are compared left to right. A numeric identifier always has lower precedence than an alphanumeric one. Two numeric identifiers compare numerically. Two alphanumeric identifiers compare by ASCII sort order. If every identifier so far is equal, the version with more identifiers has higher precedence.

Build metadata is ignored entirely. `1.0.0+build.1` and `1.0.0+build.2` have equal precedence, and `compare` returns `0` for them.

The canonical ordering from the specification therefore holds:
`1.0.0-alpha` < `1.0.0-alpha.1` < `1.0.0-alpha.beta` < `1.0.0-beta` < `1.0.0-beta.2` < `1.0.0-beta.11` < `1.0.0-rc.1` < `1.0.0`.

### Ranges

A range is one of the following forms, and nothing else.

`*` matches every version. An exact version matches only versions of equal precedence.

A caret range `^1.2.3` matches versions that do not change the leftmost non-zero component: `^1.2.3` allows `>=1.2.3 <2.0.0`, `^0.2.3` allows `>=0.2.3 <0.3.0`, and `^0.0.3` allows `>=0.0.3 <0.0.4`.

A tilde range `~1.2.3` allows patch-level changes: `>=1.2.3 <1.3.0`.

A comparator range is one of `<`, `<=`, `>`, `>=` or `=` followed by a version, and matches by precedence.

A space-separated series of comparators is a conjunction: `>=1.2.0 <2.0.0` matches versions satisfying both.

A prerelease version satisfies a range only when the range itself mentions a prerelease of the same major, minor and patch. `1.2.3-alpha` does not satisfy `^1.0.0`, but does satisfy `^1.2.3-alpha`. This rule surprises people and is the point of the exercise.

## Constraints

No dependencies. No I/O. Every function is pure and none mutates its arguments.

`parse` never throws; it reports invalidity by returning `null`. `compare`, `sort` and `satisfies` throw `TypeError` on invalid input rather than guessing.

Sorting is stable, and `sort` must not modify the array it is given.

Comparison must not be implemented by string comparison of the whole version, and prerelease identifiers must not be compared by converting numbers to strings.

## Non-goals

No coercion of loose input such as `v1.2` or `1.2.x`. No hyphen ranges, no `||` unions, no `x`/`X`/`*` wildcards inside a version. No increment, no diff, no formatting helpers beyond what the API lists.

## Examples

```ts
import { compare, parse, satisfies, sort } from "semver-lite";

parse("1.2.3-beta.11+build.5");
// { major: 1, minor: 2, patch: 3, prerelease: ["beta", 11], build: ["build", "5"] }

compare("1.0.0-alpha", "1.0.0"); // -1
compare("1.0.0+a", "1.0.0+b");   //  0

sort(["1.10.0", "1.2.0", "1.2.0-rc.1"]);
// ["1.2.0-rc.1", "1.2.0", "1.10.0"]

satisfies("1.9.9", "^1.2.3");        // true
satisfies("2.0.0", "^1.2.3");        // false
satisfies("1.2.3-alpha", "^1.0.0");  // false
```
