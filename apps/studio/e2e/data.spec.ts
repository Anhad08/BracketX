import { expect, test, type Page } from "@playwright/test";
import { openPanel } from "./depth";

/**
 * A field that holds a table is not a field you type into.
 *
 * ============================================================================
 * THE BUG, AND WHY IT WAS THE WORST KIND
 * ============================================================================
 * The Data panel rendered every variable's value through `String()` and put it
 * in a text box. A leaderboard's `standings` is an array of team objects, so
 * it displayed as "[object Object],[object Object]" — ugly, and that was the
 * least of it. The box's blur handler wrote its own contents back as the new
 * default, so clicking into that field and out of it again replaced five teams
 * with a sentence.
 *
 * Silently. No error, no warning, one undo step you would have to know to look
 * for. A control that destroys data on an accidental click is worse than a
 * control that does nothing, and this one looked completely ordinary.
 */

async function openLeaderboard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_leaderboard").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("depth-toggle").click();
  await openPanel(page, "Data");
  await expect(page.getByTestId("variables")).toBeVisible();
}

test("a list says what it is instead of pretending to be text", async ({ page }) => {
  await openLeaderboard(page);

  const variables = page.getByTestId("variables");
  await expect(
    variables,
    "a value rendered through String() is a value nobody can read",
  ).not.toContainText("[object Object]");

  // It says what it holds. "5 rows" is the useful fact about a standings
  // table; the rows themselves are edited where they are shown.
  await expect(page.getByTestId("shape-standings")).toContainText("rows");
});

/**
 * THE ONE THAT MATTERS.
 *
 * Focus the field, leave it, and the table must still be a table.
 */
test("clicking through a list field does not flatten it", async ({ page }) => {
  await openLeaderboard(page);

  const before = await page.getByTestId("variables").innerText();
  const shape = page.getByTestId("shape-standings");
  await shape.click();
  await page.getByTestId("variables").click();
  await page.waitForTimeout(200);

  await expect(page.getByTestId("variables")).not.toContainText("[object Object]");
  expect(
    await page.getByTestId("variables").innerText(),
    "touching a structured field must change nothing",
  ).toBe(before);
});

test("an ordinary text field is still editable", async ({ page }) => {
  await openLeaderboard(page);
  // The fix must not turn every field into a label. `title` is a string and
  // stays a box somebody can type in.
  const title = page.getByTestId("variables").getByLabel("Default for title");
  await expect(title).toBeVisible();
  await title.fill("LEAGUE TABLE");
  await title.blur();
  await expect(title).toHaveValue("LEAGUE TABLE");
});
