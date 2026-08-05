import { expect, test } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The transform gizmo, in the real application.
 *
 * `transform.test.ts` proves the geometry. What only a browser can prove is
 * that the handles are DRAWN where they are HIT TESTED, that dragging one
 * changes the real document, and that the whole gesture is a single undo step.
 */
async function openLowerThird(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");

  // The layer tree is Designer depth. A beginner has no layers, by design.
  await ensureDepth(page, "designer");

  // Wait for the GRAPHIC, not for a duration. A fixed 900ms passed on a quiet
  // machine and failed under a full suite run, where the click landed before
  // the shell had finished booting and the studio opened on an empty document
  // — Root and Camera only. Waiting for the content that must exist is both
  // more honest and a stronger assertion than any timeout.
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test("selecting a node shows nine handles", async ({ page }) => {
  await openLowerThird(page);
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("gizmo")).toBeVisible();
  for (const id of ["nw", "n", "ne", "w", "e", "sw", "s", "se", "rotate"]) {
    await expect(page.getByTestId(`handle-${id}`)).toBeVisible();
  }
});

/**
 * The bug this defends against, and why the assertion is shaped this way.
 *
 * It once failed at 1280x720 with the bottom dock open: the view was 351px
 * tall while the frame at 52 % zoom was ~562px, so the graphic fell below the
 * visible area and its handles were DRAWN about ten pixels past the bottom of
 * `.scene-chrome`, the element that receives pointer events. They looked
 * correct and could not be grabbed. `recentre` now refits when the frame no
 * longer fits rather than holding a centre that has stopped being reachable.
 *
 * `data-drag` is asserted as well as the pixel delta because a delta alone
 * cannot tell "the handle was missed" from "the resize was small" — and that
 * ambiguity is precisely what hid the bug.
 */
test("dragging a handle resizes the real document, as one undo step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("gizmo")).toBeVisible();
  await page.waitForTimeout(400);

  const before = await page.getByTestId("handle-se").boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.move(before!.x + 3, before!.y + 3);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "resize");
  await page.mouse.move(before!.x + 90, before!.y + 50, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.getByTestId("handle-se").boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 20);

  // One gesture, one undo entry — the handle must return to where it started.
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(300);
  const undone = await page.getByTestId("handle-se").boundingBox();
  expect(Math.abs(undone!.x - before!.x)).toBeLessThan(4);

  expect(errors, errors.join("\n")).toEqual([]);
});
