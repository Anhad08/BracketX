import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The picture and the overlay agree about where the world is.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR, AND WHY NOTHING CAUGHT IT
 * ============================================================================
 * The stage is two layers. The ENGINE draws the graphic into a canvas; an SVG
 * OVERLAY draws the frame edge, the rulers, the safe areas, the selection and
 * every gizmo. They are separate elements and they agree only because the
 * surface is pinned to the view's origin and scales from it:
 *
 *     .scene-surface { position: absolute; top: 0; left: 0; transform-origin: 0 0 }
 *
 * Two lines. They went missing in a careless block deletion, and the surface
 * fell into normal flow and began scaling about its own centre — which offset
 * the graphic from the overlay by several hundred pixels. The lower third sat
 * in one corner, its selection handles in another, and clicking a layer
 * selected nothing.
 *
 * A hundred and fifty browser tests passed. Every one of them either measured
 * the overlay against itself, or the canvas against itself, and both were
 * internally consistent the whole time. Nothing compared THE TWO.
 *
 * So that is what this file does, and it is the only thing it does.
 */

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
}

/**
 * Is the engine drawing anything at this point on the page?
 *
 * Reads the canvas's own pixel under a SCREEN coordinate, which is the whole
 * question: the overlay says the layer is here, so the picture had better be
 * here too.
 */
async function opaqueAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ px, py }) => {
      const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
      if (canvas === null) return false;
      const box = canvas.getBoundingClientRect();
      if (px < box.left || px > box.right || py < box.top || py > box.bottom) return false;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl === null) return false;

      // Screen point to buffer point. The canvas is scaled by CSS, and readPixels
      // counts from the BOTTOM, which is the classic way to read the wrong row.
      const sx = Math.round(((px - box.left) / box.width) * canvas.width);
      const sy = Math.round(((py - box.top) / box.height) * canvas.height);
      const pixel = new Uint8Array(4);
      gl.readPixels(sx, canvas.height - sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3]! > 8;
    },
    { px: x, py: y },
  );
}

test("a selected layer's handles sit on the layer", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();

  const box = await page.getByTestId("selection-box").first().boundingBox();
  expect(box, "selecting a layer must draw a selection").not.toBeNull();

  // The middle of what the overlay says is the plate. The engine must be
  // drawing the plate there. Offset the two layers and this is empty space.
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(
    await opaqueAt(page, centre.x, centre.y),
    "the overlay and the picture disagree about where the layer is",
  ).toBe(true);
});

test("clicking where a layer is drawn selects that layer", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;

  // Deselect, then click the picture itself rather than the tree. This is the
  // gesture that stops working when the layers drift apart, and it is the one
  // a designer makes a thousand times a day.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-box")).toHaveCount(0);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.getByTestId("selection-box"),
    "clicking the graphic must select what is under the pointer",
  ).toHaveCount(1);
});

test("it still agrees after a trip into 3D", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();

  await page.getByTestId("dim-3d").click();
  await page.waitForTimeout(1_800);

  // THE GIZMO'S ORIGIN, not the selection box.
  //
  // In space a layer is a quad in perspective, and an axis-aligned rectangle
  // around it is a poor description — its centre can legitimately fall off the
  // shape. The gizmo is projected through the real camera and sits exactly on
  // the layer's origin, which makes it the honest probe: if the overlay and
  // the picture have drifted apart, the arrows are somewhere the graphic is
  // not, and that is precisely what a designer sees.
  const origin = await page.evaluate(() => {
    const line = document.querySelector(".axes .axis line") as SVGLineElement | null;
    const svg = document.querySelector(".scene-chrome") as SVGSVGElement | null;
    if (line === null || svg === null) return null;
    const box = svg.getBoundingClientRect();
    return {
      x: box.left + Number(line.getAttribute("x1") ?? 0),
      y: box.top + Number(line.getAttribute("y1") ?? 0),
    };
  });

  expect(origin, "a selection in space must draw a move gizmo").not.toBeNull();
  expect(
    await opaqueAt(page, origin!.x, origin!.y),
    "in space the gizmo must sit on the layer it moves",
  ).toBe(true);
});

/**
 * The geometry the agreement rests on, asserted directly.
 *
 * Belt and braces: the tests above catch the symptom, and this catches the
 * cause the moment somebody deletes it again — with a message that says what
 * to put back.
 */
test("the picture is pinned to the view and scales from its origin", async ({ page }) => {
  await open(page);
  const geometry = await page.evaluate(() => {
    const surface = document.querySelector(".scene-surface") as HTMLElement | null;
    if (surface === null) return null;
    const style = getComputedStyle(surface);
    return { position: style.position, origin: style.transformOrigin };
  });

  expect(geometry).not.toBeNull();
  expect(
    geometry!.position,
    "the surface must be pinned to the view, or it falls into normal flow",
  ).toBe("absolute");
  expect(
    geometry!.origin,
    "the surface must scale from its top-left, or zooming walks it away from the overlay",
  ).toBe("0px 0px");
});
