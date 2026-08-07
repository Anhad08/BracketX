import { expect, type Page } from "@playwright/test";

/**
 * Reveals Studio to at least the level a test needs.
 *
 * TWO LEVELS now, not three depths, and the toggle no longer cycles — so this
 * is a single conditional click rather than a guarded loop. It still READS the
 * level rather than counting clicks, because a test that assumes where a
 * toggle starts is a test that breaks the day the default changes.
 *
 * `"designer"` and `"advanced"` are accepted and both mean `expert`. Keeping
 * the old words working was the difference between this change and a rewrite
 * of fourteen spec files, and every one of them means "reveal the tools".
 */
export async function ensureDepth(
  page: Page,
  wanted: "designer" | "advanced" | "expert",
): Promise<void> {
  void wanted;
  const current = (await page.locator(".studio").getAttribute("data-depth")) ?? "beginner";
  if (current === "expert") return;
  await page.getByTestId("depth-toggle").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-depth", "expert");
}

/**
 * Opens a panel in the summoned timeline dock, by its visible name.
 *
 * They are headers, not tabs — Volume Two refuses tabbing — so this expands a
 * collapsed panel and leaves an open one alone, which is what a caller wanting
 * to USE the panel means. Scoped to the dock because "Templates" is also a
 * rail destination and an unscoped lookup matches both.
 *
 * The dock itself is SUMMONED now rather than resident: it needs width a 320px
 * column does not have, and it is only wanted while somebody is timing
 * something. So this summons it first, the same way a person would (⌥T), which
 * also reveals the expert level that has one.
 */
export async function openPanel(page: Page, name: string): Promise<void> {
  const heads = page.locator(".dock-heads");
  if ((await heads.count()) === 0) {
    await page.keyboard.press("Alt+t");
    await expect(heads).toBeVisible();
  }
  const head = heads.getByRole("button", { name, exact: true });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}

/**
 * Puts what is open on air, the way the product now works.
 *
 * Transmission lives in Production. Design builds a graphic and hands over;
 * it does not take. Anything asserting "on air" goes through here so the
 * route exists in exactly one place.
 */
export async function goLive(page: Page): Promise<void> {
  await page.getByTestId("nav-production").click();
  await page.getByTestId("take").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
}
