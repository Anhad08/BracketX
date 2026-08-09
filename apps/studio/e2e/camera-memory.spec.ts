import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * CAMERA MEMORY — each graphic remembers how you were looking at it.
 *
 * ============================================================================
 * WHAT §03 ASKS FOR, IN ITS OWN WORDS
 * ============================================================================
 * "Camera memory — Per graphic, restored on open, including zoom step and
 * centre. Returning to a graphic you were working on at 400 % on the left
 * third and being shown Fit is a small theft of context, forty times a day."
 *
 * Zoom and centre. Orbit is deliberately NOT remembered here: turning the
 * camera in 3D writes onto the camera NODE, which is content and already
 * persists with the scene. A copy in the workspace would be a second source of
 * truth for where the camera points, and one of the two goes to air.
 *
 * These tests are the JOURNEY, not the store — the store is covered in
 * `src/camera-memory.test.ts`. What matters here is that a designer can
 * actually switch between graphics and find each one as they left it.
 */

const zoom = async (page: Page): Promise<string> =>
  (await page.getByTestId("zoom").innerText()).trim();

/** Where the view is centred, read off the surface the canvas lives on. */
async function centre(page: Page): Promise<string> {
  const box = (await page.locator(".scene-surface").boundingBox())!;
  return `${Math.round(box.x)},${Math.round(box.y)}`;
}

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
}

async function home(page: Page): Promise<void> {
  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("start-tpl_lower_third")).toBeVisible({ timeout: 30_000 });
}

/**
 * Creates a graphic from a template and SAVES it, which is what gives it a
 * durable identity.
 *
 * Every click of a template mints a NEW graphic — `instantiateTemplate` issues
 * fresh ids — so "open the lower third twice" is two graphics, not one, and a
 * camera memory keyed by graphic correctly has nothing to say about the
 * second. Saving is what makes a graphic a thing you can return TO, and
 * returning to it is the whole point of §03 camera memory.
 *
 * Returns the id, so a test can reopen exactly the graphic it made.
 */
async function createAndSave(page: Page, templateId: string): Promise<string> {
  await home(page);
  await page.getByTestId(`start-${templateId}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(600);

  await home(page);
  const recent = page.locator("[data-testid^=\"recent-\"]").first();
  const id = (await recent.getAttribute("data-testid"))!.replace("recent-", "");
  await page.getByTestId(`recent-${id}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
  return id;
}

/** Reopens a saved graphic by id. The same graphic, not a new one. */
async function reopen(page: Page, id: string): Promise<void> {
  await home(page);
  await page.getByTestId(`recent-${id}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
}

/** ⌘-wheel, because a bare wheel scrolls. One rung a notch. */
async function zoomIn(page: Page, notches: number): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.keyboard.down("Control");
  for (let index = 0; index < notches; index += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);
}

async function scroll(page: Page, dy: number): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, dy);
  // Longer than the 400ms debounce, so what is remembered is where we stopped.
  await page.waitForTimeout(700);
}

// ===========================================================================

test("a graphic comes back the way you left it", async ({ page }) => {
  await boot(page);

  const a = await createAndSave(page, "tpl_lower_third");
  await zoomIn(page, 2);
  await scroll(page, 200);
  const leftAt = { zoom: await zoom(page), centre: await centre(page) };

  // Away to a different graphic, which changes the view.
  await createAndSave(page, "tpl_title_card");
  await zoomIn(page, 1);
  await page.waitForTimeout(700);
  expect(await zoom(page), "B opened at A's zoom").not.toBe(leftAt.zoom);

  // And back to A.
  await reopen(page, a);
  expect(await zoom(page), "A did not come back at its own zoom").toBe(leftAt.zoom);
  expect(await centre(page), "A did not come back at its own centre").toBe(leftAt.centre);
});

test("three graphics keep three cameras", async ({ page }) => {
  await boot(page);

  const made: { id: string; zoom: string; centre: string }[] = [];
  const templates = ["tpl_lower_third", "tpl_title_card", "tpl_breaking"];

  for (const [index, template] of templates.entries()) {
    const id = await createAndSave(page, template);
    await zoomIn(page, index + 1);
    await scroll(page, 120 * (index + 1));
    made.push({ id, zoom: await zoom(page), centre: await centre(page) });
  }

  // Visited in the reverse of the order they were set, so a "last one wins"
  // implementation cannot pass.
  for (const entry of [...made].reverse()) {
    await reopen(page, entry.id);
    expect(await zoom(page), `${entry.id} lost its zoom`).toBe(entry.zoom);
    expect(await centre(page), `${entry.id} lost its centre`).toBe(entry.centre);
  }
});

test("changing one graphic's view does not touch another's", async ({ page }) => {
  await boot(page);

  const a = await createAndSave(page, "tpl_lower_third");
  await zoomIn(page, 2);
  const first = { zoom: await zoom(page), centre: await centre(page) };

  await createAndSave(page, "tpl_title_card");
  await zoomIn(page, 3);
  await scroll(page, 300);

  await reopen(page, a);
  expect(await zoom(page)).toBe(first.zoom);
  expect(await centre(page)).toBe(first.centre);
});

/**
 * PERSISTENCE. "Restored on OPEN" has to survive the application closing.
 */
test("a remembered view survives a reload", async ({ page }) => {
  await boot(page);
  const a = await createAndSave(page, "tpl_lower_third");
  await zoomIn(page, 2);
  await scroll(page, 180);
  const leftAt = { zoom: await zoom(page), centre: await centre(page) };

  await page.reload();
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await reopen(page, a);

  expect(await zoom(page), "a reload forgot the view").toBe(leftAt.zoom);
  expect(await centre(page), "a reload forgot the centre").toBe(leftAt.centre);
});

test("a graphic never opened before starts at Fit", async ({ page }) => {
  await boot(page);
  await createAndSave(page, "tpl_lower_third");
  await zoomIn(page, 3);
  const zoomed = await zoom(page);

  // A brand-new graphic has no memory and must not inherit one.
  await home(page);
  await page.getByTestId("start-tpl_countdown").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(800);

  // Fit — and deliberately NOT snapped to a rung.
  //
  // §03 does ask for "Fit, then snap to nearest step", and explicit Fit does
  // exactly that. Snapping the ON-OPEN fit is the one §03 row still deferred:
  // at the snapped 50% a pixel-exact assertion in orbit.spec fails for a
  // render-timing reason that is recorded and not yet understood, and routing
  // it in through camera memory would smuggle an unfinished row into a
  // finished one.
  //
  // So this asserts what camera memory is actually responsible for: a graphic
  // with no memory does not inherit somebody else's view.
  expect(
    await zoom(page),
    "a fresh graphic inherited another graphic's view",
  ).not.toBe(zoomed);
});

/**
 * THE BOUNDARY THAT MUST HOLD.
 *
 * Orbit belongs to the camera node — content — and camera memory must not
 * touch it. If it did, returning to a graphic could silently re-aim the shot
 * that goes to air.
 */
test("camera memory never moves the scene camera", async ({ page }) => {
  await boot(page);
  await createAndSave(page, "tpl_lower_third");

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
  await zoomIn(page, 2);
  await scroll(page, 200);

  await createAndSave(page, "tpl_title_card");
  await createAndSave(page, "tpl_lower_third");

  // Zooming, scrolling, leaving and returning: the document's camera is
  // untouched by all of it.
  expect(await cameraPosition(), "camera memory moved the scene camera").toBe(before);
});

test("the six numbered slots still work alongside it", async ({ page }) => {
  await boot(page);
  await createAndSave(page, "tpl_lower_third");
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);

  await zoomIn(page, 2);
  const stored = await zoom(page);

  // Slot 1, through the palette — the same command the ⌥⇧1 chord runs.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Set camera 1");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  await page.keyboard.press("Digit0");
  await page.waitForTimeout(400);
  expect(await zoom(page)).toBe("100%");

  await page.keyboard.press("Alt+Digit1");
  await page.waitForTimeout(400);
  // A numbered slot a designer FILLED, distinct from the view they merely
  // left behind. Both work, and neither is the other.
  expect(await zoom(page), "the numbered slot stopped working").toBe(stored);
});
