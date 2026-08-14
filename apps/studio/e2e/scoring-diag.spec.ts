import { test, expect } from "@playwright/test";

/**
 * DIAGNOSTIC. Looks at the picture, not at a pixel sum.
 *
 * The previous version compared a sum over the whole canvas, which is far too
 * coarse to see one glyph change — and its lit-pixel count never moved even on
 * the update it reported as working. Crops of the stage are the honest record.
 */
test("does a score change reach the picture", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_scoreboard").click();
  await page.waitForTimeout(2000);

  // The graphic lives in the design stage; shoot it there, where it is biggest.
  const stage = page.locator("canvas").first();
  await stage.screenshot({ path: "shots/diag/score-0.png" });

  await page.getByTestId("nav-production").click();
  await page.waitForTimeout(1200);

  const key = "homeScore";
  const input = page.locator(`#live-input-${key}`);
  await expect(input, "no homeScore field rendered").toHaveCount(1);

  for (let i = 1; i <= 4; i += 1) {
    await page.getByTestId(`live-up-${key}`).click();
    await page.waitForTimeout(700);
    const value = await input.inputValue();
    // Shoot the PROGRAM monitor if it exists, else the first canvas.
    const monitor = page.getByTestId("program-monitor").locator("canvas").first();
    const target = (await monitor.count()) > 0 ? monitor : page.locator("canvas").first();
    await target.screenshot({ path: `shots/diag/score-${i}.png` });
    console.log(`click${i}: field=${value}`);
  }

  // Also go back to Design and shoot the stage, which is where the graphic is
  // large enough to read.
  await page.getByTestId("nav-design").click();
  await page.waitForTimeout(1500);
  await page.locator("canvas").first().screenshot({ path: "shots/diag/score-design.png" });

  for (const line of logs.slice(0, 20)) console.log("CONSOLE", line);
});
