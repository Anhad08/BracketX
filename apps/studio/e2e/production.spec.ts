import { expect, test } from "@playwright/test";

/**
 * Production — where scenes go to air.
 *
 * Going to air used to sit on the design surface, which put a control that
 * starts a transmission next to a control that nudges a rectangle. They are
 * not the same class of act: one is undoable and private, the other is
 * neither. They also belong to different people — Design is where a graphic
 * is BUILT, Production is where somebody who did not build it puts it out.
 */
test("Production is its own place, and it is where air happens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-production")).toBeVisible();

  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("production")).toBeVisible();

  // It states the transmission in words, at the top of the page that
  // controls it.
  await expect(page.getByTestId("air-state")).toHaveText(/Off air/);

  // Scenes to cue, without a layer tree in sight.
  await expect(page.locator('[data-testid^="cue-"]').first()).toBeVisible();
  await expect(page.getByTestId("outline")).toHaveCount(0);
});

test("Design no longer carries the transmission", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");

  // No programme row, no take, no off-air on the design surface.
  await expect(page.getByTestId("program-row")).toHaveCount(0);
  await expect(page.getByTestId("take")).toHaveCount(0);
  await expect(page.getByTestId("off-air")).toHaveCount(0);

  // The one control that mentions air HANDS YOU OVER rather than doing it.
  await page.getByTestId("go-live").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "production");
  await expect(page.getByTestId("take")).toBeVisible();
});

test("a scene is cued and taken from Production alone", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-production").click();

  await page.locator('[data-testid^="cue-"]').first().click();
  // Loading a scene opens it for editing; come back to put it out.
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("program-row")).toBeVisible();

  await page.getByTestId("take").click();
  await expect(page.getByTestId("air-state")).toHaveText(/ON AIR/);
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  await page.getByTestId("off-air").click();
  await expect(page.getByTestId("air-state")).toHaveText(/Off air/);
});

/**
 * The spine — the tally, as three pixels across the whole application.
 *
 * Off air it is a hairline nobody notices. Live, it is the brightest thing on
 * the screen and the only red. You cannot be on air and not know it, from any
 * distance, without reading anything — which a text tally in a corner cannot
 * claim.
 */
test("the spine reports air across the whole application", async ({ page }) => {
  await page.goto("/");
  const spine = page.getByTestId("spine");
  await expect(spine).toHaveAttribute("data-air", "off");

  // It spans the window, not a panel.
  const box = (await spine.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeCloseTo(viewport.width, 0);
  expect(box.y).toBeCloseTo(0, 0);
  expect(box.height).toBeLessThanOrEqual(4);

  await page.getByTestId("nav-production").click();
  await page.locator('[data-testid^="cue-"]').first().click();
  await page.getByTestId("nav-production").click();
  await page.getByTestId("take").click();

  await expect(spine).toHaveAttribute("data-air", "live");
  await expect(spine).toHaveClass(/live/);

  await page.getByTestId("off-air").click();
  await expect(spine).toHaveAttribute("data-air", "off");
});

/**
 * "⏎ takes, unconditionally, even from a focused field. A show outranks a
 * form." — the prototype's rule, in its words.
 *
 * Every other shortcut stands down while somebody is typing. This one does
 * not, because the alternative is an operator pressing Enter at the moment
 * that matters and being told they were in a text box.
 */
test("Enter takes, even from inside a text field", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible();

  // Focus a content field and type into it, as an operator fixing a name
  // seconds before air would.
  const field = page.getByTestId("content").locator("input.field").first();
  await field.click();
  await field.fill("MO SALAH");

  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("spine"),
    "a show outranks a form",
  ).toHaveAttribute("data-air", "live");

  // And the field kept the edit — taking does not discard what was typed.
  await expect(field).toHaveValue("MO SALAH");
});
