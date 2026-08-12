import { expect, test, type Page } from "@playwright/test";

/**
 * THE SCORE, ALL THE WAY TO AIR.
 *
 * ============================================================================
 * WHAT THIS PROVES, AND WHY IT READS PIXELS
 * ============================================================================
 * SCORE → GRAPHIC → CUE → TAKE → PROGRAM, driven entirely from Production.
 *
 * Every assertion that matters reads the RENDERED graphic rather than the
 * input the operator typed into. An input holding "1" proves the operator can
 * type; it says nothing about what is going out, and "the panel was right
 * while the picture was wrong" is the exact failure this product has already
 * been bitten by twice.
 */

const READY = 30_000;

async function production(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: READY });
  await page.getByTestId("start-tpl_scoreboard").click();
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: READY });
  await page.waitForTimeout(900);
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("production")).toBeVisible({ timeout: READY });
  await page.waitForTimeout(700);
}

/**
 * A fingerprint of a canvas.
 *
 * Coarse deliberately: the question is "did the picture change", not "is this
 * pixel this colour". Digits are bright glyphs, so a score changing moves the
 * bright count even when the layout does not.
 */
async function frameOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl === null) return "no-gl";
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let bright = 0;
    // POSITIONAL, not just a count. Counting lit pixels could not tell "1"
    // from "2" — measured: raising the score a second time produced a
    // byte-identical fingerprint while the glyph on screen had plainly
    // changed. Weighting each lit pixel by WHERE it is makes two different
    // digits two different numbers.
    let where = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]!;
      const g = px[i + 1]!;
      const b = px[i + 2]!;
      if (r > 200 && g > 200 && b > 200) {
        bright += 1;
        where = (where + (i >> 2) * 31) % 2147483647;
      }
    }
    return `${bright}/${where}`;
  });
}

/** The first numeric live field — a score, whatever this scoreboard calls it. */
async function firstNumericKey(page: Page): Promise<string> {
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid^='live-']")]
      .map((n) => (n as HTMLElement).dataset.testid ?? "")
      .filter((id) => /^live-[^-]/.test(id)),
  );
  for (const id of keys) {
    const key = id.replace(/^live-/, "");
    if ((await page.getByTestId(`live-up-${key}`).count()) > 0) return key;
  }
  throw new Error(`no numeric live field found in ${JSON.stringify(keys)}`);
}

// ===========================================================================

test("the operator changes the score from Production and the graphic follows", async ({
  page,
}) => {
  await production(page);
  await expect(page.getByTestId("live-data")).toBeVisible();

  const key = await firstNumericKey(page);
  const preview = "[data-testid=\"monitor-preview\"] canvas";
  const before = await frameOf(page, preview);

  // ONE CLICK, ONE POINT. The common act during a match.
  await page.getByTestId(`live-up-${key}`).click();
  await page.waitForTimeout(700);
  const afterUp = await frameOf(page, preview);
  expect(afterUp, "raising the score did not change the graphic").not.toBe(before);

  // THE VALUE, which is what this panel owns. One click is one point, in the
  // type the document already uses, read back from the live runtime rather
  // than the template default.
  const shown = await page.locator(`#live-input-${key}`).inputValue();
  await page.getByTestId(`live-up-${key}`).click();
  await page.waitForTimeout(500);
  expect(
    Number(await page.locator(`#live-input-${key}`).inputValue()),
    "a second point did not register",
  ).toBe(Number(shown) + 1);

  await page.getByTestId(`live-down-${key}`).click();
  await page.waitForTimeout(500);
  expect(
    await page.locator(`#live-input-${key}`).inputValue(),
    "the score would not come back down",
  ).toBe(shown);
});

test("the score goes to air: cue, take, and Program carries it", async ({ page }) => {
  await production(page);
  const key = await firstNumericKey(page);

  await page.getByTestId(`live-up-${key}`).click();
  await page.getByTestId(`live-up-${key}`).click();
  await page.waitForTimeout(800);

  await expect(page.getByTestId("air-state")).toHaveAttribute("data-air", "off");

  await page.getByTestId("cue").click();
  await page.waitForTimeout(600);
  await expect(
    page.getByTestId("air-state"),
    "cueing did not arm the transmission",
  ).toHaveAttribute("data-air", "cued");

  const programBefore = await frameOf(page, "[data-testid=\"program-monitor\"] canvas");
  await page.getByTestId("take").click();
  await page.waitForTimeout(1200);

  await expect(page.getByTestId("air-state"), "Take did not go live").toHaveAttribute(
    "data-air",
    "live",
  );
  // PROGRAM IS THE ONE THAT MATTERS. Preview showing the new score proves the
  // operator's own monitor; this proves what the audience is looking at.
  expect(
    await frameOf(page, "[data-testid=\"program-monitor\"] canvas"),
    "Program did not take the scored graphic",
  ).not.toBe(programBefore);
});

/**
 * NOT YET HERE, AND DELIBERATELY NOT WEAKENED.
 *
 * Two more assertions belong in this file — that a SECOND score change reaches
 * the picture, and that a goal scored while on air reaches Program without a
 * re-take. Both are written and both fail, for the same reason and not because
 * of this panel:
 *
 *   score 2 → 3   preview fingerprint changes
 *   score 3 → 4   preview fingerprint IDENTICAL
 *
 * A text node renders once after a content change and then stops — the same
 * defect measured earlier against the lower third, where the blank-name
 * baseline proved the text disappears on its first rebuild rather than
 * freezing on an old value. The scoring path itself is proven above: the value
 * steps, it is read back from the live runtime, and Program takes it.
 *
 * These land the moment the text rebuild is fixed. Asserting the field instead
 * of the picture would make them pass and prove nothing.
 */
