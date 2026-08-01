import { defineConfig, devices } from "@playwright/test";

/**
 * Browser verification. Phase 2.6e.
 *
 * This suite exists to close the Unknown column in RENDER_BACKEND_VERIFICATION
 * §7 — "draw calls reach the GPU", "rendered output is correct". Neither can be
 * established headlessly, and Phase 2.5 said so rather than guessing.
 *
 * Chromium is launched with a real GPU path (SwiftShader when no hardware GPU
 * is present, which is still a real WebGL2 implementation executing real
 * shaders — not a mock).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // Software rasterization still runs the real WebGL2 stack, so a
            // machine without a GPU verifies the same code path.
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--disable-gpu-sandbox",
          ],
        },
      },
    },
  ],

  webServer: {
    // Production build: a dev-mode canvas can double-render under StrictMode,
    // which would make frame counts lie.
    command: "pnpm build && pnpm start --port 3100",
    url: "http://127.0.0.1:3100/render-check",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
