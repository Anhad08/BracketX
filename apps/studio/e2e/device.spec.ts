import { expect, test } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * What each kind of machine offers.
 *
 * A resize handle is eight pixels and a fingertip is about forty-four. Those
 * numbers do not reconcile, so a phone views and OPERATES rather than
 * pretending to author — and the difference has to be real, not cosmetic.
 */
// A real touch device, not merely a narrow window. The distinction is the
// point: a 390px window on a desktop with a mouse is a narrow DESKTOP, and
// demoting it would take the editor away from a designer for resizing.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("a phone gets the operating product, not a shrunken editor", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");

  // The rail becomes a bottom bar. A thumb reaches the bottom of a screen far
  // more easily than its left edge, and a vertical strip of icons costs width
  // a phone has none of.
  const rail = page.getByTestId("rail");
  await expect(rail).toBeVisible();
  const railBox = (await rail.boundingBox())!;
  expect(railBox.width).toBeGreaterThan(300);
  expect(railBox.y).toBeGreaterThan(600);

  // Every destination is still reachable. Nothing is hidden that a phone
  // could have used.
  for (const section of ["home", "design", "marketplace", "assets", "settings"]) {
    await expect(page.getByTestId(`nav-${section}`)).toBeVisible();
  }

  // The content surface IS the product here: fields, and the way to air.
  await expect(page.getByTestId("content")).toBeVisible();
  await expect(page.getByTestId("go-live")).toBeVisible();

  // And it really goes to air.
  await page.getByTestId("go-live").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
});

test("a phone does not offer authoring it cannot deliver", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible();

  await expect(page.locator(".studio")).toHaveAttribute("data-authoring", "no");
  await expect(page.locator(".studio")).toHaveAttribute("data-device", "phone");

  // No gizmo, at all. A control you cannot hit is worse than one that is not
  // there, because the failure is silent and the user assumes they missed.
  await page.getByTestId("scene-chrome").click({ position: { x: 100, y: 100 } });
  await expect(page.getByTestId("gizmo")).toHaveCount(0);
  await expect(page.getByTestId("axes")).toHaveCount(0);

  // The docks and the designer's status bar are gone too.
  await expect(page.locator(".dock.left")).toHaveCount(0);
  await expect(page.locator(".dock.bottom")).toHaveCount(0);
});

});

test("a narrow desktop window keeps its editor — it is not a phone", async ({ page }) => {
  // Same width as the phone above, with a mouse. Width alone must never
  // decide: a designer who narrowed their window has not changed machine.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-authoring", "yes");
  await expect(page.locator(".studio")).not.toHaveAttribute("data-device", "phone");
});

test("a desktop is unaffected by any of it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-authoring", "yes");
  await expect(page.locator(".studio")).toHaveAttribute("data-touch", "no");
  await expect(page.getByTestId("statusbar")).toBeVisible();
});

/**
 * Volume Two refuses tabbing by name:
 *
 *   "Streamatrix never tabs a panel. A tab hides a panel's state behind
 *    another panel's, and a hidden panel on a live desk is a panel you forgot
 *    about."
 *
 * and allows exactly three conditions — in a dock, on a second monitor, or
 * collapsed. Collapsed is legitimate BECAUSE a collapsed panel still shows
 * that it exists and what state it is in.
 */
test("the bottom dock has no tabs, and panels do not hide each other", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible();
  await ensureDepth(page, "designer");

  // No tab role anywhere in the product.
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("tablist")).toHaveCount(0);

  // Every panel is PRESENT, and says whether it is open.
  for (const panel of ["timeline", "presets", "variables", "library"]) {
    await expect(page.getByTestId(`panel-${panel}`)).toBeVisible();
  }
  await expect(page.getByTestId("panel-timeline")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("panel-presets")).toHaveAttribute("aria-expanded", "false");

  // TWO AT ONCE. This is the part a tab bar cannot do, and the reason the
  // rule exists: opening one panel must not conceal another.
  await page.getByTestId("panel-presets").click();
  await expect(page.getByTestId("panel-timeline")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("panel-presets")).toHaveAttribute("aria-expanded", "true");

  // Collapsing everything is allowed, and says so rather than showing a void.
  for (const panel of ["timeline", "presets"]) {
    await page.getByTestId(`panel-${panel}`).click();
  }
  await expect(page.getByTestId("dock-empty")).toBeVisible();
});
