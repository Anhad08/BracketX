import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The selection sits on the object, and clicking the object selects it.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR
 * ============================================================================
 * `nodeBounds` returns a flat rectangle: the node's `size`, in world units,
 * lying in the XY plane. For a graphic that is the whole truth. For a cube it
 * is a CROSS-SECTION — the slice through its middle at z = 0 — and the editor
 * drew the selection, hit-tested the click, and placed the gizmo on that
 * slice.
 *
 * A cube one unit on a side, seen from three-quarters, drew its selection as a
 * 76-pixel square while the cube covered 186 by 155. The brackets sat over its
 * top-left quarter, the gizmo origin sat where nothing was, and clicking the
 * cube missed it.
 *
 * Two separate errors, both fixed:
 *
 *   DEPTH        the flat rect knows nothing about the third dimension, so a
 *                solid's front face — nearer the lens, projected LARGER — was
 *                never accounted for
 *   PERSPECTIVE  the box was sized as `width * pixelsPerUnit * zoom`, which is
 *                only correct when the projection is a uniform scale. Under
 *                perspective it is not.
 *
 * Every test in the suite passed while this was broken, because they compared
 * the overlay to the overlay. This file compares the OVERLAY to the PIXELS the
 * engine drew, which is the only thing that could tell.
 */

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(1200);
}

/**
 * The screen rectangle the engine actually painted the object into.
 *
 * Found by colour: everything a new solid is made of is the default fill, a
 * strong blue, and nothing else in the scene is. Reading the alpha channel
 * would find the floor too.
 */
async function drawnBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | null;
    if (gl === null) return null;

    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4;
        const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!, a = pixels[i + 3]!;
        // Blue, and decisively so — every face of the solid, lit or shadowed.
        if (a > 200 && b > 90 && b > r * 1.6 && b > g * 1.3) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!Number.isFinite(minX)) return null;

    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    // readPixels counts rows from the BOTTOM.
    return {
      x: rect.left + minX * sx,
      y: rect.top + (canvas.height - maxY) * sy,
      width: (maxX - minX) * sx,
      height: (maxY - minY) * sy,
    };
  });
}

// ===========================================================================

test("the selection sits on the object it is selecting", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(1200);

  const drawn = (await drawnBox(page))!;
  expect(drawn, "the engine drew no solid at all").not.toBeNull();
  const selection = (await page.getByTestId("selection-box").first().boundingBox())!;

  // Every edge within a few pixels of the painted silhouette. Before the fix
  // the selection was a 76px square over a 186x155 solid — off by more than
  // the object's own size.
  const slack = 12;
  expect(Math.abs(selection.x - drawn.x), "left edge").toBeLessThan(slack);
  expect(Math.abs(selection.y - drawn.y), "top edge").toBeLessThan(slack);
  expect(Math.abs(selection.width - drawn.width), "width").toBeLessThan(slack);
  expect(Math.abs(selection.height - drawn.height), "height").toBeLessThan(slack);
});

test("clicking the object selects it", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(1200);
  const drawn = (await drawnBox(page))!;

  // Deselect, then click a part of the solid the flat cross-section never
  // covered: low and to the right, on its front face.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("statusbar")).toContainText("0 selected");

  await page.mouse.click(drawn.x + drawn.width * 0.75, drawn.y + drawn.height * 0.8);
  await expect(
    page.getByTestId("statusbar"),
    "clicking the object did not select it",
  ).toContainText("1 selected");
});

test("clicking beside the object selects nothing", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(1200);
  const drawn = (await drawnBox(page))!;

  await page.keyboard.press("Escape");
  // Well clear of the silhouette. Something IS under the cursor — the floor
  // fills the scene — so the assertion is not "nothing selected"; it is that
  // the solid's hit area does not extend past the solid.
  await page.mouse.click(drawn.x - 120, drawn.y + drawn.height / 2);

  await expect(
    page.getByTestId("inspector").getByLabel("name"),
    "the solid was picked from well outside it",
  ).not.toHaveValue("Box");
});

test("the gizmo lands on the object, not beside it", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(1200);

  const drawn = (await drawnBox(page))!;
  const gizmo = (await page.getByTestId("axes").boundingBox())!;

  // The arms radiate from the object's centre, so the gizmo's own box must
  // overlap the solid. It used to sit over the top-left quarter.
  const centre = { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 };
  expect(gizmo.x, "gizmo starts right of the object's centre").toBeLessThan(centre.x + 40);
  expect(gizmo.x + gizmo.width, "gizmo ends left of the object's centre").toBeGreaterThan(
    centre.x - 40,
  );
});

/**
 * THE ROOT IS THE DOCUMENT, NOT AN OBJECT IN IT.
 *
 * A blank scene's root carries the canvas size, so its box covered every pixel
 * of the stage. It was therefore the thing under the cursor wherever there was
 * nothing else — clicking empty space selected it, a marquee anywhere caught
 * it, and the next drag moved THE WHOLE SCENE while the object being aimed at
 * stayed exactly where it was.
 *
 * Reported as "the object won't move, the whole viewport will". Nothing was
 * wrong with the viewport.
 */
async function openBlankWithSphere(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("Blank graphic", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(1000);
  await page.getByTestId("tool-sphere").click();
  await page.waitForTimeout(1200);
}

test("dragging a band across the stage never selects the whole document", async ({ page }) => {
  await openBlankWithSphere(page);
  await page.keyboard.press("Escape");

  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  await expect(
    page.getByTestId("inspector").getByLabel("name"),
    "the marquee selected the document itself",
  ).not.toHaveValue("Root");
});

test("clicking empty stage selects nothing at all", async ({ page }) => {
  await openBlankWithSphere(page);
  await page.keyboard.press("Escape");

  // A corner of the canvas with nothing on it. There is no object here, so
  // there is nothing to select — the root must not stand in for one.
  await page.mouse.click(220, 240);
  await expect(page.getByTestId("statusbar")).toContainText("0 selected");
});

test("dragging an object moves the object and nothing else", async ({ page }) => {
  await openBlankWithSphere(page);

  const before = (await page.getByTestId("selection-box").first().boundingBox())!;
  const drawnBefore = (await drawnBox(page))!;

  // Grabbed low and left, clear of the gizmo arms, which run up and right.
  const grab = { x: before.x + before.width * 0.25, y: before.y + before.height * 0.75 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 220, grab.y + 130, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const drawnAfter = (await drawnBox(page))!;
  // The OBJECT moved, by the amount asked for, in both axes. A drag that moved
  // the scene instead would leave this unchanged.
  //
  // Within a snap's width, not exactly: guides and grid snapping may pull the
  // final position a few pixels, and that is a feature. What is under test is
  // that the object went where it was dragged in BOTH axes — a horizontal
  // component being silently dropped is the failure this catches.
  expect(Math.abs(drawnAfter.x - drawnBefore.x - -220), "horizontal drag").toBeLessThan(16);
  expect(Math.abs(drawnAfter.y - drawnBefore.y - 130), "vertical drag").toBeLessThan(16);

  // And the selection went with it.
  const after = (await page.getByTestId("selection-box").first().boundingBox())!;
  expect(Math.abs(after.x - drawnAfter.x)).toBeLessThan(12);
  expect(Math.abs(after.y - drawnAfter.y)).toBeLessThan(12);
});

test("the flat editor still boxes its graphics exactly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(900);

  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;

  // Square-on and orthographic, the eight-corner projection reduces to the
  // four-corner one — so this must be unchanged. Clicking the middle of the
  // plate still picks the plate.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");
});
