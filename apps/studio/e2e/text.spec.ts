import { expect, test, type Page } from "@playwright/test";

/**
 * Text in a browser. Phase 3B.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ============================================================================
 * `engine-text` has 43 assertions and the participation suite has 18. Between
 * them they prove the pipeline is correct and that every subsystem drives it.
 * Neither can prove the one thing that matters most here: **that glyphs reach
 * the screen**.
 *
 * The specific failure this catches is the one Phase 3A learned the hard way —
 * a subsystem that is correct and wired to nothing. Text has two extra ways to
 * be that: the font files may not be served, and the MSDF shader may not
 * compile. Both produce a working editor showing no words.
 */

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  // The boot screen says "Loading fonts…" until every font has parsed —
  // TEXT_ENGINE §3 makes that a real wait, not a spinner.
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("statusbar")).toContainText("nodes");
}

async function depth(page: Page): Promise<number> {
  const text = (await page.getByTestId("history").textContent()) ?? "";
  return Number(/history (\d+)/.exec(text)?.[1] ?? -1);
}

/** Fails the test on any console error — a shader that will not compile logs one. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test("the fonts are served and parse", async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page);
  // A 404 on a font file leaves the editor running with no glyphs at all, which
  // looks like a text bug rather than a static-asset one.
  const response = await page.request.get("/fonts/inter-latin-400.ttf");
  expect(response.status()).toBe(200);
  expect((await response.body()).byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test("the Text tool creates a node the engine draws", async ({ page }) => {
  const errors = watchConsole(page);
  await boot(page);
  const before = await depth(page);

  await page.getByTestId("tool-text").click();
  expect(await depth(page)).toBe(before + 1);

  // The inspector proves the node is a TEXT node with the properties the
  // description table declares — the two rows Phase 3A predicted would be the
  // whole editor-side integration.
  const inspector = page.getByTestId("inspector");
  await expect(inspector).toContainText("text");
  await expect(inspector.getByLabel("content")).toHaveValue("Text");

  // And no shader compiled with an error, which is how an MSDF material fails.
  expect(errors.join("\n")).not.toContain("shader");
  expect(errors).toEqual([]);
});

test("editing the content re-lays-out through the engine", async ({ page }) => {
  await boot(page);
  await page.getByTestId("tool-text").click();

  const content = page.getByTestId("inspector").getByLabel("content");
  await content.fill("LIVERPOOL");
  await content.blur();

  // One undoable edit, and the document holds it. The layout that followed is
  // the engine's; what a browser adds is proof the gesture reached it.
  await expect(content).toHaveValue("LIVERPOOL");
  await page.keyboard.press("Control+z");
  await expect(content).toHaveValue("Text");
});

test("a preset animates text, using the same code that animates a rectangle", async ({
  page,
}) => {
  await boot(page);
  await page.getByTestId("tool-text").click();

  await page.getByRole("tab", { name: "presets", exact: true }).click();
  // `fade-in` is the interesting one: it resolves a COLOUR PATH per component
  // type, and text was one line in that table.
  await page.getByTestId("preset-fade-in").click();

  await page.getByRole("tab", { name: "timeline", exact: true }).click();
  await expect(page.getByTestId("keyframe")).toHaveCount(2);
});

test("text goes to air through the ordinary Take path", async ({ page }) => {
  await boot(page);
  await page.getByTestId("tool-text").click();

  await page.getByRole("button", { name: "Program", exact: true }).click();
  await expect(page.getByTestId("tally")).toHaveText("OFF");
  await page.getByTestId("cut").click();
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");

  // Editing Preview afterwards still does not reach air — text changed nothing
  // about the guarantee, which is the point.
  await page.getByTestId("tool-rect").click();
  await expect(page.getByTestId("program-row")).toContainText(
    "Preview differs from what is on air",
  );
  await expect(page.getByTestId("tally")).toHaveText("ON AIR");
});
