import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * ZOOM TRAVELS. `studio-specification.html` §03: "120 ms · press".
 *
 * ============================================================================
 * WHAT THESE OBSERVE
 * ============================================================================
 * Not a token, and not a CSS declaration — the LIVE viewport, sampled while it
 * moves. The claim being made is that a designer sees the picture travel
 * between two scales, so what is measured is the picture between two scales.
 *
 * "Long enough to keep orientation, short enough not to be waited on."
 *
 * And under reduced motion, the same result with none of the travel:
 * "Disabled entirely under reduced motion, with no loss." The zoom still
 * happens, on the same rung, about the same point. Only the journey goes.
 */

const zoom = async (page: Page): Promise<string> =>
  (await page.getByTestId("zoom").innerText()).trim();

/** The rendered width of the surface — the picture's actual scale. */
async function width(page: Page): Promise<number> {
  return (await page.locator(".scene-surface").boundingBox())!.width;
}

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
  await page.keyboard.press("Digit0"); // 100%, an exact rung to start from.
  await page.waitForTimeout(400);
}

/**
 * Samples the surface width as fast as the page will report it, for a while.
 *
 * Returns every distinct width seen. A zoom that CUT produces two; one that
 * travels produces a run of them.
 */
async function sampleWidths(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(async (duration) => {
    const surface = document.querySelector(".scene-surface") as HTMLElement | null;
    if (surface === null) return [];
    const seen: number[] = [];
    const started = performance.now();
    return await new Promise<number[]>((resolve) => {
      const step = (): void => {
        const value = Math.round(surface.getBoundingClientRect().width * 100) / 100;
        if (seen[seen.length - 1] !== value) seen.push(value);
        if (performance.now() - started < duration) requestAnimationFrame(step);
        else resolve(seen);
      };
      requestAnimationFrame(step);
    });
  }, ms);
}

/** ⌘-wheel, because a bare wheel scrolls. Fired without waiting for it. */
async function zoomNotch(page: Page): Promise<void> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
}

// ===========================================================================
// Motion on
// ===========================================================================

test("the picture travels between two scales rather than cutting", async ({ page }) => {
  await open(page);
  const before = await width(page);

  const sampling = sampleWidths(page, 400);
  await zoomNotch(page);
  const widths = await sampling;

  // A cut gives two values: the old one and the new one. Travel gives a run.
  expect(
    widths.length,
    `the zoom cut rather than travelled — widths seen: ${widths.join(", ")}`,
  ).toBeGreaterThan(3);

  const after = await width(page);
  expect(after).toBeGreaterThan(before);
});

test("it takes a short travel — not a cut, and not something you wait for", async ({ page }) => {
  await open(page);

  // Started BEFORE the gesture and awaited after, so the measurement is
  // running while the zoom happens. Awaiting it first — as an earlier version
  // of this test did — measures a viewport that is not moving and reports zero.
  const measuring = page.evaluate(async () => {
    const surface = document.querySelector(".scene-surface") as HTMLElement;
    const began = performance.now();
    let last = surface.getBoundingClientRect().width;
    let firstChange = 0;
    let lastChange = 0;

    return await new Promise<{ from: number; to: number }>((resolve) => {
      const step = (): void => {
        const now = surface.getBoundingClientRect().width;
        if (now !== last) {
          if (firstChange === 0) firstChange = performance.now();
          lastChange = performance.now();
          last = now;
        }
        if (performance.now() - began > 800) {
          resolve({ from: firstChange - began, to: lastChange - began });
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  });

  await zoomNotch(page);
  const { from, to } = await measuring;

  expect(from, "the viewport never moved at all").toBeGreaterThan(0);
  const travelled = to - from;
  // Generous bounds deliberately: this is wall clock through a browser under
  // load. The claim worth asserting here is that the picture TRAVELS for a
  // short while — not that it cuts, and not that it is something a designer
  // waits for. The exact 120ms is the model's business and is asserted there.
  expect(travelled, "the zoom cut instead of travelling").toBeGreaterThan(15);
  expect(travelled, `the zoom travelled for ${Math.round(travelled)}ms`).toBeLessThan(400);
});

test("it lands on the exact rung, every time", async ({ page }) => {
  await open(page);
  expect(await zoom(page)).toBe("100%");

  await zoomNotch(page);
  await page.waitForTimeout(500);
  // The animation is a picture; the model jumps. 200% exactly, not 197%.
  expect(await zoom(page), "the animation left the model between rungs").toBe("200%");

  await zoomNotch(page);
  await page.waitForTimeout(500);
  expect(await zoom(page)).toBe("400%");
});

test("it still zooms about the pointer", async ({ page }) => {
  await open(page);

  // A point well off centre. The canvas point under it must stay under it.
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const at = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.3 };

  const canvasPointAt = async (): Promise<{ x: number; y: number }> =>
    page.evaluate((screen) => {
      const box = (document.querySelector(".scene-surface") as HTMLElement).getBoundingClientRect();
      return { x: (screen.x - box.left) / box.width, y: (screen.y - box.top) / box.height };
    }, at);

  const before = await canvasPointAt();

  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);

  const after = await canvasPointAt();
  // Same fraction of the canvas under the same pixel. Zooming about the centre
  // is what makes an editor feel like it is fighting you.
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.02);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.02);
});

// ===========================================================================
// Motion off — "disabled entirely under reduced motion, with no loss"
// ===========================================================================

test.describe("with reduced motion", () => {
  /**
   * `page.emulateMedia`, not `test.use({ reducedMotion })`.
   *
   * The fixture option does not reach the page here — `matchMedia` still
   * reports false with it set, verified directly — and a reduced-motion test
   * that silently runs with motion on is worse than none: it would have
   * reported this feature working while it was not.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the zoom arrives without travelling", async ({ page }) => {
    await open(page);

    const sampling = sampleWidths(page, 400);
    await zoomNotch(page);
    const widths = await sampling;

    // One step: the old width and the new one. No journey between them.
    expect(
      widths.length,
      `reduced motion still animated — widths seen: ${widths.join(", ")}`,
    ).toBeLessThanOrEqual(2);
  });

  test("and the result is exactly the same", async ({ page }) => {
    await open(page);
    expect(await zoom(page)).toBe("100%");

    await zoomNotch(page);
    await page.waitForTimeout(400);
    // NO LOSS. Same rung, same ladder — only the motion is gone.
    expect(await zoom(page)).toBe("200%");

    await page.keyboard.press("Digit0");
    await page.waitForTimeout(400);
    expect(await zoom(page)).toBe("100%");
  });

  test("pointer-centred zoom still holds", async ({ page }) => {
    await open(page);
    const stage = (await page.getByTestId("scene-view").boundingBox())!;
    const at = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.3 };

    const canvasPointAt = async (): Promise<{ x: number; y: number }> =>
      page.evaluate((screen) => {
        const box = (
          document.querySelector(".scene-surface") as HTMLElement
        ).getBoundingClientRect();
        return { x: (screen.x - box.left) / box.width, y: (screen.y - box.top) / box.height };
      }, at);

    const before = await canvasPointAt();
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(400);

    const after = await canvasPointAt();
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.02);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.02);
  });
});

// ===========================================================================
// It must not have disturbed anything already settled
// ===========================================================================

test("camera memory remembers the rung the animation landed on", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(600);

  await page.getByTestId("nav-home").click();
  const recent = page.locator("[data-testid^=recent-]").first();
  const id = (await recent.getAttribute("data-testid"))!.replace("recent-", "");
  await page.getByTestId(`recent-${id}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(600);

  await zoomNotch(page);
  await page.waitForTimeout(900);
  const landed = await zoom(page);

  await page.getByTestId("nav-home").click();
  await page.getByTestId(`recent-${id}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);

  // A rung, not a frame of the animation. The model never sees the travel.
  expect(await zoom(page), "camera memory caught a mid-animation value").toBe(landed);
});

test("a camera slot stores a rung, not a frame of the animation", async ({ page }) => {
  await open(page);
  await zoomNotch(page);
  await page.waitForTimeout(600);
  const stored = await zoom(page);

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("Set camera 1");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  await page.keyboard.press("Digit0");
  await page.waitForTimeout(500);
  await page.keyboard.press("Alt+Digit1");
  await page.waitForTimeout(500);

  expect(await zoom(page), "the slot caught a mid-animation value").toBe(stored);
});
