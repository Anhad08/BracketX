import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Walk navigation — W A S D, and Q E for down and up.
 *
 * ============================================================================
 * WHY IT IS A MODE
 * ============================================================================
 * W is free. So are A and D — select-all and duplicate both need the modifier.
 * S is not: on its own it means Scale, and G, R, S for move, rotate and scale
 * is the one binding this editor already shares with Blender exactly. Flying
 * on a bare S would take the transform triad apart in order to add
 * navigation.
 *
 * Blender's own answer is a mode, entered deliberately and left with Escape.
 * Shift+` enters it, and the stage says so while you are in it — a mode you
 * cannot see you are in is a mode that eats your keystrokes.
 */

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);
}

/** The camera's position, off the Properties panel. */
async function cameraAt(page: Page): Promise<readonly number[]> {
  await page.getByTestId("outline").getByText("Camera", { exact: true }).click();
  const inspector = page.getByTestId("inspector");
  return Promise.all(
    ["x", "y", "z"].map(async (axis) =>
      Number(await inspector.getByLabel(`position ${axis}`).inputValue()),
    ),
  );
}

async function fly(page: Page, key: string, ms = 450): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}

// ===========================================================================

test("Shift+backtick enters walk mode, and it says so", async ({ page }) => {
  await open3D(page);
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);

  await page.keyboard.press("Shift+`");
  await expect(page.getByTestId("ov-walking")).toBeVisible();
  // It has to name its own keys and its own exit, or it is a trap.
  await expect(page.getByTestId("ov-walking")).toContainText("W A S D");
  await expect(page.getByTestId("ov-walking")).toContainText("Esc");
});

test("escape leaves it", async ({ page }) => {
  await open3D(page);
  await page.keyboard.press("Shift+`");
  await expect(page.getByTestId("ov-walking")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);
});

test("W moves the camera forward and S brings it back", async ({ page }) => {
  await open3D(page);
  const start = await cameraAt(page);
  await page.keyboard.press("Shift+`");

  await fly(page, "w");
  const forward = await cameraAt(page);
  const travelled = Math.hypot(
    forward[0]! - start[0]!,
    forward[1]! - start[1]!,
    forward[2]! - start[2]!,
  );
  expect(travelled, "W did not move the camera").toBeGreaterThan(0.2);

  // Forward means TOWARDS what the lens is pointing at, so the camera gets
  // closer to the origin it was framing — not further along some world axis.
  expect(Math.hypot(...forward), "W flew backwards").toBeLessThan(Math.hypot(...start));

  await fly(page, "s", 700);
  expect(
    Math.hypot(...(await cameraAt(page))),
    "S did not reverse it",
  ).toBeGreaterThan(Math.hypot(...forward));
});

test("A and D strafe, without changing height", async ({ page }) => {
  await open3D(page);
  await page.keyboard.press("Shift+`");
  const start = await cameraAt(page);

  await fly(page, "d");
  const right = await cameraAt(page);
  expect(
    Math.hypot(right[0]! - start[0]!, right[2]! - start[2]!),
    "D did not strafe",
  ).toBeGreaterThan(0.2);
  // Strafing runs along the camera's own right, which is level — the camera
  // must not sink or climb because you stepped sideways.
  expect(Math.abs(right[1]! - start[1]!), "strafing changed height").toBeLessThan(0.05);

  await fly(page, "a", 700);
  const back = await cameraAt(page);
  expect(back[0]! - right[0]!, "A did not reverse D").not.toBe(0);
});

test("E rises and Q descends", async ({ page }) => {
  await open3D(page);
  await page.keyboard.press("Shift+`");
  const start = await cameraAt(page);

  await fly(page, "e");
  const up = await cameraAt(page);
  expect(up[1]!, "E did not rise").toBeGreaterThan(start[1]!);

  await fly(page, "q", 700);
  expect((await cameraAt(page))[1]!, "Q did not descend").toBeLessThan(up[1]!);
});

test("the keys do nothing until you enter the mode", async ({ page }) => {
  await open3D(page);
  const start = await cameraAt(page);

  // Not in walk mode: these belong to the editor, not the camera.
  await fly(page, "w", 300);
  await fly(page, "d", 300);

  const after = await cameraAt(page);
  expect(
    Math.hypot(after[0]! - start[0]!, after[1]! - start[1]!, after[2]! - start[2]!),
    "the camera flew without walk mode being entered",
  ).toBeLessThan(0.01);
});

test("S still means Scale when not walking", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(900);

  await page.keyboard.press("s");
  // The scale gizmo's handles, which only exist in scale mode.
  await expect(
    page.getByTestId("stretchers"),
    "walk mode took the Scale shortcut with it",
  ).toBeVisible();
});

test("the flat view has nothing to walk through", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(700);

  await page.keyboard.press("Shift+`");
  // A lower third is designed square-on and stays square-on. There is no mode
  // to enter, so entering it must be impossible rather than merely useless.
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);
});
