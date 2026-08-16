# trireme

## Purpose

Trireme builds a Node package from a specification and an acceptance suite, without a human in the loop. A caller hands it a job directory — a manifest, a structured spec, a TypeScript contract, and a vitest acceptance suite — and trireme drives a coding agent until the package it produces passes that suite, or until it exhausts a budget of money or time.

The verdict is objective and is rendered by trireme, never by the agent: the acceptance suite passes, the implementation typechecks against the contract, or the run failed. Every run leaves behind its workspace, its transcript, and a machine-readable report, so a run that failed still says how far it got.

This document specifies the library. The CLI is a thin wrapper over it and adds no behaviour of its own beyond argument parsing and exit codes.

## Public API

The package exports one function and the types it needs.

### `run(options: RunOptions): Promise<RunResult>`

Executes one job to a terminal outcome. It does not throw for job failure — a failing job is a `RunResult` with a failure outcome. It throws only if the host environment makes the run impossible to even attempt (an unwritable runs directory, for instance).

`options.jobDir` is the only required field. `options.runsDir` defaults to `runs/` beside the current working directory. `options.overrides` supplies per-run values that take precedence over the manifest. `options.clock` and `options.streamFn` are injection points that exist so the loop can be tested without a model or a real clock; production callers omit them.

The returned `RunResult` always carries `outcome`, `runId`, `runDir` and `ledger`. It carries `tests` once the gate has run at least once, and `artifactPath` only on success.

### `Outcome`

Seven terminal states, in three groups.

- `success` — the gate passed and an artifact was written.
- `failed:cost_cap`, `failed:wall_clock`, `failed:no_progress`, `failed:iteration_cap` — the job did not converge. The run is finished; another job may still be attempted.
- `aborted:infra` — the model provider or the network failed. Distinguished from the failures above because a caller running many jobs should stop rather than continue.
- `error:usage` — the job or the options are malformed. Nothing was executed and nothing was charged.

### `readManifest(jobDir: string): ManifestResult`

Parses and validates a job's manifest without running anything. Exposed because a caller — a future campaign runner, or `trireme new` — needs to inspect a job cheaply. Returns either the resolved manifest or a list of diagnostics.

## Behavior

### Validation

Before anything is created or charged, trireme checks the job. A job is valid when its directory contains `trireme.json`, `spec.md`, `contract.d.ts` and a non-empty `acceptance/` directory; when the manifest parses and carries `name`, `version`, `model`, `limits.costUsd`, `limits.wallClockMinutes` and `safety.maxIterations`; when `dependencies` is empty; and when `spec.md` contains non-empty `## Purpose`, `## Public API`, `## Behavior`, `## Constraints` and `## Non-goals` sections.

Any failure produces `error:usage` with one diagnostic per problem — all of them, not just the first, because the caller is often a generator that can fix several at once. A validation failure creates no run directory.

### The workspace

Trireme generates the workspace deterministically: the same manifest produces byte-identical generated files. It writes a `package.json` naming the package and declaring ESM, a `tsconfig.json`, a `vitest.config.ts`, and a conformance module that asserts the implementation and the contract are mutually assignable. It copies the job's `contract.d.ts` and `acceptance/` in unchanged. It creates `src/index.ts` containing a placeholder that typechecks but does not satisfy the contract.

The generated files and the copied files are not writable by the agent. This is structural: no tool addresses them for writing.

### The agent's interface

The agent is given twenty-one tools and no others; pi's built-in tools are not registered. The tools address things by name — the spec, the contract, named acceptance test files, the entry point, and modules containing named files and named test files. No tool accepts a filesystem path, and the mapping from names to paths is trireme's alone.

File names are normalised rather than ruled upon: `tokenizer` and `tokenizer.ts` are the same implementation file, and a test may additionally be named `tokenizer.test.ts`. The single exception is a `.test.ts` name passed to `write_module_file`, which is refused with a message naming `write_module_test`, because it would otherwise silently create a file the runner collects as a test.

A tool call that cannot be honoured returns an error result naming what to do instead. It does not abort the run.

A module is imported by name from anywhere in the package — `import { x } from "#name"` — never by a path. Trireme keeps that name resolving: the workspace's `package.json` maps each declared module's `#name` to its `index.ts`, and the packed artifact's `package.json` maps it to the built module. Files inside one module import each other as siblings. The agent never learns where a module lives, and `declare_module` tells it how to import the module it just declared.

Every mutating tool result carries a short status footer: the harness runs the typecheck, the acceptance suite and the touched module's tests the moment the workspace changes, and reports the result as counts. This is bounded and informational — a workspace mid-change is expected to be red — and the explicit `typecheck`, `run_acceptance_tests` and `run_module_tests` tools remain for the detail. Reads carry no footer, because nothing changed.

### The loop

Trireme opens one agent session, seeded with a system prompt describing the method and a first message carrying the spec, the contract and the names of the acceptance test files. It then repeats:

1. Let the agent work until it ends its turn.
2. Run the gate.
3. If the gate passes, build and pack, and finish with `success`.
4. Otherwise consult the limits. If one is spent, finish with the matching failure.
5. Otherwise send the agent a message describing the current failures, and go to 1.

Each pass through this cycle is one iteration.

### The gate

The gate is three checks, run by trireme and not by the agent, in this order, stopping at the first failure: every acceptance test passes; the typecheck reports no errors across the implementation, the acceptance suite and the conformance module; the package builds. The agent has no tool that reports the gate's verdict and no way to declare itself finished.

### Limits and the ledger

Cost and wall clock are budgets. Both are checked after every assistant message, so an overrun is bounded by one message. Wall clock starts when `run` is called and includes scaffolding; time spent waiting on provider backoff counts against it and is also recorded separately.

The ledger accumulates the token counts and costs that the agent session reports for each message. Cost is recorded in dollars when the provider has published per-token prices and as *unpriced* when it has not — a flat-rate provider reports zero, which must not be mistaken for a free run. When cost is unpriced, a cost cap cannot be enforced, and the run reports that rather than proceeding as though the cap were infinite.

`safety.maxIterations` is not a budget. It is a backstop against a loop that turns without converging and without spending, and tripping it yields `failed:iteration_cap`.

A run makes no progress when three consecutive iterations end with no mutating tool call while the gate is still failing. That yields `failed:no_progress`.

### Infrastructure failures

An authentication failure, an exhausted provider quota, a network failure, or a provider error that survives the session's own retries is `aborted:infra`. It takes precedence over a budget that was also spent, because it is the class that tells a caller to stop.

### What a run leaves behind

Every run — including a failed or aborted one — writes a run directory containing the resolved configuration, the workspace as the agent left it, the session transcript, an event log, and a report in both machine-readable and human-readable form. On success it additionally writes a packable tarball.

The report carries provenance: the trireme version, the hash of the system prompt, the model, the thinking level, and a hash of the job directory. Benchmark numbers gathered across harness versions are only comparable because of these fields.

## Constraints

Generation is deterministic. The same manifest and job produce byte-identical generated files, and the run identifier is the only varying part of a run directory's contents.

Every effect is injected. The clock, the filesystem root, the subprocess spawner and the model stream are parameters, not ambient facts, so the loop and every module beneath it can be tested without a model, without waiting, and without network access.

The acceptance suite is immutable for the duration of a run, and its immutability is structural rather than enforced.

Failure output given to the agent is bounded. A gate failure is reported as counts plus a bounded number of individual failures with their messages and locations; it is never an unbounded dump of a test runner's stdout.

Trireme never reports success without having run the gate itself in that same iteration.

## Non-goals

Trireme does not run many jobs. A campaign runner — repeating a job, sweeping models, emitting comparison tables — is a separate concern built on this library's typed result, and is not part of it.

Trireme does not delegate to sub-agents. One job is one agent session. The tool surface, the ledger's shape and the scoping of tools anticipate delegation, but v1 does not implement it.

Trireme does not resume. A run that stops is finished; continuing where it left off is future work, which is why run state is explicit and serialisable rather than implicit in the loop.

Trireme does not install dependencies for the package under construction, and provides the agent no tool to request one. The manifest's `dependencies` must be empty.

Trireme does not publish. It produces a tarball; what happens to it is the caller's business.

Trireme does not sandbox the code it builds. Tests execute agent-written code with the privileges of the process that invoked trireme.

## Examples

```ts
import { run } from "trireme";

const result = await run({ jobDir: "./bench/semver-lite" });

if (result.outcome === "success") {
  console.log(`built ${result.artifactPath} for $${result.ledger.costUsd}`);
} else {
  console.log(`${result.outcome}: ${result.reason}`);
  console.log(`${result.tests?.passed}/${result.tests?.total} acceptance tests passing`);
}
```

Overriding the manifest for a one-off experiment:

```ts
await run({
  jobDir: "./bench/semver-lite",
  overrides: { model: "openrouter/z-ai/glm-5.2", costUsd: 0.5 },
});
```
