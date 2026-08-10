import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * FRAME, RESET, AND ONE SCENE BEHIND TWO VIEWERS.
 *
 * ============================================================================
 * WHAT THESE PROVE THAT THE UNIT TESTS CANNOT
 * ============================================================================
 * `framingRadius` is checked exhaustively in `camera.test.ts` — wide, tall,
 * deep and asymmetric boxes, both frustum constraints, aspect ratios either
 * side of square. That is the arithmetic.
 *
 * These check the WIRING: that Fit reaches the camera rather than the zoom,
 * that Reset returns an angle rather than reloading anything, that one
 * operation does not corrupt the state another needs, and — the architectural
 * one — that switching viewers does not build a second Scene.
 */

const READY = 30_000;

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: READY });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: READY });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);
}

/** Camera world position, off the Properties panel. */
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

async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(title);
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
}

async function dragStage(page: Page, dx: number, dy: number): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width * 0.22, y: stage.y + stage.height * 0.24 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

/** Lit pixels — is there anything on screen to look at. */
async function lit(page: Page): Promise<number> {
  return page.locator(".scene-surface canvas").first().evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext;
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i]! > 60 || px[i + 1]! > 60 || px[i + 2]! > 60) n += 1;
    }
    return n;
  });
}

// ===========================================================================
// FIT MOVES THE CAMERA
// ===========================================================================

test("Fit recovers the view from anywhere the camera has been flown", async ({ page }) => {
  await open3D(page);
  const opened = await cameraAt(page);

  // Somewhere useless: far out and turned away.
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 240);
  await page.waitForTimeout(700);
  await dragStage(page, 240, 120);

  const lost = await cameraAt(page);
  expect(distance(lost), "the camera did not travel").not.toBeCloseTo(distance(opened), 1);

  await runCommand(page, "Fit scene in view");
  const fromFar = await cameraAt(page);
  expect(await lit(page), "nothing is on screen after Fit").toBeGreaterThan(1000);

  // THE PROPERTY THAT PROVES THE DISTANCE IS DERIVED RATHER THAN NUDGED.
  //
  // Fly somewhere else entirely — this time inwards — and Fit again. Both
  // land on the SAME radius, because it is computed from the scene bounds and
  // the lens, not from wherever the camera happened to be. A relative
  // adjustment, or a remembered position, would give two different answers.
  //
  // Deliberately not compared against the OPENING distance: Fit frames the
  // whole scene, and this scene has a ground plane far larger than the props
  // standing on it. Framing all of it is correct and is what the command
  // says; framing just the model is `view.frameSelected`, tested below.
  const stage2 = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage2.x + stage2.width / 2, stage2.y + stage2.height / 2);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(700);
  await dragStage(page, -180, -90);

  await runCommand(page, "Fit scene in view");
  const fromNear = await cameraAt(page);

  expect(
    Math.abs(distance(fromNear) - distance(fromFar)),
    "Fit gave two different distances for one scene",
  ).toBeLessThan(distance(fromFar) * 0.05);
});

test("Fit keeps the angle you chose, Reset returns it", async ({ page }) => {
  await open3D(page);

  await dragStage(page, 260, 0);
  const turned = await cameraAt(page);

  await runCommand(page, "Fit scene in view");
  const fitted = await cameraAt(page);

  // Fit changes distance only. Snapping back to a canned three-quarter angle
  // would throw away the orientation somebody just chose to inspect from, so
  // the DIRECTION from the origin is preserved while the length changes.
  const bearing = (p: readonly number[]) => Math.atan2(p[0]!, p[2]!);
  expect(bearing(fitted), "Fit moved the viewpoint, not just the distance").toBeCloseTo(
    bearing(turned),
    1,
  );

  await runCommand(page, "Reset view");
  const reset = await cameraAt(page);
  expect(bearing(reset), "Reset did not return the angle").not.toBeCloseTo(bearing(turned), 1);
  expect(await lit(page), "nothing is on screen after Reset").toBeGreaterThan(1000);
});

test("Frame, orbit, dolly, orbit, pan, Fit, Reset — nothing corrupts anything", async ({
  page,
}) => {
  await open3D(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const centre = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await runCommand(page, "Fit scene in view");
  const framed = await cameraAt(page);

  await dragStage(page, 180, 0);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(600);
  const closer = await cameraAt(page);
  expect(distance(closer), "the dolly did not close the distance").toBeLessThan(
    distance(framed),
  );

  // The SECOND orbit must respect the new radius rather than snapping back to
  // the framing one — the specific corruption this sequence exists to catch.
  await dragStage(page, -140, 60);
  const orbited = await cameraAt(page);
  expect(
    Math.abs(distance(orbited) - distance(closer)),
    "orbiting after a dolly threw the camera back out",
  ).toBeLessThan(distance(closer) * 0.2);

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centre.x + 120, centre.y + 40, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(450);

  await runCommand(page, "Fit scene in view");
  await runCommand(page, "Reset view");
  expect(await lit(page), "the model was lost somewhere in the sequence").toBeGreaterThan(1000);
});

// ===========================================================================
// ONE SCENE, TWO VIEWERS
// ===========================================================================

test("an edit made in one viewer is present in the other, and no Scene is rebuilt", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: READY });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: READY });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);

  const field = page.getByTestId("content").locator("input.field").first();
  await field.fill("ONE SCENE");
  await field.blur();
  await page.waitForTimeout(800);

  const nodeCount = async (): Promise<number> =>
    page.getByTestId("outline").locator("button.row-name").count();
  const before = await nodeCount();

  // Into the dimensional view and back. The Scene must survive the round trip
  // unchanged — a viewer switch that converted or copied the document would
  // show up here as a different tree or a lost edit.
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
  expect(await field.inputValue(), "the edit was lost switching viewer").toBe("ONE SCENE");

  await ensureDepth(page, "expert");
  await page.waitForTimeout(700);
  expect(await field.inputValue(), "the edit was lost switching back").toBe("ONE SCENE");
  expect(await nodeCount(), "the Scene tree changed shape across viewers").toBe(before);
});

// ===========================================================================
// THE VIEWPORT'S ACTUAL SIZE IS AN INPUT
// ===========================================================================

test("framing responds to the viewport it is actually given", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3D(page);
  await runCommand(page, "Fit scene in view");
  const wide = await cameraAt(page);
  expect(await lit(page)).toBeGreaterThan(1000);

  // A narrower viewport binds on WIDTH, so the camera has to pull further
  // back. A hard-coded aspect would frame identically at both sizes and clip
  // at one of them.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(700);
  await runCommand(page, "Fit scene in view");
  const square = await cameraAt(page);

  expect(
    distance(square),
    "a narrower viewport did not pull the camera back",
  ).toBeGreaterThan(distance(wide));
  expect(await lit(page), "the model was lost when the viewport changed").toBeGreaterThan(1000);
});
