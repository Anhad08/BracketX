import { expect, test, type Page } from "@playwright/test";

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

  // ------------------------------------------------- 2. Edit the name
  await page.getByRole("tab", { name: "Data", exact: true }).click();
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

  // ------------------------------------------------ 3. Change colours
  await page.getByTestId("nav-marketplace").click();
  await shot(page, "marketplace");
  await page
    .getByTestId("pack-pack_theme_broadcast_red")
    .getByRole("button", { name: "Apply" })
    .click();
  await page.getByTestId("nav-design").click();
  await page.waitForTimeout(500);
  await shot(page, "recoloured");

  // ------------------------------------------------- 4. Drag a keyframe
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
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
  await page.getByRole("button", { name: "Program", exact: true }).click();
  await expect(page.getByTestId("program-row")).toBeVisible();
  await shot(page, "program-row");

  await page.getByTestId("take").click();
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");
  await page.waitForTimeout(700);
  await shot(page, "on-air");

  expect(errors, `console errors during the walkthrough:\n${errors.join("\n")}`).toEqual([]);
});
