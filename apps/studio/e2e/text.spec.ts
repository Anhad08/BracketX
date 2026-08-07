import { expect, test, type Page } from "@playwright/test";
import { ensureDepth, openPanel } from "./depth";

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
  // Phase 4 opens on Home, not in the editor. A test that assumed the editor
  // was the application is a test that encoded the old information
  // architecture; entering Design explicitly is what a user does too.
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("nav-design").click();
  // Studio opens at BEGINNER depth (Volume One L9). These are Designer
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("scene-view")).toBeVisible();
  // "layers", not "nodes" — the status bar says what a designer calls them.
  // `journey.spec.ts` holds the stronger rule: "nodes" must not appear at all.
  await expect(page.getByTestId("statusbar")).toContainText("layers");
  // Fonts have parsed by now — TEXT_ENGINE 3 makes that a real wait.
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

  await openPanel(page, "Motion");
  // `fade-in` is the interesting one: it resolves a COLOUR PATH per component
  // type, and text was one line in that table.
  await page.getByTestId("preset-fade-in").click();

  await openPanel(page, "Timeline");
  await expect(page.getByTestId("keyframe")).toHaveCount(2);
});

test("text goes to air through the ordinary Take path", async ({ page }) => {
  await boot(page);
  await page.getByTestId("tool-text").click();

  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("program-state")).toHaveText("CLEAN");
  await page.getByTestId("cut").click();
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "live");

  // Editing Preview afterwards still does not reach air — text changed nothing
  // about the guarantee, which is the point. Editing happens in Design now;
  // transmission happens in Production, and the split is the guarantee.
  await page.getByTestId("nav-design").click();
  await page.getByTestId("tool-rect").click();
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("monitors")).toContainText(
    "Preview differs from what is on air",
  );
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "live");
});

/**
 * THE GLYPHS REACH THE SCREEN.
 *
 * Every other test in this file proves the pipeline is wired: a node exists,
 * the inspector agrees, a preset compiles, the take path works. None of them
 * looks at a pixel, and a text engine that is correct and draws nothing
 * satisfies all of them.
 *
 * This one reads the rendered surface and asks whether anything BRIGHT is in
 * it. A lower third is a dark plate with light words on it, so bright pixels
 * are the words — and their absence is the exact failure the file's own
 * header warns about: "a working editor showing no words".
 */
test("the words are actually on the screen", async ({ page }) => {
  await boot(page);
  await page.getByTestId("nav-home").click();
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });

  // Played in, because a template is authored at its arrived state and starts
  // off screen — at frame zero there is nothing to look at.
  await page.getByTestId("scene-view").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(" ");
  await page.waitForTimeout(1_400);
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);

  const bright = await page.evaluate(() => {
    const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
    if (canvas === null) return -1;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) return -1;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! === 0) continue;
      // Light ink on a dark plate. The plate is around 20 per channel; the
      // words are near white.
      if (pixels[index]! > 150 && pixels[index + 1]! > 150) count += 1;
    }
    return count;
  });

  expect(bright, "a lower third with no light pixels has no words in it").toBeGreaterThan(200);
});
