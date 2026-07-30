import { defineConfig } from "vitest/config";

/**
 * Integration tests: run against a real PostgreSQL instance.
 *
 * DATABASE_URL is supplied by scripts/with-postgres.mjs, which either reuses an
 * existing one or starts a real server for the duration of the run.
 *
 * Single-file, single-fork execution: every test truncates shared tables, so
 * running files in parallel against one database would have them delete each
 * other's fixtures.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
