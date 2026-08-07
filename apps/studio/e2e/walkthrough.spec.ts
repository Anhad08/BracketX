import { expect, test, type Page } from "@playwright/test";
import { ensureDepth, openPanel } from "./depth";

/**
 * A 4x4 broadcast-red PNG.
 *
 * Built into the test rather than checked in, for the reason the decoder's own
 * fixtures are: a binary proves the importer agrees with whatever produced it,
 * and when it disagrees you cannot see why.
 */
const BADGE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGO4rmb7HxkzkC4AALUoI5EMqBxNAAAAAElFTkSuQmCC";

/**
 * The workflow, performed and recorded.
 *
 * ============================================================================
 * WHAT THIS IS FOR
 * ============================================================================
 * Not "does the code execute". This walks the seven things a broadcast designer
 * actually needs to do, in order, with no prior knowledge, and photographs each
 * one:
 *
 *   1. Create a lower third from a template
 *   2. Edit player names, and the logo the graphic carries
 *   3. Change colours
 *   4. Drag keyframes
 *   5. Preview animations
 *   6. Send graphics to Preview
 *   7. Take graphics Live
 *
 * Every step is a real gesture on real UI. If a step needs a workaround, this
 * test is where that becomes obvious — and a workaround here is a product
 * failure even when every assertion passes.
 */

let step = 0;

async function shot(page: Page, name: string): Promise<void> {
  step += 1;
  await page.waitForTimeout(320); // Let any transition settle before capturing.
  await page.screenshot({
    path: `walkthrough/${String(step).padStart(2, "0")}-${name}.png`,
    animations: "disabled",
  });
}

test("a designer builds a lower third and takes it to air", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // ---------------------------------------------------------------- 0. Open
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("home")).toBeVisible();
  await shot(page, "home");

  // ------------------------------------------- 1. Create from a template
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("scene-view")).toBeVisible();
  await page.waitForTimeout(600); // First frame.
  await shot(page, "created-lower-third");

  // This walkthrough is a DESIGNER's journey — it uses the Data tab, the layer
  // tree and the timeline. Studio opens at beginner depth (Volume One L9), so
  // the designer reveals their tools first, exactly as they would in the
  await ensureDepth(page, "designer");

  // ------------------------------------------------- 2. Edit the name
  await openPanel(page, "Data");
  const name = page.getByTestId("variables").getByLabel("Default for name");
  await name.fill("MOHAMED SALAH");
  await name.blur();
  const role = page.getByTestId("variables").getByLabel("Default for role");
  await role.fill("Forward · Liverpool");
  await role.blur();
  await page.waitForTimeout(500);
  await shot(page, "edited-names");

  // The logo is a variable like every other field, which is the whole point of
  // IF-005 closing: replacing a sponsor is an operator action, not an edit.
  const logo = page.getByTestId("variables").getByLabel("Runtime value for logo");
  await expect(logo).toHaveValue("ast_sponsor_mark");

  // ------------------------------- 2b. Bring your own logo, and use it
  //
  // IF-006's user-facing claim: a broadcaster imports their own mark and it is
  // on air, without thinking about files. The PNG is built here so the test
  // states its own bytes rather than depending on a checked-in binary.
  await page.getByTestId("nav-assets").click();
  await expect(page.getByTestId("asset-images")).toBeVisible();
  await shot(page, "assets");

  await page.getByTestId("asset-file").setInputFiles({
    name: "Club Badge.png",
    mimeType: "image/png",
    buffer: Buffer.from(BADGE_PNG, "base64"),
  });
  // Named from the file, minus the extension — a user thinks "Club Badge".
  await expect(page.getByText("Club Badge")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("import-problem")).toHaveCount(0);
  await shot(page, "imported-badge");

  // The library is a library: a preview, an inspector, and the operations a
  // broadcaster expects of one.
  await page
    .getByTestId("asset-grid")
    .locator(".asset-tile")
    .filter({ has: page.getByText("Club Badge", { exact: true }) })
    .first()
    .click();
  await expect(page.getByTestId("asset-inspector")).toBeVisible();
  await page.getByTestId("asset-favourite").click();
  await page.getByTestId("asset-tags").fill("sport, home");
  await page.getByTestId("asset-tags").blur();
  await page.waitForTimeout(200);
  await shot(page, "asset-inspector");

  // The id the import minted, read WHILE the library is on screen — the tiles
  // do not exist on any other section.
  const badgeId = await page
    .getByTestId("asset-grid")
    .locator('[data-testid^="asset-"]')
    .last()
    .evaluate((tile) => tile.getAttribute("data-testid")!.replace("asset-", ""));
  expect(badgeId).toMatch(/^ast_/);

  // Point the graphic's logo at it. This is the live-swap path: a command, not
  // an edit, which is exactly what an operator changing a sponsor on air does.
  await page.getByTestId("nav-design").click();
  // Studio opens at BEGINNER depth (Volume One L9). These are Designer
  await ensureDepth(page, "designer");
  await openPanel(page, "Data");
  const logoField = page.getByTestId("variables").getByLabel("Runtime value for logo");
  await logoField.fill(badgeId);
  await page.waitForTimeout(600);
  await shot(page, "own-logo-on-air");

  // ------------------------------------------------ 3. Change colours
  await page.getByTestId("nav-marketplace").click();
  await shot(page, "marketplace");
  await page
    .getByTestId("pack-pack_theme_broadcast_red")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.getByTestId("nav-design").click();
  // Studio opens at BEGINNER depth (Volume One L9). These are Designer
  await ensureDepth(page, "designer");
  await page.waitForTimeout(500);
  await shot(page, "recoloured");

  // ------------------------------------------------- 4. Drag a keyframe
  await openPanel(page, "Timeline");
  await expect(page.getByTestId("keyframe").first()).toBeVisible();
  await shot(page, "timeline");

  const keyframe = page.getByTestId("keyframe").nth(1);
  const box = (await keyframe.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot(page, "keyframe-dragged");

  // --------------------------------------------- 5. Preview the animation
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(700);
  await shot(page, "playing");

  // ------------------------------------------ 6 & 7. Preview → Program
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("program-row")).toBeVisible();
  await shot(page, "program-row");

  await page.getByTestId("take").click();
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
  await page.waitForTimeout(700);
  await shot(page, "on-air");

  expect(errors, `console errors during the walkthrough:\n${errors.join("\n")}`).toEqual([]);
});
