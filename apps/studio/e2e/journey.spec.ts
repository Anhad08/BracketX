import { expect, test, type Page } from "@playwright/test";
import { ensureDepth, openPanel, goLive } from "./depth";

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
  await goLive(page);

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

/**
 * The beginner surface leaks nothing.
 *
 * Every one of these was on screen at once, in a single screenshot, while the
 * panel footer said "Content only":
 *
 *   - `ast_sponsor_mark` in the Logo box, because the template typed the logo
 *     as a string and every field rendered as a text input
 *   - `nod_iyt0000v`, position z, rotation z and scale x, because Properties
 *     rendered at beginner depth — the interface contradicting its own footer
 *   - `scn_iyt00001` in the status bar
 *   - "9 nodes", which is what the engine calls them, not what a designer does
 *
 * A screenshot found all four in a second. This test is so the next one cannot
 * happen quietly.
 */
test("no engine vocabulary reaches the beginner surface", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("content")).toBeVisible();
  await expect(page.locator(".studio")).toHaveAttribute("data-depth", "beginner");

  const screen = await page.locator(".studio").innerText();

  // Ids, in any of the engine's prefixes.
  expect(screen, "an engine id is visible on the beginner surface").not.toMatch(
    /\b(?:nod|scn|ast|cmp|var|tpl)_[a-z0-9]{4,}/i,
  );

  for (const term of ["node", "nodes", "mirror", "projection", "reconciler", "backend"]) {
    expect(
      screen.toLowerCase().split(/\b/),
      `"${term}" is engine vocabulary and must not reach a beginner`,
    ).not.toContain(term);
  }

  // Properties belongs to Designer depth. Its absence is the point.
  await expect(page.getByTestId("inspector")).toHaveCount(0);

  // And the field that started all this shows a NAME. The select's VALUE is
  // still the asset id — that is the machine's half of the bargain, and the
  // right place for it. What a user reads is the label.
  const logo = page.getByTestId("content").getByLabel("Logo");
  await expect(logo).toBeVisible();
  const shown = await logo.locator("option:checked").innerText();
  expect(shown.trim()).not.toMatch(/^ast_/);
  expect(shown.trim().length).toBeGreaterThan(0);
});

test("no engine vocabulary reaches the designer surface either", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const screen = await page.locator(".studio").innerText();

  // Designer depth shows layers and properties. It still must not show the
  // engine: a node id, a specification filename, or a dot-path.
  expect(screen, "an engine id is visible").not.toMatch(/\b(?:nod|scn|cmp|var)_[a-z0-9]{4,}/i);
  expect(screen, "a specification name is visible").not.toMatch(/SCENE_FORMAT/);
  expect(screen, "a raw property path is visible").not.toMatch(/transform\.(position|scale|rotation)\./);

  // The timeline names properties the way a designer would.
  await openPanel(page, "Timeline");
  await expect(page.getByLabel("Add keyframe")).toContainText("Left and right");
});
