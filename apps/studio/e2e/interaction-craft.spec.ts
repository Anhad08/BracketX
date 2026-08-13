import { expect, test } from "@playwright/test";

/**
 * RESPONSE AND FOCUS, as behaviour rather than as stylesheet.
 *
 * Three things a person does with every control in the product, none of which had
 * a test: press it and see it acknowledge, Tab to it and see where they are, and
 * press Enter to activate what they reached.
 */

test("Enter activates the focused control instead of taking the graphic to air", async ({
  page,
}) => {
  // ==========================================================================
  // THE DEFECT THIS DEFENDS AGAINST WAS TWO DEFECTS
  // ==========================================================================
  // Enter was bound globally to Take, with `preventDefault` called first and the
  // typing guard computed then discarded. So no focused control in Studio could be
  // activated from the keyboard at all, AND pressing Enter to commit a name in a
  // text field put the graphic to air — an irreversible outward-facing action on
  // the most common keystroke there is.
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: 30_000 });

  // TYPING. Enter in a field must commit the field and nothing else — above all
  // it must not reach the transport.
  const field = page.getByTestId("content").locator("input.field").first();
  await field.click();
  await field.fill("ALEX RIVERO");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("rail-tally"), "Enter in a text field went to air").not.toHaveText(
    "ON AIR",
  );

  // A FOCUSED BUTTON. Enter belongs to the button, so the style applies and the
  // graphic stays off air.
  const style = page.getByTestId("graphic-style-soft");
  await style.focus();
  await page.keyboard.press("Enter");
  await expect(style, "Enter did not activate the focused control").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("rail-tally")).not.toHaveText("ON AIR");
});

test("a focused control shows where the keyboard is", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });

  const start = page.getByTestId("start-tpl_lower_third");
  await start.focus();
  // A RING, and a real one: `focus-visible` fires for the keyboard path, and an
  // outline of `none` is the default browsers give buttons — which is what most of
  // this product had.
  const ring = await start.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth };
  });
  expect(ring.style, "a focused control has no ring").not.toBe("none");
  expect(parseFloat(ring.width), "the focus ring is hairline-thin").toBeGreaterThanOrEqual(2);
});

test("a press acknowledges on the way down, not on release", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });

  const start = page.getByTestId("start-tpl_lower_third");
  const box = await start.boundingBox();
  expect(box).not.toBeNull();

  const at = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(at.x, at.y);
  const resting = await start.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.down();
  // Read WHILE HELD. The whole point is that the acknowledgement exists before
  // the click resolves; reading after `mouse.up()` would test nothing.
  const held = await start.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.up();

  expect(held, "a held control looks identical to a resting one").not.toBe(resting);
  // And it is a SHRINK, not a grow: a control moves away from the finger under it.
  const scale = Number(/matrix\(([-\d.]+)/.exec(held)?.[1] ?? "1");
  expect(scale).toBeLessThan(1);
  expect(scale, "the press scale is a wobble rather than a press").toBeGreaterThan(0.9);
});
