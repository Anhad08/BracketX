import { expect, test } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Styling, as a COMPLETE user capability.
 *
 * ============================================================================
 * WHY THIS TEST IS SHAPED AS A JOURNEY AND NOT AS SIX UNIT TESTS
 * ============================================================================
 * The engine's paint model was built first, pixel-tested, and reported as done.
 * By the acceptance rule the founder later stated — *do not report a capability
 * unless the user can actually use it* — that report was wrong: gradients,
 * rounded corners, strokes, shadows and glows all worked in the reconciler and
 * **nothing in Studio exposed them**, so no user could put a gradient on a
 * graphic.
 *
 * This file is the missing half of that claim. It does not test that a picker
 * renders. It follows the chain that makes the feature real:
 *
 *   open a template → style it → the picture changes → it persists →
 *   reopen it → cue → take → Program
 *
 * A link that breaks anywhere in that chain makes the whole feature untrue,
 * however well the pixels were tested in isolation.
 */
async function openLowerThird(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");

  // Waited on the STYLE PICKER, not the layer tree. The outline is Designer
  // depth — a beginner has no layers, by design — and the default depth is
  // beginner, so waiting for a layer row here times out on a perfectly healthy
  // app. Every test in this file failed on that before the picker was used
  // instead, which looked exactly like the app being broken.
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: 30_000 });
  // And on the picture, so a style change has something to alter.
  await expect(page.locator(".scene-surface canvas").first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * The rendered picture, as bytes.
 *
 * A screenshot of the CANVAS, not of the panel. Asserting that a button gained
 * an `on` class would pass while the renderer drew nothing — which is exactly
 * the gap this file exists to close.
 */
async function picture(page: import("@playwright/test").Page): Promise<Buffer> {
  const canvas = page.locator(".scene-surface canvas").first();
  await expect(canvas).toBeVisible();
  return canvas.screenshot();
}

test("a style reaches the picture, not just the panel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);

  const styles = page.getByTestId("graphic-styles");
  await expect(styles).toBeVisible();

  // A TEMPLATE NO LONGER SHIPS FLAT, and this expectation changed with it.
  // The shipped graphics now carry a plate paint of their own — gradient,
  // rounded corners, rim and shadow — because a flat rectangle is what a
  // placeholder looks like. So Flat must NOT be lit on open.
  //
  // Nothing is lit at all: the shipped paint is authored for the plate's role
  // rather than being one of the seven named styles, which `paintOf` correctly
  // reports as "adjusted by hand". Choosing a style still replaces it, which the
  // rest of this test exercises.
  await expect(page.getByTestId("graphic-style-flat")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const before = await picture(page);
  await page.getByTestId("graphic-style-elevated").click();
  await expect(page.getByTestId("graphic-style-elevated")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The paint is rasterised and uploaded, so give the frame time to land.
  await page.waitForTimeout(700);
  const after = await picture(page);

  // Gradient, rounded corners, rim highlight and a drop shadow — none of which
  // the engine could draw at all a milestone ago.
  expect(Buffer.compare(before, after), "the picture did not change").not.toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("every style is offered, and each one changes the picture", async ({ page }) => {
  await openLowerThird(page);

  // Not a smoke test of the list: each look must actually draw differently, or
  // two buttons are the same button with two names.
  const seen = new Map<string, string>();
  for (const id of ["flat", "soft", "elevated", "glass", "glow", "outlined", "pill"]) {
    const button = page.getByTestId(`graphic-style-${id}`);
    await expect(button, `${id} is not offered`).toBeVisible();
    await button.click();
    await page.waitForTimeout(600);
    const shot = (await picture(page)).toString("base64");
    for (const [other, bytes] of seen) {
      expect(shot, `${id} draws identically to ${other}`).not.toBe(bytes);
    }
    seen.set(id, shot);
  }
});

test("a style survives a save and a reopen", async ({ page }) => {
  await openLowerThird(page);

  await page.getByTestId("graphic-style-glass").click();
  await expect(page.getByTestId("graphic-style-glass")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(600);

  // Save through the real command, not a test hook.
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(1000);

  // Reload the whole application. Studio does NOT restore the open document on
  // reload — only the recents list persists — so reopening means what it means
  // for a user: come back to Home and pick the project up again. Asserting a
  // reload alone would have been asserting a feature the product does not have.
  await page.reload();
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });

  // The workspace persists which SECTION was open, so a reload lands back on
  // Design rather than Home — and the recents list lives on Home. Looking for a
  // recent project without navigating there first reports "the save produced no
  // recent project" when the save was fine.
  await page.getByTestId("nav-home").click();

  const recent = page.locator('[data-testid^="recent-"]').first();
  await expect(recent, "the save produced no recent project").toBeVisible({
    timeout: 15_000,
  });
  await recent.click();

  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: 30_000 });

  // The style came back from disk, not from memory.
  await expect(page.getByTestId("graphic-style-glass")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a styled graphic goes to air and reaches Program", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);

  await page.getByTestId("graphic-style-elevated").click();
  await page.waitForTimeout(600);

  // The one control on Design that mentions air hands over rather than doing it.
  await page.getByTestId("go-live").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "production");

  await page.getByTestId("take").click();
  await expect(page.getByTestId("air-state")).toHaveText(/ON AIR/);
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  // Program is a SECOND renderer of the same document. A paint that reached the
  // design viewport but not Program would be a graphic that looks right to the
  // designer and wrong to the audience — the worst possible failure here.
  const program = page.getByTestId("program-monitor");
  await expect(program).toBeVisible();
  await page.waitForTimeout(700);
  // The canvas is MOVED into the program monitor rather than recreated — a
  // backend binds to its canvas for the session (MirrorBackend C2) — so the
  // assertion is that the monitor is hosting one and drawing.
  await expect(program.locator("canvas")).toHaveCount(1);
  const shot = await program.screenshot();
  expect(shot.byteLength, "Program rendered nothing").toBeGreaterThan(1000);

  await page.getByTestId("off-air").click();
  await expect(page.getByTestId("air-state")).toHaveText(/Off air/);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("styling a selection is offered beside Material, in Designer depth", async ({ page }) => {
  await openLowerThird(page);
  // The per-node picker lives beside Material in the inspector, which only
  // Designer depth shows — so the depth switch is part of this test's subject,
  // not incidental setup.
  await ensureDepth(page, "designer");
  await expect(
    page.getByTestId("outline").getByText("Background", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("outline").getByText("Background", { exact: true }).click();

  // Two pickers, because they answer different questions: Material is what a
  // surface is made of under lights, Style is what the graphic looks like flat.
  await expect(page.getByTestId("styles")).toBeVisible();
  await page.getByTestId("style-soft").click();
  await expect(page.getByTestId("style-soft")).toHaveAttribute("aria-pressed", "true");

  // And it applied to THAT node only — the accent bar is untouched, so the
  // whole-graphic picker can no longer report a single shared style.
  await expect(page.getByTestId("graphic-style-soft")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("recolouring a theme rebuilds the gradients with it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);

  await page.getByTestId("graphic-style-soft").click();
  await page.waitForTimeout(700);
  const before = await picture(page);

  // The beginner COLOUR swatch — the gesture a broadcaster actually makes.
  const surface = page.getByTestId("token-color.surface");
  await expect(surface).toBeVisible();
  await surface.fill("#7a1030");
  await page.waitForTimeout(900);

  // A style is DERIVED from its colour, so recolouring must rebuild it. Without
  // that, the flat fill goes red and every gradient keeps describing the old
  // colour — and the picker then reports the style as hand-edited.
  expect(Buffer.compare(before, await picture(page)), "recolour changed nothing").not.toBe(0);
  await expect(page.getByTestId("graphic-style-soft")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // One undo step: the colour and the rebuild travel together, so a single undo
  // cannot leave the fill recoloured with stale gradients.
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(900);
  await expect(page.getByTestId("graphic-style-soft")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors, errors.join("\n")).toEqual([]);
});
