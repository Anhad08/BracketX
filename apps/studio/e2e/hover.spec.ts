import { expect, test, type Page } from "@playwright/test";

/**
 * Point at a graphic and it plays.
 *
 * ============================================================================
 * WHAT ONLY A BROWSER CAN PROVE
 * ============================================================================
 * A still says what a template LOOKS like. It cannot say what it DOES, and for
 * a broadcast graphic what it does is most of the decision — "slides in from
 * the left", "wipes open, then the headline arrives" were words under the
 * cards that a person had to take on trust.
 *
 * The claim being tested is not "a canvas appeared". It is that the ENGINE is
 * running the real timeline into that canvas: the pixels have to be different
 * from one moment to the next, and different again from the still underneath.
 * A canvas that mounted and stayed black would satisfy every structural
 * assertion and deliver nothing.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  // The player is built once the fonts have parsed, and the stills arrive on
  // the same signal — so waiting for one waits for both.
  await expect(page.locator(".start-card .art-still").first()).toBeVisible({
    timeout: 25_000,
  });
}

/** A cheap signature of what is currently drawn in a tile's live layer. */
async function signature(page: Page, index: number): Promise<string> {
  return page.evaluate((position) => {
    const canvas = document.querySelectorAll<HTMLCanvasElement>(".start-card .art-live")[
      position
    ];
    if (canvas === undefined || canvas.width === 0) return "empty";
    const context = canvas.getContext("2d");
    if (context === null) return "no-context";
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let filled = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (data[i + 3]! === 0) continue;
      filled += 1;
      sum += data[i]! + data[i + 1]! + data[i + 2]!;
    }
    return `${filled}:${sum}`;
  }, index);
}

test("hovering a card plays the real graphic", async ({ page }) => {
  await boot(page);

  const card = page.locator(".start-card").first();
  await expect(card.locator(".art-live")).not.toHaveClass(/\bon\b/);

  await card.hover();
  await expect(card.locator(".art-live")).toHaveClass(/\bon\b/);

  // Two frames, a beat apart, during the entrance. They must differ — a canvas
  // that mounted and held one frame is a canvas that is not playing.
  await page.waitForTimeout(180);
  const first = await signature(page, 0);
  await page.waitForTimeout(320);
  const second = await signature(page, 0);

  expect(first).not.toBe("empty");
  expect(second, "the tile must be animating, not holding a frame").not.toBe(first);
});

test("it stops when the pointer leaves, and the still is still there", async ({ page }) => {
  await boot(page);
  const card = page.locator(".start-card").first();

  await card.hover();
  await expect(card.locator(".art-live")).toHaveClass(/\bon\b/);

  // Somewhere that is not a card.
  await page.mouse.move(4, 4);
  await expect(card.locator(".art-live")).not.toHaveClass(/\bon\b/);

  // The still was never disturbed. Unmounting it on hover would flash the
  // card's background between the last live frame and the still coming back.
  await expect(card.locator(".art-still")).toBeVisible();

  // And nothing is left running. A rAF loop that survives the pointer leaving
  // is a rAF loop per card you ever touched.
  await page.waitForTimeout(400);
  const before = await signature(page, 0);
  await page.waitForTimeout(400);
  expect(await signature(page, 0), "the loop must stop when you leave").toBe(before);
});

/**
 * ONE RENDERER, NOT ONE PER TILE.
 *
 * A player per card would mean forty WebGL contexts on the Marketplace and a
 * browser that refuses the seventeenth — the tab dies and takes the editor
 * with it. Moving across a whole grid must cost exactly one.
 */
test("crossing every card costs one renderer", async ({ page }) => {
  await boot(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // Only the cards that HAVE a graphic. "3D scene" and "Blank graphic" start
  // from nothing, so there is nothing for them to play — and a test that
  // expected pixels from them would be asserting that empty is not empty.
  const cards = page.locator(".start-card:has(.art-live)");
  const count = await cards.count();
  expect(count).toBeGreaterThan(4);
  for (let index = 0; index < count; index += 1) {
    await cards.nth(index).hover();
    await page.waitForTimeout(60);
  }

  // The last one still plays, which it would not if the earlier hovers had
  // exhausted the browser's context budget.
  await page.waitForTimeout(250);
  expect(await signature(page, count - 1)).not.toBe("empty");
  expect(errors, errors.join("\n")).toEqual([]);
});
