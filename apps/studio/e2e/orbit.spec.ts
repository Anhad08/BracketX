import { expect, test, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * Orbit — the product's defining gesture, in the real application.
 *
 * `camera.test.ts` proves the maths and pins it against three.js. What only a
 * browser can prove is that the gesture moves the SCENE CAMERA, that the
 * change is a document edit which undoes in one step, and — the part that
 * matters most — that selection still lands on the graphic afterwards.
 *
 * That last one is the whole reason this could not be built before. The old
 * viewport maths was a flat map that ignored the camera, so the moment the
 * camera left the Z axis every handle and every hit test would have pointed
 * somewhere the graphic is not, while the rendered picture stayed correct.
 */
async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await ensureDepth(page, "designer");
  await expect(page.getByTestId("outline").getByText("Accent Bar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** The camera's authored position, read from the layer tree's own inspector. */
async function cameraPosition(page: Page): Promise<[number, number, number]> {
  await page.getByTestId("outline").getByText("Camera", { exact: true }).first().click();
  const read = async (label: string): Promise<number> =>
    Number(await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue());
  return [await read("position x"), await read("position y"), await read("position z")];
}

test("orbiting turns the scene camera, and it undoes in one step", async ({ page }) => {
  await open3D(page);

  const before = await cameraPosition(page);
  // A default broadcast camera sits on the Z axis looking at the origin.
  expect(before[0]).toBeCloseTo(0, 5);
  expect(before[2]).toBeGreaterThan(0);

  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await expect(chrome).toHaveAttribute("data-drag", "orbit");
  await page.mouse.move(cx + 160, cy, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Shift");

  const after = await cameraPosition(page);
  // Turned about Y: X must have swung out, and the distance is preserved.
  expect(Math.abs(after[0]), "orbiting must move the camera off the Z axis").toBeGreaterThan(1);
  const radiusBefore = Math.hypot(before[0], before[1], before[2]);
  const radiusAfter = Math.hypot(after[0], after[1], after[2]);
  expect(radiusAfter, "orbit must not change the distance to the pivot").toBeCloseTo(
    radiusBefore,
    1,
  );

  // ONE undo step for the whole turn, not one per pointer move.
  await page.keyboard.press("Control+z");
  const undone = await cameraPosition(page);
  expect(undone[0]).toBeCloseTo(before[0], 3);
  expect(undone[2]).toBeCloseTo(before[2], 3);
});

test("selection still lands on the graphic after the camera has moved", async ({ page }) => {
  await open3D(page);

  const chrome = page.getByTestId("scene-chrome");
  const box = (await chrome.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Shift");

  // Select through the layer tree, then read where the editor believes the
  // graphic is, and click THERE. Under the old flat map this point would have
  // been somewhere the graphic is not.
  await page.getByTestId("outline").getByText("Accent Bar", { exact: true }).click();
  const gizmo = (await page.getByTestId("gizmo").boundingBox())!;
  await page.mouse.click(gizmo.x + gizmo.width / 2, gizmo.y + gizmo.height / 2);

  await expect(
    page.getByTestId("gizmo"),
    "clicking where the editor draws the graphic must select the graphic, " +
      "whatever the camera is doing",
  ).toBeVisible();
  await expect(page.getByTestId("statusbar")).toContainText("1 selected");
});

test("named views move the camera, and the control says where you are", async ({ page }) => {
  await open3D(page);

  // Studio opens Front — that is where flat graphics are designed.
  await expect(page.getByTestId("view-front")).toHaveClass(/on/);

  await page.getByTestId("view-side").click();
  await expect(page.getByTestId("view-side")).toHaveClass(/on/);
  await expect(page.getByTestId("view-front")).not.toHaveClass(/on/);

  const side = await cameraPosition(page);
  // From the right: X carries the distance, Z is through zero.
  expect(Math.abs(side[0])).toBeGreaterThan(1);
  expect(Math.abs(side[2])).toBeLessThan(0.01);

  await page.getByTestId("view-top").click();
  const top = await cameraPosition(page);
  expect(top[1], "Top must be above the scene").toBeGreaterThan(1);

  // Choosing a view RE-AIMS without RE-FRAMING: the distance is preserved.
  expect(Math.hypot(...top)).toBeCloseTo(Math.hypot(...side), 1);

  // Orbiting away un-highlights the view — "I am in Top" and "I have orbited
  // back to roughly the top" are different states, and only one of them is
  // pixel-accurate.
  const box = (await page.getByTestId("scene-chrome").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("view-top")).not.toHaveClass(/on/);

  // And it undoes as one step, back into the named view.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("view-top")).toHaveClass(/on/);
});

test("a 3D object is really 3D: turning the camera changes what it looks like", async ({
  page,
}) => {
  await open3D(page);

  // A box, from the toolbox that already builds real geometry.
  await page.getByTestId("tool-box").click();
  await expect(page.getByTestId("gizmo")).toBeVisible();

  const shot = async (): Promise<Buffer> =>
    page.getByTestId("scene-view").screenshot();

  await page.getByTestId("view-front").click();
  await page.waitForTimeout(400);
  const front = await shot();

  await page.getByTestId("view-three-quarter").click();
  await page.waitForTimeout(400);
  const threeQuarter = await shot();

  // The rendered pixels must differ. A "3D" product where turning the camera
  // changes nothing is a 2D product with extra buttons.
  expect(
    Buffer.compare(front, threeQuarter),
    "turning the camera must change what the scene looks like",
  ).not.toBe(0);
});
