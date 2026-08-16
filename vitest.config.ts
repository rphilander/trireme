import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two suites live here, and they are not the same kind of thing.
    //   acceptance/ — trireme's own acceptance suite: black-box, drives run()
    //                 through a scripted agent. This is what decides done.
    //   src/        — module test suites, written alongside each module.
    include: ["acceptance/**/*.test.ts", "src/**/*.test.ts"],
    // Every test that touches the harness spawns subprocesses and writes
    // temp directories; forks keep a wedged run from taking the suite with it.
    pool: "forks",
    testTimeout: 30_000,
  },
});
