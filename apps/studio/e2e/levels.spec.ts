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

const ADVANCED = ["content-depth", "content-style", "lighting", "content-motion"] as const;

test("Fill in shows the content, and none of the construction", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();

  // What a beginner came for.
  await expect(page.getByTestId("content-colour")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();

  // ABSENT, not collapsed. A disclosure you must learn to ignore is still
  // something you must learn.
  for (const section of ADVANCED) {
    await expect(page.getByTestId(section)).toHaveCount(0);
  }
});

test("Build adds every section, closed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await page.getByTestId("level-expert").click();

  for (const section of ADVANCED) {
    const panel = page.getByTestId(section);
    await expect(panel).toBeVisible();
    // Closed: Build is a superset, not a wall.
    await expect(panel).not.toHaveAttribute("open", "");
  }

  // And the fields never moved — the switch is safe to press.
  await expect(page.getByLabel("Name")).toBeVisible();
});

test("an advanced section opens, and only the one asked for", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await page.getByTestId("level-expert").click();

  await page.getByTestId("content-style").locator("summary").click();
  await expect(page.getByTestId("content-style")).toHaveAttribute("open", "");
  await expect(page.getByTestId("lighting")).not.toHaveAttribute("open", "");
});

test("a section with nothing to reveal shows no switch", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("level-switch")).toHaveCount(0);
});
