import { expect, test } from "@playwright/test";

/**
 * Sound, in the real application.
 *
 * The law that matters most here cannot be checked by ear and cannot be
 * checked in a unit test: that the product is SILENT until an operator asks
 * for sound, and that the preference survives a reload. A gallery has its own
 * audio discipline, and an unexpected noise on a live desk is a fault.
 */
test("sound is off until asked for, and the choice is remembered", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();

  const toggle = page.getByTestId("sound-toggle");
  await expect(toggle, "a broadcast product must not make noise uninvited").not.toBeChecked();

  // The voices are listed but cannot be auditioned while sound is off — a
  // control that plays nothing when pressed would read as broken.
  await expect(page.getByTestId("voices")).toBeVisible();
  await expect(page.getByTestId("voice-take")).toBeDisabled();

  await toggle.check();
  await expect(page.getByTestId("voice-take")).toBeEnabled();

  // Remembered per operator. A preference that resets is not a preference.
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("sound-toggle")).toBeChecked();
});

test("all nine voices are offered, named for what they mean", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("sound-toggle").check();

  const names = ["tick", "detent", "press", "cue", "take", "offair", "notify", "alert", "install"];
  for (const name of names) {
    await expect(page.getByTestId(`voice-${name}`)).toBeVisible();
  }
  // Named for the moment, not the synthesis.
  await expect(page.getByTestId("voice-take")).toContainText("Take");
  await expect(page.getByTestId("voice-alert")).toContainText("Attention");

  // Auditioning does not throw. Playwright has no speaker; what is asserted
  // is that the page survives nine WebAudio graphs being built.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const name of names) await page.getByTestId(`voice-${name}`).click();
  expect(errors).toEqual([]);
});

test("the interface ducks while on air, and says so", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible();

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("sound-toggle").check();
  await expect(page.getByTestId("ducked")).toHaveCount(0);

  await page.getByTestId("nav-design").click();
  await page.getByTestId("go-live").click();
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  await page.getByTestId("nav-settings").click();
  await expect(
    page.getByTestId("ducked"),
    "an operator mid-transmission must not hear the editor",
  ).toBeVisible();
});
