import { expect, test } from "@playwright/test";

test("the level switch is visible in Design, and moves", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-design").click();

  const beginner = page.getByTestId("level-beginner");
  const expert = page.getByTestId("level-expert");

  await expect(beginner).toHaveText(/fill in/i);
  await expect(expert).toHaveText(/build/i);
  // Beginner is the default: the first five minutes decide whether anyone
  // reaches the fifth.
  await expect(beginner).toHaveAttribute("aria-pressed", "true");

  await expert.click();
  await expect(expert).toHaveAttribute("aria-pressed", "true");
  await expect(beginner).toHaveAttribute("aria-pressed", "false");
});

test("the level survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-design").click();
  await page.getByTestId("level-expert").click();

  await page.reload();
  await page.getByTestId("nav-design").click();
  await expect(page.getByTestId("level-expert")).toHaveAttribute("aria-pressed", "true");
});

test("Production names the act it performs", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("level-beginner")).toHaveText(/air/i);
  await expect(page.getByTestId("level-expert")).toHaveText(/desk/i);
});

test("a section with nothing to reveal shows no switch", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("level-switch")).toHaveCount(0);
});
