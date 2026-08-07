import { expect, type Page } from "@playwright/test";

/**
 * Reveals Studio to at least the depth a test needs.
 *
 * Studio opens at BEGINNER depth (Volume One L9) and the control CYCLES —
 * beginner → designer → advanced → beginner. Tests that clicked it a fixed
 * number of times therefore cycled back to beginner and lost the panels they
 * had just revealed, which is exactly what happened to the walkthrough.
 *
 * Reading the depth instead of counting clicks is also the honest thing: this
 * is the user asking for their tools, not a test poking a toggle.
 */
export async function ensureDepth(
  page: Page,
  wanted: "designer" | "advanced",
): Promise<void> {
  const order = ["beginner", "designer", "advanced"];
  for (let guard = 0; guard < 4; guard += 1) {
    const current = (await page.locator(".studio").getAttribute("data-depth")) ?? "beginner";
    if (order.indexOf(current) >= order.indexOf(wanted)) return;
    await page.getByTestId("depth-toggle").click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator(".studio")).toHaveAttribute("data-depth", wanted);
}

/**
 * Opens a bottom-dock panel by its visible name.
 *
 * They are headers, not tabs — Volume Two refuses tabbing — so this expands a
 * collapsed panel and leaves an open one alone, which is what a caller wanting
 * to USE the panel means. Scoped to the dock because "Templates" is also a
 * rail destination and an unscoped lookup matches both.
 */
export async function openPanel(page: Page, name: string): Promise<void> {
  const head = page.locator(".dock-heads").getByRole("button", { name, exact: true });
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
