import { test } from "@playwright/test";

const SECTIONS = ["templates", "marketplace", "assets", "outputs", "settings", "production"] as const;

test("survey every section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForTimeout(3000);

  for (const section of SECTIONS) {
    await page.getByTestId(`nav-${section}`).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `shots/survey/${section}.png` });
    const height = await page.evaluate(() => document.body.scrollHeight);
    console.log(`${section}: scrollHeight=${height}`);
  }
});
