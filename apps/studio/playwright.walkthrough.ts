import { defineConfig, devices } from "@playwright/test";

/**
 * The walkthrough harness.
 *
 * Produces what a person can actually judge: screenshots at every step of the
 * workflow, and a video of the whole thing. A phase is not complete because the
 * code executes; it is complete when someone can watch the task being done.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /walkthrough\.spec\.ts/,
  workers: 1,
  reporter: "line",
  timeout: 120_000,
  outputDir: "./walkthrough/artifacts",
  use: {
    baseURL: "http://127.0.0.1:5181",
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    video: { mode: "on", size: { width: 1600, height: 1000 } },
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
