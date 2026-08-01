import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Stress and scalability run separately: they take ~140s and starve the
    // parallel runner, which surfaced as a vitest worker RPC timeout rather
    // than as a test failure. Separated for the same reason integration tests
    // are — a slow suite in the fast path makes the fast path unreliable.
    exclude: ["src/stress.test.ts", "node_modules/**"],
    passWithNoTests: true,
  },
});
