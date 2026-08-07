import { expect, test, type Page } from "@playwright/test";

/**
 * The menu bar.
 *
 * ============================================================================
 * WHAT IT IS FOR, AND WHAT IS BEING TESTED
 * ============================================================================
 * A command palette is a search box: it helps somebody who already knows the
 * word. A menu bar answers the question a person actually arrives with —
 * "what CAN this do?" — and every application a broadcaster already uses
 * answers it the same way.
 *
 * The load-bearing claim is not that menus open. It is that they are the SAME
 * COMMANDS as the palette and the keyboard, with the same enablement and the
 * same shortcuts. A hand-written menu is a second list of what the product
 * does, and the day it disagrees with the first, a menu item silently does
 * nothing.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("menubar")).toBeVisible();
}

test("it is there on every screen, not only in the editor", async ({ page }) => {
  await boot(page);
  for (const section of ["marketplace", "templates", "production", "settings", "home"]) {
    await page.getByTestId(`nav-${section}`).click();
    await expect(
      page.getByTestId("menubar"),
      "a menu bar that comes and goes is the opposite of what a menu bar is for",
    ).toBeVisible();
  }
});

test("every menu opens, and pointing at a sibling moves to it", async ({ page }) => {
  await boot(page);
  for (const menu of ["file", "edit", "create", "arrange", "view", "motion", "air", "help"]) {
    await expect(page.getByTestId(`menu-${menu}`)).toBeVisible();
  }

  await page.getByTestId("menu-file").click();
  await expect(page.getByTestId("menu-pop-file")).toBeVisible();

  // Once one is open, HOVERING a sibling opens it. Every desktop application
  // does this and nobody notices until it is missing — without it, browsing a
  // menu bar is click, read, click away, click again.
  await page.getByTestId("menu-edit").hover();
  await expect(page.getByTestId("menu-pop-edit")).toBeVisible();
  await expect(page.getByTestId("menu-pop-file")).toHaveCount(0);

  // Escape backs out of the menu and nothing else.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu-pop-edit")).toHaveCount(0);
});

test("an item runs the real command", async ({ page }) => {
  await boot(page);
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });

  // Safe areas are drawn on the stage, so running the command from the menu
  // has a consequence anybody can see — which is the point. Chosen over "Fit"
  // because its effect is visible at every level of the product rather than
  // only where a zoom readout happens to be shown.
  const safe = page.locator(".safe-area");
  const before = await safe.count();
  expect(before).toBeGreaterThan(0);

  await page.getByTestId("menu-view").click();
  const toggle = page.getByTestId("menu-item-view.safeAreas");
  await expect(toggle).toBeVisible();
  await expect(toggle, "the shortcut is how somebody stops needing the menu").toContainText("'");
  await toggle.click();

  await expect(page.getByTestId("menu-pop-view")).toHaveCount(0);
  await expect(safe, "the menu item must run the real command").toHaveCount(0);
});

/**
 * DISABLED, NEVER HIDDEN.
 *
 * A menu whose contents change shape as you work cannot be learned, and half
 * the value of a menu bar is that the third item is always the third item.
 */
test("an item that cannot run is greyed, not removed", async ({ page }) => {
  await boot(page);
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });

  // Nothing is selected, so Delete has nothing to act on.
  await page.getByTestId("menu-edit").click();
  const remove = page.getByTestId("menu-item-edit.delete");
  await expect(remove).toBeVisible();
  await expect(remove).toBeDisabled();
});

/**
 * THE ONE THAT KEEPS IT HONEST.
 *
 * The bar declares nothing of its own: it reads the same registry the palette
 * and the keyboard read. So every item in it must be findable in the palette,
 * by the same name.
 */
test("the menus and the palette are the same list", async ({ page }) => {
  await boot(page);

  await page.getByTestId("menu-file").click();
  const titles = await page.getByTestId("menu-pop-file").locator(".menu-label").allTextContents();
  expect(titles.length).toBeGreaterThan(1);
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("palette");
  await expect(palette).toBeVisible();

  // SEARCHED, not scanned. The palette shows the first thirty matches, so an
  // unfiltered comparison would fail on the size of the product rather than on
  // any disagreement — which is exactly the kind of test that gets deleted
  // instead of believed.
  const field = palette.getByRole("textbox");
  for (const title of titles) {
    await field.fill(title);
    await expect(
      palette,
      `"${title}" is in a menu, so it must be findable in the palette`,
    ).toContainText(title);
  }
});
