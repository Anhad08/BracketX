import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * DOES THE SELECTION SIT ON THE OBJECT?
 *
 * ============================================================================
 * WHY THIS MEASURES PIXELS AND NOT BOUNDS
 * ============================================================================
 * `bounds.test.ts` proves the arithmetic of `nodeBounds`. It cannot prove the
 * thing that was actually reported: that the frame a designer sees is not on
 * the object a designer sees. Any test comparing the selection against another
 * call to the selection code will agree with itself while both are wrong —
 * which is how this defect survived a passing suite.
 *
 * So the object's position and size are read from THE RENDERER, as lit pixels,
 * by hiding the node and diffing the canvas. Whatever changed between those two
 * frames is that node's footprint, exactly, owing nothing to the editor's idea
 * of where it is. That is then compared with the drawn selection rect.
 *
 *     footprint (pixels the renderer changed)  ==  .sel-field (the frame drawn)
 *
 * The bug: `nodeBounds` read `matrix[0]`/`matrix[5]` as the x/y scale. For a
 * rotated node those are `cos(theta) * scale`, so the frame shrank as the
 * object turned — to nothing at 90 degrees — and stayed axis-aligned while it
 * did. The error grew with the angle, which is why it read as the selection
 * drifting away from the object rather than as a constant offset.
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const NODE = "Accent Bar";

/**
 * The Accent Bar, because it is DELIBERATELY ASYMMETRIC — a tall narrow flag,
 * about 1:7. A square tells you nothing: every wrong answer about width and
 * height looks the same on it, and the two axes can be swapped undetected.
 */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-section", "design");
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText(NODE, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".scene-surface canvas").first()).toBeVisible();
  await page.waitForTimeout(900);
}

async function select(page: Page, name: string): Promise<void> {
  await page.getByTestId("outline").getByText(name, { exact: true }).click();
  await expect(page.getByTestId("selection-box").first()).toBeVisible();
}

/** Raw device pixels, plus what it takes to map them back to the page. */
async function frame(page: Page) {
  const canvas = page.locator(".scene-surface canvas").first();
  const box = await canvas.boundingBox();
  expect(box, "no canvas to read").not.toBeNull();
  const data = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext;
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width: c.width, height: c.height, bytes: Array.from(pixels) };
  });
  return { ...data, rect: box! };
}

/**
 * Where the node actually IS, in page coordinates, according to the renderer.
 *
 * Hide it, read the canvas, show it again, read the canvas: the pixels that
 * differ are its footprint. Visibility is an undoable document edit, so this
 * leaves the document exactly as it found it.
 */
async function footprint(page: Page, name: string): Promise<Box> {
  // `.last()`, because the outline nests: every ancestor's `li` also contains
  // this node's text, and `.first()` matches the outermost one — a row holding
  // every sibling's toggle as well as this one's.
  const row = page.getByTestId("outline").locator("li").filter({ hasText: name }).last();
  // DISPATCHED, not clicked. This is instrumentation, not the behaviour under
  // test, and a real click waits for actionability on a row that the selection
  // and the inspector are both re-rendering — which hung for the full timeout
  // on the second press every time.
  const toggle = async (label: "Hide node" | "Show node") => {
    await row.getByRole("button", { name: label }).dispatchEvent("click");
  };

  const shown = await frame(page);
  await toggle("Hide node");
  await page.waitForTimeout(700);
  const hidden = await frame(page);
  await toggle("Show node");
  await page.waitForTimeout(700);

  expect(hidden.width, "the surface resized mid-measurement").toBe(shown.width);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let changed = 0;
  for (let y = 0; y < shown.height; y += 1) {
    for (let x = 0; x < shown.width; x += 1) {
      const i = (y * shown.width + x) * 4;
      const delta =
        Math.abs(shown.bytes[i]! - hidden.bytes[i]!) +
        Math.abs(shown.bytes[i + 1]! - hidden.bytes[i + 1]!) +
        Math.abs(shown.bytes[i + 2]! - hidden.bytes[i + 2]!) +
        Math.abs(shown.bytes[i + 3]! - hidden.bytes[i + 3]!);
      // Above dither and antialias noise, below any real coverage. A single
      // stray pixel would otherwise stretch the footprint across the frame.
      if (delta < 40) continue;
      changed += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  expect(changed, `hiding ${name} changed nothing on the canvas`).toBeGreaterThan(50);

  // readPixels has row 0 at the BOTTOM; the page has it at the top.
  const scale = shown.width / shown.rect.width;
  return {
    x: shown.rect.x + minX / scale,
    y: shown.rect.y + (shown.height - 1 - maxY) / scale,
    width: (maxX - minX + 1) / scale,
    height: (maxY - minY + 1) / scale,
  };
}

/** The frame the designer sees, in the same page coordinates. */
async function drawn(page: Page): Promise<Box> {
  const field = page.locator(".selection-box .sel-field").first();
  const box = await field.boundingBox();
  expect(box, "nothing is drawing a selection").not.toBeNull();
  return box!;
}

/**
 * The whole assertion, in one place, so every stage below reads the same way.
 *
 * Tolerance is in SCREEN PIXELS and generous, because the two measurements are
 * honestly different things: an antialiased edge lands a pixel wide either way,
 * a paint shadow bleeds past its rect, and the frame is stroked. What is being
 * defended is not sub-pixel agreement — it is that the frame is ON the object
 * and THE SIZE OF it. The failures this catches were 40% and 100% wrong.
 */
async function aligned(page: Page, stage: string, tolerance = 16): Promise<void> {
  const object = await footprint(page, NODE);
  const frameBox = await drawn(page);
  const report =
    `${stage}\n` +
    `  object    x=${object.x.toFixed(1)} y=${object.y.toFixed(1)} ` +
    `w=${object.width.toFixed(1)} h=${object.height.toFixed(1)}\n` +
    `  selection x=${frameBox.x.toFixed(1)} y=${frameBox.y.toFixed(1)} ` +
    `w=${frameBox.width.toFixed(1)} h=${frameBox.height.toFixed(1)}`;
  console.log(report);

  const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  expect(
    Math.abs(centre(frameBox).x - centre(object).x),
    `${report}\n  CENTRE X`,
  ).toBeLessThan(tolerance);
  expect(
    Math.abs(centre(frameBox).y - centre(object).y),
    `${report}\n  CENTRE Y`,
  ).toBeLessThan(tolerance);
  expect(Math.abs(frameBox.width - object.width), `${report}\n  WIDTH`).toBeLessThan(tolerance);
  expect(Math.abs(frameBox.height - object.height), `${report}\n  HEIGHT`).toBeLessThan(
    tolerance,
  );
}

test("the frame sits on the object through move, rotate and scale", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await select(page, NODE);

  // Framed, so the flag is big enough for a pixel measurement to mean anything.
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(600);
  await aligned(page, "AT REST");

  // MOVE. Dragged from a point clear of the handles and the gizmo arms.
  const start = await drawn(page);
  const grab = { x: start.x + start.width / 2, y: start.y + start.height * 0.78 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 60, grab.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await aligned(page, "AFTER MOVE");

  // ROTATE. This is the stage the old code could not survive: the frame width
  // was `size * cos(theta)`, so it narrowed as the flag turned and the handles
  // walked off the object.
  const grip = await page.getByTestId("handle-rotate").boundingBox();
  expect(grip, "no rotation grip").not.toBeNull();
  const pivot = await drawn(page);
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("scene-chrome")).toHaveAttribute("data-drag", "rotate");
  // A quarter turn: dragged to the pivot's own right, which is 90 degrees round
  // from a grip that starts above it.
  await page.mouse.move(pivot.x + pivot.width / 2 + 240, pivot.y + pivot.height / 2, {
    steps: 14,
  });
  await page.mouse.up();
  await page.waitForTimeout(800);

  const turned = await footprint(page, NODE);
  console.log(
    `AFTER ROTATE object w=${turned.width.toFixed(1)} h=${turned.height.toFixed(1)}`,
  );
  // The flag is now lying down, so the RENDERED footprint is wider than tall.
  // Asserted on the object first: if the gesture did not turn it, the rest of
  // this test would be checking nothing and passing.
  expect(turned.width, "the rotate gesture did not turn the object").toBeGreaterThan(
    turned.height,
  );
  await aligned(page, "AFTER ROTATE");

  // SCALE, on the rotated object — the combination the arithmetic gets wrong in
  // a way neither one alone reveals.
  const east = await page.getByTestId("handle-e").boundingBox();
  expect(east).not.toBeNull();
  await page.mouse.move(east!.x + east!.width / 2, east!.y + east!.height / 2);
  await page.mouse.down();
  await page.mouse.move(east!.x + east!.width / 2 + 90, east!.y + east!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await aligned(page, "AFTER SCALE");

  expect(errors, errors.join("\n")).toEqual([]);
});

test("the frame stays on the object across zoom levels and after a pan", async ({ page }) => {
  await open(page);
  await select(page, NODE);
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(600);

  // Zoom is where a wrong ppu or a stale viewport shows up, and it is the state
  // a designer changes most often.
  for (const step of [1, 2, 3]) {
    await page.keyboard.press("Equal");
    await page.waitForTimeout(400);
    await aligned(page, `ZOOMED IN x${step}`);
  }
  for (const step of [1, 2]) {
    await page.keyboard.press("Minus");
    await page.waitForTimeout(400);
    await aligned(page, `ZOOMED OUT x${step}`);
  }

  // PAN. A translation applied to the view and not to the frame is the other
  // half of "the selection drifts", and it only shows once the object is no
  // longer centred.
  const surface = await page.locator(".scene-surface").boundingBox();
  expect(surface).not.toBeNull();
  await page.keyboard.down("Space");
  await page.mouse.move(surface!.x + surface!.width / 2, surface!.y + surface!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    surface!.x + surface!.width / 2 - 120,
    surface!.y + surface!.height / 2 + 70,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(700);
  await aligned(page, "AFTER PAN");
});

test("a GROUP can be selected, framed and moved once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);

  // Two siblings, grouped — the gesture a designer makes constantly.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  await page
    .getByTestId("outline")
    .getByText("Name", { exact: true })
    .click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.getByTestId("outline").getByText("Group", { exact: true })).toBeVisible();
  await page.waitForTimeout(600);

  // THE DEFECT. `arrange.group` gives its container no size, and `nodeBounds`
  // skipped anything without one — so the group a designer had just made had no
  // frame and no handles. It appeared in Layers and did not exist in the
  // viewport.
  await page.getByTestId("outline").getByText("Group", { exact: true }).click();
  await expect(
    page.locator(".selection-box .sel-field").first(),
    "a group has no selection frame",
  ).toBeVisible();
  await expect(page.getByTestId("handle-e"), "a group has no handles").toBeVisible();

  const before = await drawn(page);
  // And it is boxed by its CONTENTS: two nodes that are yards apart cannot give
  // a group a box smaller than either of them.
  expect(before.width).toBeGreaterThan(40);
  expect(before.height).toBeGreaterThan(20);

  // MOVED ONCE, not twice. Selecting the group and a child together used to
  // write the delta to both, and the child travelled double.
  await page.keyboard.press("ControlOrMeta+a");
  await page.waitForTimeout(400);
  const child = await footprint(page, "Accent Bar");
  const grab = { x: before.x + before.width / 2, y: before.y + before.height * 0.85 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 120, grab.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const movedChild = await footprint(page, "Accent Bar");

  const travelled = movedChild.x - child.x;
  console.log(`GROUP MOVE pointer=120 child travelled=${travelled.toFixed(1)}`);
  // Within a snap of the pointer's own distance — and nowhere near 240.
  expect(travelled, "the child did not move with its group").toBeGreaterThan(60);
  expect(travelled, "the child moved twice: parent delta plus its own").toBeLessThan(190);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("the frame sits on TEXT, which has geometry of its own", async ({ page }) => {
  // Text is the case the flat-rect assumption is most wrong about: a text node
  // hangs from its top-left rather than being centred on its origin, and its
  // `size` is the box the words are fitted INTO, not the box they fill. So the
  // claim asserted here is containment, and a text change must not move the
  // frame off the words.
  await open(page);
  await select(page, "Name");
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(600);

  const inside = (object: Box, box: Box, slack: number) => {
    expect(object.x + slack, "words start left of the frame").toBeGreaterThan(box.x - slack);
    expect(object.x + object.width, "words run past the frame").toBeLessThan(
      box.x + box.width + slack,
    );
    expect(object.y + slack, "words sit above the frame").toBeGreaterThan(box.y - slack);
    expect(object.y + object.height, "words sit below the frame").toBeLessThan(
      box.y + box.height + slack,
    );
  };

  inside(await footprint(page, "Name"), await drawn(page), 20);

  // CHANGE THE TEXT. The frame must follow the new extent, not the old one.
  const field = page.getByTestId("content").locator("input.field").first();
  await field.fill("JO");
  await field.blur();
  await page.waitForTimeout(900);
  inside(await footprint(page, "Name"), await drawn(page), 20);
});
