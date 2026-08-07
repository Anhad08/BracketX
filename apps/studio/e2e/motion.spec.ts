import { expect, test, type Page } from "@playwright/test";

/**
 * Motion, proved rather than declared.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * The stylesheet used to carry a rule that read "CHROME DOES NOT MOVE", and
 * the result was an interface where nothing acknowledged anything: sections
 * cut, panels appeared, selections blinked on. That is not restraint, it is
 * absence — and absence is most of what makes software feel unfinished.
 *
 * A CSS rule can be written and then quietly cancelled by a later selector, by
 * a specificity collision, or by an element that never remounts. So these
 * assertions ask the BROWSER what is actually running, not what the stylesheet
 * says.
 *
 * The last test is the important one, and it is a negative: nothing may animate
 * on its own. Every movement in this product is a response to something a
 * person did. A pulsing, looping, attention-seeking interface competes with the
 * graphic being authored, which is the one thing on screen allowed to move by
 * itself.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
}

/** The animations the browser is actually running on an element, right now. */
async function running(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (node === null) return [];
    return node
      .getAnimations()
      .map((animation) => (animation as CSSAnimation).animationName ?? "transition");
  }, selector);
}

test("a section arrives rather than cutting", async ({ page }) => {
  await boot(page);

  // Navigating remounts the host, so the entrance runs on every arrival and
  // not only on first paint — which is the bug a CSS-only entrance has.
  await page.getByTestId("nav-marketplace").click();
  expect(await running(page, ".section-host")).toContain("section-in");

  // And again, going somewhere else. A transition that plays once is a
  // transition somebody sees once and then wonders why the product got worse.
  await page.getByTestId("nav-templates").click();
  expect(await running(page, ".section-host")).toContain("section-in");
});

test("cards assemble across the grid instead of appearing at once", async ({ page }) => {
  await boot(page);
  expect(await running(page, ".start-card")).toContain("tile-in");

  // Staggered by position: the fourth card starts after the first. Read from
  // the browser rather than from the stylesheet, because a stagger written as
  // a rule and cancelled by a later one looks identical in the source.
  const delays = await page.evaluate(() =>
    [...document.querySelectorAll(".start-card")]
      .slice(0, 4)
      .map((node) => getComputedStyle(node).animationDelay),
  );
  expect(new Set(delays).size, "cards must not all arrive together").toBeGreaterThan(1);
});

test("the rail answers the pointer, and the icons are drawn", async ({ page }) => {
  await boot(page);

  // Drawn, not typed. Unicode glyphs come from whatever font the machine has,
  // so they arrive at different weights and baselines — a row of mismatched
  // marks pretending to be a set.
  const icons = page.locator(".rail-icon svg");
  await expect(icons.first()).toBeVisible();
  expect(await icons.count()).toBeGreaterThan(5);

  const lifted = await page.evaluate(() => {
    const item = document.querySelector(".rail-item.on .rail-icon");
    return item === null ? "" : getComputedStyle(item).transform;
  });
  // The icon leads the state, so pressing a section reads as arriving at it
  // rather than as tinting a row.
  expect(lifted, "the current section's icon must be lifted").not.toBe("none");
});

test("a selection springs onto the layer", async ({ page }) => {
  await boot(page);
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("depth-toggle").click();
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("selection-box")).toBeVisible();
  expect(await running(page, ".selection-box .sel-tick")).toContain("tick-in");
});

/**
 * THE NEGATIVE, AND THE IMPORTANT ONE.
 *
 * Nothing animates on its own. A product whose chrome pulses, breathes or
 * loops is a product competing with the work — and on a broadcast desk, a
 * moving interface is a moving interface you eventually stop being able to
 * ignore.
 */
test("nothing moves unless somebody did something", async ({ page }) => {
  await boot(page);
  // Long enough for every entrance to have finished several times over.
  await page.waitForTimeout(2_500);

  const forever = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        const timing = animation.effect?.getTiming();
        const iterations = timing?.iterations ?? 1;
        return iterations === Infinity || iterations > 3;
      })
      .map((animation) => (animation as CSSAnimation).animationName ?? "unnamed"),
  );
  expect(forever, "chrome must never loop").toEqual([]);

  // And everything that did run has finished. An entrance still playing three
  // seconds after arrival is not an entrance, it is a stall.
  const stillRunning = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === "running")
      .map((animation) => (animation as CSSAnimation).animationName ?? "unnamed"),
  );
  expect(stillRunning).toEqual([]);
});
