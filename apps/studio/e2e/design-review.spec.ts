import { expect, test, type Page } from "@playwright/test";

/**
 * THE DESIGN REVIEW HARNESS.
 *
 * ============================================================================
 * WHY THIS IS NOT `essentials.spec.ts`
 * ============================================================================
 * That file photographs the whole application window, which is the right picture
 * for "does the editor open a template". It is the wrong picture for judging a
 * GRAPHIC: the canvas is a few hundred pixels wide inside it, surrounded by
 * panels, and a lower third at that scale looks fine no matter what it is.
 *
 * This shoots the CANVAS ONLY, at the size the graphic actually goes to air, and
 * it shoots every piece of content that has to survive — the designed case, the
 * longest string in the feed, and the shortest. Volume Four's specimen rule:
 * "the extreme of its own data source — the longest name, the largest number,
 * the widest string — and shows you the failure while you are still designing
 * it."
 *
 * The output is for LOOKING AT. The assertions here only catch what a picture
 * cannot argue with; the design judgement is made by reading the images.
 */

async function open(page: Page, id: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`start-${id}`).click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.locator(".scene-surface canvas").first()).toBeVisible({ timeout: 30_000 });
  // Fonts, images, paint rasterisation, and the first projected frame.
  await page.waitForTimeout(1400);
}

/** The graphic itself, with none of the editor around it. */
async function shoot(page: Page, name: string): Promise<void> {
  const canvas = page.locator(".scene-surface canvas").first();
  await expect(canvas).toBeVisible();
  await canvas.screenshot({ path: `design/${name}.png`, animations: "disabled" });
}

/**
 * Sets a content field by its label, the way an operator would.
 *
 * By ROW rather than by position. A graphic's fields are ordered by the document,
 * so `input.field.first()` silently edits whichever variable happens to be first
 * — and once this template gained a Context slot, that lookup found a NUMBER
 * input and Playwright refused to type into it. The label is the stable handle.
 */
async function setField(page: Page, label: string, value: string): Promise<void> {
  const row = page
    .getByTestId("content")
    .locator("label.content-row")
    .filter({ hasText: label })
    .first();
  const field = row.locator("input").first();
  await expect(field, `no content field called ${label}`).toBeVisible();
  await field.fill(value);
  await field.blur();
  await page.waitForTimeout(900);
}

test("Lower Third — designed, longest and shortest content", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await open(page, "tpl_lower_third");
  await shoot(page, "lower-third-1-designed");

  // THE WORST CASE IN THE FEED. 25 characters, and the name that used to make
  // the old strap render nothing at all.
  await setField(page, "Name", "KONSTANTINOS PAPADOPOULOS");
  await shoot(page, "lower-third-2-longest");

  // And the shortest, where a composition built around a long word falls apart
  // in the other direction — acres of empty plate beside two letters.
  await setField(page, "Name", "LI");
  await shoot(page, "lower-third-3-shortest");

  expect(errors, errors.join("\n")).toEqual([]);
});
