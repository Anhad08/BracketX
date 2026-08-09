import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * ANY TRANSFORM → COMMIT → UNDO → EXACT PRE-TRANSFORM STATE.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR, AND WHY IT WAS NOT V-1's
 * ============================================================================
 * A gesture applies its work SILENTLY while the pointer moves, then commits
 * once so the history holds a single step. That commit has to be built in a
 * particular order:
 *
 *   read the destinations → rewind the silent work → build the transaction
 *   against the REWOUND document → apply it
 *
 * Build the transaction before the rewind and its "previous value" is the
 * dragged position, not the starting one — so undo puts the object back where
 * the drag left it. Measured, on an ordinary move:
 *
 *   before drag    x = -4.35
 *   after drag     x =  6.79
 *   after undo     x = 35.66      ← where the drag ENDED
 *
 * The axis-drag path already had the correct order, and its comment already
 * named this exact failure. The free-move path never got the same treatment.
 * That is the shape of the bug: a fix that was found once and not applied
 * everywhere — which is why this file checks EVERY transform rather than the
 * one that happened to be caught.
 */

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(800);
}

/** Every authored transform value, as exact strings. */
async function transform(page: Page): Promise<string> {
  const inspector = page.getByTestId("inspector");
  const read = async (group: string): Promise<string> =>
    (
      await Promise.all(
        ["x", "y", "z"].map((axis) => inspector.getByLabel(`${group} ${axis}`).inputValue()),
      )
    ).join(",");
  return `${await read("position")} | ${await read("rotation")} | ${await read("scale")}`;
}

const history = async (page: Page): Promise<string> =>
  (await page.getByTestId("history").innerText()).trim();

/**
 * Presses on the graphic and returns where, having selected something.
 *
 * Press first, ask second — the object under the pointer is the one being
 * transformed, and assuming a named layer is how an earlier test measured one
 * node before a gesture and a different one after.
 */
async function press(page: Page): Promise<{ x: number; y: number }> {
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const at = { x: stage.x + stage.width * 0.38, y: stage.y + stage.height * 0.74 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  return at;
}

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
};

// ===========================================================================

test("an ordinary move undoes to the exact original state", async ({ page }) => {
  await open(page);
  const at = await press(page);
  const before = await transform(page);
  const depth = await history(page);

  await page.mouse.move(at.x + 180, at.y - 90, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await transform(page), "the move did nothing").not.toBe(before);

  await undo(page);
  expect(await transform(page), "undo did not restore the exact state").toBe(before);
  expect(await history(page)).toBe(depth);
});

test("a move far enough to cross guides still undoes exactly", async ({ page }) => {
  await open(page);
  const at = await press(page);
  const before = await transform(page);

  // Toward the centre, where the snapping guides live. A snap that could not
  // be reversed would show here.
  await page.mouse.move(at.x + 40, at.y - 120, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  await undo(page);
  expect(await transform(page), "a snapped move did not undo exactly").toBe(before);
});

/**
 * THE V-1 CASE, WHICH IS THE SAME CASE.
 *
 * The snap-back is part of the move's own transaction, so one undo takes the
 * object back to where the gesture started — not to the frame edge where it
 * was refused.
 */
test("an off-frame drag and its snap-back undo as one step", async ({ page }) => {
  await open(page);
  const at = await press(page);
  const before = await transform(page);
  const depth = await history(page);

  await page.mouse.move(at.x + 2400, at.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await transform(page)).not.toBe(before);

  await undo(page);
  expect(await transform(page), "undo left the object where the snap put it").toBe(before);
  expect(await history(page), "the snap took its own history step").toBe(depth);
});

test("a resize undoes to the exact original state", async ({ page }) => {
  await open(page);
  await press(page);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const before = await transform(page);

  // A corner handle, which is what resize grabs.
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 140, box.y + box.height + 90, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await transform(page), "the resize did nothing").not.toBe(before);

  await undo(page);
  expect(await transform(page), "a resize did not undo exactly").toBe(before);
});

test("a rotate undoes to the exact original state", async ({ page }) => {
  await open(page);
  await press(page);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const before = await transform(page);

  // The rotate handle sits above the box's top edge.
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 130, box.y + 50, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(await transform(page), "the rotate did nothing").not.toBe(before);

  await undo(page);
  expect(await transform(page), "a rotate did not undo exactly").toBe(before);
});

test("three transforms in a row undo one at a time, back to the start", async ({ page }) => {
  await open(page);
  const at = await press(page);
  const start = await transform(page);
  await page.mouse.up();
  await page.waitForTimeout(300);

  /**
   * Each drag grabs the object BY ITS OWN BOX, not by a fixed screen point.
   *
   * The object moves, so a fixed point picks a different node on the second
   * gesture — which is how an earlier version of this test compared three
   * different objects' positions and reported undo broken. Grabbed at 30%
   * across and 50% down: inside the object, and clear of the eight resize
   * handles on its corners and edge midpoints.
   */
  const dragSame = async (dx: number, dy: number): Promise<void> => {
    const box = (await page.getByTestId("selection-box").first().boundingBox())!;
    const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  void at;

  const states: string[] = [start];
  for (const delta of [
    { dx: 60, dy: 0 },
    { dx: 0, dy: -70 },
    { dx: -90, dy: 40 },
  ]) {
    await dragSame(delta.dx, delta.dy);
    states.push(await transform(page));
  }

  // Each press starts from wherever the object now is, so the states differ.
  expect(new Set(states).size, "the three moves did not all move it").toBeGreaterThan(2);

  // Unwound one at a time, in reverse. A gesture whose transaction recorded
  // the wrong prior state would break the chain at its own step.
  for (let step = states.length - 1; step > 0; step -= 1) {
    await undo(page);
    expect(await transform(page), `undo ${step} landed wrong`).toBe(states[step - 1]);
  }
});

test("redo puts it back where undo took it from", async ({ page }) => {
  await open(page);
  const at = await press(page);
  const before = await transform(page);

  await page.mouse.move(at.x + 150, at.y + 60, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await transform(page);

  await undo(page);
  expect(await transform(page)).toBe(before);

  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(500);
  // The transaction's forward value has to be right as well as its prior one.
  expect(await transform(page), "redo did not restore the move").toBe(after);
});
