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
