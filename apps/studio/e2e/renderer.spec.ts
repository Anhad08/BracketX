import { expect, test, type Page } from "@playwright/test";

/**
 * Two renderers, one product.
 *
 * ============================================================================
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT
 * ============================================================================
 * `conformance.test.ts` proves the two backends build the same mirror from the
 * same document. It runs against Babylon's headless engine — no GPU, no
 * canvas, no pixels.
 *
 * This is the other half: that a person can choose the other renderer, that
 * the choice survives a reload, that the scene actually DRAWS through it, and
 * that a graphic still reaches air. A backend that passes conformance and
 * produces a black canvas has passed nothing that matters.
 */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
}

/** How much of the frame is drawn. Zero means the renderer produced nothing. */
async function coverage(page: Page): Promise<number> {
  return page.locator(".scene-surface canvas").evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const scratch = document.createElement("canvas");
    scratch.width = 160;
    scratch.height = 90;
    const context = scratch.getContext("2d")!;
    context.drawImage(source, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
    let covered = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index]! > 8) covered += 1;
    }
    return covered;
  });
}

test("the renderer is a choice, and it says when it takes effect", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-settings").click();

  // Three is the default — the founder's decision, recorded verbatim.
  await expect(page.getByTestId("renderer-three")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("renderer-active")).toContainText("Running on Standard");
  await expect(page.getByTestId("renderer-pending")).toHaveCount(0);

  await page.getByTestId("renderer-babylon").click();
  await expect(page.getByTestId("renderer-babylon")).toHaveAttribute("aria-pressed", "true");

  // A backend binds to its canvas for the session's lifetime, so the change
  // lands on the next start — and the panel says so rather than appearing to
  // do nothing.
  await expect(page.getByTestId("renderer-pending")).toBeVisible();
  await expect(page.getByTestId("renderer-active")).toContainText("reload to use Babylon");
});

test("a scene draws through Babylon, and reaches air", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("renderer-babylon").click();

  // The choice is remembered. This is the reload the panel asked for.
  await page.reload();
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-settings").click();
  await expect(
    page.getByTestId("renderer-active"),
    "the choice must survive a reload or it is not a setting",
  ).toContainText("Running on Babylon");
  await expect(page.getByTestId("renderer-pending")).toHaveCount(0);

  // A 3D scene, on the second renderer, from the Marketplace content the
  // product actually ships.
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("enable-3d").click();
  await expect(page.getByTestId("enable-3d")).toHaveAttribute("data-on", "yes");

  // IT DREW SOMETHING. A backend that passes conformance and produces a black
  // canvas has passed nothing that matters.
  await expect
    .poll(async () => coverage(page), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // And it still goes to air. The whole point of the seam is that nothing
  // above it knows which renderer it is talking to.
  await page.getByTestId("nav-production").click();
  await page.getByTestId("take").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  await page.getByTestId("off-air").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("OFF");
});

test("no console errors while Babylon is driving", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await boot(page);
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("renderer-babylon").click();
  await page.reload();
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  // The section survives a reload too, so this comes back in Settings.
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("enable-3d").click();
  await page.waitForTimeout(1200);

  expect(errors, "a renderer that logs errors is one nobody will trust").toEqual([]);
});
