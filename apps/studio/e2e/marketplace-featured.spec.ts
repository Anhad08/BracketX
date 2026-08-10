import { expect, test, type Page } from "@playwright/test";

/**
 * THE FEATURED SECTION, LOOKED AT.
 *
 * Shoots the section itself at both stated widths and asserts the things a
 * picture cannot: that the composition holds, that the artwork is a REAL
 * rendered graphic rather than a swatch, that the index navigates, and that the
 * page never scrolls sideways.
 */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("mk-featured")).toBeVisible({ timeout: 30_000 });
  // Stills are rendered off the real templates; give them a frame to arrive.
  await page.waitForTimeout(2500);
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`Featured composes at ${size.width}x${size.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setViewportSize(size);
    await open(page);

    const section = page.getByTestId("mk-featured");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await section.screenshot({ path: `design/featured-${size.width}.png`, animations: "disabled" });

    // NO HORIZONTAL OVERFLOW, asserted on the document rather than by eye.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("the featured artwork is a real rendered graphic, and the index navigates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);

  // A REAL PREVIEW, not the two-tone swatch this surface used to draw. The art
  // pipeline renders a still per template; a swatch would leave the placeholder.
  const art = page.getByTestId("mk-featured").locator(".mk-feat-art img, .mk-feat-art canvas");
  await expect(art.first(), "the featured pack has no rendered artwork").toBeVisible();

  const name = page.getByTestId("mk-feat-name");
  const first = await name.textContent();
  await expect(page.getByTestId("mk-feat-count")).toHaveText(/^01 \/ \d\d$/);

  // The index is the whole secondary navigation: press a row, that pack features.
  const rows = page.getByTestId("mk-feat-index").locator("button");
  await rows.nth(1).click();
  await expect(name).not.toHaveText(first ?? "");
  await expect(page.getByTestId("mk-feat-count")).toHaveText(/^02 \/ \d\d$/);
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");

  // And the step control agrees with it.
  await page.getByTestId("mk-feat-prev").click();
  await expect(page.getByTestId("mk-feat-count")).toHaveText(/^01 \/ \d\d$/);
  await expect(name).toHaveText(first ?? "");
});
