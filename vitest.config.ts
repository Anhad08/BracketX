import { defineConfig } from "vitest/config";

/**
 * Workspace-level tests. Currently the engine boundary invariants, which are a
 * property of the workspace as a whole and therefore belong to no single
 * package.
 */
export default defineConfig({
  test: {
    include: ["tools/**/*.test.ts"],
  },
});
