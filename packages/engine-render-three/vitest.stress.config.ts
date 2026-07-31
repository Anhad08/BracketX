import { defineConfig } from "vitest/config";

/**
 * Stress and scalability. Slow by design — builds scenes up to 100k nodes and
 * measures projection cost in isolation.
 *
 * Single-fork so timing measurements are not competing with other workers for
 * CPU, which is what makes the O(scene) regression guard trustworthy.
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
