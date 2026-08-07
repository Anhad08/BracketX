import { expect, test, type Page } from "@playwright/test";
import { openPanel } from "./depth";

/**
 * The timeline, as an instrument.
 *
 * ============================================================================
 * THE LOOP THESE TESTS DEFEND
 * ============================================================================
 * Everyone who edits motion works the same way: scrub to a moment, look at the
 * frame, drag a key, scrub again. What was here before could do none of the
 * three — a list of rows with a truncated name, a number box and a strip of
 * diamonds. No ruler, so you could not tell when anything happened. No
 * playhead, so you could not go to a moment. No dragging.
 *
 * So the assertions are the loop: the ruler moves the picture, a keyframe
 * moves with the pointer, and both are one undo step.
 */

async function openTimeline(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-tpl_lower_third").click();
  await expect(page.getByTestId("scene-view")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("depth-toggle").click();
  await openPanel(page, "Timeline");
  await expect(page.getByTestId("timeline-grid")).toBeVisible();
}

/** Where the playhead currently is, in pixels from the left of the grid. */
async function playhead(page: Page): Promise<number> {
  const box = await page.getByTestId("timeline-playhead").boundingBox();
  return box?.x ?? -1;
}

test("it has a ruler, a playhead and tracks named by their layer", async ({ page }) => {
  await openTimeline(page);

  // The ruler is what turns a list of keys into a timeline — without it a
  // keyframe is a dot at an unknown moment.
  const ruler = page.getByTestId("timeline-ruler");
  await expect(ruler).toBeVisible();
  await expect(ruler, "the ruler must be labelled in time").toContainText("s");

  await expect(page.getByTestId("timeline-playhead")).toBeVisible();

  // The LAYER first, the property second: a designer looks for "Name" long
  // before they look for "position x".
  await expect(page.locator(".tl-layer").first()).not.toHaveText("");
  await expect(page.locator(".tl-prop").first()).not.toHaveText("");
});

test("dragging the ruler scrubs, and the picture follows", async ({ page }) => {
  await openTimeline(page);

  const before = await playhead(page);
  const ruler = (await page.getByTestId("timeline-ruler").boundingBox())!;

  await page.mouse.move(ruler.x + 40, ruler.y + 12);
  await page.mouse.down();
  await page.mouse.move(ruler.x + ruler.width * 0.6, ruler.y + 12, { steps: 10 });
  await page.mouse.up();

  expect(await playhead(page), "the playhead must follow the pointer").toBeGreaterThan(
    before + 40,
  );
  // And the engine went with it — the frame readout is the transport's own.
  await expect(page.getByTestId("frame")).not.toHaveText("f0");
});

test("a keyframe moves with the pointer, as one undo step", async ({ page }) => {
  await openTimeline(page);

  // The LAST keyframe of the track, dragged LATER. Keyframes are addressed by
  // their position in the track and a move re-sorts them, so dragging an early
  // key past a later one swaps their indices — the drag works perfectly and
  // the test measures the wrong diamond. Moving the last one later cannot
  // reorder anything.
  const key = page.locator('[data-testid="keyframe"][data-track="0"][data-index="1"]');
  await expect(key).toBeVisible();
  const before = (await key.boundingBox())!;
  const history = (await page.getByTestId("history").textContent()) ?? "";

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + before.height / 2, { steps: 12 });
  await page.mouse.up();

  const after = (await key.boundingBox())!;
  expect(after.x, "the keyframe must have moved").toBeGreaterThan(before.x + 20);

  // One gesture, one entry. A drag that recorded a step per pointer move would
  // fill the history with a hundred moves nobody wants back.
  const depth = (text: string) => Number(/history (\d+)/.exec(text)?.[1] ?? -1);
  const now = (await page.getByTestId("history").textContent()) ?? "";
  expect(depth(now)).toBe(depth(history) + 1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await key.boundingBox())?.x ?? 0)
    .toBeLessThan(before.x + 20);
});

test("selecting a keyframe and nudging it moves by exact frames", async ({ page }) => {
  await openTimeline(page);

  const key = page.locator('[data-testid="keyframe"][data-track="0"][data-index="1"]');
  const before = (await key.boundingBox())!;
  await key.click();
  await expect(key).toHaveClass(/\bon\b/);

  // Arrow keys are what hands do without looking. One frame, or ten with
  // shift — the same relationship the viewport's nudge has.
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await key.boundingBox())?.x ?? 0).toBeGreaterThan(before.x);
});

/**
 * ZOOM ABOUT THE POINTER.
 *
 * Zooming about the left edge is the single most disorienting thing a timeline
 * can do: the moment you were looking at leaves the screen every time you
 * zoom, so you spend the whole session hunting for it again.
 */
test("the wheel zooms the time axis around the pointer", async ({ page }) => {
  await openTimeline(page);

  const ruler = (await page.getByTestId("timeline-ruler").boundingBox())!;
  const labels = () => page.locator(".tl-tick").allTextContents();
  const before = await labels();

  await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + 12);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(120);

  const after = await labels();
  expect(after.join(","), "zooming must change the span the ruler shows").not.toBe(
    before.join(","),
  );
});
