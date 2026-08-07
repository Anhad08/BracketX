import { expect, test, type Page } from "@playwright/test";
import { PACKS } from "../src/studio/packs";
import { ensureDepth, openPanel } from "./depth";

/**
 * Phase 4 in a browser — Studio as a product.
 *
 * ============================================================================
 * THE SUCCESS CRITERION, EXECUTED
 * ============================================================================
 * The brief states it as a workflow, so it is tested as one:
 *
 *   > Within 30 seconds a new user should be capable of: creating a lower
 *   > third, changing colours, replacing a logo, editing text, previewing,
 *   > taking it live — without reading documentation.
 *
 * Five of those six steps run below, in one test, in order, with no
 * intermediate knowledge. **Replacing a logo is absent because the engine
 * cannot draw an image** (IF-005); it is called out here rather than quietly
 * omitted, because a suite that silently drops a requirement is how a gap
 * survives a phase.
 *
 * The rest of the file guards the rules Phase 4 introduced: the engine does not
 * leak, Developer Mode reveals it, and browsing costs no rendering.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("home")).toBeVisible();
}

/** Console errors fail a test. A shader or asset failure logs one. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

// ===========================================================================
// The criterion
// ===========================================================================

test("a first-time user gets a lower third on air", async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page);

  // 1. CREATE. It is on Home, above the fold, named in plain words.
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("doc-name")).toContainText("Lower Third");

  // 2. CHANGE COLOURS. One click in the Marketplace restyles the whole graphic.
  await page.getByTestId("nav-marketplace").click();
  await page.getByTestId("pack-pack_theme_broadcast_red").getByRole("button", { name: "Apply" }).click();
  await page.getByTestId("nav-design").click();
  // Studio opens at BEGINNER depth (Volume One L9). These are Designer
  await ensureDepth(page, "designer");

  // 3. EDIT TEXT.
  //
  // Selecting the layer by its NAME shows that the text comes from a field
  // rather than from the layer — which is what makes a template a template. The
  // inspector says so, and says where to change it.
  await page.getByTestId("outline").getByRole("button", { name: /Name/ }).first().click();
  await expect(page.getByTestId("inspector")).toContainText("comes from the");
  await expect(page.getByTestId("inspector")).toContainText("Change it in");

  await openPanel(page, "Data");
  const field = page.getByTestId("variables").getByLabel("Default for name");
  await field.fill("MO SALAH");
  await field.blur();
  await expect(field).toHaveValue("MO SALAH");

  // 4. PREVIEW, and 5. TAKE IT LIVE.
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("program-state")).toHaveText("CLEAN");
  await page.getByTestId("take").click();
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "live");
  // The rail says so too, so an operator never has to navigate to find out.
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  // 6. REPLACING A LOGO — not possible. IF-005. Asserted so the gap cannot be
  // quietly closed by a future change that only appears to work.
  await page.getByTestId("nav-assets").click();
  await expect(page.getByTestId("assets")).toContainText("arrive with image support");

  expect(errors).toEqual([]);
});

// ===========================================================================
// The engine does not leak
// ===========================================================================

test("no engine terminology is visible with Developer Mode off", async ({ page }) => {
  await boot(page);

  // Every section a broadcaster can reach, read as rendered text.
  const sections = ["home", "templates", "marketplace", "assets", "outputs", "settings"];
  const forbidden = [
    "mirror",
    "backend",
    "projection",
    "reconciler",
    "dirty node",
    "node attachment",
    "conformance",
    "msdf",
    "glyph atlas",
  ];

  for (const section of sections) {
    await page.getByTestId(`nav-${section}`).click();
    const text = (await page.locator(".section-host").innerText()).toLowerCase();
    for (const term of forbidden) {
      expect(text, `${section} leaked "${term}"`).not.toContain(term);
    }
  }

  // And the EDITOR, which is where a designer spends the day. This was the gap:
  // the first version of this test checked only the browsing sections, and the
  // properties panel was shipping "read from the mirror" the whole time.
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  // The layer tree and the bottom panels are Designer depth (Volume One L9).
  // Checked at that depth deliberately: the terminology audit matters MOST
  await ensureDepth(page, "designer");
  await page.getByTestId("outline").getByRole("button", { name: /Name/ }).first().click();
  // Every bottom panel, opened one at a time. They are headers rather than
  // tabs — Volume Two refuses tabbing — so each is expanded and then
  // collapsed again, which also proves opening one does not conceal another.
  for (const name of ["Timeline", "Motion", "Data", "Templates"]) {
    await openPanel(page, name);
    const editor = (await page.locator(".body").innerText()).toLowerCase();
    for (const term of forbidden) {
      expect(editor, `the editor (${name}) leaked "${term}"`).not.toContain(term);
    }
  }

  // And Developer is not even in the navigation.
  await expect(page.getByTestId("nav-developer")).toHaveCount(0);
});

test("Developer Mode reveals the engine and nothing is lost", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-settings").click();
  await page.getByLabel("Developer mode").check();

  await expect(page.getByTestId("nav-developer")).toBeVisible();
  await page.getByTestId("nav-developer").click();

  const developer = page.getByTestId("developer");
  // The words a broadcaster must never see are exactly the words an engineer
  // expects to find here.
  await expect(developer).toContainText("Mirror");
  await expect(developer).toContainText("Backend writes");
  await expect(developer).toContainText("Last projection");

  // Turning it back off hides it again, and does not lose the setting.
  await page.getByTestId("nav-settings").click();
  await page.getByLabel("Developer mode").uncheck();
  await expect(page.getByTestId("nav-developer")).toHaveCount(0);
});

// ===========================================================================
// The Marketplace
// ===========================================================================

test("the free tier is installed and every pack is usable", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-marketplace").click();

  // Every pack, all owned — a first-time user installs nothing to
  // evaluate. Counted from PACKS rather than written here: this
  // assertion was hard-coded to 7 and silently drifted when the
  // Essentials library shipped two more.
  await expect(page.locator(".pack-card")).toHaveCount(PACKS.length);
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);

  // Removing and re-installing round-trips.
  await page
    .getByTestId("pack-pack_motion_snap")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByTestId("install-pack_motion_snap")).toBeVisible();
  await page.getByTestId("install-pack_motion_snap").click();
  await expect(page.getByTestId("install-pack_motion_snap")).toHaveCount(0);
});

// ===========================================================================
// Performance — the brief's non-negotiable
// ===========================================================================

test("browsing costs no rendering", async ({ page }) => {
  // "Every UI decision must preserve deterministic rendering, 60/120fps
  // editing, zero unnecessary allocations." The cheapest way to honour that is
  // not to render at all when nothing is being edited: leaving the editor
  // unmounts the canvas and stops its animation-frame loop.
  await boot(page);
  await page.getByTestId("start-tpl_lower_third").click();
  // Scoped to the scene surface, because that is the one the ENGINE draws
  // into. Scoped rather than counting every canvas on the page, so the
  // assertion stays about how much Studio RENDERS rather than about how many
  // pictures it happens to show. The claim below — nothing at all while
  // browsing — is what carries the cost.
  await expect(page.locator(".scene-surface canvas")).toHaveCount(1);

  await page.getByTestId("nav-marketplace").click();
  // No canvas in the document at all while browsing. The strip's tiles go with
  // the editor, so browsing still costs nothing.
  await expect(page.locator("canvas")).toHaveCount(0);

  // And it comes back intact, with the graphic still open.
  await page.getByTestId("nav-design").click();
  // Studio opens at BEGINNER depth (Volume One L9). These are Designer
  await ensureDepth(page, "designer");
  await expect(page.locator(".scene-surface canvas")).toHaveCount(1);
  await expect(page.getByTestId("doc-name")).toContainText("Lower Third");
});

test("the section survives a reload", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-marketplace").click();
  await page.reload();
  await expect(page.getByTestId("marketplace")).toBeVisible({ timeout: 30_000 });
});
