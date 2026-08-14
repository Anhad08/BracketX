import { expect, test } from "@playwright/test";

async function openScoreboard(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_scoreboard").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("scoring")).toBeVisible();
}

test("the scoreboard is recognised, and named for the teams", async ({ page }) => {
  await openScoreboard(page);
  // Named for the TEAMS, never "homeScore" — that is our word, not theirs.
  const sides = page.locator(".side-name");
  await expect(sides.first()).toHaveText(/liverpool/i);
  await expect(sides.nth(1)).toHaveText(/arsenal/i);
});

test("a point goes on, and keeps going on", async ({ page }) => {
  await openScoreboard(page);
  const score = page.getByTestId("score-homeScore");
  await expect(score).toHaveText("2");

  // The defect this replaces: the first step landed and every one after it was
  // computed from the template default, so the score stuck.
  for (const expected of ["3", "4", "5", "6"]) {
    await page.getByTestId("score-up-homeScore").click();
    await expect(score).toHaveText(expected);
  }
});

test("the keyboard scores, left hand for the left side", async ({ page }) => {
  await openScoreboard(page);
  await page.getByTestId("production").click({ position: { x: 5, y: 5 } });

  await page.keyboard.press("q");
  await expect(page.getByTestId("score-homeScore")).toHaveText("3");

  await page.keyboard.press("p");
  await expect(page.getByTestId("score-awayScore")).toHaveText("2");

  // Shift corrects.
  await page.keyboard.press("Shift+Q");
  await expect(page.getByTestId("score-homeScore")).toHaveText("2");
});

test("typing a team name never scores", async ({ page }) => {
  await openScoreboard(page);
  const before = await page.getByTestId("score-homeScore").textContent();

  const nameField = page.locator("#live-input-home");
  await nameField.click();
  await nameField.fill("Queens Park");

  // The letter q appears twice in what was typed.
  await expect(page.getByTestId("score-homeScore")).toHaveText(before ?? "2");
});

test("undo takes back the last point, not the whole match", async ({ page }) => {
  await openScoreboard(page);
  await page.getByTestId("score-up-homeScore").click();
  await page.getByTestId("score-up-homeScore").click();
  await expect(page.getByTestId("score-homeScore")).toHaveText("4");

  await page.getByTestId("score-undo").click();
  // Back by ONE. Reset-to-default would have said 2.
  await expect(page.getByTestId("score-homeScore")).toHaveText("3");
});

test("a score cannot go below zero", async ({ page }) => {
  await openScoreboard(page);
  for (let i = 0; i < 4; i += 1) {
    const down = page.getByTestId("score-down-homeScore");
    if (await down.isDisabled()) break;
    await down.click();
  }
  await expect(page.getByTestId("score-homeScore")).toHaveText("0");
  await expect(page.getByTestId("score-down-homeScore")).toBeDisabled();
});

test("a graphic with no scores shows no scoring surface", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await page.waitForTimeout(1000);
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("scoring")).toHaveCount(0);
});
