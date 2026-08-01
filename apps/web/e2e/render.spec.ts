import { expect, test, type Page } from "@playwright/test";

/**
 * Real pixels. Phase 2.6e.
 *
 * Everything below asserts against a framebuffer produced by a real WebGL2
 * context executing real shaders. These are the claims Phase 2.5 recorded as
 * Unknown because nothing headless could establish them.
 *
 * The canvas is the document's declared resolution (1920x1080) regardless of
 * CSS size, so pixel coordinates here are scene coordinates, not layout ones.
 */

const WIDTH = 1920;
const HEIGHT = 1080;

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Reads one pixel out of the live drawing buffer.
 *
 * Goes through the canvas's own WebGL context rather than a screenshot: a
 * screenshot is composited against the page background and would silently make
 * every transparent pixel opaque, which is exactly the property most worth
 * testing for broadcast output.
 */
async function readPixel(page: Page, x: number, y: number): Promise<Pixel> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="scene-canvas"]',
      );
      if (!canvas) throw new Error("canvas not found");
      const gl =
        canvas.getContext("webgl2") ??
        (canvas.getContext("webgl") as WebGLRenderingContext | null);
      if (!gl) throw new Error("no WebGL context");

      const buffer = new Uint8Array(4);
      // WebGL's origin is bottom-left; scene coordinates here are top-left.
      gl.readPixels(
        px,
        canvas.height - py,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        buffer,
      );
      return {
        r: buffer[0]!,
        g: buffer[1]!,
        b: buffer[2]!,
        a: buffer[3]!,
      };
    },
    [x, y] as const,
  );
}

/** `#rrggbb`, for comparison against the colour the scene actually declares. */
function hex(pixel: Pixel): string {
  const part = (value: number) => value.toString(16).padStart(2, "0");
  return `#${part(pixel.r)}${part(pixel.g)}${part(pixel.b)}`;
}

/** Waits until the engine has actually drawn at least `count` frames. */
async function waitForFrames(page: Page, count = 2): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const bridge = (window as unknown as { __bracketx?: { host?: unknown } })
        .__bracketx;
      const host = bridge?.host as { framesRendered?: number } | undefined;
      return (host?.framesRendered ?? 0) >= target;
    },
    count,
    { timeout: 20_000 },
  );
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  await page.goto("/render-check");
  await page.waitForSelector('[data-testid="scene-canvas"][data-status="ready"]');
  await waitForFrames(page);

  // A scene that renders while throwing every frame is not a working engine.
  expect(failures, `console errors: ${failures.join(" | ")}`).toEqual([]);
});

test.describe("the engine renders its own scene format", () => {
  test("obtains a real WebGL2 context", async ({ page }) => {
    const info = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="scene-canvas"]',
      )!;
      const gl = canvas.getContext("webgl2");
      if (!gl) return null;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        version: gl.getParameter(gl.VERSION) as string,
        renderer: debug
          ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string)
          : "unknown",
        width: canvas.width,
        height: canvas.height,
      };
    });

    expect(info).not.toBeNull();
    expect(info!.version).toContain("WebGL 2.0");
    expect(info!.width).toBe(WIDTH);
    expect(info!.height).toBe(HEIGHT);
  });

  test("draws the backing bar where the hierarchy places it", async ({
    page,
  }) => {
    // The bar is authored at its group's origin; the group's transform is what
    // puts it left of centre and below the midline. If world matrices were not
    // composing, this pixel would be transparent and the bar would be centred
    // — a failure that still "looks like a scene".
    //
    // Camera orthographicSize 5 => visible height 10 units => 108 px/unit,
    // origin at (960, 540). Group at (-2.5, -2.5), backing bar 6x1.4, so the
    // bar's centre lands at screen (690, 810).
    const pixel = await readPixel(page, 690, 810);

    // Exact, not approximate. Authored #0B1F3A must survive sRGB -> linear ->
    // GPU -> sRGB and arrive back byte-identical. A tolerance here would have
    // hidden the double-encoding bug this test originally caught.
    expect(hex(pixel)).toBe("#0b1f3a");
    expect(pixel.a).toBe(255);
  });

  test("leaves the background fully transparent", async ({ page }) => {
    // Broadcast output composites over live video. An opaque background is a
    // black rectangle on air, and it is invisible in a screenshot because the
    // page paints behind it.
    const pixel = await readPixel(page, 40, 40);
    expect(pixel.a).toBe(0);
  });

  test("draws the accent bar in the variable's colour", async ({ page }) => {
    // The accent's fill is a { $var } binding. This pixel proves the binding
    // resolved through the runtime and reached the GPU.
    // Accent sits at group + (-2.85, 0) => scene (-5.35, -2.5), a 0.3-wide
    // strip centred on screen x 382.
    const pixel = await readPixel(page, 382, 810);

    expect(hex(pixel)).toBe("#e8b23a");
    expect(pixel.a).toBe(255);
  });

  test("repaints when a runtime variable changes", async ({ page }) => {
    // The live path, end to end: click -> command -> runtime state ->
    // invalidateVariables -> updateMaterial -> GPU.
    expect(hex(await readPixel(page, 382, 810))).toBe("#e8b23a");

    await page.getByTestId("accent-22C55E").click();
    await page.waitForTimeout(200); // let a frame or two land

    expect(hex(await readPixel(page, 382, 810))).toBe("#22c55e");
    // The backing bar must be untouched — only the bound node repaints.
    expect(hex(await readPixel(page, 690, 810))).toBe("#0b1f3a");
  });

  test("a runtime variable change is not a document edit", async ({ page }) => {
    // RFC-002 §4.3. Asserted here as well as in unit tests because this is the
    // only place the whole live path actually runs.
    const before = await page.evaluate(() => {
      const host = (window as unknown as { __bracketx: { host: unknown } })
        .__bracketx.host as { document: unknown };
      return JSON.stringify(host.document);
    });

    await page.getByTestId("accent-EF4444").click();
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const host = (window as unknown as { __bracketx: { host: unknown } })
        .__bracketx.host as { document: unknown };
      return JSON.stringify(host.document);
    });

    expect(after).toBe(before);
  });

  test("keeps the mirror consistent with the document", async ({ page }) => {
    // The reconciler's own verifier, run against a live GPU-backed session.
    const result = await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          __bracketx: { diagnostics: () => { consistent: boolean; issues: unknown[] } };
        }
      ).__bracketx;
      return bridge.diagnostics();
    });

    expect(result.issues).toEqual([]);
    expect(result.consistent).toBe(true);
  });

  test("advances frames continuously", async ({ page }) => {
    const first = await page.evaluate(
      () =>
        (
          window as unknown as {
            __bracketx: { host: { framesRendered: number } };
          }
        ).__bracketx.host.framesRendered,
    );
    await page.waitForTimeout(500);
    const second = await page.evaluate(
      () =>
        (
          window as unknown as {
            __bracketx: { host: { framesRendered: number } };
          }
        ).__bracketx.host.framesRendered,
    );

    // ~30 frames in 500ms at 60fps; anything above a handful proves the loop
    // is live rather than having drawn once and stopped.
    expect(second - first).toBeGreaterThan(5);
  });

  test("matches a reference image", async ({ page }) => {
    // The catch-all. Per-pixel assertions above test specific properties; this
    // catches everything nobody thought to assert — a flipped Y axis, a wrong
    // draw order, a material regression.
    const canvas = page.getByTestId("scene-canvas");
    await expect(canvas).toHaveScreenshot("lower-third.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
