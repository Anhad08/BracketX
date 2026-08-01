import { defineConfig } from "vitest/config";

/** T1 spike — measurement, not behaviour. Run explicitly. */
export default defineConfig({
  test: {
    include: ["src/**/*.spike.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 300_000,
  },
});
