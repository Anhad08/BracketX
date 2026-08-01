import { expect, test, type Page } from "@playwright/test";

/** Reads a pixel from the live drawing buffer, not a composited screenshot. */
async function pixel(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="showcase-canvas"]')!;
    const gl = canvas.getContext("webgl2")!;
    const buf = new Uint8Array(4);
    gl.readPixels(px, canvas.height - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { r: buf[0]!, g: buf[1]!, b: buf[2]!, a: buf[3]! };
  }, [x, y] as const);
}

test("the shell mounts and lists every scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BracketX" })).toBeVisible();
  // 12 scenes, each a nav button.
  await expect(page.locator("nav li button")).toHaveCount(12);
});

test("primitive rendering produces real pixels", async ({ page }) => {
  await page.goto("/#/primitive-rendering");
  await page.waitForSelector('[data-testid="showcase-canvas"][data-scene="primitive-rendering"]');
  await page.waitForTimeout(700);

  // 108 px/unit, origin (960, 540). The top-left box sits at world (-6, 3).
  const corner = await pixel(page, 960 - 6 * 108, 540 - 3 * 108);
  expect(corner.a).toBe(255);

  // Outside every rect, the background must stay fully transparent — broadcast
  // output composites over live video.
  const empty = await pixel(page, 30, 30);
  expect(empty.a).toBe(0);
});

test("overlays report engine state", async ({ page }) => {
  await page.goto("/#/animation");
  await page.waitForSelector('[data-testid="showcase-canvas"]');
  await page.waitForTimeout(500);

  // A labelled <section> is a landmark region, not a form control.
  await expect(page.getByRole("region", { name: "Developer diagnostics" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Performance" })).toBeVisible();

  // The overlay must show the engine's real frame number, not a placeholder.
  const frame = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".overlay .row")];
    const match = rows.find((row) => row.querySelector(".label")?.textContent === "frame");
    return Number(match?.querySelector(".value")?.textContent ?? "-1");
  });
  expect(frame).toBeGreaterThanOrEqual(0);
});

test("overlays keep up with the running engine", async ({ page }) => {
  // REGRESSION GUARD. The sampling timer once lived in the viewport while the
  // overlays rendered in the shell, so every number froze at the last shell
  // render: the tool reported one frame for a session rendering sixty a second.
  // A diagnostics panel that silently stops updating is worse than none.
  await page.goto("/#/animation");
  await page.waitForSelector('[data-testid="showcase-canvas"]');

  const frames = async () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll(".overlay .row")];
      const match = rows.find(
        (row) => row.querySelector(".label")?.textContent === "frames",
      );
      return Number(match?.querySelector(".value")?.textContent ?? "0");
    });

  await page.waitForTimeout(400);
  const first = await frames();
  await page.waitForTimeout(700);
  const second = await frames();

  expect(first).toBeGreaterThan(5);
  expect(second).toBeGreaterThan(first);
});

test("switching scenes does not error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const id of ["collections", "layout", "leaderboard", "scoreboard", "tournament-bracket"]) {
    await page.goto(`/#/${id}`);
    await page.waitForSelector(`[data-testid="showcase-canvas"][data-scene="${id}"]`);
    await page.waitForTimeout(350);
  }

  expect(errors, errors.join(" | ")).toEqual([]);
});
