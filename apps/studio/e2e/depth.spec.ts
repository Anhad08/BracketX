import { expect, test, type Page } from "@playwright/test";

/**
 * Enable 3D, in the real application.
 *
 * ============================================================================
 * WHAT ONLY A BROWSER CAN PROVE
 * ============================================================================
 * `finishes.test.ts` proves the document is correct after the press. What it
 * cannot prove is the thing the founder actually asked for:
 *
 *   "The first-time user should create a beautiful animated 3D lower third in
 *    under five minutes. Without understanding cameras. Without understanding
 *    lighting. Without understanding rendering."
 *
 * So this opens a template as a beginner, presses one button, and requires the
 * PICTURE to change — and to change into something lit rather than into black.
 * A lit surface in an unlit scene renders pure black, which is the single most
 * likely way this feature ships broken while every unit test passes.
 */
async function openLowerThird(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByTestId("content")).toBeVisible({ timeout: 30_000 });
}

/** Mean luminance of the rendered frame, and how much of it is not empty. */
async function frame(page: Page): Promise<{ lit: number; covered: number }> {
  return page.locator(".scene-surface canvas").evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const scratch = document.createElement("canvas");
    scratch.width = 160;
    scratch.height = 90;
    const context = scratch.getContext("2d")!;
    context.drawImage(source, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
    let sum = 0;
    let covered = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! <= 8) continue;
      covered += 1;
      sum += (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
    }
    return { lit: covered === 0 ? 0 : sum / covered, covered };
  });
}

test("one press turns a flat graphic into a lit solid", async ({ page }) => {
  await openLowerThird(page);

  const button = page.getByTestId("enable-3d");
  await expect(button).toHaveText("Enable 3D");
  await expect(button).toHaveAttribute("data-on", "no");
  // No finishes offered until there is something to finish.
  await expect(page.getByTestId("finishes")).toHaveCount(0);

  await expect.poll(async () => (await frame(page)).covered, { timeout: 15_000 }).toBeGreaterThan(0);
  const flat = await frame(page);

  await button.click();
  await expect(button).toHaveText("Back to flat");
  await expect(button).toHaveAttribute("data-on", "yes");

  // THE PICTURE CHANGED, and it did not go black. A lit surface with no light
  // renders pure black — this is the assertion that catches the feature
  // shipping "working" and invisible.
  await expect
    .poll(async () => (await frame(page)).lit, { timeout: 10_000 })
    .not.toBeCloseTo(flat.lit, 0);
  const solid = await frame(page);
  expect(solid.covered, "the graphic must still be on screen").toBeGreaterThan(0);
  expect(solid.lit, "a lit surface with no light renders black").toBeGreaterThan(8);
});

test("the finishes are named by outcome, and switching one repaints", async ({ page }) => {
  await openLowerThird(page);
  await page.getByTestId("enable-3d").click();

  const finishes = page.getByTestId("finishes");
  await expect(finishes).toBeVisible();
  // Broadcast is the default and is lit.
  await expect(page.getByTestId("finish-broadcast")).toHaveAttribute("aria-pressed", "true");

  // Not one PBR word anywhere on the beginner surface.
  const text = (await page.getByTestId("content").innerText()).toLowerCase();
  for (const word of ["metalness", "metallic", "roughness", "specular", "transmission", "pbr"]) {
    expect(text, `the content panel leaked "${word}"`).not.toContain(word);
  }

  await expect.poll(async () => (await frame(page)).covered, { timeout: 15_000 }).toBeGreaterThan(0);
  const broadcast = await frame(page);

  await page.getByTestId("finish-chrome").click();
  await expect(page.getByTestId("finish-chrome")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("finish-broadcast")).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await frame(page)).lit, { timeout: 10_000 })
    .not.toBeCloseTo(broadcast.lit, 0);
});

test("one undo puts the graphic back exactly as it was", async ({ page }) => {
  await openLowerThird(page);
  await expect.poll(async () => (await frame(page)).covered, { timeout: 15_000 }).toBeGreaterThan(0);

  // A settled baseline, not a first-paint one — see `stablePicture` in
  // orbit.spec.ts for why that distinction has already cost a day.
  let previous = await frame(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const next = await frame(page);
    if (Math.abs(next.lit - previous.lit) < 0.01 && next.covered === previous.covered) break;
    previous = next;
  }
  const before = previous;

  await page.getByTestId("enable-3d").click();
  await expect(page.getByTestId("enable-3d")).toHaveAttribute("data-on", "yes");

  // ONE undo. Depth, finish and the lighting the engine provisioned all go
  // together, or somebody who tried this is left with a light they never asked
  // for and no obvious way to remove it.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("enable-3d")).toHaveAttribute("data-on", "no");
  await expect
    .poll(async () => (await frame(page)).lit, { timeout: 10_000 })
    .toBeCloseTo(before.lit, 0);
});

test("the graphic cannot change shape while it is on air", async ({ page }) => {
  await openLowerThird(page);
  await page.getByTestId("nav-production").click();
  await page.getByTestId("take").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  await page.getByTestId("nav-design").click();
  await expect(
    page.getByTestId("enable-3d"),
    "changing a graphic's shape mid-transmission is not an edit, it is an incident",
  ).toBeDisabled();
});
