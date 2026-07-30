import { nextJsConfig } from "@bracketx/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    // Build config runs in Node before Next boots, so it is not covered by the
    // browser globals the Next preset assumes.
    files: ["next.config.js", "postcss.config.mjs"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
];
