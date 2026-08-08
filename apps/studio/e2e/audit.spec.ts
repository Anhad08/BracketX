import { test, expect, type Page } from "@playwright/test";
import { ensureDepth } from "./depth";

/**
 * A standing audit of every gesture the stage offers.
 *
 * ============================================================================
 * WHY THIS IS ONE TEST THAT REPORTS A LIST
 * ============================================================================
 * The ordinary suite stops at the first failure in a file, which is right when
 * you are guarding one claim and wrong when you are asking "what is broken?".
 * Every check here runs whatever the ones before it did, and the run prints a
 * line per gesture — so a regression anywhere shows up as a LIST rather than
 * as one failure hiding eleven others behind it.
 *
 * It exists because the viewport was reported broken twice and both times the
 * suite was green: a hundred and fifty tests, none of which drove the stage
 * the way a person drives it.
 */

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly note?: string;
}

const results: Check[] = [];

async function check(name: string, fn: () => Promise<boolean | string>): Promise<void> {
  try {
    const outcome = await fn();
    results.push(
      outcome === true ? { name, ok: true } : { name, ok: false, note: String(outcome) },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.split("\n")[0]! : String(cause);
    results.push({ name, ok: false, note: message });
  }
}

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await ensureDepth(page, "designer");
  await page.waitForTimeout(700);
}

const pickLayer = (page: Page, name: string): Promise<void> =>
  page.getByTestId("outline").getByText(name, { exact: true }).click();

async function field(page: Page, label: string): Promise<number> {
  return Number(
    await page.getByTestId("inspector").getByLabel(label, { exact: true }).inputValue(),
  );
}

test("viewport audit", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(String(error)));
  await open(page);

  // ---- The flat viewport --------------------------------------------------

  await check("2D · select from the tree", async () => {
    await pickLayer(page, "Accent Bar");
    return (await page.getByTestId("selection-box").count()) === 1;
  });

  await check("2D · hover outlines what is under the pointer", async () => {
    await pickLayer(page, "Background");
    const box = (await page.getByTestId("selection-box").first().boundingBox())!;
    await page.keyboard.press("Escape");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    return (await page.getByTestId("hover-outline").count()) === 1;
  });

  await check("2D · drag the picture to move a layer", async () => {
    await pickLayer(page, "Accent Bar");
    const before = await field(page, "position x");
    const box = (await page.getByTestId("selection-box").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await field(page, "position x");
    if (after <= before) return `x stayed ${before}`;
    await page.keyboard.press("ControlOrMeta+z");
    return true;
  });

  await check("2D · a resize handle resizes", async () => {
    await pickLayer(page, "Background");
    await page.waitForTimeout(250);
    const handle = await page.getByTestId("handle-e").boundingBox();
    if (handle === null) return "no east handle drawn";
    const before = (await page.getByTestId("selection-box").first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = (await page.getByTestId("selection-box").first().boundingBox())!;
    const grew = after.width > before.width + 20;
    await page.keyboard.press("ControlOrMeta+z");
    return grew ? true : `width ${Math.round(before.width)} to ${Math.round(after.width)}`;
  });

  await check("2D · the rotate grip rotates", async () => {
    await pickLayer(page, "Accent Bar");
    await page.waitForTimeout(250);
    const grip = await page.getByTestId("handle-rotate").boundingBox();
    if (grip === null) return "no rotate grip drawn";
    const before = await field(page, "rotation z");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 70, grip.y + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await field(page, "rotation z");
    if (Math.abs(after - before) < 1) return `rotation stayed ${before}`;
    await page.keyboard.press("ControlOrMeta+z");
    return true;
  });

  await check("2D · marquee selects several layers", async () => {
    await page.keyboard.press("Escape");
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    await page.mouse.move(chrome.x + 20, chrome.y + 20);
    await page.mouse.down();
    await page.mouse.move(chrome.x + chrome.width - 20, chrome.y + chrome.height - 20, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const selected = await page.getByTestId("selection-box").count();
    return selected > 1 ? true : `selected ${selected}`;
  });

  await check("2D · the wheel zooms", async () => {
    const zoom = async (): Promise<string> =>
      (await page.getByTestId("zoom").textContent()) ?? "";
    const before = await zoom();
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    await page.mouse.move(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    const after = await zoom();
    return before === after ? `zoom stayed ${before}` : true;
  });

  await check("2D · alt-drag pans the view", async () => {
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    const surface = async (): Promise<string> =>
      page.evaluate(
        () => (document.querySelector(".scene-surface") as HTMLElement | null)?.style.transform ?? "",
      );
    const before = await surface();
    await page.keyboard.down("Alt");
    await page.mouse.move(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2);
    await page.mouse.down();
    await page.mouse.move(chrome.x + chrome.width / 2 + 120, chrome.y + chrome.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(250);
    return (await surface()) !== before ? true : "the view did not move";
  });

  await check("2D · Fit reframes", async () => {
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(400);
    return (await page.getByTestId("zoom").count()) === 1;
  });

  await check("2D · Escape closes the stage menu, and the stage still works", async () => {
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    await page.mouse.click(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2, {
      button: "right",
    });
    await page.waitForTimeout(250);
    if ((await page.getByTestId("context-menu").count()) !== 1) return "no context menu";

    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    // THE ONE THAT MATTERS. The menu sits on a full-surface scrim, so a menu
    // that will not close is a stage that will not respond — every pointer
    // event lands on the scrim instead of the picture.
    if ((await page.getByTestId("context-menu").count()) !== 0) {
      return "Escape left the menu open, and the scrim swallows the stage";
    }
    await pickLayer(page, "Accent Bar");
    return (await page.getByTestId("selection-box").count()) === 1
      ? true
      : "the stage stopped responding after the menu";
  });

  await check("2D · right-click opens the stage menu", async () => {
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    await page.mouse.click(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2, {
      button: "right",
    });
    await page.waitForTimeout(250);
    const menu = await page.getByTestId("context-menu").count();
    await page.keyboard.press("Escape");
    return menu === 1 ? true : "no context menu";
  });

  // ---- Space --------------------------------------------------------------

  await check("3D · switching enters space", async () => {
    await page.getByTestId("dim-3d").click();
    await page.waitForTimeout(1_800);
    return (await page.getByTestId("gizmo-modes").count()) === 1;
  });

  await check("3D · the ground is drawn", async () =>
    (await page.getByTestId("ground").count()) === 1);

  await check("3D · the compass is drawn", async () =>
    (await page.getByTestId("compass").count()) === 1);

  await check("3D · the move gizmo slides along X", async () => {
    await pickLayer(page, "Accent Bar");
    await page.waitForTimeout(400);
    // ALONG THE LINE, not through the bounding box. An arm in space is
    // diagonal, so the middle of its box is beside the arm rather than on it —
    // a grab there misses, and the audit reports a working gizmo as broken.
    const arm = await page.evaluate(() => {
      const line = document.querySelector('[data-testid="axis-x"] line');
      const svg = document.querySelector('[data-testid="scene-chrome"]');
      if (line === null || svg === null) return null;
      const box = svg.getBoundingClientRect();
      const at = (name: string): number => Number(line.getAttribute(name) ?? 0);
      const t = 0.66;
      return {
        x: box.left + at("x1") + (at("x2") - at("x1")) * t,
        y: box.top + at("y1") + (at("y2") - at("y1")) * t,
      };
    });
    if (arm === null) return "no X arm drawn";
    const before = await field(page, "position x");

    await page.mouse.move(arm.x, arm.y);
    await page.waitForTimeout(200);
    const hovered = await page.getByTestId("scene-chrome").getAttribute("data-hover");
    if (hovered !== "axis-x") return `pointer over "${hovered}" instead of the X arm`;

    await page.mouse.down();
    await page.waitForTimeout(120);
    const grabbed = await page.getByTestId("scene-chrome").getAttribute("data-drag");
    if (grabbed !== "axis") {
      await page.mouse.up();
      return `press started a "${grabbed}" drag, not an axis drag`;
    }
    await page.mouse.move(arm.x + 100, arm.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const after = await field(page, "position x");
    if (Math.abs(after - before) < 0.05) return `grabbed the arm but x stayed ${before}`;
    await page.keyboard.press("ControlOrMeta+z");
    return true;
  });

  await check("3D · rotate rings appear", async () => {
    await page.getByTestId("gizmo-rotate").click();
    await page.waitForTimeout(350);
    const rings = await page.locator('[data-testid^="ring-"]').count();
    return rings > 0 ? true : "no rings drawn";
  });

  await check("3D · scale handles appear", async () => {
    await page.getByTestId("gizmo-scale").click();
    await page.waitForTimeout(350);
    const handles = await page.locator('[data-testid^="stretch-"]').count();
    await page.getByTestId("gizmo-move").click();
    return handles > 0 ? true : "no scale handles drawn";
  });

  await check("3D · middle-drag orbits the camera", async () => {
    const camera = async (): Promise<string> =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid="compass"]');
        return node === null ? "" : node.innerHTML;
      });
    const before = await camera();
    const chrome = (await page.getByTestId("scene-chrome").boundingBox())!;
    await page.mouse.move(chrome.x + chrome.width / 2, chrome.y + chrome.height / 2);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(chrome.x + chrome.width / 2 + 150, chrome.y + chrome.height / 2 + 40, {
      steps: 14,
    });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(500);
    return (await camera()) !== before ? true : "the camera did not turn";
  });

  await check("3D · a named view moves the camera", async () => {
    const camera = async (): Promise<string> =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid="compass"]');
        return node === null ? "" : node.innerHTML;
      });
    const before = await camera();
    await page.getByTestId("view-top").click();
    await page.waitForTimeout(1_400);
    return (await camera()) !== before ? true : "Top did nothing";
  });

  await check("3D · returning to 2D leaves space", async () => {
    await page.getByTestId("dim-2d").click();
    await page.waitForTimeout(1_800);
    return (await page.getByTestId("gizmo-modes").count()) === 0;
  });

  const report =
    "\n=== VIEWPORT AUDIT ===\n" +
    results.map((r) => `${r.ok ? "ok  " : "BAD "} ${r.name}${r.note === undefined ? "" : `  ::  ${r.note}`}`).join("\n") +
    `\ncrashes: ${crashes.length === 0 ? "none" : crashes.slice(0, 3).join(" | ")}\n`;
  console.log(report);

  // The audit REPORTS, and then it judges. A run with a failure in it is a
  // failing run — a diagnostic that never fails is a diagnostic nobody reads.
  expect(results.filter((r) => !r.ok).map((r) => `${r.name} :: ${r.note}`)).toEqual([]);
  expect(crashes).toEqual([]);
});
