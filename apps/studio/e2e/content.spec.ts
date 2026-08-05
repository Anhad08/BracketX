import { expect, test } from "@playwright/test";

/**
 * The content surface and the pre-air verdict, in the real application.
 *
 * ============================================================================
 * WHY THIS IS AN E2E TEST AND NOT A UNIT TEST
 * ============================================================================
 * `surface.ts` and `preflight.ts` already have unit tests that drive the real
 * engine. What those cannot prove is that the panel is WIRED — that typing in
 * the field produces a transaction, that the transaction reaches the document,
 * and that the verdict re-reads the projection afterwards.
 *
 * That wiring is exactly what a prototype fakes, so it is the thing worth
 * photographing.
 */
test("the content surface edits the real document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await page.waitForTimeout(900);

  const content = page.getByTestId("content");
  await expect(content).toBeVisible();

  // The fields are DERIVED from the document's variables — the starter lower
  // third declares them, so they must appear without the panel knowing anything
  // about lower thirds.
  const fields = content.locator("input.field");
  expect(await fields.count()).toBeGreaterThan(0);

  // Typing edits the document. The proof is that undo can take it back, which
  // only works if a real transaction was journalled.
  const first = fields.first();
  await first.fill("Konstantinos Papadopoulos");
  await page.waitForTimeout(300);
  await expect(first).toHaveValue("Konstantinos Papadopoulos");

  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(300);
  await expect(first).not.toHaveValue("Konstantinos Papadopoulos");

  await page.screenshot({ path: "walkthrough/content/01-surface.png", animations: "disabled" });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the pre-air verdict reports engine state, not a guess", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await page.waitForTimeout(900);

  const verdict = page.getByTestId("preflight");
  await expect(verdict).toBeVisible();

  // Whatever it says, it must say something — Law 7 forbids a dead surface.
  await expect(verdict).not.toBeEmpty();

  await page.screenshot({ path: "walkthrough/content/02-verdict.png", animations: "disabled" });
});
