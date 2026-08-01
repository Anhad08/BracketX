import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Performance and stress suites run separately: they are measurements,
    // not assertions about behaviour, and a slow suite in the fast path makes
    // the fast path unreliable.
    exclude: ["src/stress.test.ts", "node_modules/**"],
    passWithNoTests: true,
  },
});
