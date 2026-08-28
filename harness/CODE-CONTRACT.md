# CODE-CONTRACT v1 — the platform language

Product code is written in a prescribed TypeScript subset over the
platform value system. The subset exists to eliminate unnecessary
variation (every module reads the same way), to make the platform's
analysis sound (purity is what lets a definition's hash certify its
behavior), and to keep every agent's reasoning surface constant as the
system grows. The lint enforces it mechanically: it runs inside your
world for feedback while you work, and at the bank as a floor.

## 1. Modules

A module is one directory of `.ts` files: conceptually related
functions behind an abstraction boundary that hides both its helpers
and its downstream dependencies. File layout, in order: header doc
comment, imports, noun types, exported functions, private helpers.

Functions are IMMUTABLE once banked: never edited, only superseded
(add `f2`, migrate callers, collect the orphan). A bank may only ADD
definitions and DELETE orphans — the ledger verifies this by closure
hash; banked source is mounted read-only in your world.

## 2. Values

All data crossing any function boundary is a `Value` from
`platform/values`: scalars (`null | boolean | number | string`),
`Vec`, `VMap`, `VSet`, and records (`Rec<S>`). Collections are opaque
branded types — the facade's exported functions are the entire
vocabulary; there are no methods.

- Nouns are tagged records: `Rec<{ readonly tag: 'name'; … }>`, one
  constructor function per noun, unions for alternatives.
- Case analysis uses `match(v, { … })` — total by construction: one
  arm per tag, compile-checked. Adding a variant breaks every match
  site until handled. No `default` escape.
- Heterogeneous literals name the union once: `V.of<JsVal>(a, b, c)`.
- Equality is `equals` (structural), rendering is `show` (EDN). There
  is no reference identity on Values.

## 3. Purity and state

- Exported functions are pure: same arguments, same result, no
  observable effects.
- SEMANTIC state (anything whose content affects results) is threaded
  as values: `(state, args) → result-record` carrying the new state —
  the house Step shape. Never park semantic state in module scope.
- Module scope is frozen: no `let`/`var` at module level, no mutation
  of anything imported or module-scoped, no classes, no `this`, no
  enums, no namespaces.
- FUNCTION-LOCAL SCRATCH is allowed: locals (and parameters of private
  helpers) may be mutated freely — plain arrays/objects as working
  memory inside a call. The Value-typed public signatures are what
  keep raw mutables from escaping; the lint keeps mutation off
  module-scope and imports.
- BENIGN state comes only from the platform services, usable anywhere:
  `memo(f)` (speed; observationally f), `intern(v)` (sharing;
  equals-preserving), `trace(event)` (telemetry; write-only).
  `services-admin` is shell/harness territory — never import it.
- Effects are DATA: a function that needs the outside world returns an
  effect value; the shell interprets it. Randomness and time arrive as
  arguments (seed, clock) injected at the boundary.

## 4. Types

- `strict` TypeScript; the platform tsconfig is fixed.
- No `any`, no `as`, no non-null `!` — the platform kernel
  (`platform/values`) is the single audited exception.
- Lookups return `T | undefined`; handle the undefined.
- Exhaustive `match`/switches over unions — the checker proves
  completeness; keep it able to.

## 5. Naming grammar (closed set)

- Modules and files: `kebab-case`. Functions and bindings:
  `camelCase`. Noun types: `PascalCase`.
- Constructors are the noun, lowercased (`numV`, `interval`);
  predicates are `isX`; converters are `xToY`; a function superseding
  `f` is `f2` (then `f3`, …) with a `@superseded-by f2` doc tag left
  on `f`.
- Namespaced facade imports: `import * as V from '…/vec.js'`,
  `M` for vmap, `VSet` for vset.

## 6. What the platform verifies at every bank

Compile-clean under the fixed tsconfig; lint-clean (the rules above);
closure-hash accretion (additions + orphan deletions only); node-count
and definition ledgers; your module's suite; the global no-regression
grade. Test all of it yourself before finishing — the same tools are
in your world.
