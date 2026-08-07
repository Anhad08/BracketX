import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The confidence strip, in the real application.
 *
 * ============================================================================
 * WHAT ONLY A BROWSER CAN PROVE HERE
 * ============================================================================
 * The arithmetic is covered in `formats.test.ts` against a live host. What that
 * cannot show is the part that makes the strip worth having: that the tiles
 * carry THE ENGINE'S OWN PIXELS. A strip that computed every finding correctly
 * and drew nothing would pass every unit test in the repository, and would be
 * a status line with an identity crisis.
 *
 * So this reads the tile canvases back and requires them to be non-empty, and
 * requires the 9:16 tile to differ from the 16:9 one — because a crop that
 * silently returned the same picture would look plausible and report a format
 * nobody is actually seeing.
 */
async function openLowerThird(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Name", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** Non-transparent pixels in a tile, and a cheap fingerprint of them. */
async function tilePixels(
  page: Page,
  id: string,
): Promise<{ opaque: number; signature: string }> {
  return page.getByTestId(`conf-${id}`).locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    let sum = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! > 8) {
        opaque += 1;
        sum += data[index]! + data[index + 1]! + data[index + 2]! + index;
      }
    }
    return { opaque, signature: `${canvas.width}x${canvas.height}:${opaque}:${sum}` };
  });
}

test("every delivery format is shown at once, with the engine's own pixels", async ({
  page,
}) => {
  await openLowerThird(page);
  const strip = page.getByTestId("conf-strip");
  await expect(strip).toBeVisible();

  // The primary is IN the list, not above it. The recorded failure this stops
  // is "a clipped name on the main canvas with no warning anywhere".
  await expect(page.getByTestId("conf-primary")).toBeVisible();
  for (const id of ["2160", "720", "vertical", "sd"]) {
    await expect(page.getByTestId(`conf-${id}`)).toBeVisible();
  }

  // The pixels have to arrive. The strip repaints on a cadence, so this waits
  // for a frame rather than assuming one has already landed.
  await expect
    .poll(async () => (await tilePixels(page, "primary")).opaque, { timeout: 15_000 })
    .toBeGreaterThan(0);

  // And 9:16 must be a DIFFERENT picture from 16:9 — it is a narrower window on
  // the same world, so it shows less of the graphic. Identical bytes would mean
  // the crop is not being applied and the tile is reporting a format nobody is
  // looking at.
  const wide = await tilePixels(page, "primary");
  const tall = await tilePixels(page, "vertical");
  expect(tall.opaque).toBeGreaterThan(0);
  expect(
    tall.signature,
    "a 9:16 tile that matched 16:9 byte for byte is not showing 9:16",
  ).not.toBe(wide.signature);
});

test("a graphic that fits in 16:9 and not in 9:16 says so, on the tile that breaks", async ({
  page,
}) => {
  await openLowerThird(page);

  // The lower third's name box is 8.4 units wide. Title safe at 9:16 is 5.06
  // units wide at this camera, so the words cannot fit — while 16:9 has room
  // to spare. One graphic, two verdicts, and nothing about the document
  // changed between them.
  await expect(page.getByTestId("conf-primary")).toHaveAttribute("data-warn", "no");
  await expect(page.getByTestId("conf-2160")).toHaveAttribute("data-warn", "no");
  await expect(page.getByTestId("conf-vertical")).toHaveAttribute("data-warn", "yes");

  // The lamp says which layer, in the author's words, not a node id.
  await expect(page.getByTestId("conf-vertical")).toHaveAttribute(
    "title",
    /Name: (Crosses title safe|Outside the frame)/,
  );
});

test("the primary is checked on the same terms as the secondaries", async ({ page }) => {
  await openLowerThird(page);
  await expect(page.getByTestId("conf-primary")).toHaveAttribute("data-warn", "no");

  // Push the name out of the frame. If the primary were exempt — the failure
  // the prototype records beside this feature — it would stay green while the
  // main canvas showed a clipped name.
  await page.getByTestId("outline").getByText("Name", { exact: true }).click();
  const x = page.getByTestId("inspector").getByLabel("position x");
  await x.fill("20");
  await x.blur();

  await expect(page.getByTestId("conf-primary")).toHaveAttribute("data-warn", "yes", {
    timeout: 10_000,
  });
});

test("clicking a warning selects the layer it is about", async ({ page }) => {
  await openLowerThird(page);

  // Deselect first, so the assertion cannot pass on a stale selection.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("inspector").getByLabel("Name")).toHaveValue("Accent Bar");

  await page.getByTestId("conf-vertical").click();
  await expect(
    page.getByTestId("inspector").getByLabel("Name"),
    "a warning you cannot act on from where you read it is a warning you read twice",
  ).toHaveValue("Name");
});
