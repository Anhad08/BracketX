import { defineConfig } from "vitest/config";

/**
 * Unit tests: pure logic, no database, fast.
 * Integration tests are excluded here and run via vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
  },
});
