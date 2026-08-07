import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Stress runs separately for the same reason it does in the reconciler:
    // a suite that builds 100k-node scenes starves the parallel runner and
    // fails as a worker RPC timeout rather than as an assertion.
    exclude: ["src/stress.test.ts", "node_modules/**"],
    passWithNoTests: true,
  },
});
