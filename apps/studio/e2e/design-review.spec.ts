import { expect, test, type Page } from "@playwright/test";

/**
 * THE DESIGN REVIEW HARNESS.
 *
 * ============================================================================
 * WHY THIS IS NOT `essentials.spec.ts`
 * ============================================================================
 * That file photographs the whole application window, which is the right picture
 * for "does the editor open a template". It is the wrong picture for judging a
 * GRAPHIC: the canvas is a few hundred pixels wide inside it, surrounded by
 * panels, and a lower third at that scale looks fine no matter what it is.
 *
 * This shoots the CANVAS ONLY, at the size the graphic actually goes to air, and
 * it shoots every piece of content that has to survive — the designed case, the
 * longest string in the feed, and the shortest. Volume Four's specimen rule:
 * "the extreme of its own data source — the longest name, the largest number,
 * the widest string — and shows you the failure while you are still designing
 * it."
 *
 * The output is for LOOKING AT. The assertions here only catch what a picture
 * cannot argue with; the design judgement is made by reading the images.
 */

async function open(page: Page, id: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`start-${id}`).click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.locator(".scene-surface canvas").first()).toBeVisible({ timeout: 30_000 });
  // Fonts, images, paint rasterisation, and the first projected frame.
  await page.waitForTimeout(1400);
}

/** The graphic itself, with none of the editor around it. */
async function shoot(page: Page, name: string): Promise<void> {
  const canvas = page.locator(".scene-surface canvas").first();
  await expect(canvas).toBeVisible();
  await canvas.screenshot({ path: `design/${name}.png`, animations: "disabled" });
}

/**
 * Sets a content field by its label, the way an operator would.
 *
 * By ROW rather than by position. A graphic's fields are ordered by the document,
 * so `input.field.first()` silently edits whichever variable happens to be first
 * — and once this template gained a Context slot, that lookup found a NUMBER
 * input and Playwright refused to type into it. The label is the stable handle.
 */
async function setField(page: Page, label: string, value: string): Promise<void> {
  const row = page
    .getByTestId("content")
    .locator("label.content-row")
    .filter({ hasText: label })
    .first();
  const field = row.locator("input").first();
  await expect(field, `no content field called ${label}`).toBeVisible();
  await field.fill(value);
  await field.blur();
  await page.waitForTimeout(900);
}

test("Lower Third — designed, longest and shortest content", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await open(page, "tpl_lower_third");
  await shoot(page, "lower-third-1-designed");

  // THE WORST CASE IN THE FEED. 25 characters, and the name that used to make
  // the old strap render nothing at all.
  await setField(page, "Name", "KONSTANTINOS PAPADOPOULOS");
  await shoot(page, "lower-third-2-longest");

  // And the shortest, where a composition built around a long word falls apart
  // in the other direction — acres of empty plate beside two letters.
  await setField(page, "Name", "LI");
  await shoot(page, "lower-third-3-shortest");

  expect(errors, errors.join("\n")).toEqual([]);
});

test("Title Card — designed and with a title that runs long", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await open(page, "tpl_title_card");
  await shoot(page, "title-card-1-designed");

  // A title that will not fit on one line, so the two-line case is a designed
  // state rather than a discovery. This is a real segment name, not filler.
  await setField(page, "Title", "THE CHAMPIONSHIP RUN-IN");
  await shoot(page, "title-card-2-long");

  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * IS EDITED TEXT DRAWN DIFFERENTLY FROM AUTHORED TEXT?
 *
 * Every review render taken AFTER a content edit came back greyer and thinner
 * than the one before it — the long title, the long name, and the two-letter
 * name alike. Length was the obvious suspect and it is not the cause: what the
 * three have in common is that they were typed into the Content panel.
 *
 * So this changes ONE character and measures the glyph coverage on the canvas
 * either side. If the same string set two different ways draws with different
 * weight, that is a defect in the text or variable path and not a design
 * problem, and it also means no design can be judged from a screenshot taken
 * after an edit.
 */
test("edited text renders with the same weight as authored text", async ({ page }) => {
  // ==========================================================================
  // A CONFIRMED DEFECT, NOT A DESIGN PROBLEM — AND NOT THIS TRACK'S TO FIX
  // ==========================================================================
  // `test.fail` rather than a deletion or a softened threshold, matching how
  // `tokens.test.ts` carries IF-008: the assertion says what the product is
  // supposed to do, it runs on every build, and the day the text path is fixed
  // this starts failing — which is the signal to delete this line.
  //
  // WHAT WAS MEASURED. Dropping one character from the title cuts the bright-
  // pixel luminance of the canvas to 8.8% of the authored render. Geometry,
  // position and size are unchanged; the strokes simply lose most of their
  // coverage and the type goes from near-white to mid-grey.
  //
  // WHAT IT IS NOT. Length is not the cause — one character is not 92% of the
  // mass. Colour resolution is not the cause either: setting the title's colour
  // to a LITERAL instead of the `color.ink` binding produced a byte-identical
  // pair of numbers, so the token was resolving correctly all along.
  //
  // WHERE IT POINTS. Only the RE-SHAPED node degrades — the context line and the
  // programme flag beside it are untouched in the same frame. That puts it in the
  // glyph/atlas path after a re-shape rather than in materials or bindings, and
  // an MSDF sampled with a screen-pixel range meant for a different atlas page
  // looks exactly like this. Text rendering lifecycle is engineering-owned and
  // explicitly off this track, so it is measured, located and handed over.
  //
  // WHY IT MATTERS BEYOND THE BUG: no graphic's WEIGHT can be judged from a
  // screenshot taken after a content edit. The extreme-content renders in this
  // file are still valid for composition, alignment and fit — which is what they
  // are read for — but not for colour.
  test.fail();
  await open(page, "tpl_title_card");

  const ink = async (): Promise<number> =>
    page.locator(".scene-surface canvas").first().evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Total luminance of everything brighter than the furniture — the title is
      // the only near-white mass in this graphic.
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const value = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
        if (value > 140) sum += value;
      }
      return sum;
    });

  const authored = await ink();
  // One character shorter, so the mass changes by about 6% and nothing else.
  await setField(page, "Title", "MATCH OF THE DA");
  const edited = await ink();
  await shoot(page, "probe-edited-title");

  console.log(`authored ink=${authored}  edited ink=${edited}  ratio=${(edited / authored).toFixed(3)}`);
  // Allowing a fifth either way for the one dropped character.
  expect(edited / authored, "edited text is drawn at a different weight").toBeGreaterThan(0.8);
});

test("Sponsor Bar — as designed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await open(page, "tpl_sponsor");
  await shoot(page, "sponsor-1-designed");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Ticker — as designed and with a headline that overruns", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await open(page, "tpl_ticker");
  await shoot(page, "ticker-1-designed");
  await setField(
    page,
    "Headline",
    "Konstantinos Papadopoulos signs a four-year deal at Anfield as the window closes on a record-breaking day",
  );
  await shoot(page, "ticker-2-overrun");
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * ONE DEFECT, TWO SYMPTOMS: EDITED TEXT IS BARELY DRAWN.
 *
 * ==========================================================================
 * THE MEASUREMENT
 * ==========================================================================
 * Lit pixels across the middle of the ticker's strap — the headline's own band,
 * excluding the LIVE flag and the clock so neither can mask it going missing:
 *
 *   AUTHORED, 62 characters, never edited ....... 14269
 *   edited to  47 characters ....................     0
 *   edited to  63 characters ....................     0
 *   edited to  79 characters ....................     0
 *   edited to  95 characters ....................     0
 *   edited to 111 characters ....................     0
 *   edited to 127 characters ....................     0
 *
 * LENGTH IS NOT THE VARIABLE. A 47-character headline is SHORTER than the
 * authored default that draws perfectly, and it draws nothing. The only thing
 * the failing cases share is that they were typed into the Content panel.
 *
 * ==========================================================================
 * WHY IT LOOKED LIKE TWO DIFFERENT BUGS
 * ==========================================================================
 * The same defect presents differently by type size, which is why it has been
 * mis-diagnosed twice:
 *
 *   AT 168px  the title card's headline survives at 8.8% of its authored
 *             luminance — visible, and obviously wrong: mid-grey instead of
 *             near-white.
 *   AT 44px   the ticker's headline falls below visibility altogether and reads
 *             as "the text vanished".
 *
 * It also explains the older report that "long text makes a lower-third name
 * disappear", which was investigated as a fit-and-shrink problem and never
 * reproduced against length. It was never about length.
 *
 * Not colour resolution either: setting the title to a LITERAL ink colour rather
 * than the `color.ink` binding produced byte-identical measurements. And only the
 * RE-SHAPED node degrades — its neighbours are untouched in the same frame —
 * which puts it in the glyph or atlas path after a re-shape.
 *
 * Text rendering lifecycle is engineering-owned and off this track, so it is
 * measured, located and handed over. `test.fail()` for the reason `tokens.test.ts`
 * uses: the assertion states what the product should do, it runs on every build,
 * and it starts failing the day somebody fixes it.
 *
 * CONSEQUENCE FOR DESIGN REVIEW, and it is not a small one: no graphic can be
 * judged from a screenshot taken after a content edit. Extreme-content checking
 * has to change the template's DEFAULT in code and re-render.
 */
test("a headline still draws after it is edited", async ({ page }) => {
  test.fail();
  await open(page, "tpl_ticker");

  const ink = async (): Promise<number> =>
    page.locator(".scene-surface canvas").first().evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0;
      const from = Math.floor(canvas.width * 0.28);
      const to = Math.floor(canvas.width * 0.78);
      const rows = Math.floor(canvas.height * 0.09);
      for (let y = 0; y < rows; y += 1) {
        for (let x = from; x < to; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const value = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
          if (value > 110) sum += 1;
        }
      }
      return sum;
    });

  const authored = await ink();
  expect(authored, "the authored headline must draw at all").toBeGreaterThan(2000);

  // SHORTER than the default, so nothing about fit or shrink is in play.
  await setField(page, "Headline", "Liverpool lead at Anfield");
  const edited = await ink();
  console.log(`authored=${authored} lit px   edited=${edited} lit px`);
  expect(edited, "an edited headline is barely drawn").toBeGreaterThan(authored * 0.5);
});

test("Breaking News — as designed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await open(page, "tpl_breaking");
  await shoot(page, "breaking-1-designed");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Scoreboard — as designed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await open(page, "tpl_scoreboard");
  await shoot(page, "scoreboard-1-designed");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("Countdown — as designed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await open(page, "tpl_countdown");
  await shoot(page, "countdown-1-designed");
  expect(errors, errors.join("\n")).toEqual([]);
});
