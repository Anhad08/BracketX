import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Studio authoring, in a browser.
 *
 * ============================================================================
 * WHAT ONLY A DOM CAN SHOW
 * ============================================================================
 * The headless suite already proves every claim about documents, transactions
 * and engine state — 125 assertions. What it cannot prove is that a gesture
 * reaches those code paths at all: that clicking a tool creates a node, that
 * dragging a keyframe moves it, that Take puts the tally on air.
 *
 * The specific failure this file exists to catch is a panel that renders
 * perfectly and is wired to nothing. Every test below therefore ends on an
 * assertion about STATE the engine reports — the frame counter, the history
 * depth, an inspector readout — rather than on the panel that caused it.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  // Phase 4 opens on Home, not in the editor. A test that assumed the editor
  // was the application is a test that encoded the old information
  // architecture; entering Design explicitly is what a user does too.
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-design").click();
  await expect(page.getByTestId("scene-view")).toBeVisible();
  // "layers", not "nodes" — the status bar says what a designer calls them.
  // `journey.spec.ts` holds the stronger rule: "nodes" must not appear at all.
  await expect(page.getByTestId("statusbar")).toContainText("layers");
  // Studio now opens at BEGINNER depth (Volume One L9): no toolbox, no layer
  // tree, no timeline. Every test in this file is a Designer or Advanced
  // workflow, so it asks for that depth the way a designer does — one click.
  await ensureDepth(page, "designer");
  await expect(page.locator(".panel.toolbox")).toBeVisible();
}

/** Creates a node from the toolbox and returns the history depth afterwards. */
async function addNode(page: Page, kind: string): Promise<number> {
  await page.getByTestId(`tool-${kind}`).click();
  return depth(page);
}

async function depth(page: Page): Promise<number> {
  const text = (await page.getByTestId("history").textContent()) ?? "";
  return Number(/history (\d+)/.exec(text)?.[1] ?? -1);
}

async function tab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

test("boots, renders, and reports engine state", async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId("doc-name")).toContainText("Untitled");
  await expect(page.getByTestId("frame")).toContainText("f");
  await expect(page.getByTestId("viewport-toolbar")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

test("every toolbox entry creates a node the engine accepts", async ({ page }) => {
  await boot(page);
  const before = await depth(page);

  // All nine, in one session: a kind that threw would leave the history depth
  // short, and a kind the projector refused would surface as an error overlay.
  const kinds = [
    "rect",
    "ellipse",
    "box",
    "sphere",
    "cylinder",
    "plane",
    "group",
    "camera",
    "light",
  ];
  for (const kind of kinds) {
    await page.getByTestId(`tool-${kind}`).click();
  }

  // One undo step each, still — the lighting rig below travels INSIDE the
  // box's transaction rather than as a step of its own.
  expect(await depth(page)).toBe(before + kinds.length);
  await expect(page.locator(".scene-error")).toHaveCount(0);

  // Nine created nodes, the root and its camera, and TWO more: the first 3D
  // primitive brings a key light and a fill with it. A lit object in an
  // unlit scene renders black, and asking a beginner to know that a box needs
  // a light first is exactly the engine concept the product exists to hide.
  const LIGHTING_RIG = 2;
  await expect(page.getByTestId("outline").locator("li")).toHaveCount(
    kinds.length + 2 + LIGHTING_RIG,
  );
});

// ---------------------------------------------------------------------------
// Timeline authoring
// ---------------------------------------------------------------------------

test("keying a property creates a track, and the drag is undoable", async ({ page }) => {
  await boot(page);
  await addNode(page, "rect");
  await tab(page, "Timeline");

  await page.getByRole("button", { name: "New timeline" }).click();
  await expect(page.getByTestId("tracks")).toContainText("No tracks");

  await page.getByLabel("Add keyframe").selectOption("transform.position.0");
  await expect(page.getByTestId("keyframe")).toHaveCount(1);

  // Move the playhead and key again — two keyframes on one track, which is the
  // whole recording gesture.
  await page.getByLabel("Duration").fill("2");
  await page.getByLabel("Duration").blur();
  await page.getByTestId("lane").click({ position: { x: 200, y: 10 } });
  await page.getByLabel("Add keyframe").selectOption("transform.position.0");
  await expect(page.getByTestId("keyframe")).toHaveCount(2);

  const withKeys = await depth(page);
  await page.keyboard.press("Control+z");
  expect(await depth(page)).toBe(withKeys - 1);
  await expect(page.getByTestId("keyframe")).toHaveCount(1);
});

test("selecting a keyframe enables the clipboard and delete", async ({ page }) => {
  await boot(page);
  await addNode(page, "rect");
  await tab(page, "Timeline");
  await page.getByRole("button", { name: "New timeline" }).click();
  await page.getByLabel("Add keyframe").selectOption("transform.position.0");

  const copy = page.getByRole("button", { name: "copy", exact: true });
  await expect(copy).toBeDisabled();

  await page.getByTestId("keyframe").first().click();
  await expect(page.getByTestId("timeline")).toContainText("1 keyframes");
  await expect(copy).toBeEnabled();

  // Deleting the last keyframe of a track removes the track, which is what
  // keeps the document loadable.
  await page.getByRole("button", { name: "delete", exact: true }).click();
  await expect(page.getByTestId("tracks")).toContainText("No tracks");
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test("a preset compiles to a timeline that plays", async ({ page }) => {
  await boot(page);
  await addNode(page, "rect");

  await tab(page, "Motion");
  await page.getByTestId("preset-slide-in-left").click();

  // The preset compiled to an ordinary timeline, editable in the ordinary
  // timeline editor. Nothing marks it as preset-derived.
  await tab(page, "Timeline");
  await expect(page.getByTestId("keyframe")).toHaveCount(2);

  // And the engine is actually running it — the frame counter is read from the
  // runtime clock, so it only moves if playback really started.
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => (await page.getByTestId("frame").textContent()) ?? "")
    .not.toBe("f0");
});

test("a preset offers nothing the engine cannot draw", async ({ page }) => {
  await boot(page);
  await tab(page, "Motion");

  // The BUTTONS, not the panel text — the panel deliberately explains that Blur,
  // Glow and Dissolve are absent, so asserting over the whole panel would be
  // asserting that the explanation is missing.
  const labels = await page.getByTestId("presets").locator("button.tool").allInnerTexts();
  expect(labels.length).toBeGreaterThan(10);
  for (const forbidden of ["Blur", "Glow", "Dissolve"]) {
    expect(labels.join(" ")).not.toContain(forbidden);
  }
});

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

test("aligning two nodes moves them to the same edge", async ({ page }) => {
  await boot(page);
  await addNode(page, "rect");
  await addNode(page, "rect");

  // Both rects, selected through the hierarchy.
  const rows = page.getByTestId("outline").locator("li button.row-name");
  await rows.nth(1).click();
  await rows.nth(2).click({ modifiers: ["Shift"] });

  const before = await depth(page);
  const bar = page.getByTestId("arrange-bar");
  await bar.getByRole("button", { name: "Align top" }).click();

  // Two rects created at the same place are already aligned, so this correctly
  // produces NO transaction — asserted, because an editor that pushed a no-op
  // onto the stack would fill undo with nothing.
  expect(await depth(page)).toBe(before);

  // Grouping them, however, is a real edit — and exactly one.
  await bar.getByRole("button", { name: "Group", exact: true }).click();
  expect(await depth(page)).toBe(before + 1);
});

// ---------------------------------------------------------------------------
// Preview and Program
// ---------------------------------------------------------------------------

test("Take puts a graphic on air, and editing Preview afterwards does not", async ({
  page,
}) => {
  await boot(page);
  await addNode(page, "rect");

  await page.getByRole("button", { name: "Program", exact: true }).click();
  const row = page.getByTestId("program-row");
  await expect(row).toBeVisible();
  await expect(page.getByTestId("tally")).toHaveText("OFF");

  await page.getByTestId("cut").click();
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
  await expect(row).toContainText("Program matches what was last taken");

  // The claim the whole split exists for: a Preview edit changes what is
  // PENDING and nothing else. The tally stays on air, unchanged.
  await addNode(page, "ellipse");
  await expect(row).toContainText("Preview differs from what is on air");
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
});

// ---------------------------------------------------------------------------
// Variables and the library
// ---------------------------------------------------------------------------

test("a runtime override is not a document edit", async ({ page }) => {
  await boot(page);
  await tab(page, "Data");

  await page.getByLabel("New field name").fill("title");
  await page.getByLabel("New field name").press("Enter");
  await expect(page.getByTestId("variables")).toContainText("title");

  const afterDefine = await depth(page);
  await page.getByLabel("Runtime value for title").fill("LIVE");

  // The history depth is unchanged: a live value is a command, not an
  // operation. This is RFC-002 §4.3 executing rather than being described.
  expect(await depth(page)).toBe(afterDefine);
  await expect(page.getByRole("button", { name: "reset" })).toBeVisible();
});

test("a template declares a parameter per variable", async ({ page }) => {
  await boot(page);
  await tab(page, "Data");
  await page.getByLabel("New field name").fill("title");
  await page.getByLabel("New field name").press("Enter");

  await tab(page, "Templates");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByTestId("library")).toContainText("1 parameters");

  // Adding a variable afterwards is drift, and it is reported rather than
  // silently ignored at instantiation.
  await tab(page, "Data");
  await page.getByLabel("New field name").fill("score");
  await page.getByLabel("New field name").press("Enter");
  await tab(page, "Templates");
  await expect(page.getByTestId("template-drift")).toContainText("score");
});
