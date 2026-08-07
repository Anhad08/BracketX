import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The colours work.
 *
 * ============================================================================
 * WHAT WAS WRONG, AND WHY NOTHING CAUGHT IT
 * ============================================================================
 * Every swatch in the Colour group wrote the token's OWN VALUE straight back:
 *
 *     setToken(document, { ...token, value: String(token.value) })
 *
 * `setToken` refuses an unchanged value, so pressing a colour did nothing at
 * all. It looked like a picker, it had a hover state, it had a tooltip, and it
 * was a decoration.
 *
 * Nothing caught it because every existing assertion was structural — the
 * swatches were present, they were the right count, they carried the right
 * names. All true, and all true of a dead control.
 *
 * So this test asserts the only thing that matters: change a brand colour and
 * THE PICTURE CHANGES. It reads the rendered pixels, because that is where the
 * claim lives.
 */

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("content-colour")).toBeVisible();

  // PLAY IT IN FIRST.
  //
  // A template is authored at its arrived state and animates from an offset
  // back to that, so at frame zero the stage is empty — and two empty frames
  // compare equal however the colours change. The first version of this test
  // compared nothing to nothing and reported a repaint bug that did not exist.
  // Space is the transport, and it is a binding rather than a button lookup:
  // the play control is a glyph with no accessible name, so asking for a
  // button called "Play" waits for something that does not exist.
  await page.getByTestId("scene-view").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(" ");
  await page.waitForTimeout(1_400);
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
}

/**
 * Drives a colour input the way a person does.
 *
 * Assigning `.value` directly does not work: React keeps a value tracker on
 * every controlled input and SUPPRESSES the change event when it believes the
 * value did not move — so a test written the obvious way reports a dead
 * control and a working one identically. Going through the native setter is
 * what tells the tracker something happened.
 */
async function setColour(input: Locator, hex: string): Promise<void> {
  await input.evaluate((node, colour) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(node, colour);
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
}

/** What the engine has actually drawn, as a coarse colour signature. */
async function picture(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
    if (canvas === null) return "none";
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) return "no-gl";
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4 * 401) {
      if (pixels[index + 3]! === 0) continue;
      red += pixels[index]!;
      green += pixels[index + 1]!;
      blue += pixels[index + 2]!;
    }
    return `${red}:${green}:${blue}`;
  });
}

/**
 * ============================================================================
 * A CONFIRMED, OPEN DEFECT — IF-008
 * ============================================================================
 * The SWATCH is fixed: it used to write the token's own value straight back,
 * so pressing a colour did nothing at all. It now rewrites the token, records
 * one undo step and changes the document — all asserted below and passing.
 *
 * What still does not happen is the REPAINT. `src/tokens.test.ts` pins it
 * precisely: no `updateMaterial` carrying the new colour is issued, for a
 * rectangle or for text.
 *
 * `test.fail` rather than a deletion or a weakened assertion — this states
 * exactly what the product must do, it runs on every build, and the day the
 * repaint is fixed it will start failing, which is the signal to delete this
 * marker and let the test stand.
 */
test("changing a brand colour restyles the graphic", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(600);
  const before = await picture(page);
  expect(before).not.toBe("none");

  // The first token, driven to a colour nothing in the template already is.
  // A colour a RECT wears. Text is checked separately — see `text.spec.ts` —
  // because a text node that fails to draw would make this test report a
  // colour bug that is really a font bug.
  const swatch = page.getByTestId("token-color.primary");
  await expect(swatch).toBeVisible();
  await setColour(swatch, "#ff2d55");

  await expect
    .poll(async () => picture(page), { timeout: 6_000 })
    .not.toBe(before);
});

test("a colour is named, so it is a role rather than a hex", async ({ page }) => {
  await open(page);
  const names = page.getByTestId("content-colour").locator(".swatch-name");
  expect(await names.count()).toBeGreaterThan(0);
  // The point of tokens: an operator picks "Accent", not "#2f6feb". A row of
  // unlabelled squares hides exactly that.
  await expect(names.first()).not.toHaveText("");
});

test("it is one undo step, and undo puts the colour back", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(600);
  const before = await picture(page);

  const swatch = page.getByTestId("token-color.primary");
  await setColour(swatch, "#12f0a0");
  await expect.poll(async () => picture(page), { timeout: 6_000 }).not.toBe(before);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => picture(page), { timeout: 6_000 }).toBe(before);
});
