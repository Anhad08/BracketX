import { goLive } from "./depth";
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
  await goLive(page);

  await page.getByTestId("nav-settings").click();
  await expect(
    page.getByTestId("ducked"),
    "an operator mid-transmission must not hear the editor",
  ).toBeVisible();
});

/**
 * There was no way off air that said so.
 *
 * The control existed and was called "Clear" — which is what it does to the
 * surface, not what it means to a gallery. An operator looking for the way
 * off air could not find one.
 */
test("there is an off-air control, and it says off air", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible();

  await goLive(page);
  await expect(page.getByTestId("monitors")).toBeVisible();

  const offAir = page.getByTestId("off-air");
  await expect(offAir).toBeVisible();
  await expect(offAir).toContainText("OFF AIR");
  await expect(offAir).toBeEnabled();

  await offAir.click();
  // The strip keeps the FROZEN duration once a show has ended — the number an
  // operator reads afterwards is the one they need. "Nothing is out" is said
  // by the rail tally and by the closure appearing.
  await expect(page.getByTestId("rail-tally")).not.toHaveText("ON AIR");
  await expect(page.getByTestId("closure")).toBeVisible();

  // And it is GONE once the show has ended — the transport is replaced by the
  // closure, because there is no longer a transmission to act on. A control
  // that offers to stop something that is not happening is one you distrust,
  // and absent says that more plainly than disabled.
  await expect(offAir).toHaveCount(0);
});
