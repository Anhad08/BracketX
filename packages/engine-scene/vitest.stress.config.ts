import { defineConfig } from "vitest/config";

/**
 * Stress and regression protection (P-001 P6/P7). Slow by design — builds
 * scenes up to 100k nodes across wide, deep, balanced, and mixed shapes.
 *
 * Single-fork so timing measurements are not competing with other workers for
 * CPU, which is what makes the growth-factor guards trustworthy.
 */
export default defineConfig({
  test: {
    include: ["src/stress.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
