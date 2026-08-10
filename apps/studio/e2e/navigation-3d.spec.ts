import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * CAN A HUMAN NAVIGATE THIS SCENE?
 *
 * ============================================================================
 * THE COMPLAINT THESE TESTS ANSWER
 * ============================================================================
 * "It behaves like a 2D canvas." Both gestures a person reaches for first were
 * spent on flat-document verbs: the wheel scrolled the scene up and down the
 * screen instead of moving the camera through it, and a plain drag opened a
 * marquee over empty air instead of looking around.
 *
 * So these assert the 3D RELATIONSHIPS, not that numbers changed:
 *
 *   ORBIT  camera moves, and its DISTANCE to the pivot stays constant
 *   ZOOM   distance changes, rather than the scene sliding across the screen
 *   PAN    the middle button still pans, in both views
 *
 * A test that only says "the camera moved" would pass for a camera being
 * dragged sideways, which is exactly the behaviour being replaced.
 */

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);
}

/** Camera world position, read off the Properties panel. */
async function cameraAt(page: Page): Promise<readonly number[]> {
  await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
  const inspector = page.getByTestId("inspector");
  return Promise.all(
    ["x", "y", "z"].map(async (axis) =>
      Number(await inspector.getByLabel(`position ${axis}`).inputValue()),
    ),
  );
}

const distance = (p: readonly number[]): number => Math.hypot(p[0]!, p[1]!, p[2]!);

const travelled = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Drags across empty stage — the gesture a person tries first. */
async function dragStage(page: Page, dx: number, dy: number): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  // Well away from the centre, so nothing is under the pointer.
  const from = { x: stage.x + stage.width * 0.22, y: stage.y + stage.height * 0.24 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

// ===========================================================================

test("a plain drag orbits, and holds its distance to the pivot", async ({ page }) => {
  await open3D(page);
  const before = await cameraAt(page);

  await dragStage(page, 220, 0);
  const after = await cameraAt(page);

  expect(after, "a plain drag did not turn the camera").not.toEqual(before);
  // THE PROPERTY THAT MAKES IT AN ORBIT rather than a slide: the camera went
  // AROUND the pivot, so how far it sits from the pivot barely changed.
  expect(
    Math.abs(distance(after) - distance(before)),
    "the camera slid sideways instead of orbiting",
  ).toBeLessThan(distance(before) * 0.15);
  expect(travelled(after, before), "the camera barely moved").toBeGreaterThan(0.3);
});

test("dragging vertically changes elevation", async ({ page }) => {
  await open3D(page);
  const before = await cameraAt(page);

  await dragStage(page, 0, -170);
  const after = await cameraAt(page);

  // Without this, an orbit that only ever spins about Y would pass the test
  // above and still be unusable — you could never look from above or below.
  expect(
    Math.abs(after[1]! - before[1]!),
    "a vertical drag did not change elevation",
  ).toBeGreaterThan(0.2);
  expect(
    Math.abs(distance(after) - distance(before)),
    "changing elevation slid the camera",
  ).toBeLessThan(distance(before) * 0.15);
});

test("the bare wheel moves the camera through the scene", async ({ page }) => {
  await open3D(page);
  const before = await cameraAt(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);

  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(700);
  const closer = await cameraAt(page);

  // THE COMPLAINT, ASSERTED. The wheel used to slide the scene up the screen.
  expect(
    distance(closer),
    "the wheel did not bring the camera closer",
  ).toBeLessThan(distance(before));

  // Reading the camera clicks the outline, which leaves the pointer over the
  // panel — a wheel there scrolls the panel, not the scene.
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(700);
  expect(
    distance(await cameraAt(page)),
    "the wheel does not reverse",
  ).toBeGreaterThan(distance(closer));
});

test("orbit works after zooming, and zoom after orbiting", async ({ page }) => {
  await open3D(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(700);

  const afterZoom = await cameraAt(page);
  await dragStage(page, 200, 0);
  const afterOrbit = await cameraAt(page);

  expect(afterOrbit, "orbit stopped working once zoomed").not.toEqual(afterZoom);
  // The orbit respects the NEW distance rather than snapping back to the old.
  expect(
    Math.abs(distance(afterOrbit) - distance(afterZoom)),
    "orbiting after a zoom threw the camera back out",
  ).toBeLessThan(distance(afterZoom) * 0.15);

  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(700);
  expect(
    distance(await cameraAt(page)),
    "zoom stopped working once orbited",
  ).toBeLessThan(distance(afterOrbit));
});

test("the middle button still pans rather than orbiting", async ({ page }) => {
  await open3D(page);
  const surface = async () => (await page.locator(".scene-surface").boundingBox())!;
  const before = await surface();
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 150, from.y, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(450);

  // §03 gives the middle button to pan in BOTH views. Orbit taking the plain
  // drag must not have taken this with it.
  expect((await surface()).x - before.x).toBeGreaterThan(60);
});

test("dragging an object moves the object, not the camera", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(900);

  const camBefore = await cameraAt(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const centre = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  // Reading the camera selected IT. Select the box again through the tree,
  // which is exact — clicking the stage depends on where the box happens to
  // project, and the rule under test is "a drag on your selection moves your
  // selection", not "the box is at the centre of the screen".
  await page.getByTestId("outline").getByText("Box", { exact: true }).first().click();
  await page.waitForTimeout(400);

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 90, centre.y + 40, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // The rule that lets orbit have the plain button at all: a drag starting ON
  // something is about that thing. If this fails, every attempt to move a box
  // swings the camera instead.
  expect(await cameraAt(page), "dragging an object turned the camera").toEqual(camBefore);
});

test("a flat graphic is still a document — the wheel scrolls it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);

  await page.keyboard.press("Digit0");
  await page.waitForTimeout(400);
  const zoom = async (): Promise<string> =>
    (await page.getByTestId("zoom").innerText()).trim();
  expect(await zoom()).toBe("100%");

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(400);
  // A lower third has edges. The wheel scrolls it, exactly as §03 says.
  expect(await zoom(), "the bare wheel started zooming a flat graphic").toBe("100%");
});
