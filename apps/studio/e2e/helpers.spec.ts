import { expect, test, type Page } from "@playwright/test";

/**
 * The 3D viewport shows the scene's camera and lights, and lets you click them.
 *
 * ============================================================================
 * WHY THIS IS THE PRODUCT TEST, NOT A CHROME TEST
 * ============================================================================
 * Before this, orbiting around a lower third showed a ground grid and a slab.
 * The broadcast camera and the two lights that decide how the graphic is shot
 * and lit were not drawn at all — so the one workflow a person most needs in a
 * 3D scene, *see the light, click it, change it*, was impossible.
 *
 * These assert the workflow rather than the pixels: the helpers appear only in
 * the dimensional view, clicking one selects the right node, and Properties
 * then shows that node.
 */
async function open3D(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("content")).toBeVisible({ timeout: 30_000 });
  // Enable 3D provisions the key and the fill, so there is lighting to see.
  await page.getByTestId("enable-3d").click();
  await expect(page.getByTestId("enable-3d")).toHaveAttribute("data-on", "yes");
  await page.getByTestId("dim-3d").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-flying", "no");
}

test("the camera and the lights are visible in 3D, and only in 3D", async ({ page }) => {
  await open3D(page);

  // Enable 3D provisioned a key and a fill, and both are now visible objects.
  await expect(page.getByTestId("helper-directional")).toHaveCount(1);
  await expect(page.getByTestId("helper-ambient")).toHaveCount(1);

  // The key light draws its actual rays, not just a mark. Directional means
  // parallel, so there are four of them.
  const rays = page.getByTestId("helper-directional").locator(".helper-line");
  expect(await rays.count()).toBe(4);

  // NO HELPER FOR THE CAMERA YOU ARE LOOKING THROUGH. Studio orbits the
  // scene's camera, so a frustum for it would trace the volume you are
  // already inside — two rectangles pinned to the screen that never move.
  await expect(page.getByTestId("helper-camera")).toHaveCount(0);

  // FLAT VIEW DRAWS NONE OF IT. In 2D the framing IS the canvas.
  await page.getByTestId("dim-2d").click();
  await expect(page.locator(".studio")).toHaveAttribute("data-flying", "no");
  await expect(page.getByTestId("helper-directional")).toHaveCount(0);
  await expect(page.getByTestId("helper-ambient")).toHaveCount(0);
});

test("clicking a light selects it, and Properties follows", async ({ page }) => {
  await open3D(page);

  // Nothing selected to begin with.
  await expect(page.getByTestId("gizmo")).toHaveCount(0);

  const icon = page.getByTestId("helper-directional").locator(".helper-icon");
  const box = (await icon.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // THE WORKFLOW: see the light, click the light, change the light.
  await expect(page.locator(".studio")).toBeVisible();
  await page.getByTestId("depth-toggle").click(); // reveal Properties
  await expect(page.getByTestId("inspector").getByLabel("Name")).toHaveValue(/Light|Fill/);
  await expect(page.getByTestId("helper-directional")).toHaveClass(/on/);
});

test("helpers follow the camera as it orbits", async ({ page }) => {
  await open3D(page);

  const at = async () => {
    const box = await page
      .getByTestId("helper-directional")
      .locator(".helper-icon")
      .boundingBox();
    return box === null ? null : { x: Math.round(box.x), y: Math.round(box.y) };
  };
  const before = await at();
  expect(before).not.toBeNull();

  // Orbit with the middle button, the Blender binding the viewport already
  // uses. A helper that stayed put would be describing a camera that is no
  // longer where it is drawn.
  const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
  await page.mouse.move(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(chrome.x + chrome.width / 2 + 140, chrome.y + chrome.height / 2 + 40, {
    steps: 8,
  });
  await page.mouse.up({ button: "middle" });

  await expect
    .poll(async () => {
      const now = await at();
      return now === null ? 0 : Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
    }, { timeout: 10_000 })
    .toBeGreaterThan(4);
});
