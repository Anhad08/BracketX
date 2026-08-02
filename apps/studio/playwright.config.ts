import { defineConfig, devices } from "@playwright/test";

/**
 * Studio in a browser.
 *
 * Deliberately thin: the 125 headless tests already prove every claim about
 * documents, transactions and engine state. What only a browser can prove is
 * that a GESTURE reaches those code paths — that clicking a tool creates a
 * node, that a preset lands on a timeline, that Take puts the tally on air.
 *
 * (The header said "showcase" until Phase 3A, having been copied from that app
 * along with the config. The `e2e` directory it points at was empty.)
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:5181" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
