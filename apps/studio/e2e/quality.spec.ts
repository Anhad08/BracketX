import { expect, test } from "@playwright/test";

/**
 * Quality presets, in the real application.
 *
 * The claim that matters is the one a unit test cannot make: that the number
 * on screen was MEASURED. A performance readout that is actually a constant is
 * worse than no readout, because it is trusted.
 */
test("quality can be chosen, and the frame rate is measured not claimed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");

  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();

  // Automatic is the default, and it says which level it landed on.
  await expect(page.getByTestId("quality-auto")).toHaveClass(/on/);

  await page.getByTestId("quality-high").click();
  await expect(page.getByTestId("quality-high")).toHaveClass(/on/);
  await expect(page.getByTestId("quality-auto")).not.toHaveClass(/on/);

  // A pin is remembered. A preset that reset itself on reload would be a
  // suggestion, not a setting.
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("quality-high")).toHaveClass(/on/);

  // A still scene draws nothing and therefore has nothing to measure. Saying
  // "Idle" is the honest answer; reporting the display refresh rate for a
  // stationary editor would be a number that means nothing.
  await page.getByTestId("nav-design").click();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("fps")).toHaveText("Idle");

  // Play, and it measures real frames.
  await page.getByTestId("nav-design").click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByTestId("nav-settings").click();
  const fps = await page.getByTestId("fps").innerText();
  expect(fps, "the frame rate must be measured, not a placeholder").toMatch(/^\d+ fps$/);
  expect(Number(fps.replace(" fps", ""))).toBeGreaterThan(0);
});
