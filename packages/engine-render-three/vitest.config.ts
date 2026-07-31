import { defineConfig } from "vitest/config";

export default defineConfig({
  // Packages ahead of their implementation phase have no tests yet; that is a
  // schedule fact, not a failure.
  test: { include: ["src/**/*.test.ts"], passWithNoTests: true },
});
