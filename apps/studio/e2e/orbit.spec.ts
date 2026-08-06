import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Orbit — the product's defining gesture, in the real application.
 *
 * `camera.test.ts` proves the maths and pins it against three.js. What only a
 * browser can prove is that the gesture moves the SCENE CAMERA, that the
 * change is a document edit which undoes in one step, and — the part that
 * matters most — that selection still lands on the graphic afterwards.
 *
 * That last one is the whole reason this could not be built before. The old
 * viewport maths was a flat map that ignored the camera, so the moment the
 * camera left the Z axis every handle and every hit test would have pointed
 * somewhere the graphic is not, while the rendered picture stayed correct.
 */
async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The camera's authored position, read from the layer tree's own inspector. */
async function cameraPosition(page: Page): Promise<[number, number, number]> {
  await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
  const read = async (label: string): Promise<number> =>
    Number(await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue());
  return [await read("position x"), await read("position y"), await read("position z")];
}

/**
 * Switches to 3D and selects a mode.
 *
 * The modes only exist inside 3D — that is the point of the control — so a
 * test that reaches for "3/4" while flat has to press 3D first, exactly as a
 * designer does.
 */
async function enterSpatial(page: Page, mode: string): Promise<void> {
  const button = page.getByTestId(`view-${mode}`);
  if ((await button.count()) === 0) await page.getByTestId("dim-3d").click();
  await page.getByTestId(`view-${mode}`).click();
}

test("orbiting turns the scene camera, and does not touch the history", async ({ page }) => {
  await open3D(page);

  // Studio opens on the Z axis, square-on, and the flat view is FIXED — see
  // the test below. Entering 3D is a deliberate, named act, so the gesture
  // being tested here starts where a designer would actually perform it.
  const front = await cameraPosition(page);
  expect(front[0]).toBeCloseTo(0, 5);
  expect(front[2]).toBeGreaterThan(0);

  await enterSpatial(page, "three-quarter");
  const before = await cameraPosition(page);

  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await expect(chrome).toHaveAttribute("data-drag", "orbit");
  await page.mouse.move(cx + 160, cy, { steps: 8 });
  await page.mouse.up({ button: "middle" });

  const after = await cameraPosition(page);
  // Turned further about Y, and the distance to the pivot is preserved.
  expect(
    Math.abs(after[0] - before[0]),
    "orbiting must turn the camera",
  ).toBeGreaterThan(0.5);
  const radiusBefore = Math.hypot(before[0], before[1], before[2]);
  const radiusAfter = Math.hypot(after[0], after[1], after[2]);
  expect(radiusAfter, "orbit must not change the distance to the pivot").toBeCloseTo(
    radiusBefore,
    1,
  );

  // UNDO BELONGS TO THE WORK, NOT THE VIEW. Pressing Ctrl+Z after orbiting
  // must not give the camera back — a designer who orbited three times to
  // check a logo would otherwise press undo four times to reverse one
  // mistake, watching the scene swing about while doing it.
  await page.keyboard.press("Control+z");
  const after2 = await cameraPosition(page);
  expect(after2[0], "undo must not rewind the camera").toBeCloseTo(after[0], 5);
  expect(after2[2]).toBeCloseTo(after[2], 5);
});

test("undo gives back the work, in the order it was done", async ({ page }) => {
  await open3D(page);
  await ensureDepth(page, "designer");

  const outline = page.getByTestId("outline");
  const count = async (): Promise<number> => outline.locator("li").count();
  const start = await count();

  // Three pieces of work, with a view change in the middle of them. The view
  // change must be invisible to the history.
  await page.getByTestId("tool-rect").click();
  await enterSpatial(page, "three-quarter");
  await page.getByTestId("tool-ellipse").click();
  await enterSpatial(page, "top");
  await page.getByTestId("tool-text").click();
  expect(await count()).toBe(start + 3);

  // Three undos, three pieces of work removed — not five.
  await page.keyboard.press("Control+z");
  expect(await count()).toBe(start + 2);
  await page.keyboard.press("Control+z");
  expect(await count()).toBe(start + 1);
  await page.keyboard.press("Control+z");
  expect(await count(), "a view change must never occupy a step").toBe(start);
});

test("selection still lands on the graphic after the camera has moved", async ({ page }) => {
  await open3D(page);

  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
  await page.mouse.up({ button: "middle" });

  // Select through the layer tree, then read where the editor believes the
  // graphic is, and click THERE. Under the old flat map this point would have
  // been somewhere the graphic is not.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  const gizmo = (await page.getByTestId("gizmo").boundingBox())!;
  await page.mouse.click(gizmo.x + gizmo.width / 2, gizmo.y + gizmo.height / 2);

  await expect(
    page.getByTestId("gizmo"),
    "clicking where the editor draws the graphic must select the graphic, " +
      "whatever the camera is doing",
  ).toBeVisible();
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");
});

test("named views move the camera, and the control says where you are", async ({ page }) => {
  await open3D(page);

  // Studio opens Front — that is where flat graphics are designed.
  await expect(page.getByTestId("dim-2d")).toHaveClass(/on/);

  await enterSpatial(page, "side");
  await expect(page.getByTestId("view-side")).toHaveClass(/on/);
  await expect(page.getByTestId("dim-2d")).not.toHaveClass(/on/);

  const side = await cameraPosition(page);
  // From the right: X carries the distance, Z is through zero.
  expect(Math.abs(side[0])).toBeGreaterThan(1);
  expect(Math.abs(side[2])).toBeLessThan(0.01);

  await enterSpatial(page, "top");
  const top = await cameraPosition(page);
  expect(top[1], "Top must be above the scene").toBeGreaterThan(1);

  // Choosing a view RE-AIMS without RE-FRAMING: the distance is preserved.
  expect(Math.hypot(...top)).toBeCloseTo(Math.hypot(...side), 1);

  // Orbiting away un-highlights the view — "I am in Top" and "I have orbited
  // back to roughly the top" are different states, and only one of them is
  // pixel-accurate.
  const box = (await page.getByTestId("scene-chrome").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("view-top")).not.toHaveClass(/on/);

  // And undo does NOT put it back, because a view change is not work. The way
  // back to a named view is to press the named view — which is exact, where
  // undo would only be approximately-where-you-were.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("view-top")).not.toHaveClass(/on/);
  await enterSpatial(page, "top");
  await expect(page.getByTestId("view-top")).toHaveClass(/on/);
});

test("a 3D object is really 3D: turning the camera changes what it looks like", async ({
  page,
}) => {
  await open3D(page);

  // A box, from the toolbox that already builds real geometry.
  await page.getByTestId("tool-box").click();
  await expect(page.getByTestId("gizmo")).toBeVisible();

  const shot = async (): Promise<Buffer> =>
    page.getByTestId("scene-view").screenshot();

  await page.getByTestId("dim-2d").click();
  await page.waitForTimeout(400);
  const front = await shot();

  await enterSpatial(page, "three-quarter");
  await page.waitForTimeout(400);
  const threeQuarter = await shot();

  // The rendered pixels must differ. A "3D" product where turning the camera
  // changes nothing is a 2D product with extra buttons.
  expect(
    Buffer.compare(front, threeQuarter),
    "turning the camera must change what the scene looks like",
  ).not.toBe(0);
});

test("the viewport becomes a 3D viewport when the camera turns, and not before", async ({
  page,
}) => {
  await open3D(page);

  // Front on: a flat graphic gains nothing from a floor. The grid would
  // project to a single horizontal line across the middle of a lower third,
  // which is worse than drawing nothing.
  await page.getByTestId("dim-2d").click();
  await expect(page.getByTestId("ground")).toHaveCount(0);
  await expect(page.getByTestId("compass")).toHaveCount(0);

  // Turned: the ground and the axis widget arrive together.
  await enterSpatial(page, "three-quarter");
  await expect(page.getByTestId("ground")).toBeVisible();
  await expect(page.getByTestId("compass")).toBeVisible();

  // The widget goes back to a known angle, through the same named views the
  // buttons use — so the two can never disagree about where "Top" is.
  await page.getByTestId("compass-y").click();
  await expect(page.getByTestId("view-top")).toHaveClass(/on/);

  // And back to Front removes it again.
  await page.getByTestId("dim-2d").click();
  await expect(page.getByTestId("ground")).toHaveCount(0);
});

test("the flat view is fixed: the camera cannot be nudged off axis", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("dim-2d").click();

  const before = await cameraPosition(page);
  const box = (await page.getByTestId("scene-chrome").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 200, cy + 120, { steps: 10 });
  await page.mouse.up({ button: "middle" });

  // A lower third is designed square-on and stays square-on. A camera nudged
  // off axis by a stray drag makes every later judgement about alignment and
  // letter-spacing wrong, and the designer has no idea why.
  const after = await cameraPosition(page);
  expect(after[0]).toBeCloseTo(before[0], 5);
  expect(after[1]).toBeCloseTo(before[1], 5);
  expect(after[2]).toBeCloseTo(before[2], 5);
  await expect(page.getByTestId("dim-2d")).toHaveClass(/on/);

  // The way into 3D is the view control, which is deliberate and named.
  await enterSpatial(page, "three-quarter");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  expect(Math.abs((await cameraPosition(page))[0])).not.toBeCloseTo(Math.abs(before[0]), 1);
});

test("the flat design chrome does not appear in the 3D viewport", async ({ page }) => {
  await open3D(page);

  // Flat: the checkerboard, the safe areas and the rulers are the tools of a
  // square-on design view.
  await page.getByTestId("dim-2d").click();
  await expect(page.locator(".scene-checker")).not.toHaveClass(/off/);
  await expect(page.getByTestId("safe-title")).toBeVisible();

  // Turned: they are measured in canvas space, so under a moved camera they
  // are not merely unwanted, they are drawn somewhere the scene is not.
  await enterSpatial(page, "three-quarter");
  // Hidden by a class, never unmounted — see the round-trip test below for
  // what unmounting it cost.
  await expect(page.locator(".scene-checker")).toHaveClass(/off/);
  await expect(page.getByTestId("safe-title")).toHaveCount(0);
  await expect(page.locator(".ruler")).toHaveCount(0);

  // And the ground replaces them.
  await expect(page.getByTestId("ground")).toBeVisible();
});

/**
 * A round trip through 3D leaves the picture exactly as it was.
 *
 * This is the bug that took the longest to find and was the least interesting
 * once found. Going Front → 3/4 → Front lost the lower third's background and
 * accent bar. Everything measurable said the product was fine: the document
 * was byte-identical, the mirror's world matrices were identical, the backend
 * snapshot was identical, and the renderer was issuing the same eight draw
 * calls and fifty-four triangles.
 *
 * It was the transparency checkerboard. The canvas is appended to its parent
 * imperatively, so React does not know it is there — and a sibling that
 * unmounts in 3D and remounts in 2D is re-inserted AFTER the canvas, where it
 * paints straight over the scene.
 *
 * The lesson is in the assertion: comparing camera NUMBERS and asserting the
 * picture merely CHANGED was never going to catch this. Only comparing the
 * picture to itself does.
 */
test("a trip to 3D and back leaves the picture unchanged", async ({ page }) => {
  await open3D(page);
  await page.waitForTimeout(600);

  const stage = page.getByTestId("scene-view");
  const before = await stage.screenshot();

  await enterSpatial(page, "three-quarter");
  await page.waitForTimeout(500);
  await page.getByTestId("dim-2d").click();
  await page.waitForTimeout(700);

  const after = await stage.screenshot();
  expect(
    Buffer.compare(before, after),
    "returning to Front must restore the picture exactly, not approximately",
  ).toBe(0);

  // And the checkerboard is never re-ordered above the canvas: it is hidden
  // by a class rather than unmounted, so DOM order cannot change.
  await expect(page.locator(".scene-checker")).toHaveCount(1);
  await enterSpatial(page, "three-quarter");
  await expect(page.locator(".scene-checker")).toHaveCount(1);
  await expect(page.locator(".scene-checker")).toHaveClass(/off/);
});

/**
 * 2D or 3D first, modes second.
 *
 * Five equal buttons — Front, 3/4, Side, Top, Low — asked a designer to
 * understand camera angles before they could make a flat lower third, and
 * buried the one distinction that actually matters: flat, or in space.
 */
test("the dimension switch comes first, and the modes live inside 3D", async ({ page }) => {
  await open3D(page);

  // Studio opens flat, and says so in one word.
  await expect(page.getByTestId("dim-2d")).toHaveClass(/on/);
  await expect(page.getByTestId("dim-3d")).not.toHaveClass(/on/);

  // No angles on screen at all while flat. Nothing to understand.
  await expect(page.getByTestId("modes")).toHaveCount(0);
  await expect(page.getByTestId("view-side")).toHaveCount(0);

  await page.getByTestId("dim-3d").click();
  await expect(page.getByTestId("dim-3d")).toHaveClass(/on/);
  await expect(page.getByTestId("modes")).toBeVisible();
  for (const mode of ["three-quarter", "side", "top", "low"]) {
    await expect(page.getByTestId(`view-${mode}`)).toBeVisible();
  }

  // The switch REPORTS the camera rather than asserting it: orbiting away
  // from flat is entering 3D, whether or not anybody pressed 3D.
  await page.getByTestId("dim-2d").click();
  await expect(page.getByTestId("modes")).toHaveCount(0);

  const box = (await page.getByTestId("scene-chrome").boundingBox())!;
  await page.getByTestId("dim-3d").click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("dim-3d")).toHaveClass(/on/);

  // And 2D returns exactly, not approximately.
  await page.getByTestId("dim-2d").click();
  await expect(page.getByTestId("dim-2d")).toHaveClass(/on/);
  await expect(page.getByTestId("modes")).toHaveCount(0);
});
