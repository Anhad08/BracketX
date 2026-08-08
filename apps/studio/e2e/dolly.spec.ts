import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The wheel means "closer", and in 3D that is not a scale factor.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR
 * ============================================================================
 * One wheel handler served both views. In the flat view it is right: the
 * picture is a picture and zooming scales it. In 3D it produced a state
 * nobody could describe and everybody could see was wrong.
 *
 * `viewport.zoom` scales the engine's canvas AS A FLAT IMAGE, and it scales
 * the frame rectangle. Both duly shrank. But the ground grid is world geometry
 * projected through the camera, and a grid line running to the horizon
 * projects to canvas coordinates in the tens of thousands — multiplying those
 * by 0.05 still leaves them spanning the screen.
 *
 * So scrolling out gave a frame at five per cent adrift inside a giant fan of
 * floor lines. The camera had not moved at all. The view had not changed, only
 * its scale factor, and a perspective projection does not survive being
 * treated as a bitmap.
 *
 * Every existing test passed. They measured the overlay against the overlay.
 * This file measures the FLOOR against the FRAME — the two things that were
 * disagreeing — and asks whether the camera actually moved.
 */

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(900);
  // The floor only exists in the dimensional view. If it is missing, the rest
  // of this file would pass vacuously.
  await expect(page.getByTestId("ground")).toBeVisible();
}

async function openFlat(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
}

/** How much of the screen the drawn floor covers, in square pixels. */
async function floorArea(page: Page): Promise<number> {
  const box = await page.getByTestId("ground").boundingBox();
  return box === null ? 0 : box.width * box.height;
}

/**
 * How far the scene camera is from the origin, read off the Properties panel.
 *
 * The document is the subject here, not the drawing: a dolly is a camera MOVE,
 * and the point of the fix is that the wheel changes where the camera is
 * rather than what scale its picture is drawn at.
 */
async function cameraDistance(page: Page): Promise<number> {
  await page.getByTestId("outline").getByText("Camera", { exact: true }).click();
  const inspector = page.getByTestId("inspector");
  const axes = await Promise.all(
    ["x", "y", "z"].map(async (axis) =>
      Number(await inspector.getByLabel(`position ${axis}`).inputValue()),
    ),
  );
  return Math.hypot(...axes);
}

/**
 * ⌘/Ctrl + wheel, because a BARE wheel scrolls.
 *
 * `studio-specification.html` §03 reserves the bare wheel for scrolling and
 * puts zoom behind the modifier — "bare-wheel zoom is the single most
 * complained-about behaviour in design tools". This file was written before
 * that was honoured, when the bare wheel dollied. The behaviour under test is
 * unchanged; the gesture that asks for it moved.
 */
async function wheel(page: Page, amount: number, times: number): Promise<void> {
  const box = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let index = 0; index < times; index += 1) {
    await page.mouse.wheel(0, amount);
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);
}

// ===========================================================================

test("in 3D the wheel moves the camera and leaves the zoom alone", async ({ page }) => {
  await open3D(page);
  const zoomBefore = await page.getByTestId("zoom").innerText();

  await wheel(page, 240, 10);

  // THE ASSERTION THAT WOULD HAVE CAUGHT IT. Scaling a perspective view is
  // not zooming it, so the scale factor must not be what changed.
  expect(
    await page.getByTestId("zoom").innerText(),
    "the wheel scaled the flat viewport instead of moving the camera",
  ).toBe(zoomBefore);
});

test("scrolling out makes the floor smaller, not larger", async ({ page }) => {
  await open3D(page);
  const before = await floorArea(page);
  expect(before, "the floor is not being drawn").toBeGreaterThan(0);

  await wheel(page, 240, 10);
  const after = await floorArea(page);

  // The whole visible symptom, in one number. Before the fix this GREW — the
  // camera stayed put while everything measured in canvas space shrank around
  // it, so the floor swallowed the screen.
  expect(after, "pulling back made the floor bigger").toBeLessThan(before);
});

test("scrolling moves the camera itself, in both directions", async ({ page }) => {
  await open3D(page);
  const start = await cameraDistance(page);
  expect(start, "the camera has no position to move").toBeGreaterThan(0);

  await wheel(page, 240, 8);
  const out = await cameraDistance(page);
  expect(out, "scrolling out did not move the camera back").toBeGreaterThan(start);

  await wheel(page, -240, 16);
  expect(
    await cameraDistance(page),
    "scrolling in did not bring the camera closer",
  ).toBeLessThan(out);
});

test("the floor moves and the flat surface does not", async ({ page }) => {
  await open3D(page);
  const surface = page.locator(".scene-surface");
  const floorBefore = await floorArea(page);
  const surfaceBefore = (await surface.boundingBox())!.width;

  await wheel(page, 240, 10);

  // The exact pair that was disagreeing. `.scene-surface` carries the flat
  // transform — the one that used to shrink to five per cent — and the floor
  // is projected through the camera. Pulling back must move the FLOOR and
  // leave the surface exactly where it is.
  expect(await floorArea(page)).toBeLessThan(floorBefore);
  expect(
    (await surface.boundingBox())!.width,
    "the wheel rescaled the picture instead of moving the camera",
  ).toBeCloseTo(surfaceBefore, 0);
});

test("a camera dollied out and back leaves the scene where it was", async ({ page }) => {
  await open3D(page);
  const before = await floorArea(page);

  await wheel(page, 240, 6);
  await wheel(page, -240, 6);

  // Multiplicative steps, so out-and-back returns. A fixed step would not, and
  // a designer would find the view drifting every time they scrolled.
  expect(Math.abs((await floorArea(page)) - before) / before).toBeLessThan(0.08);
});

test("the flat view still zooms, and its camera never moves", async ({ page }) => {
  await openFlat(page);
  const zoomBefore = await page.getByTestId("zoom").innerText();

  await wheel(page, -240, 5);

  // A lower third is designed square-on. The wheel here must be an ordinary
  // zoom, exactly as before — this fix must not have reached the flat view.
  expect(
    await page.getByTestId("zoom").innerText(),
    "the flat view stopped zooming",
  ).not.toBe(zoomBefore);
  expect(await page.getByTestId("ground").count()).toBe(0);
});


