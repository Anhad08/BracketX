import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * THE CAPABILITY, END TO END.
 *
 * ============================================================================
 * WHY THIS FILE IS ONE LONG TEST AND NOT TWENTY SHORT ONES
 * ============================================================================
 * Every step below already had a test of its own. The capability still did not
 * work, because the failures were never inside a step — they were in the joins:
 * a material panel that only appeared for flat rectangles, a 3D object that had
 * no finish anybody could choose, a scene that lit itself but could not be
 * relit.
 *
 * So this runs the whole thing in one document, in order, exactly as a
 * broadcaster would:
 *
 *   create a hybrid scene → place 2D graphics → place 3D objects →
 *   manipulate them → assign materials → light the scene →
 *   preview → cue → take to air
 *
 * If any join breaks, this fails. That is the only assertion that matters
 * about a capability.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/**
 * What the ENGINE actually drew: how much of the frame is covered, and how
 * bright it is.
 *
 * Read off the WebGL surface rather than from a screenshot, because a
 * screenshot includes the editor's own overlays — the ground grid, the axis
 * lines, the gizmo — and those are drawn whether or not the scene renders
 * anything at all. Two of this sprint's bugs hid behind exactly that: a floor
 * standing on edge and therefore invisible, and a set the lighting never
 * reached. Every unit test passed through both.
 */
async function drawn(page: Page): Promise<{ covered: number; light: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".scene-surface canvas") as HTMLCanvasElement | null;
    if (canvas === null) return { covered: 0, light: 0 };
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) return { covered: 0, light: 0 };
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0;
    let light = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! === 0) continue;
      covered += 1;
      light += pixels[index]! + pixels[index + 1]! + pixels[index + 2]!;
    }
    return { covered: covered / (canvas.width * canvas.height), light };
  });
}

async function value(page: Page, label: string): Promise<number> {
  return Number(
    await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue(),
  );
}

test("a broadcaster builds a hybrid scene and takes it to air", async ({ page }) => {
  const errors = watchConsole(page);

  // ---------------------------------------------------------------------
  // 1. CREATE A HYBRID SCENE
  // ---------------------------------------------------------------------
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-hybrid").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await ensureDepth(page, "designer");

  // A hybrid scene arrives ready to work in: a camera that can see depth, a
  // floor, and lighting. Nothing here is something a designer had to know to
  // ask for.
  await expect(page.getByTestId("outline")).toContainText("Floor");
  await expect(page.getByTestId("outline")).toContainText("Key");
  // And it opens in space, because a scene that opens flat is a scene whose
  // whole point is hidden behind a control nobody pressed.
  await expect(page.getByTestId("gizmo-modes")).toBeVisible({ timeout: 15_000 });

  // ---------------------------------------------------------------------
  // 2. PLACE 2D GRAPHICS
  // ---------------------------------------------------------------------
  await page.getByTestId("tool-rect").click();
  await expect(page.getByTestId("inspector")).toContainText("rect");
  await page.getByTestId("tool-text").click();
  await expect(page.getByTestId("inspector").getByLabel("content")).toHaveValue("Text");

  // ---------------------------------------------------------------------
  // 3. PLACE 3D OBJECTS
  // ---------------------------------------------------------------------
  await page.getByTestId("tool-box").click();
  await expect(page.getByTestId("inspector")).toContainText("meshRenderer");
  await page.getByTestId("tool-cylinder").click();
  await expect(page.getByTestId("outline")).toContainText("Cylinder");

  // Both kinds in one document, which is what "hybrid" means.
  await expect(page.getByTestId("outline")).toContainText("Rectangle");
  await expect(page.getByTestId("outline")).toContainText("Box");

  // ---------------------------------------------------------------------
  // 4. MANIPULATE THEM NATURALLY
  // ---------------------------------------------------------------------
  await page.getByTestId("gizmo-rotate").click();
  const ring = page.getByTestId("ring-y");
  await expect(ring).toBeVisible();
  const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
  const polyline = (await ring.getAttribute("points"))!
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
  // A QUARTER of the way round is exactly where this ring crosses another —
  // every pair of rings shares a centre and a radius, so they meet at the
  // axis points. A grab there is genuinely ambiguous and the hit test may
  // legitimately answer with either. An eighth is on one ring and no other.
  const on = polyline[Math.floor(polyline.length / 8)]!;
  const before = await value(page, "rotation y");

  await page.mouse.move(chrome.x + on[0]!, chrome.y + on[1]!);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "ring");
  await page.mouse.move(chrome.x + on[0]! - 80, chrome.y + on[1]! + 30, { steps: 12 });
  await page.mouse.up();
  // The Y RING turned it about Y. Asserting the specific axis is the point:
  // a gizmo that turns the object by SOMETHING when you drag a ring is not a
  // rotate tool, it is a surprise.
  expect(Math.abs((await value(page, "rotation y")) - before)).toBeGreaterThan(1);
  expect(await value(page, "rotation x")).toBeCloseTo(0, 3);
  expect(await value(page, "rotation z")).toBeCloseTo(0, 3);

  // ---------------------------------------------------------------------
  // 5. ASSIGN MATERIALS
  // ---------------------------------------------------------------------
  // By OUTCOME, on the selected object. The panel names what a surface looks
  // like; metalness and roughness are the engine's business.
  const materials = page.getByTestId("materials");
  await expect(materials).toBeVisible();
  await page.getByTestId("material-chrome").click();
  await expect(page.getByTestId("material-chrome")).toHaveAttribute("aria-pressed", "true");
  // The generated values are real and reach the document.
  expect(await value(page, "metallic")).toBeGreaterThan(0.8);

  await page.getByTestId("material-glass").click();
  expect(await value(page, "opacity")).toBeLessThan(1);

  // ---------------------------------------------------------------------
  // 6. LIGHT THE SCENE
  // ---------------------------------------------------------------------
  await page.getByTestId("nav-design").click();
  const lighting = page.getByTestId("lighting");
  await expect(lighting).toBeVisible();
  // A named look, not six numbers. The rig it builds is ordinary light nodes.
  await page.getByTestId("look-dramatic").click();
  await expect(page.getByTestId("look-dramatic")).toHaveAttribute("aria-pressed", "true");

  // AND IT CHANGED THE PICTURE. A look that only rewrites the document is a
  // look that does nothing — which is precisely what a rig the projector never
  // reached would look like from the outside.
  await page.waitForTimeout(600);
  const dramatic = await drawn(page);
  await page.getByTestId("look-flat").click();
  await page.waitForTimeout(600);
  const flat = await drawn(page);
  expect(
    Math.abs(dramatic.light - flat.light) / Math.max(1, dramatic.light),
    "changing the lighting must change what is rendered",
  ).toBeGreaterThan(0.05);

  // Exposure is a scene property and it moves the picture too.
  const exposure = page.getByTestId("exposure");
  await expect(exposure).toBeVisible();
  await exposure.fill("2");
  await exposure.blur();
  await expect(exposure).toHaveValue("2");
  await page.waitForTimeout(600);
  expect((await drawn(page)).light, "exposure must brighten the image").toBeGreaterThan(
    flat.light,
  );

  // Shadows are a switch, and it reaches the renderer.
  await page.getByTestId("shadows").check();
  await expect(page.getByTestId("shadows")).toBeChecked();

  // ---------------------------------------------------------------------
  // 7. PREVIEW  ·  8. CUE  ·  9. TAKE TO AIR
  // ---------------------------------------------------------------------
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("monitor-preview")).toBeVisible();
  await expect(page.getByTestId("program-state")).toHaveText("CLEAN");

  await page.getByTestId("cue").click();
  await expect(page.getByTestId("preview-state")).toHaveText("CUED");
  await expect(page.getByTestId("monitor-program")).toHaveAttribute("data-live", "no");

  await page.getByTestId("take").click();
  await expect(page.getByTestId("monitors")).toHaveAttribute("data-air", "live");
  await expect(page.getByTestId("rail-tally")).toHaveText("ON AIR");

  // The whole capability, and not one console error along the way.
  expect(errors, errors.join("\n")).toEqual([]);
});
