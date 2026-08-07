import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Rotate and scale, in space, in the real application.
 *
 * ============================================================================
 * WHAT ONLY A BROWSER CAN PROVE HERE
 * ============================================================================
 * `spin.test.ts` proves the geometry: where a ring lands, which one a pointer
 * is over, what a turn composes to. It cannot prove the three things that
 * actually decide whether the viewport works:
 *
 *   · that the rings are DRAWN where they are HIT TESTED
 *   · that dragging one changes the real document
 *   · that the flat editor's box handles STOP being offered in space, where
 *     they can only rotate about Z and scale in X and Y
 *
 * The last is a negative assertion and it is the important one. A build that
 * drew both would look richer and would be offering a control that silently
 * does a third of what it appears to.
 */

async function openInSpace(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Into 3D. The camera FLIES there, so the arrival is waited for rather than
  // timed — the mode switcher only exists once the camera is off Front.
  await page.getByTestId("dim-3d").click();
  await expect(page.getByTestId("gizmo-modes")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
}

/** The value of one inspector transform field. */
async function field(page: Page, label: string): Promise<number> {
  const value = await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue();
  return Number(value);
}

test("the three transforms are offered, and only in space", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");

  // Square-on there is one plane and the box handles already offer all three,
  // so a mode switch would be three buttons that change nothing.
  await expect(page.getByTestId("gizmo-modes")).toHaveCount(0);

  await page.getByTestId("dim-3d").click();
  await expect(page.getByTestId("gizmo-modes")).toBeVisible({ timeout: 10_000 });
  for (const mode of ["move", "rotate", "scale"]) {
    await expect(page.getByTestId(`gizmo-${mode}`)).toBeVisible();
  }
  // Move is where it starts: the transform that can undo what the other two do.
  await expect(page.getByTestId("gizmo-move")).toHaveAttribute("aria-pressed", "true");
});

test("each mode shows its own gizmo and no other", async ({ page }) => {
  await openInSpace(page);

  await expect(page.getByTestId("axes")).toBeVisible();
  await expect(page.getByTestId("rings")).toHaveCount(0);
  await expect(page.getByTestId("stretchers")).toHaveCount(0);

  await page.getByTestId("gizmo-rotate").click();
  await expect(page.getByTestId("rings")).toBeVisible();
  await expect(page.getByTestId("axes")).toHaveCount(0);

  await page.getByTestId("gizmo-scale").click();
  await expect(page.getByTestId("stretchers")).toBeVisible();
  await expect(page.getByTestId("rings")).toHaveCount(0);

  /**
   * THE NEGATIVE ASSERTION.
   *
   * The flat editor's nine box handles are computed from a screen-space
   * rectangle and solved against the z = 0 plane. In space they can rotate
   * about Z alone and scale in X and Y alone — a control that appears to offer
   * three dimensions and delivers two. They must not be on screen here at all.
   */
  await expect(page.getByTestId("gizmo")).toHaveCount(0);
});

test("G, R and S switch the tool, as they do in every 3D application", async ({ page }) => {
  await openInSpace(page);

  await page.keyboard.press("r");
  await expect(page.getByTestId("gizmo-rotate")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rings")).toBeVisible();

  await page.keyboard.press("s");
  await expect(page.getByTestId("gizmo-scale")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("g");
  await expect(page.getByTestId("gizmo-move")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("axes")).toBeVisible();

  // And the modified variants still mean what they always meant — ⌘G groups.
  // A new binding that quietly stole an old one would be the worst kind.
  await expect(page.getByTestId("rings")).toHaveCount(0);
});

test("dragging a ring turns the real layer, as one undo step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openInSpace(page);
  await page.getByTestId("gizmo-rotate").click();

  const before = {
    x: await field(page, "rotation x"),
    y: await field(page, "rotation y"),
    z: await field(page, "rotation z"),
  };

  // Grabbed at a point read off the polyline's OWN coordinates, not from its
  // bounding box. That is the assertion: the hit test measures distance to
  // this polyline, so a ring drawn anywhere other than where it is tested
  // would make this grab miss and the press would fall through to the layer.
  const ring = page.getByTestId("ring-y");
  await expect(ring).toBeVisible();
  const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
  const drawn = (await ring.getAttribute("points"))!
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
  const on = drawn[Math.floor(drawn.length / 4)]!;
  const grab = { x: chrome.x + on[0]!, y: chrome.y + on[1]! };

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // `data-drag` proves the RING was grabbed. A change in the numbers alone
  // cannot tell "the ring was missed and the layer was dragged instead" from
  // "the rotation was small", and that ambiguity has hidden a real bug in this
  // component before.
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "ring");
  await page.mouse.move(grab.x - 70, grab.y + 40, { steps: 14 });
  await page.mouse.up();

  const after = {
    x: await field(page, "rotation x"),
    y: await field(page, "rotation y"),
    z: await field(page, "rotation z"),
  };
  const moved =
    Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.z - before.z);
  expect(moved, "dragging a ring must turn the layer").toBeGreaterThan(2);

  // One gesture, one undo entry.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => field(page, "rotation y"))
    .toBeCloseTo(before.y, 1);
  expect(await field(page, "rotation x")).toBeCloseTo(before.x, 1);
  expect(await field(page, "rotation z")).toBeCloseTo(before.z, 1);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("dragging a scale handle stretches along that axis and no other", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await openInSpace(page);
  await page.getByTestId("gizmo-scale").click();

  const before = {
    x: await field(page, "scale x"),
    y: await field(page, "scale y"),
    z: await field(page, "scale z"),
  };

  const handle = page.getByTestId("stretch-x");
  await expect(handle).toBeVisible();
  const cap = (await handle.locator("rect").boundingBox())!;
  const grab = { x: cap.x + cap.width / 2, y: cap.y + cap.height / 2 };

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "stretch");
  await page.mouse.move(grab.x + 120, grab.y, { steps: 14 });
  await page.mouse.up();

  const after = {
    x: await field(page, "scale x"),
    y: await field(page, "scale y"),
    z: await field(page, "scale z"),
  };
  expect(after.x, "the X handle must stretch X").toBeGreaterThan(before.x + 0.05);
  // ONE axis. A handle that stretched everything would be a uniform scale
  // wearing a directional arrow, and there would be no way to make anything
  // wider than it is tall.
  expect(after.y).toBeCloseTo(before.y, 2);
  expect(after.z).toBeCloseTo(before.z, 2);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => field(page, "scale x")).toBeCloseTo(before.x, 1);

  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * The flat editor is untouched.
 *
 * Everything above changes what happens in space. A lower third is designed
 * square-on, and the day that stopped working the way it always has would be
 * the day this sprint cost more than it delivered.
 */
test("square-on, the box handles are exactly as they were", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();

  await expect(page.getByTestId("gizmo")).toBeVisible();
  for (const id of ["nw", "n", "ne", "w", "e", "sw", "s", "se", "rotate"]) {
    await expect(page.getByTestId(`handle-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("rings")).toHaveCount(0);
  await expect(page.getByTestId("stretchers")).toHaveCount(0);
});
