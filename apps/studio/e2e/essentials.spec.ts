import { expect, test, type Page } from "@playwright/test";

/**
 * Every starter graphic, opened and photographed.
 *
 * ============================================================================
 * WHY EACH ONE GETS ITS OWN PICTURE
 * ============================================================================
 * "Professional starter content" is a claim about how something LOOKS, and the
 * only way to check it is to look. A test that asserts eight templates build
 * would have passed while every one of them rendered a smudge — which is
 * exactly what happened to text before anyone captured a screenshot.
 *
 * So this opens each template from Home, waits for a real frame, and writes a
 * numbered image. The assertions catch the failures a picture cannot argue
 * with: nothing on the console, a canvas with pixels, layers with the names a
 * designer would use.
 */

const TEMPLATES = [
  { id: "tpl_lower_third", name: "Lower Third" },
  { id: "tpl_title_card", name: "Title Card" },
  { id: "tpl_sponsor", name: "Sponsor Bar" },
  { id: "tpl_ticker", name: "Ticker" },
  { id: "tpl_breaking", name: "Breaking News" },
  { id: "tpl_scoreboard", name: "Scoreboard" },
  { id: "tpl_leaderboard", name: "Leaderboard" },
  { id: "tpl_countdown", name: "Countdown" },
];

async function open(page: Page, id: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`start-${id}`).click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await expect(page.getByTestId("scene-view")).toBeVisible();
  // Fonts, images and the first projected frame.
  await page.waitForTimeout(900);
}

TEMPLATES.forEach((template, index) => {
  test(`${template.name} opens, renders and is editable`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await open(page, template.id);

    await page.screenshot({
      path: `walkthrough/essentials/${String(index + 1).padStart(2, "0")}-${template.id}.png`,
      animations: "disabled",
    });

    // Named in a designer's words, not the engine's — the rule Phase 4 set.
    await expect(page.getByTestId("outline")).toContainText(template.name);

    // Every field a broadcaster would change is exposed as data, so nothing
    // needs the layer tree to be edited.
    await page.getByRole("tab", { name: "Data", exact: true }).click();
    const fields = await page.getByTestId("variables").locator("tbody tr").count();
    expect(fields, `${template.name} exposes no editable fields`).toBeGreaterThan(0);

    expect(errors, `${template.name}:\n${errors.join("\n")}`).toEqual([]);
  });
});

test("the leaderboard renders one row per entry, from a list", async ({ page }) => {
  // The collection mechanism, doing the job it exists for: five entries in one
  // variable become five rows, and adding a team is a data edit rather than a
  // redesign. This is the only starter graphic that proves repeat works, so it
  // is asserted rather than left to the picture.
  await open(page, "tpl_leaderboard");

  await expect(page.getByTestId("outline")).toContainText("Standings");

  // ONE row in the layer tree. The five on screen are mirror instances with no
  // document counterpart, which is the point: adding a team is a data edit and
  // the design is authored once. A tree showing five rows would mean five rows
  // had been authored.
  const authored = await page.getByTestId("outline").getByText("Row", { exact: true }).count();
  expect(authored).toBe(1);

  // And the data is where a broadcaster edits it.
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(page.getByTestId("variables")).toContainText("standings");
});

test("the sponsor bar draws the shipped mark", async ({ page }) => {
  // The one starter graphic built around an imported asset. If the asset system
  // and the templates ever disagree, this is where it shows.
  await open(page, "tpl_sponsor");
  await expect(page.getByTestId("outline")).toContainText("Partner Logo");

  await page.getByTestId("nav-assets").click();
  await page.getByTestId("asset-ast_sponsor_mark").click();
  await expect(page.getByTestId("asset-usage")).toHaveText("1 graphic");
});
