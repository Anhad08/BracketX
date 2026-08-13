import { test } from "@playwright/test";

const SHOTS = "shots/p1";

async function runCommand(page: import("@playwright/test").Page, title: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".palette-input").fill(title);
  await page.locator(".palette-input").press("Enter");
}

test("capture the level switch and the composite", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 1 — Design at the beginner level. The switch reads "Fill in".
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/01-fill-in.png` });

  // 2 — the same screen at Build. Construction appears; the switch moves.
  await page.getByTestId("level-expert").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/02-build.png` });

  // 3 — the switch itself, close up, in both positions.
  await page.getByTestId("level-switch").screenshot({ path: `${SHOTS}/03-switch.png` });

  // 4 — the palette, now carrying a take and a clear for every layer.
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".palette-input").fill("Take to");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/04-palette-channels.png` });
  await page.locator(".palette-input").press("Escape");

  // 5 — two layers on air at once.
  await runCommand(page, "Take to lower");
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_ticker").click();
  await page.waitForTimeout(800);
  await runCommand(page, "Take to upper");
  await page.getByTestId("nav-production").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/05-two-layers-on-air.png` });

  // 6 — the program monitor alone: the composite, both layers stacked.
  await page.getByTestId("program-monitor").screenshot({
    path: `${SHOTS}/06-program-composite.png`,
  });

  // 7 — Production at the Air level, where the switch reads Air / Desk.
  await page.getByTestId("level-beginner").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/07-production-air.png` });
});
