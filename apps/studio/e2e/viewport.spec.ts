import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The stage interactions, in the real application.
 *
 * These three were all VISUALLY complete and FUNCTIONALLY absent: the stage
 * looked like an editor, and moving the pointer across it said nothing, a
 * right-click did nothing, and there was no way to zoom to what you had
 * selected. An interaction that looks finished and is not is worse than one
 * that is obviously missing, because nobody files a bug against it.
 */
async function openLowerThird(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The centre of a layer's box on screen, via its selection gizmo. */
async function centreOf(page: Page, layer: string): Promise<{ x: number; y: number }> {
  await page.getByTestId("outline").getByText(layer, { exact: true }).click();
  const box = await page.getByTestId("gizmo").boundingBox();
  if (box === null) throw new Error("no gizmo");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("hovering a layer outlines it, and the cursor answers before the click", async ({ page }) => {
  await openLowerThird(page);
  const point = await centreOf(page, "Accent Bar");

  // Deselect, so the hover is not confused with the selection outline.
  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12);
  await expect(page.getByTestId("gizmo")).toHaveCount(0);

  await page.mouse.move(point.x, point.y);
  await expect(
    page.getByTestId("hover-outline"),
    "moving the pointer over a graphic must say so before it is clicked",
  ).toBeVisible();
  await expect(chrome).toHaveCSS("cursor", "move");

  // Off the graphic, the outline goes away — a hover that stuck would be a
  // permanent lie about what the pointer is over.
  await page.mouse.move(box.x + 12, box.y + 12);
  await expect(page.getByTestId("hover-outline")).toHaveCount(0);
  await expect(chrome).toHaveCSS("cursor", "default");
});

test("a resize handle shows a resize cursor", async ({ page }) => {
  await openLowerThird(page);
  await centreOf(page, "Accent Bar");

  const handle = (await page.getByTestId("handle-e").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);

  // Both, in this order. `data-hover` says the pointer FOUND the east handle;
  // the cursor says it was then dressed correctly. Asserting only the cursor
  // cannot tell a missed handle from a wrong cursor, and that ambiguity has
  // already hidden one real bug in this component.
  const chrome = page.getByTestId("scene-chrome");
  await expect(chrome).toHaveAttribute("data-hover", "e");
  await expect(chrome).toHaveCSS("cursor", "ew-resize");
});

test("right-clicking a layer selects it and offers the same commands as the palette", async ({
  page,
}) => {
  await openLowerThird(page);
  const point = await centreOf(page, "Accent Bar");

  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12);
  await expect(page.getByTestId("gizmo")).toHaveCount(0);

  await page.mouse.click(point.x, point.y, { button: "right" });

  // Right-clicking something unselected selects it first — otherwise the menu
  // acts on a thing the user cannot see they are acting on.
  await expect(page.getByTestId("gizmo")).toBeVisible();
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await expect(page.getByTestId("menu-edit.duplicate")).toBeVisible();

  // It runs the real command: duplicating adds a layer.
  const before = await page.getByTestId("outline").locator("li").count();
  await page.getByTestId("menu-edit.duplicate").click();
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  expect(await page.getByTestId("outline").locator("li").count()).toBe(before + 1);
});

test("frame selection zooms to what is selected", async ({ page }) => {
  await openLowerThird(page);
  await centreOf(page, "Accent Bar");

  const zoom = async (): Promise<number> =>
    Number((await page.getByTestId("zoom").innerText()).replace("%", ""));
  const before = await zoom();

  await page.getByTestId("scene-chrome").click({ position: { x: 5, y: 5 } });
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await page.keyboard.press("Shift+F");

  // The accent bar is a fraction of the frame, so framing it must zoom IN.
  await expect
    .poll(zoom, { message: "framing a selection must zoom to it" })
    .toBeGreaterThan(before);
});

/**
 * Clicking a template the instant the page is usable.
 *
 * The engine starts asynchronously, so an early click was queued — and the
 * queue was drained inside the boot effect, BEFORE the store subscription
 * existed. `open()` published its change to nobody, the revision never
 * advanced, and the shell went on rendering the blank scene. You landed on an
 * empty stage called "Untitled", the click looked ignored, and clicking again
 * worked. That is the signature of a race, and the reason it survived: it
 * always reproduced on a cold, loaded machine and never on a warm one.
 *
 * No waiting for the engine here beyond the button existing. That is the
 * point.
 */
test("a template opens when clicked the moment the page is usable", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click({ timeout: 30_000 });

  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await ensureDepth(page, "designer");
  await expect(
    page.getByTestId("outline").getByText("Accent Bar", { exact: true }),
    "the graphic must open on the first click, not the second",
  ).toBeVisible({ timeout: 30_000 });
});

/**
 * The frame states what it is.
 *
 * Two overlays on the picture itself — its format, and the selection's size.
 * A designer should never open a panel to learn what they are working in, and
 * the size readout is what turns "about right" into a number you can repeat.
 */
test("the frame names its format, and the selection its size", async ({ page }) => {
  await openLowerThird(page);

  const format = page.getByTestId("ov-format");
  await expect(format).toBeVisible();
  // Format and cadence, from the document's own output — not a constant.
  await expect(format).toHaveText(/^\d+ × \d+ · \d+p$/);

  // Nothing selected, nothing to measure.
  await expect(page.getByTestId("ov-size")).toHaveCount(0);

  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  const size = page.getByTestId("ov-size");
  await expect(size).toBeVisible();
  await expect(size).toHaveText(/^\d+ × \d+$/);

  // It MEASURES: a wider selection reads wider. The union of two layers must
  // be at least as wide as either alone, or the readout is decorative.
  const widthOf = async () => Number((await size.innerText()).split("×")[0]!.trim());
  const one = await widthOf();
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  const other = await widthOf();
  await page.keyboard.down("Shift");
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await page.keyboard.up("Shift");
  expect(await widthOf()).toBeGreaterThanOrEqual(Math.max(one, other));
});
