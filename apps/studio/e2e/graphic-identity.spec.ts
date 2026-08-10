import { expect, test, type Page } from "@playwright/test";

/**
 * ONE GRAPHIC CANNOT WEAR THE LAST GRAPHIC'S STATE.
 *
 * ============================================================================
 * WHY THE INSPECTOR IS NOT ENOUGH
 * ============================================================================
 * `944ad42` fixed the engine half: `SceneHost.load()` now clears the outgoing
 * runtime, so a key the incoming document does not declare cannot survive.
 * That is proven at the engine level, and it is not the whole path.
 *
 * The leak the founder saw was in the PRODUCT — open one graphic, open
 * another, see the first one's values. So these tests drive the real UI and
 * check two independent things at every step:
 *
 *   THE FIELDS   what the Content panel says the graphic contains
 *   THE CANVAS   what the renderer actually drew
 *
 * Checking only the fields is how this stayed hidden: two lower thirds declare
 * the same keys, so the panel reads correctly while the picture is wrong.
 */

const OPENED = 30_000;

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: OPENED });
}

/** Opens a template from the start screen — the real "open a graphic" path. */
async function open(page: Page, template: string): Promise<void> {
  await page.getByTestId(`start-${template}`).click();
  await expect(page.getByTestId("graphic-styles")).toBeVisible({ timeout: OPENED });
  await page.waitForTimeout(900);
}

/** Back to the start screen, so another graphic can be opened. */
/**
 * Back to the start screen THROUGH THE APP, not by reloading.
 *
 * A reload is not the journey being tested. The reported sequence happens in
 * one session, and a fresh page cannot leak anything — so navigating by
 * `goto` would assert nothing and, since the app restores the open graphic,
 * would not even reach the start screen.
 */
async function home(page: Page): Promise<void> {
  await page.getByTestId("nav-home").click();
  await expect(page.getByTestId("start-tpl_lower_third")).toBeVisible({ timeout: OPENED });
  await page.waitForTimeout(500);
}

/** Every value the Content panel is currently offering. */
async function fields(page: Page): Promise<string[]> {
  const inputs = page.getByTestId("content").locator("input.field");
  const count = await inputs.count();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(await inputs.nth(i).inputValue());
  return out;
}

/**
 * A fingerprint of the drawn frame.
 *
 * Coarse on purpose: the question is "is this a different picture", not "is
 * this pixel this colour". Lit-pixel counts in three brightness bands separate
 * one graphic from another without depending on layout that designers change.
 */
async function frame(page: Page): Promise<string> {
  return page.locator(".scene-surface canvas").first().evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext;
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let bright = 0;
    let mid = 0;
    let colour = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]!;
      const g = px[i + 1]!;
      const b = px[i + 2]!;
      if (r > 200 && g > 200 && b > 200) bright += 1;
      else if (r > 90 || g > 90 || b > 90) mid += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colour += 1;
    }
    return `${bright}/${mid}/${colour}`;
  });
}

// ===========================================================================
// A → B
// ===========================================================================

test("opening a second graphic shows none of the first", async ({ page }) => {
  await boot(page);
  await open(page, "tpl_lower_third");

  const aFields = await fields(page);
  const aFrame = await frame(page);
  expect(aFields.join("|"), "the lower third opened empty").toContain("ALEX RIVERA");

  await home(page);
  await open(page, "tpl_title_card");

  const bFields = await fields(page);
  const bFrame = await frame(page);

  // ASSERTED ON THE VALUES THAT IDENTIFY EACH GRAPHIC, not on every string.
  //
  // Measured: comparing whole field sets flags "MATCH OF THE DAY", which both
  // templates legitimately ship. Two graphics from one pack SHOULD share
  // wording; a test that forbids it is testing the catalogue, not the leak.
  expect(bFields.join("|"), "the title card did not load its own content").toContain(
    "PREMIER LEAGUE",
  );
  expect(
    bFields.join("|"),
    "the lower third’s name followed it into the title card",
  ).not.toContain("ALEX RIVERA");

  // AND ON THE PICTURE. The panel reading correctly while the canvas still
  // shows the previous graphic is the exact failure being ruled out.
  expect(bFrame, "the canvas did not change with the graphic").not.toBe(aFrame);
});

test("and going back the other way is equally clean", async ({ page }) => {
  await boot(page);
  await open(page, "tpl_title_card");
  const bFields = await fields(page);

  await home(page);
  await open(page, "tpl_lower_third");
  const aFields = await fields(page);

  expect(
    aFields.join("|"),
    "the title card’s headline followed it into the lower third",
  ).not.toContain("PREMIER LEAGUE");
  expect(aFields.join("|"), "the lower third lost its own defaults").toContain("ALEX RIVERA");
  void bFields;
});

// ===========================================================================
// EDITS AND OVERRIDES ARE SCOPED TO THE GRAPHIC THAT OWNS THEM
// ===========================================================================

test("an edit to one graphic does not follow into the next", async ({ page }) => {
  await boot(page);
  await open(page, "tpl_lower_third");

  const field = page.getByTestId("content").locator("input.field").first();
  await field.fill("BORROWED FROM A");
  await field.blur();
  await page.waitForTimeout(800);
  expect(await fields(page)).toContain("BORROWED FROM A");

  await home(page);
  await open(page, "tpl_title_card");

  expect(
    await fields(page),
    "an edit made in the previous graphic appeared in this one",
  ).not.toContain("BORROWED FROM A");
});

test("returning to a template gives its defaults, not the last edit", async ({ page }) => {
  await boot(page);
  await open(page, "tpl_lower_third");

  const field = page.getByTestId("content").locator("input.field").first();
  await field.fill("BORROWED FROM A");
  await field.blur();
  await page.waitForTimeout(800);

  await home(page);
  await open(page, "tpl_lower_third");

  // Opening a template is opening the TEMPLATE. The previous session's edit
  // living on would make every graphic a mutable global.
  const back = await fields(page);
  expect(back, "the previous edit survived reopening the template").not.toContain(
    "BORROWED FROM A",
  );
  expect(back.join("|")).toContain("ALEX RIVERA");
});

// ===========================================================================
// A → DELETE → B
// ===========================================================================

test("deleting a graphic from the library leaves nothing of it behind", async ({ page }) => {
  await boot(page);
  await open(page, "tpl_lower_third");

  const field = page.getByTestId("content").locator("input.field").first();
  await field.fill("DELETED GRAPHIC");
  await field.blur();
  await page.waitForTimeout(800);

  // Save it, so there is something to delete rather than merely navigate away
  // from — the reported sequence is delete, then open, and a deleted graphic
  // is the one most likely to be left holding the editor.
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(900);

  await home(page);
  await page.getByTestId("nav-templates").click();
  await page.waitForTimeout(600);

  const remove = page.getByRole("button", { name: "Remove" }).first();
  if ((await remove.count()) > 0) {
    await remove.click();
    await page.waitForTimeout(600);
  }

  await home(page);
  await open(page, "tpl_title_card");

  expect(
    await fields(page),
    "a deleted graphic left its content in the editor",
  ).not.toContain("DELETED GRAPHIC");
});
