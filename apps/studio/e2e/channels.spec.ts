import { expect, test } from "@playwright/test";

/** Runs a command by name through the palette. */
async function runCommand(page: import("@playwright/test").Page, title: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.locator(".palette-input").fill(title);
  await page.locator(".palette-input").press("Enter");
  await expect(page.getByTestId("palette")).toHaveCount(0);
}

/** True when the layer's canvas has any non-transparent pixel. */
async function drew(page: import("@playwright/test").Page, channel: string) {
  return page
    .getByTestId("program-monitor")
    .locator(`canvas[data-channel='${channel}']`)
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (context === null) return false;
      const gl = context as WebGLRenderingContext;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    });
}

/**
 * Everything else in P1 can pass while the feature does not work. This cannot:
 * it looks at the pixels and asserts two graphics are out at once.
 */
test("two graphics are on air at the same time", async ({ page }) => {
  await page.goto("/");

  // A lower third, onto `lower`.
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await runCommand(page, "Take to lower");

  // A ticker, onto `upper` — a different layer, so the lower third stays out.
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_ticker").click();
  await runCommand(page, "Take to upper");

  await page.getByTestId("nav-production").click();

  const stack = page.getByTestId("program-monitor");
  await expect(stack.locator("canvas[data-channel='lower']")).toHaveCount(1);
  await expect(stack.locator("canvas[data-channel='upper']")).toHaveCount(1);

  // Mounted proves nothing. Both must have actually drawn.
  expect(await drew(page, "lower"), "the lower third drew nothing").toBe(true);
  expect(await drew(page, "upper"), "the ticker drew nothing").toBe(true);

  // And the tally agrees that something is out.
  await expect(page.getByTestId("rail-tally")).toHaveAttribute("data-air", "live");
});

test("clearing one layer leaves the other on air", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await runCommand(page, "Take to lower");
  await runCommand(page, "Take to upper");

  await runCommand(page, "Clear upper");
  await page.getByTestId("nav-production").click();

  const stack = page.getByTestId("program-monitor");
  await expect(stack.locator("canvas[data-channel='upper']")).toHaveCount(0);
  await expect(stack.locator("canvas[data-channel='lower']")).toHaveCount(1);
  await expect(page.getByTestId("rail-tally")).toHaveAttribute("data-air", "live");
});
