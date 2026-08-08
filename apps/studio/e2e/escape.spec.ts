import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * ONE ESCAPE, AND WHAT IT BACKS OUT OF FIRST.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * Escape was claimed in six places — the menu bar, the Scene tree's row menu,
 * the stage's context menu, walk mode, the command palette and the keymap —
 * each with its own window listener, three of them in capture phase so they
 * could win. Whichever mounted last took the key. Closing a context menu also
 * cleared the selection behind it; the fix for that swallowed Escape from
 * everything else.
 *
 * Now there is one listener and one ladder:
 *
 *   overlay → gesture → mode → air → selection
 *
 * The tests below are all about COMPETING states: two things open at once,
 * and exactly one of them must give way.
 */

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(800);
}

const name = async (page: Page): Promise<string> =>
  page.getByTestId("inspector").getByLabel("name").inputValue();

/** Every authored transform value, as strings, so equality is exact. */
async function transform(page: Page): Promise<{ position: string; rotation: string; scale: string }> {
  const inspector = page.getByTestId("inspector");
  const read = async (group: string): Promise<string> =>
    (
      await Promise.all(
        ["x", "y", "z"].map((axis) => inspector.getByLabel(`${group} ${axis}`).inputValue()),
      )
    ).join(",");
  return { position: await read("position"), rotation: await read("rotation"), scale: await read("scale") };
}

const selected = async (page: Page): Promise<string> =>
  (await page.getByTestId("statusbar").innerText()).split("\n")[0] ?? "";

// ===========================================================================
// overlay before selection
// ===========================================================================

test("closing a menu does not also clear the selection", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");

  await page.getByTestId("outline").getByText("Background", { exact: true })
    .click({ button: "right" });
  await expect(page.getByTestId("tree-menu")).toBeVisible();

  await page.keyboard.press("Escape");

  // THE BUG THIS REPLACES: one press used to do both.
  await expect(page.getByTestId("tree-menu")).toHaveCount(0);
  expect(await selected(page), "the menu and the selection both went").toContain("1 selected");

  // And the SECOND press clears it, because now that is the innermost thing.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("statusbar")).toContainText("0 selected");
});

/**
 * FIXED — and the ladder was never the problem.
 *
 * Instrumenting `cancel()` showed it returning "overlay" and the menu closing
 * correctly. The selection had already gone: `onPointerDown` did not ignore
 * the RIGHT button, so right-clicking empty stage began a marquee whose
 * release cleared the selection — before Escape was pressed at all. The menu
 * then opened over a selection that had just been thrown away.
 *
 * The right button now belongs to the menu, declared in `pointerIntent` so
 * the rule lives in the model rather than as a guard somebody can forget.
 */
test("the stage menu closes first, and the stage still works after", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2, {
    button: "right",
  });
  await expect(page.getByTestId("context-menu")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  expect(await selected(page)).toContain("1 selected");

  // The menu sits on a full-surface scrim. One that lingered would leave the
  // viewport dead to every pointer event — the original reason this was fixed.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");
});

test("the menu bar closes without touching anything behind it", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();

  await page.getByRole("button", { name: "View", exact: true }).first().click();
  await page.waitForTimeout(200);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await selected(page), "closing the menu bar cleared the selection").toContain(
    "1 selected",
  );
});

// ===========================================================================
// gesture before everything below it
// ===========================================================================

/**
 * THE CAPABILITY THAT DID NOT EXIST.
 *
 * A drag could not be cancelled. The only ways down were to drop it —
 * committing wherever the pointer was — or to drop it and undo, which is a
 * different gesture with a different result.
 */
/**
 * ESCAPE RESTORES THE EXACT PRE-DRAG STATE.
 *
 * ==========================================================================
 * THE "16px DISCREPANCY" WAS THIS TEST, NOT THE PRODUCT
 * ==========================================================================
 * An earlier version selected Background in the tree, pressed on the stage,
 * and compared selection boxes. Pressing on the stage selects whatever is
 * UNDER THE POINTER — the Name text sits over the plate — so it measured one
 * node before and a different node after, and reported the gap between them
 * as a failure to restore. Instrumented:
 *
 *   before press   Background   0, 0, 0
 *   after press    Name        -4.35,  0.32, 0.02
 *   during drag    Name        -0.75, -1.61, 0.02
 *   after Escape   Name        -4.35,  0.32, 0.02
 *
 * Exactly restored. So this test now presses, reads WHICH node it got, and
 * asserts on that one — by its authored numbers, string-equal, not by a
 * tolerance and not by a screen box.
 */
test("escape during a drag restores the exact pre-drag state", async ({ page }) => {
  await open(page);

  // Press first, then ask what was picked. The node under the pointer is the
  // one being dragged, and it is the only one worth measuring.
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const grab = { x: stage.x + stage.width * 0.45, y: stage.y + stage.height * 0.72 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.waitForTimeout(200);

  const dragged = await name(page);
  const before = await transform(page);
  const history = await page.getByTestId("history").innerText();

  await page.mouse.move(grab.x + 220, grab.y + 120, { steps: 15 });
  await page.waitForTimeout(200);
  const during = await transform(page);
  expect(during.position, "the drag never moved anything").not.toBe(before.position);

  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await transform(page);
  // EXACT. A cancelled gesture leaves no trace, so every authored number is
  // string-equal to what it was — not close to it.
  expect(await name(page), "the selection changed under the cancel").toBe(dragged);
  expect(after.position, "position was not restored exactly").toBe(before.position);
  expect(after.rotation, "rotation was not restored exactly").toBe(before.rotation);
  expect(after.scale, "scale was not restored exactly").toBe(before.scale);

  // And nothing to undo, because nothing happened.
  expect(
    await page.getByTestId("history").innerText(),
    "a cancelled drag left a transaction behind",
  ).toBe(history);
});

test("escape during a drag keeps the selection", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3 + 150, box.y + box.height * 0.5, { steps: 10 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  // The gesture rung took the key; the selection rung never heard it.
  expect(await selected(page), "cancelling a drag also cleared the selection").toContain(
    "1 selected",
  );
});

// ===========================================================================
// mode, and the order below it
// ===========================================================================

test("escape leaves walk mode before it clears the selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByText("3D scene", { exact: true }).click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "expert");
  await page.waitForTimeout(900);

  await page.getByTestId("tool-box").click();
  await page.waitForTimeout(700);
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");

  await page.keyboard.press("Shift+`");
  await expect(page.getByTestId("ov-walking")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ov-walking")).toHaveCount(0);
  expect(await selected(page), "leaving walk mode also cleared the selection").toContain(
    "1 selected",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("statusbar")).toContainText("0 selected");
});

// ===========================================================================
// nothing open
// ===========================================================================

test("escape with nothing open does nothing at all", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const history = await page.getByTestId("history").innerText();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Escape with nothing to back out of must not reach for the nearest
  // closable thing, and must certainly not edit the document.
  expect(await selected(page)).toContain("0 selected");
  expect(await page.getByTestId("history").innerText()).toBe(history);
});

test("a text field keeps escape for itself", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");

  const field = page.getByTestId("inspector").getByLabel("name");
  await field.click();
  await field.press("Escape");
  await page.waitForTimeout(200);

  // Typing is its own context. Escape there belongs to the field, and must not
  // reach past it to clear what the designer is editing.
  expect(await selected(page), "escape escaped a text field").toContain("1 selected");
});

// ===========================================================================
// The same invariant, under every gesture that can move something
// ===========================================================================

/**
 * BEGIN → arbitrary interaction → snapping may occur → Escape → EXACT BEGIN.
 *
 * Snapping is on by default, so the plain drag above already crosses guides;
 * this one drags a short distance near the frame's centre, where the
 * centre-line snap is most likely to grab, and asserts the same exactness.
 * A snap that could not be reversed would show here first.
 */
test("escape reverses a snapped drag exactly", async ({ page }) => {
  await open(page);
  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  const grab = { x: stage.x + stage.width * 0.45, y: stage.y + stage.height * 0.72 };

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const before = await transform(page);

  // Short, toward the centre, where the guides live.
  await page.mouse.move(grab.x + 30, grab.y - 40, { steps: 12 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  expect((await transform(page)).position).toBe(before.position);
});

test("escape reverses a scale exactly", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  await page.waitForTimeout(300);
  const before = await transform(page);

  // A corner handle of the selection box, which is what resize grabs.
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 120, box.y + box.height + 80, { steps: 12 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await transform(page);
  expect(after.scale, "scale was not restored exactly").toBe(before.scale);
  expect(after.position, "a cancelled resize moved the object").toBe(before.position);
});

test("escape reverses a rotate exactly", async ({ page }) => {
  await open(page);
  await page.getByTestId("outline").getByText("Background", { exact: true }).click();
  await page.waitForTimeout(300);
  const before = await transform(page);

  // The rotate handle sits above the box's top edge.
  const box = (await page.getByTestId("selection-box").first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y - 18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 40, { steps: 12 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await transform(page);
  expect(after.rotation, "rotation was not restored exactly").toBe(before.rotation);
  expect(after.position, "a cancelled rotate moved the object").toBe(before.position);
});

test("escape reverses a pan, returning the view exactly", async ({ page }) => {
  await open(page);
  const surfaceBox = async (): Promise<string> => {
    const box = (await page.locator(".scene-surface").boundingBox())!;
    return `${box.x.toFixed(2)},${box.y.toFixed(2)}`;
  };
  const before = await surfaceBox();

  const stage = (await page.getByTestId("scene-view").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(stage.x + stage.width / 2 + 180, stage.y + stage.height / 2 + 90, {
    steps: 12,
  });
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);

  // Pan moves the VIEW, so cancelling restores the viewport rather than the
  // document — the same invariant, one layer out.
  expect(await surfaceBox(), "the view did not return").toBe(before);
});
