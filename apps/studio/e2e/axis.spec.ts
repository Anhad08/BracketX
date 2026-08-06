import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * The three-axis move gizmo, in the real application.
 *
 * `axis.test.ts` proves the geometry. What only a browser can prove is that
 * the arms are DRAWN where they are HIT TESTED, that a drag moves the real
 * document along one axis and no other, and that the whole gesture is a
 * single undo step.
 */
async function openWithBox(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("tool-box").click();
  await expect(page.getByTestId("gizmo")).toBeVisible();
}

async function position(page: Page): Promise<[number, number, number]> {
  const read = async (label: string): Promise<number> =>
    Number(await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue());
  return [await read("position x"), await read("position y"), await read("position z")];
}

/**
 * Drags an arm from a point along it, by a screen delta.
 *
 * The point is interpolated from the line's OWN endpoints, not from its
 * bounding box. A box corner is only on the line when the line happens to run
 * top-left to bottom-right; for an arm running the other way it is nowhere
 * near it, which is a mistake that reads as "the Z axis is not grabbable".
 */
async function dragArm(page: Page, axis: string, dx: number, dy: number): Promise<void> {
  const arm = page.getByTestId(`axis-${axis}`).locator("line");
  const ends = await arm.evaluate((node) => {
    const line = node as unknown as SVGLineElement;
    const chrome = node.closest("svg")!.getBoundingClientRect();
    return {
      left: chrome.left,
      top: chrome.top,
      x1: line.x1.baseVal.value,
      y1: line.y1.baseVal.value,
      x2: line.x2.baseVal.value,
      y2: line.y2.baseVal.value,
    };
  });
  // 70% along the arm: clear of the centre, clear of the head.
  const x1 = ends.left + ends.x1 + (ends.x2 - ends.x1) * 0.7;
  const y1 = ends.top + ends.y1 + (ends.y2 - ends.y1) * 0.7;
  await page.mouse.move(x1, y1);
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-hover", `axis-${axis}`);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "axis");
  await page.mouse.move(x1 + dx, y1 + dy, { steps: 10 });
  await page.mouse.up();
}

/**
 * Switches to 3D and selects a mode.
 *
 * The modes only exist inside 3D — that is the point of the control — so a
 * test that reaches for "3/4" while flat has to press 3D first, exactly as a
 * designer does.
 */
async function enterSpatial(page: Page, mode: string): Promise<void> {
  const button = page.getByTestId(`view-${mode}`);
  if ((await button.count()) === 0) await page.getByTestId("dim-3d").click();
  await page.getByTestId(`view-${mode}`).click();
}

test("the axis arms are drawn, and only the ones you can aim at", async ({ page }) => {
  await openWithBox(page);

  // Front on, Z points at the lens: it projects to a stub that cannot be
  // aimed at, and is not offered. X and Y are.
  await page.getByTestId("dim-2d").click();
  await expect(page.getByTestId("axis-x")).toBeVisible();
  await expect(page.getByTestId("axis-y")).toBeVisible();
  await expect(
    page.getByTestId("axis-z"),
    "an axis pointing at the camera cannot be aimed at and must not be offered",
  ).toHaveCount(0);

  // Turn the camera and Z arrives. One gizmo, no 2D mode and no 3D mode.
  await enterSpatial(page, "three-quarter");
  await expect(page.getByTestId("axis-z")).toBeVisible();
});

test("dragging the X arm moves the node in X and nothing else", async ({ page }) => {
  await openWithBox(page);
  await enterSpatial(page, "three-quarter");

  const before = await position(page);
  await dragArm(page, "x", 120, 40);
  const after = await position(page);

  expect(after[0], "X must change").not.toBeCloseTo(before[0], 3);
  // The pointer moved DOWN as well as across. A constrained drag must ignore
  // that entirely — this is the whole point of choosing an axis first.
  expect(after[1], "Y must not change").toBeCloseTo(before[1], 6);
  expect(after[2], "Z must not change").toBeCloseTo(before[2], 6);
});

test("dragging the Z arm moves the node in depth", async ({ page }) => {
  await openWithBox(page);
  await enterSpatial(page, "three-quarter");

  const before = await position(page);
  await dragArm(page, "z", 90, 30);
  const after = await position(page);

  expect(after[2], "Z must change — this is real depth, not a fake").not.toBeCloseTo(
    before[2],
    3,
  );
  expect(after[0], "X must not change").toBeCloseTo(before[0], 6);
  expect(after[1], "Y must not change").toBeCloseTo(before[1], 6);
});

test("an axis drag is one undo step", async ({ page }) => {
  await openWithBox(page);
  await enterSpatial(page, "three-quarter");

  const before = await position(page);
  await dragArm(page, "x", 130, 0);
  expect((await position(page))[0]).not.toBeCloseTo(before[0], 3);

  await page.keyboard.press("Control+z");
  const undone = await position(page);
  expect(undone[0], "one undo must return the whole drag").toBeCloseTo(before[0], 5);
});
