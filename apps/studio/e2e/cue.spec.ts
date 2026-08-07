import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Air has three states, and the middle one is the point.
 *
 * ============================================================================
 * WHAT THIS IS GUARDING
 * ============================================================================
 * `cued` is the state where a graphic is armed and NOTHING IS GOING OUT. It is
 * only worth having if that is visibly, unmistakably true — so these assert the
 * negative as hard as the positive: cueing must not light the spine red, must
 * not put ON AIR on the rail, and must not transmit a frame.
 *
 * A cue that looked like air would be worse than no cue at all.
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

test("cueing arms the graphic and airs nothing", async ({ page }) => {
  await openLowerThird(page);
  await expect(page.getByTestId("spine")).toHaveAttribute("data-air", "off");

  await page.keyboard.press("c");

  await expect(page.getByTestId("rail-tally")).toHaveText("CUED");
  await expect(page.getByTestId("rail-tally")).toHaveAttribute("data-air", "cued");
  // The spine is the tally. It is teal when armed and red ONLY when live —
  // red across the top of the application must go on meaning exactly one
  // thing.
  await expect(page.getByTestId("spine")).toHaveAttribute("data-air", "cued");

  // And Production agrees, because both surfaces drive one bus.
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("air-state")).toHaveAttribute("data-air", "cued");
  await expect(page.getByTestId("air-state")).toContainText("CUED");
  await expect(page.getByTestId("cue")).toHaveAttribute("data-armed", "yes");
});

test("escape un-cues, and only when something is armed", async ({ page }) => {
  await openLowerThird(page);

  // With nothing armed, Escape is still the deselect key. A contested chord
  // that stole the key outright would break selection everywhere.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("gizmo")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("gizmo")).toHaveCount(0);

  await page.keyboard.press("c");
  await expect(page.getByTestId("rail-tally")).toHaveText("CUED");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rail-tally")).toHaveText("OFF");
  await expect(page.getByTestId("spine")).toHaveAttribute("data-air", "off");
});

test("a take consumes the cue and is the only thing that reaches air", async ({ page }) => {
  await openLowerThird(page);
  await page.keyboard.press("c");
  await expect(page.getByTestId("rail-tally")).toHaveText("CUED");

  await page.getByTestId("nav-production").click();
  await page.getByTestId("take").click();

  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
  await expect(page.getByTestId("spine")).toHaveAttribute("data-air", "live");
  // The cue is spent. A transport still showing CUED after the take would be
  // armed for a graphic that has already gone out.
  await expect(page.getByTestId("cue")).toHaveAttribute("data-armed", "no");
  await expect(page.getByTestId("cue")).toBeDisabled();

  await page.getByTestId("off-air").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("OFF");
  await expect(page.getByTestId("spine")).toHaveAttribute("data-air", "off");
});

test("says so when the graphic changed after it was cued", async ({ page }) => {
  await openLowerThird(page);
  await page.getByTestId("nav-production").click();
  await page.getByTestId("cue").click();
  await expect(page.getByTestId("cue-stale")).toHaveCount(0);

  // Edit the graphic after arming it. Taking something you checked and airing
  // something you did not is the failure this makes visible.
  await page.getByTestId("nav-design").click();
  const nameField = page.getByTestId("content").getByLabel("Name");
  await nameField.fill("SOMEBODY ELSE");
  await nameField.blur();

  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("cue-stale")).toBeVisible();
});
