import { defineConfig } from "vitest/config";

/**
 * Performance investigation (P-001). Slow and measurement-only.
 *
 * Single fork with --expose-gc: allocation figures are meaningless if a
 * collection may or may not have run between samples, and timing figures are
 * meaningless if a parallel worker is competing for the CPU.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.perf.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true, execArgv: ["--expose-gc"] },
    },
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
