import { expect, test, type Page } from "@playwright/test";

/**
 * Preview and Program, and the discipline of what does NOT move.
 *
 * ============================================================================
 * THE STATES ARE SPECIFIED, SO THEY ARE TESTED AS SPECIFIED
 * ============================================================================
 * Most of these assertions are negative, and that is the point:
 *
 *   CUE   the preview monitor gains a teal edge. The program monitor does not
 *         change IN ANY WAY, because nothing has happened to the show.
 *   TAKE  the program monitor takes the red edge and the clock starts.
 *   OFF   preview goes away, the feed goes CLEAN, and the closure states what
 *         the show actually did.
 *
 * A build where cue quietly nudged program would pass every positive
 * assertion here and would be a build that lies about what is on air.
 */
async function openProduction(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("monitors")).toBeVisible();
}

test("two monitors, named, with the state of each", async ({ page }) => {
  await openProduction(page);

  await expect(page.getByTestId("monitor-preview")).toBeVisible();
  await expect(page.getByTestId("monitor-program")).toBeVisible();
  await expect(page.getByTestId("preview-label")).toContainText("PREVIEW");
  await expect(page.getByTestId("program-label")).toContainText("PROGRAM");

  // Nothing armed, nothing out.
  await expect(page.getByTestId("preview-state")).toHaveText("READY");
  // CLEAN is the broadcast word for a feed carrying nothing, and it is what
  // an operator would say.
  await expect(page.getByTestId("program-state")).toHaveText("CLEAN");
});

test("cue arms preview and leaves program completely alone", async ({ page }) => {
  await openProduction(page);
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "no");

  await page.getByTestId("cue").click();

  await expect(page.getByTestId("preview-state")).toHaveText("CUED");
  await expect(page.getByTestId("monitor-preview")).toHaveAttribute("data-cued", "yes");

  // THE NEGATIVE ASSERTION. Cue is fully reversible, so it needs no
  // confirmation, no warning and no guard — and it says so by being quiet.
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "no");
  await expect(page.getByTestId("program-state")).toHaveText("CLEAN");
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "cued");

  // And it is reversible, from the same key.
  await page.getByTestId("cue").click();
  await expect(page.getByTestId("preview-state")).toHaveText("READY");
});

test("take puts the red edge on program and starts the clock", async ({ page }) => {
  await openProduction(page);
  await page.getByTestId("take").click();

  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "yes");
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "live");

  // The clock is real. It starts at the cut and it advances.
  await expect(page.getByTestId("program-state")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect
    .poll(async () => page.getByTestId("program-state").textContent(), { timeout: 8_000 })
    .not.toBe("00:00:00");
});

test("off air goes clean, and states what the show did", async ({ page }) => {
  await openProduction(page);
  await page.getByTestId("take").click();
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "yes");
  await page.getByTestId("off-air").click();

  // Preview is gone — there is nothing left to arm.
  await expect(page.getByTestId("monitor-preview")).toHaveCount(0);
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "no");

  // The closure counts what actually happened, from the thing that did it.
  await expect(page.getByTestId("closure")).toBeVisible();
  await expect(page.getByTestId("closure-takes")).toHaveText("1");
  await expect(page.getByTestId("closure-duration")).toHaveText(/^\d+:\d{2}:\d{2}$/);
});

test("the count is takes that reached air, not cues that were armed", async ({ page }) => {
  await openProduction(page);

  // Arm and disarm twice. Neither reached air, so neither counts.
  await page.getByTestId("cue").click();
  await page.getByTestId("cue").click();
  await page.getByTestId("cue").click();
  await page.getByTestId("cue").click();

  await page.getByTestId("take").click();
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "yes");
  await page.getByTestId("off-air").click();

  await expect(
    page.getByTestId("closure-takes"),
    "a cue that was disarmed never went out and must not inflate the count",
  ).toHaveText("1");
});
