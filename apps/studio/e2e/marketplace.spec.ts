import { expect, test } from "@playwright/test";

/**
 * Marketplace discovery.
 *
 * Volume One §States writes the filtered-empty state out in full. It was absent:
 * filtering to nothing showed an EMPTY GRID — no words, no count, no action —
 * which answers Law 7's "what now?" with nothing at all.
 */
async function marketplace(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("marketplace")).toBeVisible();
  return page.getByLabel("Search packs");
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`a search that matches nothing says so, and offers a way out — ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const search = await marketplace(page);

    const all = await page.locator('[data-testid^="pack-"]').count();
    expect(all, "no packs at all").toBeGreaterThan(1);

    // Real filtering first: a word that IS in the catalogue must reduce, not empty.
    await search.fill("motion");
    await expect(page.getByTestId("marketplace-empty")).toHaveCount(0);
    const matched = await page.locator('[data-testid^="pack-"]').count();
    expect(matched, "a real word matched nothing").toBeGreaterThan(0);
    expect(matched, "the filter did not actually filter").toBeLessThan(all);

    // A word nothing carries. NOT "esports" — Volume One's example copy uses it,
    // but this catalogue ships a pack called "Sport & Esports", so it matches.
    // The specified string is illustrative, not a fixture.
    await search.fill("zzqqxx");
    const empty = page.getByTestId("marketplace-empty");
    await expect(empty).toBeVisible();
    // It names the query back, which makes it a report rather than a shrug.
    await expect(empty).toContainText("zzqqxx");
    await expect(page.locator('[data-testid^="pack-"]')).toHaveCount(0);

    // And a way back that works.
    await page.getByTestId("empty-clear-filter").click();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('[data-testid^="pack-"]')).toHaveCount(all);
    await expect(search).toHaveValue("");
  });
}

test("no card carries a rating, a star or a score", async ({ page }) => {
  await marketplace(page);
  // Volume Four Amendment 3 reversed the ratings model outright: "No subjective
  // ratings." Worth a regression, because stars are the first thing anyone
  // reaches for when designing a storefront.
  const body = (await page.getByTestId("marketplace").textContent()) ?? "";
  expect(body).not.toMatch(/★|⭐|\b\d(\.\d)?\s*\/\s*5\b|\breviews?\b|\brating\b/i);
});
