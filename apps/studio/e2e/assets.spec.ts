import { expect, test, type Page } from "@playwright/test";

/**
 * The Asset Browser, operated.
 *
 * ============================================================================
 * WHY THIS IS A BROWSER TEST AND NOT A UNIT TEST
 * ============================================================================
 * The registry's own suite proves rename, duplicate, delete, replace and search
 * are correct. It cannot prove they are REACHABLE — that a designer clicking a
 * tile gets an inspector, that a rename survives, that deleting the asset a
 * graphic uses does the right thing. Every gap this milestone closed was a gap
 * between a working model and an unusable product, so the test has to be a
 * gesture.
 */

const BADGE =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGO4rmb7HxkzkC4AALUoI5EMqBxNAAAAAElFTkSuQmCC";
// A second, different image, so replace and dedup have something to disagree
// about. 2x2 rather than 4x4 — the size is the assertion.
const OTHER =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGPQz3/9H4QZYAwAVVoKIW4vgIQAAAAASUVORK5CYII=";

async function openAssets(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-assets").click();
  await expect(page.getByTestId("asset-images")).toBeVisible();
}

/**
 * Imports a file and returns the id of the resulting asset.
 *
 * Waits for the tile bearing the asset's NAME rather than for "the last tile".
 * The shipped mark already matches any id-shaped selector, so a positional
 * locator resolves to it the instant the page renders — before the import has
 * landed — and every assertion afterwards is then about the wrong asset. That
 * cost three red tests that had nothing wrong with the product.
 *
 * `expectName` is explicit because a re-import of existing content keeps the
 * name it already had, not the file name it arrived under this time.
 */
async function importBadge(
  page: Page,
  file = "Club Badge.png",
  data = BADGE,
  expectName = file.replace(/\.png$/, ""),
): Promise<string> {
  await page.getByTestId("asset-file").setInputFiles({
    name: file,
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  const tile = page
    .getByTestId("asset-grid")
    .locator(".asset-tile")
    .filter({ has: page.getByText(expectName, { exact: true }) })
    .first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  return (await tile.getAttribute("data-testid"))!.replace("asset-", "");
}

test("an imported asset gets a real preview, not a text tile", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);

  // A thumbnail rendered from the pixels that go on air — see preview.ts on why
  // it is not the original file handed to the browser.
  const image = page.getByTestId(`asset-${id}`).locator("img");
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  expect(source).toMatch(/^data:image\/png;base64,/);

  // And the shipped mark has one too, so the library is not half-illustrated.
  await expect(page.getByTestId("asset-ast_sponsor_mark").locator("img")).toBeVisible();
});

test("search narrows the library and says so when nothing matches", async ({ page }) => {
  await openAssets(page);
  await importBadge(page);
  await expect(page.locator(".asset-tile")).toHaveCount(2);

  await page.getByTestId("asset-search").fill("badge");
  await expect(page.locator(".asset-tile")).toHaveCount(1);
  await expect(page.getByText("Club Badge")).toBeVisible();

  await page.getByTestId("asset-search").fill("zzzz");
  await expect(page.locator(".asset-tile")).toHaveCount(0);
  await expect(page.getByText('Nothing matches "zzzz"')).toBeVisible();
});

test("selecting an asset opens an inspector with its facts", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);

  await expect(page.getByTestId("asset-inspector")).toHaveCount(0);
  await page.getByTestId(`asset-${id}`).click();
  await expect(page.getByTestId("asset-inspector")).toBeVisible();
  await expect(page.getByTestId("asset-name")).toHaveValue("Club Badge");
  await expect(page.getByTestId("asset-usage")).toHaveText("0 graphics");
});

test("rename, tag and favourite persist across a reload", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);
  await page.getByTestId(`asset-${id}`).click();

  await page.getByTestId("asset-name").fill("Home Badge");
  await page.getByTestId("asset-name").blur();
  await page.getByTestId("asset-tags").fill("sport, home");
  await page.getByTestId("asset-tags").blur();
  await page.getByTestId("asset-favourite").click();
  await expect(page.getByTestId("asset-favourite")).toHaveAttribute("aria-pressed", "true");

  // The point of a library: it is still there tomorrow.
  await page.reload();
  await page.getByTestId("nav-assets").click();
  await expect(page.getByText("Home Badge")).toBeVisible({ timeout: 30_000 });

  // And tags are searchable, which is what tagging is FOR.
  await page.getByTestId("asset-search").fill("sport");
  await expect(page.locator(".asset-tile")).toHaveCount(1);
});

test("duplicate costs a record, not bytes", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);
  await page.getByTestId(`asset-${id}`).click();
  await page.getByTestId("asset-duplicate").click();

  await expect(page.getByText("Club Badge copy")).toBeVisible();
  await expect(page.locator(".asset-tile")).toHaveCount(3);
});

test("delete removes what is yours and refuses what ships", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);

  await page.getByTestId(`asset-${id}`).click();
  await page.getByTestId("asset-delete").click();
  await expect(page.getByTestId(`asset-${id}`)).toHaveCount(0);
  await expect(page.getByTestId("asset-inspector")).toHaveCount(0);

  // An included asset returns on the next launch, so a Delete button that
  // appeared to work would be lying.
  await page.getByTestId("asset-ast_sponsor_mark").click();
  await expect(page.getByTestId("asset-delete")).toBeDisabled();
});

test("replace keeps the asset's identity and updates its facts", async ({ page }) => {
  await openAssets(page);
  const id = await importBadge(page);
  await page.getByTestId(`asset-${id}`).click();
  await expect(page.getByTestId("asset-inspector")).toContainText("4 x 4 px");

  await page.getByTestId("asset-replace-file").setInputFiles({
    name: "new-badge.png",
    mimeType: "image/png",
    buffer: Buffer.from(OTHER, "base64"),
  });

  // Same id, new bytes, and a second version recorded — which is what makes
  // every graphic using it update without being re-opened.
  await expect(page.getByTestId("asset-inspector")).toContainText("2 x 2 px");
  await expect(page.getByTestId(`asset-${id}`)).toHaveCount(1);
  await expect(page.getByTestId("asset-inspector")).toContainText("Versions");
  await expect(page.getByTestId("asset-name")).toHaveValue("Club Badge");
});

test("re-importing the same file does not make a second asset", async ({ page }) => {
  await openAssets(page);
  await importBadge(page);
  await expect(page.locator(".asset-tile")).toHaveCount(2);

  // Content addressing: the same bytes are the same asset, whatever the file
  // was called this time.
  await importBadge(page, "another-name.png", BADGE, "Club Badge");
  await expect(page.locator(".asset-tile")).toHaveCount(2);
});

test("usage is exact, and counts the graphic that uses the mark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible();

  await page.getByTestId("nav-assets").click();
  await page.getByTestId("asset-ast_sponsor_mark").click();
  await expect(page.getByTestId("asset-usage")).toHaveText("1 graphic");
});
