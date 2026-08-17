import { defineConfig } from "vitest/config";

// The tooling's own tests live at the job root (test262.test.ts, measure.test.ts).
// acceptance/*.test.ts are the JOB's tests — they import the package under test
// and run inside the trireme workspace, not here — so they are excluded.
export default defineConfig({
  test: {
    include: ["*.test.ts"],
    exclude: ["acceptance/**", "node_modules/**", "dist/**"],
  },
});
