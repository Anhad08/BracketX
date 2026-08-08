import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The viewport interaction language, in the real app.
 *
 * ============================================================================
 * WHAT THIS FILE IS FOR
 * ============================================================================
 * `src/interaction.test.ts` proves the MODEL — that a bare wheel means scroll
 * and the middle button means pan. This file proves the VIEWPORT obeys it,
 * which is a different claim: the model was correct in isolation for as long
 * as it took to write, and the two rows it now enforces were violated in the
 * shipping product because nothing connected the specification to the handler.
 *
 * Each test names the row of `studio-specification.html` §03 it holds.
 */

async function openFlat(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(800);
}

const zoom = async (page: Page): Promise<string> =>
  (await page.getByTestId("zoom").innerText()).trim();

/** The view transform, read off the surface the engine's canvas lives on. */
async function surface(page: Page): Promise<{ x: number; y: number; width: number }> {
  const box = (await page.locator(".scene-surface").boundingBox())!;
  return { x: box.x, y: box.y, width: box.width };
}

async function wheelAt(
  page: Page,
  delta: { x?: number; y?: number },
  modifiers: string[] = [],
): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(350);
}

// ===========================================================================
// §03 · "Wheel — Scrolls vertically. ⌘+wheel zooms about the pointer."
// ===========================================================================

test("the bare wheel scrolls and does not zoom", async ({ page }) => {
  await openFlat(page);
  const before = await zoom(page);
  const start = await surface(page);

  await wheelAt(page, { y: 240 });

  // THE ROW THAT WAS VIOLATED. The spec calls bare-wheel zoom "the single most
  // complained-about behaviour in design tools", and it shipped anyway.
  expect(await zoom(page), "the bare wheel is zooming again").toBe(before);
  const after = await surface(page);
  expect(Math.abs(after.y - start.y), "the wheel did not scroll").toBeGreaterThan(20);
  expect(after.width, "the wheel rescaled the picture").toBeCloseTo(start.width, 0);
});

test("shift and the wheel scrolls sideways", async ({ page }) => {
  await openFlat(page);
  const start = await surface(page);

  await wheelAt(page, { y: 240 }, ["Shift"]);

  const after = await surface(page);
  expect(Math.abs(after.x - start.x), "shift-wheel did not scroll sideways").toBeGreaterThan(20);
  expect(Math.abs(after.y - start.y), "shift-wheel scrolled vertically too").toBeLessThan(4);
});

test("the modifier and the wheel zooms, one named step at a time", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0"); // 100%, an exact rung.
  await page.waitForTimeout(300);
  expect(await zoom(page)).toBe("100%");

  await wheelAt(page, { y: -240 }, ["Control"]);
  // "Zoom steps — 10 · 25 · 50 · 66 · 100 · 200 · 400 · 800 %". Not 103%.
  expect(await zoom(page), "zoom is still continuous").toBe("200%");

  await wheelAt(page, { y: 240 }, ["Control"]);
  expect(await zoom(page)).toBe("100%");
});

test("every zoom the wheel reaches is a named step", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);

  const allowed = new Set(["10%", "25%", "50%", "66%", "100%", "200%", "400%", "800%"]);
  const seen: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    await wheelAt(page, { y: -240 }, ["Control"]);
    seen.push(await zoom(page));
  }
  for (let index = 0; index < 8; index += 1) {
    await wheelAt(page, { y: 240 }, ["Control"]);
    seen.push(await zoom(page));
  }
  const strays = seen.filter((step) => !allowed.has(step));
  expect(strays, `off-ladder zoom levels: ${strays.join(", ")}`).toEqual([]);
});

// ===========================================================================
// §03 · "Pan — Space-drag, middle-drag, or two-finger scroll."
// ===========================================================================

test("the middle button pans", async ({ page }) => {
  await openFlat(page);
  const start = await surface(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 160, from.y + 90, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(400);

  const after = await surface(page);
  expect(after.x - start.x, "the middle button did not pan").toBeGreaterThan(80);
});

test("space and the left button pans, for anyone without a middle button", async ({ page }) => {
  await openFlat(page);
  const start = await surface(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  await page.keyboard.down("Space");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 150, from.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(400);

  const after = await surface(page);
  expect(start.x - after.x, "space-drag did not pan").toBeGreaterThan(80);
});

test("the flat camera cannot be turned by any gesture", async ({ page }) => {
  await openFlat(page);
  // A lower third is designed square-on and stays square-on. Alt-drag orbits
  // in space; here it must not, or every later judgement about alignment and
  // letter-spacing is made against a camera nobody knows has moved.
  await expect(page.getByTestId("ground")).toHaveCount(0);

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  await page.keyboard.down("Alt");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 200, from.y - 120, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(400);

  await expect(page.getByTestId("ground"), "the flat view was orbited").toHaveCount(0);
});

// ===========================================================================
// Orbit, where there is something to orbit
// ===========================================================================

test("alt-drag orbits in space, and the middle button still pans there", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(900);

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };

  const floorBefore = (await page.getByTestId("ground").boundingBox())!;
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
    "alt-drag did not orbit",
  ).toBeGreaterThan(10);

  // And the middle button is still pan here, not orbit — the spec makes no
  // exception for the dimensional view.
  const surfaceBefore = await surface(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 140, from.y, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(400);
  expect(
    (await surface(page)).x - surfaceBefore.x,
    "the middle button is orbiting again",
  ).toBeGreaterThan(70);
});

// ===========================================================================
// §03 · "Camera presets — Six, bound ⌥1 – ⌥6. Set with ⌥⇧1 – ⌥⇧6."
// ===========================================================================

test("a camera can be stored and recalled", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);

  // Somewhere distinctive, then stored.
  await wheelAt(page, { y: -240 }, ["Control"]);
  const stored = await zoom(page);
  expect(stored).toBe("200%");
  // Stored through the PALETTE, recalled through the KEYBOARD.
  //
  // Both routes are the same command — that is the point of the command
  // system — and this exercises one of each. The ⌥⇧1 chord itself does not
  // reach the page under Playwright on this platform; the binding is declared
  // and printed, and its partner ⌥1 is verified below, but the chord is
  // untested here rather than assumed working.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Set camera 1");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  // Move away, then back.
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);
  expect(await zoom(page)).toBe("100%");

  await page.keyboard.press("Alt+Digit1");
  await page.waitForTimeout(300);
  expect(await zoom(page), "the camera preset did not come back").toBe(stored);
});

test("recalling a preset that was never set does nothing", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);
  const before = await zoom(page);

  await page.keyboard.press("Alt+Digit5");
  await page.waitForTimeout(300);

  // Being thrown somewhere arbitrary is worse than the key appearing not to
  // work: the designer has lost their place and cannot get it back.
  expect(await zoom(page), "an empty preset moved the view").toBe(before);
});

// ===========================================================================
// PRESERVED — the functionality consolidation must not have cost
// ===========================================================================

test("Fit still fits, and lands on a named step", async ({ page }) => {
  await openFlat(page);
  await wheelAt(page, { y: -240 }, ["Control"]);
  await wheelAt(page, { y: -240 }, ["Control"]);

  await page.keyboard.press("f");
  await page.waitForTimeout(400);

  const allowed = ["10%", "25%", "50%", "66%", "100%", "200%", "400%", "800%"];
  expect(allowed, "Fit landed off the ladder").toContain(await zoom(page));
});

test("the keyboard zoom agrees with the wheel zoom", async ({ page }) => {
  await openFlat(page);
  await page.keyboard.press("Digit0");
  await page.waitForTimeout(300);

  // The bug this guards: the keyboard used to zoom continuously about the
  // origin while the wheel stepped about the pointer. Two zooms, one product.
  await page.keyboard.press("Equal");
  await page.waitForTimeout(350);
  expect(await zoom(page)).toBe("200%");

  await page.keyboard.press("Minus");
  await page.waitForTimeout(350);
  expect(await zoom(page)).toBe("100%");
});

test("100% is exactly 100%, from anywhere", async ({ page }) => {
  await openFlat(page);
  await wheelAt(page, { y: 240 }, ["Control"]);
  await wheelAt(page, { y: 240 }, ["Control"]);

  await page.keyboard.press("Digit0");
  await page.waitForTimeout(350);
  // "It must be exact, not approximately exact" — the only zoom at which a
  // designer can judge type legibility.
  expect(await zoom(page)).toBe("100%");
});
