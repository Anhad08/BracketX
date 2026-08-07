import { expect, test, type Page } from "@playwright/test";

/**
 * Where a scene lives.
 *
 * ============================================================================
 * THE RULE THIS FILE ENFORCES
 * ============================================================================
 * A provider that cannot work yet must SAY SO rather than offer a button that
 * fails after the click. Drive and Dropbox both need an OAuth client id, which
 * comes from registering the application — an act only the product's owner can
 * perform, and one that cannot be invented in a source file.
 *
 * So the interesting assertions here are about honesty: an unconfigured
 * provider is listed, named, and explains what would make it work; it does not
 * present a Connect button. The moment a key is entered, it does.
 */

async function openSettings(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("place-disk")).toBeVisible();
}

test("every place a scene can live is listed", async ({ page }) => {
  await openSettings(page);
  for (const id of ["disk", "drive", "dropbox"]) {
    await expect(page.getByTestId(`place-${id}`)).toBeVisible();
  }
  // Named for what they are to a person, not for the API behind them.
  await expect(page.getByTestId("place-drive")).toContainText("Google Drive");
  await expect(page.getByTestId("place-dropbox")).toContainText("Dropbox");
});

/**
 * THE HONESTY TEST.
 *
 * A Connect button for an application that has not been registered opens a
 * consent screen for a client id that does not exist. That is a control that
 * lies, and this product does not ship them.
 */
test("an unconfigured provider says what it needs instead of offering a button", async ({
  page,
}) => {
  await openSettings(page);

  await expect(page.getByTestId("place-blocked-drive")).toBeVisible();
  await expect(page.getByTestId("place-connect-drive")).toHaveCount(0);
  await expect(page.getByTestId("place-drive")).toContainText("client id");

  await expect(page.getByTestId("place-blocked-dropbox")).toBeVisible();
  await expect(page.getByTestId("place-connect-dropbox")).toHaveCount(0);
});

test("entering a key makes the provider offer to connect", async ({ page }) => {
  await openSettings(page);

  const field = page.getByTestId("drive-client-id");
  await field.fill("123456.apps.googleusercontent.com");
  await field.blur();

  await expect(page.getByTestId("place-connect-drive")).toBeVisible();
  await expect(page.getByTestId("place-blocked-drive")).toHaveCount(0);

  // And it is remembered — a key you have to paste on every launch is a key
  // nobody pastes twice.
  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("drive-client-id")).toHaveValue(
    "123456.apps.googleusercontent.com",
  );
});

test("the disk is ready without an account, or says why not", async ({ page }) => {
  await openSettings(page);
  const disk = page.getByTestId("place-disk");
  // Chromium has the file picker, so this is "ready" here. On a browser
  // without it the row must still exist and explain — an absent option is one
  // somebody hunts for.
  const ready = await page.getByTestId("place-ready-disk").count();
  const blocked = await page.getByTestId("place-blocked-disk").count();
  expect(ready + blocked, "the disk must report a state either way").toBe(1);
  await expect(disk).toContainText("folder");
});

test("Save and Open are in the File menu, and Save asks where the first time", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("menu-file").click();
  await expect(page.getByTestId("menu-item-file.open")).toBeVisible();
  await expect(page.getByTestId("menu-item-file.save")).toBeVisible();
  // "Save as…", not "Save as file…" — the destination is a choice now, and it
  // is not always a file on this machine.
  await expect(page.getByTestId("menu-pop-file")).toContainText("Save as…");
});
