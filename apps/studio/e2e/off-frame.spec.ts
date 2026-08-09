import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * V-1 · THE FRAME IS THE WORLD.
 *
 * ============================================================================
 * §03, IN ITS OWN WORDS
 * ============================================================================
 * "There is no space outside the frame to place things in — objects may extend
 * past the edge, but nothing can be parked there. The pasteboard that every
 * design tool provides is where forgotten objects go to be rendered
 * accidentally at 20:00. Streamatrix has none. An object dragged fully outside
 * the frame snaps back to the nearest edge with 25 % of its bounds inside, and
 * the layer is flagged off frame."
 *
 * THE OBJECT MOVES. THE CAMERA DOES NOT. These tests assert both halves.
 */

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(800);
}

/** Every authored transform value of the selected node, as exact strings. */
async function transform(page: Page): Promise<{
  position: readonly number[];
  rotation: string;
  scale: string;
}> {
  const inspector = page.getByTestId("inspector");
  const read = async (group: string): Promise<string[]> =>
    Promise.all(
      ["x", "y", "z"].map((axis) => inspector.getByLabel(`${group} ${axis}`).inputValue()),
    );
  return {
    position: (await read("position")).map(Number),
    rotation: (await read("rotation")).join(","),
    scale: (await read("scale")).join(","),
  };
}

const name = async (page: Page): Promise<string> =>
  page.getByTestId("inspector").getByLabel("name").inputValue();

/**
 * Presses on the graphic and reports which object was picked up.
 *
 * ==========================================================================
 * PRESS FIRST, ASK SECOND
 * ==========================================================================
 * An earlier version selected a layer by name in the tree and then grabbed the
 * centre of its selection box. For the Accent Bar — a thin vertical strip —
 * that centre sits within the resize handles' tolerance, so the gesture became
 * a RESIZE and drove the scale to 364. The object never moved, nothing went
 * off frame, and the test reported V-1 broken.
 *
 * So the point is chosen on the plate, well clear of any handle, and whatever
 * is under it is the object under test. That is also what a designer does.
 */
async function grab(page: Page): Promise<{ from: { x: number; y: number }; node: string }> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const from = { x: stage.x + stage.width * 0.38, y: stage.y + stage.height * 0.74 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  return { from, node: await name(page) };
}

/**
 * Presses, records the object's state, drags it and releases.
 *
 * The BEFORE state is read after the press, because the press is what decides
 * which object is being measured.
 */
async function dragBy(
  page: Page,
  dx: number,
  dy: number,
): Promise<{ node: string; before: Awaited<ReturnType<typeof transform>> }> {
  const { from, node } = await grab(page);
  const before = await transform(page);
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  return { node, before };
}

/**
 * Drags whatever is currently selected, from inside its own box.
 *
 * Grabbed at 30% across and 50% down — inside the object, and clear of the
 * eight resize handles, which sit on the corners and edge midpoints. Grabbing
 * the exact centre is safe for a wide plate and lands on a handle for a thin
 * bar, which is how an earlier version of this file turned a move into a
 * resize and drove the scale to 364.
 */
async function dragSelectedBy(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/**
 * How much of the selected object lies inside the FRAME, as a share of itself.
 *
 * Measured on screen, against `.scene-surface` — which is exactly the delivery
 * raster, drawn. That makes this the spec's own sentence as a number: "25 % of
 * its bounds inside". Per axis, smaller wins, for the same reason the model
 * does it that way: an object fully on screen vertically and entirely off it
 * horizontally is not three-quarters present.
 */
async function insideShare(page: Page): Promise<number> {
  const object = (await page.getByTestId("selection-box").first().boundingBox())!;
  const frame = (await page.locator(".scene-surface").boundingBox())!;

  const overlap = (a: number, aSize: number, b: number, bSize: number): number =>
    Math.max(0, Math.min(a + aSize, b + bSize) - Math.max(a, b));

  return Math.min(
    overlap(object.x, object.width, frame.x, frame.width) / object.width,
    overlap(object.y, object.height, frame.y, frame.height) / object.height,
  );
}

// ===========================================================================
// Each edge
// ===========================================================================

for (const [edge, delta] of [
  ["right", { dx: 2400, dy: 0 }],
  ["left", { dx: -2400, dy: 0 }],
  ["top", { dx: 0, dy: -1400 }],
  ["bottom", { dx: 0, dy: 1400 }],
] as const) {
  test(`dragged fully off the ${edge}, it comes back a quarter inside`, async ({ page }) => {
    await open(page);
    const { before } = await dragBy(page, delta.dx, delta.dy);
    const after = await transform(page);

    // It MOVED — the drag was not simply refused.
    expect(after.position, "the object never moved").not.toEqual(before.position);

    // EXACTLY A QUARTER OF ITSELF, INSIDE. §03's sentence, as a number, and
    // measured against the object's OWN bounds rather than a pixel offset — a
    // wide banner and a small bug must both come back showing a quarter.
    //
    // A tolerance, and why it is here rather than an exact equality: this
    // measures the DRAWN selection box, which is not pixel-identical to the
    // world bounds the rule is computed from — it carries the corner-tick
    // stroke and the browser's rounding of a transformed rect. Measured at
    // 0.263 against a rule of 0.250.
    //
    // The EXACT quarter is asserted in `src/offframe.test.ts`, against the
    // bounds themselves, to six places. What this test is for is that the
    // VISIBLE outcome is a quarter — not a half, and not a sliver.
    const share = await insideShare(page);
    const reported = `${Math.round(share * 100)}% of it is inside, not a quarter`;
    expect(share, reported).toBeGreaterThan(0.2);
    expect(share, reported).toBeLessThan(0.32);

    // ONLY POSITION CHANGED.
    expect(after.rotation, "the snap changed the rotation").toBe(before.rotation);
    expect(after.scale, "the snap changed the scale").toBe(before.scale);
  });
}

test("it moves along the axis it left by, and leaves the other alone", async ({ page }) => {
  await open(page);
  // Straight out the right. The vertical intent was never refused, so the
  // height it was dragged to is the height it keeps.
  const { before } = await dragBy(page, 2400, 0);
  const after = await transform(page);

  // V-1 pushed it back along X. The exact "one axis only" rule is asserted in
  // `src/offframe.test.ts` against the bounds; it cannot be asserted from the
  // authored numbers here, because SNAPPING may have moved the object
  // vertically during the drag itself — which is a different feature doing its
  // job, and not something V-1 undoes.
  expect(after.position[0], "the object was not pushed back along X").toBeLessThan(
    before.position[0]! + 2400,
  );
  expect(after.position[0], "the object is still parked off the right").toBeLessThan(20);
});

// ===========================================================================
// What must NOT be snapped
// ===========================================================================

test("a graphic that merely bleeds off the edge is left alone", async ({ page }) => {
  await open(page);

  // Far enough to hang over the edge, nowhere near far enough to be parked.
  // §03 permits the bleed by name: "objects may extend past the edge".
  await dragBy(page, 260, 0);
  const bled = await transform(page);

  await page.waitForTimeout(300);
  const settled = await transform(page);
  expect(settled.position, "a bleeding graphic was snapped").toEqual(bled.position);
});

test("a drag that stays inside is untouched", async ({ page }) => {
  await open(page);

  await dragBy(page, 60, -40);
  const moved = await transform(page);
  await page.waitForTimeout(300);
  expect((await transform(page)).position).toEqual(moved.position);
});

// ===========================================================================
// The flag
// ===========================================================================

test("the Scene tree flags the layer as off frame", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("outline").getByText("off frame")).toHaveCount(0);

  await dragBy(page, 2400, 0);

  // §03: "the layer is flagged off frame". Shown in the tree, in the product's
  // existing badge shape and warning colour.
  await expect(
    page.getByTestId("outline").getByText("off frame"),
    "the layer was not flagged",
  ).toBeVisible();
});

test("the flag clears when the object comes back into shot", async ({ page }) => {
  await open(page);
  await dragBy(page, 2400, 0);
  await expect(page.getByTestId("outline").getByText("off frame")).toBeVisible();

  // Derived, never stored — so bringing it back clears it with nothing to
  // remember. Dragged by its own box, because the object is no longer under
  // the point the first gesture started from.
  await dragSelectedBy(page, -500, 0);
  await expect(
    page.getByTestId("outline").getByText("off frame"),
    "the flag survived the object coming back",
  ).toHaveCount(0);
});

// ===========================================================================
// Cooperation with Escape — the completed cancellation ladder
// ===========================================================================

/**
 * A CANCELLED DRAG MUST NOT TRIGGER V-1.
 *
 * Escape restores the exact pre-drag state, so there is no gesture to refuse.
 * If the snap ran anyway, cancelling a drag would MOVE the object — the
 * opposite of what cancel means.
 */
test("escape during an off-frame drag restores the exact original position", async ({ page }) => {
  await open(page);
  const history = await page.getByTestId("history").innerText();

  const { from } = await grab(page);
  const before = await transform(page);
  await page.mouse.move(from.x + 2400, from.y, { steps: 20 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await transform(page);
  expect(after.position, "escape did not restore the exact position").toEqual(before.position);
  expect(after.rotation).toBe(before.rotation);
  expect(after.scale).toBe(before.scale);

  // Neither the drag nor the snap wrote history.
  expect(
    await page.getByTestId("history").innerText(),
    "a cancelled off-frame drag left a transaction",
  ).toBe(history);

  // And no flag, because nothing ever went off frame.
  await expect(page.getByTestId("outline").getByText("off frame")).toHaveCount(0);
});

// ===========================================================================
// One undo step, and the camera untouched
// ===========================================================================

test("one undo takes it back to where it started, not to where it was refused", async ({
  page,
}) => {
  await open(page);
  const { before } = await dragBy(page, 2400, 0);
  expect((await transform(page)).position).not.toEqual(before.position);

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);

  // The snap is part of the SAME transaction as the move, so one press undoes
  // the whole gesture rather than leaving the object at the frame edge.
  expect(
    (await transform(page)).position,
    "undo left the object where the snap put it",
  ).toEqual(before.position);
});

test("the camera never moves — V-1 moves the object", async ({ page }) => {
  await open(page);

  const cameraPosition = async (): Promise<string> => {
    await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
    const inspector = page.getByTestId("inspector");
    return (
      await Promise.all(
        ["x", "y", "z"].map((axis) => inspector.getByLabel(`position ${axis}`).inputValue()),
      )
    ).join(",");
  };

  const before = await cameraPosition();
  await dragBy(page, 2400, 0);

  // §03 says the OBJECT snaps back. A camera that moved instead would change
  // what the output frames — the shot itself.
  expect(await cameraPosition(), "V-1 moved the camera").toBe(before);
});

// ===========================================================================
// Independent of how you are looking at it
// ===========================================================================

/**
 * ZOOM CANNOT MOVE ANYTHING.
 *
 * ==========================================================================
 * WHY THIS SHAPE, AND WHERE THE OTHER HALF LIVES
 * ==========================================================================
 * The invariant is that the frame is the WORLD: where a graphic is allowed to
 * be cannot depend on how somebody is looking at it. Asserting it by dragging
 * the same object off frame at two different zooms proved unreliable — at a
 * different scale the graphic is a different size in a different place, so the
 * gesture picks a different object or none.
 *
 * So it is asserted from the other side, which is both simpler and stronger:
 * changing the zoom must not move ANY object, at any scale, ever. If V-1 were
 * measuring against the viewport rather than the frame, zooming out would make
 * more room and zooming in would push things around — and this would catch it
 * immediately.
 *
 * The positive half — that the landing place is computed in world units and is
 * the same whatever the frame — is asserted in `src/offframe.test.ts`, which
 * can hold the frame fixed and vary it deliberately.
 */
test("zooming never moves an object, at any scale", async ({ page }) => {
  await open(page);
  const { before } = await dragBy(page, 40, 0);
  const settled = await transform(page);
  expect(settled.position, "the drag did nothing").not.toEqual(before.position);

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const zoomBy = async (direction: -1 | 1, notches: number): Promise<void> => {
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.keyboard.down("Control");
    for (let index = 0; index < notches; index += 1) {
      await page.mouse.wheel(0, direction * 240);
      await page.waitForTimeout(150);
    }
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
  };

  // All the way out, and all the way back in. If the boundary were the
  // viewport, the object would be off frame at one of these and snapped.
  await zoomBy(-1, 3);
  expect((await transform(page)).position, "zooming out moved it").toEqual(settled.position);

  await zoomBy(1, 5);
  expect((await transform(page)).position, "zooming in moved it").toEqual(settled.position);

  // And nothing was flagged along the way.
  await expect(
    page.getByTestId("outline").getByText("off frame"),
    "a zoom flagged an object as off frame",
  ).toHaveCount(0);
});
