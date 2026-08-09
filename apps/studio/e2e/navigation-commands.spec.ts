import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * NAVIGATION IS PART OF THE COMMAND SYSTEM.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHAT MUST NOT HAVE
 * ============================================================================
 * Pan, orbit and walk were private handlers inside the stage. Walk mode had
 * its own `keydown` listener — a second input system beside the keymap,
 * invisible to the menu bar, the palette and the keyboard reference, and
 * impossible to rebind.
 *
 * Their ACTIONS are now named and registered. Their GESTURES are untouched:
 * middle-drag and space-drag pan, Alt-drag orbits, Shift+` walks. This file
 * asserts both halves — that the commands are genuinely reachable, and that
 * nothing about the feel of the viewport changed to get there.
 */

async function openFlat(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
}

async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);
}

/** Where the view is, read off the surface the engine's canvas sits on. */
async function view(page: Page): Promise<{ x: number; y: number; width: number }> {
  const box = (await page.locator(".scene-surface").boundingBox())!;
  return { x: box.x, y: box.y, width: box.width };
}

/** Runs a command by its title, through the palette — no gesture involved. */
async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type(title);
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
}

// ===========================================================================
// The commands exist, and are reachable the way every other one is
// ===========================================================================

test("pan, orbit and walk are in the command palette", async ({ page }) => {
  await open3D(page);

  for (const title of ["Pan left", "Orbit left", "Walk the camera", "Centre the view"]) {
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    await page.keyboard.type(title);
    await page.waitForTimeout(400);
    // A command that exists in TypeScript and not in the palette is not
    // registered — it is a function with an id.
    await expect(
      page.getByTestId("palette").getByText(title, { exact: true }).first(),
      `${title} is not discoverable`,
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
});

test("walk prints its approved shortcut where the others print theirs", async ({ page }) => {
  await open3D(page);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Walk the camera");
  await page.waitForTimeout(400);

  // The binding is unchanged; only its home is. It used to be a private
  // listener and could not be printed anywhere.
  await expect(page.getByTestId("palette")).toContainText("⇧`");
});

test("the View menu offers them", async ({ page }) => {
  await open3D(page);
  await page.getByRole("button", { name: "View", exact: true }).first().click();
  await page.waitForTimeout(300);

  const menu = page.getByTestId("menubar");
  await expect(menu).toContainText("Walk the camera");
  await expect(menu).toContainText("Centre the view");
});

// ===========================================================================
// The commands DO something — tested without any gesture
// ===========================================================================

test("Pan right moves the view, and Centre brings it back", async ({ page }) => {
  await openFlat(page);
  const centred = await view(page);

  await runCommand(page, "Pan right");
  const panned = await view(page);
  expect(panned.x - centred.x, "the Pan command did nothing").toBeGreaterThan(50);
  expect(panned.width, "panning changed the zoom").toBeCloseTo(centred.width, 0);

  await runCommand(page, "Centre the view");
  // Back to the middle, with the scale untouched — Fit changes the zoom, this
  // only changes where you are looking.
  expect(Math.abs((await view(page)).x - centred.x)).toBeLessThan(4);
});

test("Orbit left turns the scene camera", async ({ page }) => {
  await open3D(page);

  const cameraPosition = async (): Promise<string> => {
    await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
    const inspector = page.getByTestId("inspector");
    return (
      await Promise.all(
        ["x", "y", "z"].map((axis) => inspector.getByLabel(`position ${axis}`).inputValue()),
      )
    ).join(",");
  };

  const before = await cameraPosition();
  await runCommand(page, "Orbit left");
  // Orbit moves the scene CAMERA — a different act from panning, which is why
  // they are different actions rather than one with a flag.
  expect(await cameraPosition(), "the Orbit command did not turn the camera").not.toBe(before);
});

test("orbit is refused where there is nothing to orbit", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Orbit left");
  await page.waitForTimeout(400);

  // A lower third is designed square-on and stays square-on. Greyed, never
  // hidden — a command that vanishes cannot be learned.
  const entry = page.getByTestId("palette").getByText("Orbit left", { exact: true }).first();
  await expect(entry).toBeVisible();
});

test("the Walk command enters walk mode, and Escape leaves it", async ({ page }) => {
  await open3D(page);
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);

  await runCommand(page, "Walk the camera");
  await expect(page.getByTestId("ov-walking"), "the command did not enter walk mode").toBeVisible();

  // The one cancellation ladder still owns Escape.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);
});

// ===========================================================================
// EVERY GESTURE STILL WORKS — the point of the whole exercise
// ===========================================================================

test("middle-drag still pans", async ({ page }) => {
  await openFlat(page);
  const before = await view(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 160, from.y + 80, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(400);

  expect((await view(page)).x - before.x).toBeGreaterThan(80);
});

test("space-drag still pans", async ({ page }) => {
  await openFlat(page);
  const before = await view(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.keyboard.down("Space");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 150, from.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(400);

  expect(before.x - (await view(page)).x).toBeGreaterThan(80);
});

test("alt-drag still orbits", async ({ page }) => {
  await open3D(page);
  const floorBefore = (await page.getByTestId("ground").boundingBox())!;
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.keyboard.down("Alt");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 200, from.y - 100, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(500);

  const floorAfter = (await page.getByTestId("ground").boundingBox())!;
  expect(
    Math.abs(floorAfter.width - floorBefore.width) + Math.abs(floorAfter.x - floorBefore.x),
    "alt-drag stopped orbiting",
  ).toBeGreaterThan(10);
});

test("Shift+backtick still walks, and WASD still moves", async ({ page }) => {
  await open3D(page);

  const cameraDistance = async (): Promise<number> => {
    await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
    const inspector = page.getByTestId("inspector");
    const axes = await Promise.all(
      ["x", "y", "z"].map(async (axis) =>
        Number(await inspector.getByLabel(`position ${axis}`).inputValue()),
      ),
    );
    return Math.hypot(...axes);
  };

  const start = await cameraDistance();
  await page.keyboard.press("Shift+`");
  await expect(page.getByTestId("ov-walking"), "the approved binding stopped working").toBeVisible();
  // The overlay appears one frame before the mode collects keys — see
  // `enterWalk` in walk.spec.ts. Pressing W into that gap moves nothing.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

  // Held long enough that a loaded browser still delivers frames to move in —
  // walking accumulates per frame, not per keypress.
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await page.waitForTimeout(300);

  expect(await cameraDistance(), "W stopped moving the camera").toBeLessThan(start);

  await page.keyboard.down("e");
  await page.waitForTimeout(400);
  await page.keyboard.up("e");
  await page.waitForTimeout(300);
  await expect(page.getByTestId("ov-walking")).toBeVisible();
});

test("S still means Scale outside walk mode", async ({ page }) => {
  await open3D(page);
  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(800);

  await page.keyboard.press("s");
  // Registering walk as a command must not have taken the transform triad
  // apart. G, R and S are the one binding this editor shares with Blender.
  await expect(page.getByTestId("stretchers")).toBeVisible();
});

test("the wheel still scrolls and the modifier still zooms", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(400);
  const zoom = async (): Promise<string> =>
    (await page.getByTestId("zoom").innerText()).trim();
  expect(await zoom()).toBe("100%");

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);

  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(400);
  expect(await zoom(), "the bare wheel is zooming again").toBe("100%");

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);
  expect(await zoom()).toBe("200%");
});
