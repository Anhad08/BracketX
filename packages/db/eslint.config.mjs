import { config } from "@bracketx/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  { ignores: ["drizzle/**", ".pgdata/**"] },
  {
    // Local development tooling: plain Node scripts, not part of any bundle.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      // These scripts read env deliberately and are never a build input, so
      // Turborepo's cache hash does not depend on them.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
