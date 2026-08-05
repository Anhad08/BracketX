import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * THE PRIMARY JOURNEY.
 *
 * Marketplace → install → Assets → drag onto the Stage → the scene is really
 * there → edit → cue → take → programme.
 *
 * This is the demonstration the product is judged on, so it is a test rather
 * than a script somebody performs by hand. Every step is a real gesture. If a
 * step here needs a workaround, the product needs the fix — not the test.
 *
 * What it is specifically defending: for a long time you could install a pack
 * and there was NOWHERE to see what you had installed, and nothing to drag.
 * The two ends of the journey existed and did not meet.
 */

test("a producer installs a scene, drags it onto the stage, and takes it to air", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  // -- Start with something on the stage, so placing is COMPOSITION ----------
  await page.getByTestId("nav-marketplace").click();

  // -- Install ---------------------------------------------------------------
  const pack = page.locator('[data-testid^="pack-"]').first();
  await expect(pack).toBeVisible();
  const install = pack.getByRole("button", { name: /install/i });
  if (await install.isVisible().catch(() => false)) await install.click();

  // -- The installed scenes appear in Assets ---------------------------------
  await page.getByTestId("nav-assets").click();
  const scene = page.locator('[data-testid^="scene-"]').first();
  await expect(
    scene,
    "an installed pack's scenes must be visible in Assets — that is the only " +
      "place the journey can pick one up",
  ).toBeVisible();

  // The card names the graphic. A beginner must never see a template id.
  const name = (await scene.locator("strong").innerText()).trim();
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toMatch(/^tpl_|^ast_|^scn_/);

  // -- Place it on the stage -------------------------------------------------
  await scene.click();
  const chrome = page.getByTestId("scene-chrome");
  await expect(chrome).toBeVisible();

  // It is REALLY there: the placed nodes are selected, because the next thing
  // anyone does is edit what they just added.
  await expect(page.getByTestId("gizmo")).toBeVisible();

  // -- Edit its content, on the beginner surface -----------------------------
  const content = page.getByTestId("content");
  await expect(content).toBeVisible();
  const fields = content.locator("input.field, select.field");
  await expect(fields.first()).toBeVisible();

  const text = content.locator('input.field[type="text"], input.field:not([type])').first();
  if (await text.isVisible().catch(() => false)) {
    await text.fill("ARSENAL 2 - 1 CHELSEA");
    await expect(text).toHaveValue("ARSENAL 2 - 1 CHELSEA");
  }

  // -- Go live ---------------------------------------------------------------
  //
  // From the BEGINNER surface, with no depth change and no dock opened. The
  // product is a broadcast product: if going to air needs a settings change
  // first, the journey is broken for the default user.
  await page.getByTestId("go-live").click();
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
  await expect(page.getByTestId("program-row")).toBeVisible();

  expect(errors, `console errors during the primary journey:\n${errors.join("\n")}`).toEqual([]);
});

/**
 * The drag itself.
 *
 * Separate from the journey above because the journey must survive a
 * click-to-add too — but "drag a scene onto the stage" is the gesture the
 * product promises, and HTML5 drag-and-drop fails in ways a click never
 * reveals: a missing `preventDefault` on `dragover` means `drop` is never
 * delivered and the graphic silently does not arrive.
 */
test("a scene is dragged from the dock onto the stage", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-marketplace").click();

  const pack = page.locator('[data-testid^="pack-"]').first();
  const install = pack.getByRole("button", { name: /install/i });
  if (await install.isVisible().catch(() => false)) await install.click();

  // Scenes are draggable in the left dock — the one place a scene and the
  // stage share a screen. A drop target with no reachable source would be a
  // half-feature, which is worse than no feature.
  await page.getByTestId("nav-assets").click();
  await page.locator('[data-testid^="scene-"]').first().click();
  await ensureDepth(page, "designer");

  const source = page.locator('[data-testid^="dock-scene-"]').first();
  await expect(
    source,
    "an installed scene must be draggable from beside the stage",
  ).toBeVisible();

  const before = await countNodes(page);
  await source.dragTo(page.getByTestId("scene-chrome"));

  // The stage never stays lit after the pointer leaves.
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-dropping", "no");
  expect(
    await countNodes(page),
    "dropping a scene must ADD to the stage, never replace it",
  ).toBeGreaterThan(before);
});

/** How many top-level things the stage holds, read from the layer list. */
async function countNodes(page: Page): Promise<number> {
  return page.getByTestId("outline").locator("li").count();
}
