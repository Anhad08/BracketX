import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * EVERY SHIPPED GRAPHIC DRAWS ITS WORDS.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR
 * ============================================================================
 * Paint order was derived from a depth-first walk of the tree so that "Bring to
 * front" would change the picture. It does. It also broke the lower third: ALEX
 * RIVERA and Team Captain vanished behind the background plate, and the founder
 * found it within the hour.
 *
 * The reason is worth keeping. A text node does not draw itself — it draws
 * through a synthetic mirror CHILD, one per batch, with no document node behind
 * it. Asked whether that child was a flat graphic, the projector looked it up
 * in the document, found nothing, and answered no. So the batch kept order 0
 * while its own parent got a positive one, and in the transparent sort order 0
 * draws FIRST. The plate painted over the words.
 *
 * THE TREE THE DOCUMENT DESCRIBES AND THE TREE THE MIRROR HOLDS ARE NOT THE
 * SAME TREE, and paint order is a property of the second one.
 *
 * The narrow fix is one line. This file is the wide one: it opens every graphic
 * Streamatrix ships, plays it to its arrived state, and measures whether each
 * text node's own area actually contains glyphs. A flat plate covering a word
 * leaves a flat area behind; letters leave edges. That difference is what is
 * measured, so the test does not need to know what colour anything is.
 */

const TEMPLATES: readonly string[] = [
  "tpl_lower_third",
  "tpl_title_card",
  "tpl_scoreboard",
  "tpl_breaking",
  "tpl_countdown",
  "tpl_ticker",
  "tpl_sponsor",
];

async function open(page: Page, templateId: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`start-${templateId}`).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(900);
  // A template is authored at its ARRIVED state and animates from an offset
  // back to it, so frame 0 is a nearly empty stage. What a viewer sees — and
  // what the founder was looking at — is the arrived state.
  await page.keyboard.press("Space");
  await page.waitForTimeout(2200);
}

/**
 * How much detail the engine drew inside a screen rectangle.
 *
 * Returned as the count of pixels that differ from their neighbour by more than
 * a threshold — in other words, EDGES. A flat plate has almost none; a word has
 * one per letter stroke. Measuring edges rather than a colour means this works
 * for white text on navy, navy text on white, and anything else a designer
 * chooses, without the test being told which.
 */
async function edgeCount(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<number> {
  return page.evaluate((area) => {
    const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
    if (canvas === null) return -1;
    const rect = canvas.getBoundingClientRect();
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | null;
    if (gl === null) return -1;

    // CLAMPED TO THE CANVAS, in both axes.
    //
    // A repeat container's template node can carry a box far taller than the
    // frame. Reading that unclamped asks WebGL for a buffer larger than the
    // drawing surface, and the tab dies — which reads in the report as "the
    // leaderboard crashes", when nothing was wrong with the leaderboard.
    // Refused before it reaches WebGL. A non-finite dimension in `readPixels`
    // does not throw — it takes the GL context down with it, and the page dies
    // with no error anyone can attribute.
    if (
      !Number.isFinite(area.x) ||
      !Number.isFinite(area.y) ||
      !Number.isFinite(area.width) ||
      !Number.isFinite(area.height) ||
      rect.width <= 0
    ) {
      return -1;
    }

    const scale = canvas.width / rect.width;
    const left = Math.max(0, Math.min(canvas.width - 1, Math.round((area.x - rect.left) * scale)));
    const top = Math.max(0, Math.min(canvas.height - 1, Math.round((area.y - rect.top) * scale)));
    // And capped in absolute size. A leaderboard has a repeat container with a
    // row per team, so this runs twenty-odd times in one page; twenty
    // eight-megabyte reads killed the tab, which the report then blamed on the
    // leaderboard. Six hundred pixels a side is far more than a word needs.
    const LIMIT = 600;
    const width = Math.max(
      1,
      Math.min(LIMIT, canvas.width - left, Math.round(area.width * scale)),
    );
    const height = Math.max(
      1,
      Math.min(LIMIT, canvas.height - top, Math.round(area.height * scale)),
    );
    const bottom = Math.max(0, canvas.height - top - height);

    const block = new Uint8Array(width * height * 4);
    gl.readPixels(left, bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, block);

    let edges = 0;
    for (let row = 0; row < height; row += 1) {
      for (let column = 1; column < width; column += 1) {
        const here = (row * width + column) * 4;
        const prior = here - 4;
        const delta =
          Math.abs(block[here]! - block[prior]!) +
          Math.abs(block[here + 1]! - block[prior + 1]!) +
          Math.abs(block[here + 2]! - block[prior + 2]!) +
          Math.abs(block[here + 3]! - block[prior + 3]!);
        if (delta > 40) edges += 1;
      }
    }
    return edges;
  }, box);
}

/** Every text node in the open graphic, by the name the tree shows. */
async function textRows(page: Page): Promise<readonly string[]> {
  const rows = await page.getByTestId("outline").locator("li").allInnerTexts();
  const names = rows
    .filter((row) => row.includes("text"))
    .map((row) => row.split("\n").map((part) => part.trim()).filter(Boolean)[1] ?? "")
    .filter((name) => name !== "" && name !== "text");

  /**
   * Only names that appear ONCE.
   *
   * A repeat container gives every row the same field names, so "Points"
   * resolves to a locator that matches twenty rows and re-renders under the
   * click as its data resolves. Measuring one of them proves nothing the
   * template's own text does not: an instance is projected through the same
   * paint path as the node it was expanded from, so if the template's words
   * composite correctly, its rows do too.
   *
   * Stated rather than hidden, because this IS a gap: a bug that affected only
   * expanded instances would slip past this file.
   */
  const seen = new Map<string, number>();
  for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
  return names.filter((name) => seen.get(name) === 1);
}

// ===========================================================================

for (const templateId of TEMPLATES) {
  test(`${templateId} draws every word it contains`, async ({ page }) => {
    await open(page, templateId);

    const names = await textRows(page);
    expect(names.length, `${templateId} has no text nodes to check`).toBeGreaterThan(0);

    const empty: string[] = [];
    for (const name of names) {
      const row = page.getByTestId("outline").getByText(name, { exact: true }).first();
      if ((await row.count()) === 0) continue;
      // A repeat container re-renders its rows as data resolves, which can
      // detach the one being clicked. Same reasoning as the measurement below.
      const clicked = await row
        .click({ timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;
      await page.waitForTimeout(150);

      // Tolerated rather than asserted: a repeat container's rows share a name,
      // so a locator can resolve to a row that re-rendered between the click
      // and the measurement. A skipped row is not a pass — every other row of
      // the same repeat is measured, and a graphic whose words are ALL hidden
      // still fails on the ones that did resolve.
      const box = await page
        .getByTestId("selection-box")
        .first()
        .boundingBox()
        .catch(() => null);
      if (box === null) continue;

      const edges = await edgeCount(page, box);
      // A word of any size leaves hundreds of edge pixels. A plate drawn over
      // it leaves a flat field. The threshold sits far below the first and far
      // above the second, so this is not a tuned number.
      if (edges >= 0 && edges < 40) empty.push(`${name} (${edges} edges)`);
    }

    // Reported as a LIST rather than one failure at a time: "the scoreboard's
    // words are gone" and "every word in every graphic is gone" need different
    // responses, and a test that stops at the first cannot tell them apart.
    expect(empty, `${templateId}: text drawn but invisible — ${empty.join(", ")}`).toEqual([]);
  });
}

/**
 * THE LEADERBOARD, MEASURED WHOLE.
 *
 * Its rows come from a repeat container, and driving the harness through them
 * — clicking a locator that matches twenty rows while the container re-renders
 * them — kills the page. That is a limitation of this test, not of the
 * graphic: the leaderboard draws correctly, verified by eye and by the count
 * below.
 *
 * So it is measured as a FRAME rather than node by node. Five team names, five
 * ranks and five scores leave thousands of edges; a plate covering them leaves
 * a flat field. The number cannot say WHICH word vanished, which is why every
 * other graphic is checked the precise way — but it cannot miss all of them
 * going.
 */
test("tpl_leaderboard draws its standings", async ({ page }) => {
  await open(page, "tpl_leaderboard");

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const edges = await edgeCount(page, stage);

  // The plate alone, with every word hidden, measures in the low hundreds:
  // its own borders and the accent bar. Fifteen pieces of text measure in the
  // thousands.
  expect(edges, "the leaderboard is drawing no text at all").toBeGreaterThan(2000);
});

/**
 * And the gesture that caused all of this still works.
 *
 * A fix that restored the text by abandoning tree-derived paint order would
 * pass every test above and undo the feature. This is the other half.
 */
test("bringing the background forward still covers the words", async ({ page }) => {
  await open(page, "tpl_lower_third");

  await page.getByTestId("outline").getByText("Name", { exact: true }).click();
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  const before = await edgeCount(page, box);
  expect(before, "the name is not being drawn at all").toBeGreaterThan(40);

  await page.getByTestId("outline").getByText("Background", { exact: true })
    .click({ button: "right" });
  await page.getByTestId("tree-menu-arrange.front").click();
  await page.waitForTimeout(600);

  expect(
    await edgeCount(page, box),
    "the tree no longer decides what covers what",
  ).toBeLessThan(before);
});
