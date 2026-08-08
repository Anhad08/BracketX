import { expect, test } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Snapping, in the real application.
 *
 * `snapping.test.ts` proves the arithmetic. What only a browser can prove is
 * that each GESTURE is actually wired to it — which is the exact thing that was
 * wrong before: the module did not exist, `snap` existed and was called by one
 * gesture out of six, and no test could tell the difference because each
 * gesture was tested for what it did rather than for what it snapped to.
 *
 * So every test here drives a pointer and asserts the FEEDBACK a designer sees:
 * a labelled guide, or the detent readout. Feedback rather than a document
 * value, because a snap the user cannot see is the failure being defended
 * against just as much as a snap that does not happen.
 */
async function openLowerThird(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  const start = page.getByTestId("start-tpl_lower_third");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await ensureDepth(page, "designer");
  await expect(
    page.getByTestId("outline").getByText("Accent Bar", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * A point inside the selection that is not on any handle.
 *
 * The obvious choice — the centre of the gizmo's bounding box — is wrong, and
 * wrong in a way that HID A BROKEN TEST: the box includes the rotation grip
 * above the shape, so its centre sits near the shape's top edge, and on a thin
 * lower-third bar the press landed on a resize handle. `data-drag` read
 * "resize" while the test was named "moving". One of the two tests written
 * against that point passed anyway, because it asserted feedback that a resize
 * also produces.
 *
 * Finding it took three wrong answers, and each one is worth recording because
 * each was a different thing competing for the same pixels:
 *
 *   1. The gizmo bbox centre — includes the rotation grip, so it sits near the
 *      shape's TOP EDGE and pressed a resize handle.
 *   2. A fraction across the Accent Bar — that node is a narrow flag, and with a
 *      10 screen-pixel pick tolerance every interior point of it is within
 *      grabbing distance of some handle. No fraction avoids one.
 *   3. The exact centre of a wide node — which is where the 3D MOVE GIZMO's
 *      origin is, so the press grabbed the Y arm (`data-drag="axis"`).
 *
 * So: a wide node, framed to fill the viewport, and a point offset DOWN-LEFT of
 * centre. Down-left because the gizmo's arms run +X (right) and +Y (up), so the
 * opposite quadrant is the one place clear of the arms, the eight handles and
 * the grip at once.
 */
async function bodyPoint(
  page: import("@playwright/test").Page,
): Promise<{ x: number; y: number }> {
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(500);

  const west = await page.getByTestId("handle-w").boundingBox();
  const east = await page.getByTestId("handle-e").boundingBox();
  const north = await page.getByTestId("handle-n").boundingBox();
  const south = await page.getByTestId("handle-s").boundingBox();
  for (const box of [west, east, north, south]) expect(box).not.toBeNull();

  const wx = west!.x + west!.width / 2;
  const ex = east!.x + east!.width / 2;
  const ny = north!.y + north!.height / 2;
  const sy = south!.y + south!.height / 2;

  const halfWidth = Math.abs(ex - wx) / 2;
  const halfHeight = Math.abs(sy - ny) / 2;
  // What has to be cleared is the 10px pick tolerance, not some arbitrary size.
  expect(
    Math.min(halfWidth, halfHeight),
    "the framed shape is too small to grab clear of its handles",
  ).toBeGreaterThan(24);

  // Down-left of centre: away from the +X and +Y arms, and far enough from the
  // origin and from the S and W handles that none of them wins the pick.
  return {
    x: (wx + ex) / 2 - halfWidth * 0.45,
    y: (ny + sy) / 2 + halfHeight * 0.45,
  };
}

/**
 * Whether a snap guide is currently on screen.
 *
 * NOT `isVisible()`. A guide is an SVG `<line>`, and a perfectly vertical line
 * has a ZERO-WIDTH bounding box — which Playwright reports as not visible. The
 * first version of these tests used `isVisible` and it was wrong twice over: it
 * failed the move test on a guide that was really there, and it made the Alt
 * test a FALSE PASS, since "no guide" was indistinguishable from "a guide
 * Playwright would not admit to seeing".
 *
 * Attachment is the honest question for a zero-area element.
 */
async function guideShowing(page: import("@playwright/test").Page): Promise<boolean> {
  const counts = await Promise.all([
    page.getByTestId("snap-guide-x").count(),
    page.getByTestId("snap-guide-y").count(),
  ]);
  return counts.some((count) => count > 0);
}

async function select(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("outline").getByText(name, { exact: true }).click();
  await expect(page.getByTestId("gizmo")).toBeVisible();
  // The gizmo is drawn from the document; give the first frame time to land so
  // a handle's box is where it will stay.
  await page.waitForTimeout(400);
}

test("moving a graphic shows a guide that says what it snapped to", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);
  await select(page, "Background");

  const start = await bodyPoint(page);

  // Drag from the body of the selection, slowly and in many steps, so the
  // pointer passes through the neighbourhood of at least one candidate rather
  // than jumping over every threshold in one event.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y);
  // Asserted so this test cannot silently become a resize test.
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "move");

  // Sweep across the frame. Somewhere in a sweep this long the box's centre
  // meets the frame centre, another node's edge, or the title-safe margin.
  let sawGuide = false;
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(start.x - 120 + step * 10, start.y - 40 + step * 3);
    if (await guideShowing(page)) {
      sawGuide = true;
      break;
    }
  }
  await page.mouse.up();

  expect(sawGuide, "a move across the frame snapped to nothing at all").toBe(true);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the guide is labelled, so a designer knows WHY it moved", async ({ page }) => {
  await openLowerThird(page);
  await select(page, "Background");

  const start = await bodyPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y);
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "move");

  let label: string | null = null;
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(start.x - 120 + step * 10, start.y);
    const guide = page.getByTestId("snap-guide-x-label");
    if (await guide.isVisible().catch(() => false)) {
      label = await guide.textContent();
      break;
    }
  }
  await page.mouse.up();

  // An unlabelled guide is a line a designer has to guess at, and guessing is
  // why people turn snapping off.
  expect(label, "the guide showed no reason").toBeTruthy();
  expect(["Edge", "Centre", "Title safe", "Equal gap", "Same size"]).toContain(label);
});

test("resizing snaps, and reports the detent it landed on", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openLowerThird(page);
  await select(page, "Accent Bar");

  const handle = await page.getByTestId("handle-se").boundingBox();
  expect(handle).not.toBeNull();

  await page.mouse.move(handle!.x + 3, handle!.y + 3);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "resize");

  // Resize was the gesture with NO snapping of any kind before this. Any
  // feedback at all during the drag is the regression guard.
  let sawFeedback = false;
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(handle!.x + step * 8, handle!.y + step * 4);
    const feedback = [
      await guideShowing(page),
      (await page.getByTestId("ov-detent").count()) > 0,
    ];
    if (feedback.some(Boolean)) {
      sawFeedback = true;
      break;
    }
  }
  await page.mouse.up();

  expect(sawFeedback, "a resize across the frame snapped to nothing").toBe(true);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("rotation snaps by default, not only while Shift is held", async ({ page }) => {
  await openLowerThird(page);
  await select(page, "Accent Bar");

  const grip = await page.getByTestId("handle-rotate").boundingBox();
  expect(grip).not.toBeNull();

  await page.mouse.move(grip!.x + 3, grip!.y + 3);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "rotate");

  // No Shift. Before this change the default gesture produced angles like
  // 7.3°, which is not a design choice — it is something nobody noticed.
  let readout: string | null = null;
  for (let step = 1; step <= 16; step += 1) {
    await page.mouse.move(grip!.x + step * 12, grip!.y + step * 6);
    const detent = page.getByTestId("ov-detent");
    if (await detent.isVisible().catch(() => false)) {
      readout = await detent.textContent();
      break;
    }
  }
  await page.mouse.up();

  // The readout is the angle, and a snapped angle is a whole number of degrees.
  expect(readout, "rotating showed no angle readout").toBeTruthy();
  expect(readout).toMatch(/^-?\d+°$/);
});

test("Alt suspends snapping, so an off-margin placement is still possible", async ({ page }) => {
  await openLowerThird(page);
  await select(page, "Background");

  const start = await bodyPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();

  let sawGuide = false;
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(start.x - 120 + step * 10, start.y);
    if (await guideShowing(page)) {
      sawGuide = true;
      break;
    }
  }
  await page.mouse.up();
  await page.keyboard.up("Alt");

  // The same sweep that snapped without Alt must snap to nothing with it. This
  // is the escape hatch that makes snapping-on-by-default acceptable.
  expect(sawGuide, "Alt did not suspend snapping").toBe(false);
});

test("every snap kind is reachable from the command palette", async ({ page }) => {
  await openLowerThird(page);

  // `commands.ts`: an action with no entry there does not exist. A snap kind
  // reachable only by editing stored workspace JSON is, for the menu bar, the
  // palette and the keyboard, not a feature.
  for (const title of [
    "Toggle snap to grid",
    "Toggle snap to objects",
    "Toggle snap to safe areas",
    "Toggle angle snapping",
    "Toggle size snapping",
  ]) {
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByTestId("palette");
    await expect(palette).toBeVisible();
    await page.keyboard.type(title);
    await expect(palette.getByText(title, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
