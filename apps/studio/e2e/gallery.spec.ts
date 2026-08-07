import { test, expect, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

const W = 1600, H = 1000;
async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/${name}.png` });
}

/**
 * Every screen, captured — and the one product guarantee the captures exist to
 * defend: THE CARDS ARE NOT ALL THE SAME PICTURE.
 *
 * Six of the eight template cards on Home carried an identical drawn glyph, so
 * the screen that decides what somebody makes offered six indistinguishable
 * choices. Nothing failed; it simply looked like a placeholder. This asserts
 * that each card is the engine's own render of its own graphic, and that no
 * two of them are the same bytes.
 */
test("gallery", async ({ page }) => {
  await page.setViewportSize({ width: W, height: H });
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".start-card .art-still")).toHaveCount(8, { timeout: 20_000 });
  const art = await page.locator(".start-card .art-still").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLImageElement).src),
  );
  expect(new Set(art).size, "every template card must show its own graphic").toBe(art.length);
  for (const src of art) expect(src.startsWith("data:image/png")).toBe(true);
  await shot(page, "01-home");

  await page.getByTestId("nav-marketplace").click();
  await shot(page, "02-marketplace");

  await page.getByTestId("nav-templates").click();
  await shot(page, "03-templates");

  await page.getByTestId("nav-assets").click();
  await shot(page, "04-assets");

  await page.getByTestId("nav-settings").click();
  await shot(page, "05-settings");

  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await shot(page, "06-design-beginner");

  await ensureDepth(page, "designer");
  await shot(page, "07-design-expert");

  await page.getByTestId("nav-production").click();
  await shot(page, "08-production");
  await page.getByTestId("cue").click();
  await shot(page, "09-production-cued");
  await page.getByTestId("take").click();
  await shot(page, "10-production-live");

  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-hybrid").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("gizmo-modes")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("tool-box").click();
  await shot(page, "11-design-3d");
});
