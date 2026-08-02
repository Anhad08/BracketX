import { defineConfig, devices } from "@playwright/test";

/**
 * Visual smoke test for the showcase.
 *
 * Deliberately thin: the 158 headless tests already prove every scene loads,
 * validates, renders, and frees. What only a browser can prove is that the
 * shell mounts and real pixels appear.
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
