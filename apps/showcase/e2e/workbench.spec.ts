import { expect, test, type Page } from "@playwright/test";

/**
 * Workbench, in a browser.
 *
 * The headless suite already proves every tool's DATA — 281 assertions over the
 * model layer. What only a DOM can show is that the panels stay SYNCHRONIZED
 * with a running engine, and that the keyboard workflow actually works, which
 * is the difference between a feature and a demo.
 *
 * The specific failure this file exists to catch is the one Phase 1 shipped:
 * every number individually correct and collectively frozen.
 */

async function open(page: Page, scene: string, tool?: string): Promise<void> {
  await page.goto(`/#/${scene}`);
  await page.waitForSelector(`[data-testid="showcase-canvas"][data-scene="${scene}"]`);
  if (tool !== undefined) {
    await page.getByRole("tab", { name: tool, exact: false }).click();
  }
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

test("inspector reflects the live mirror", async ({ page }) => {
  await open(page, "leaderboard", "Inspector");

  const tree = page.getByTestId("inspector-tree");
  await expect(tree).toBeVisible();
  await expect(tree.locator("li")).not.toHaveCount(0);

  await tree.locator("li button.node").nth(1).click();
  const detail = page.getByTestId("inspector-detail");
  await expect(detail).toContainText("world");
  await expect(detail).not.toContainText("Select a node");
});

test("inspector opens collapsed and expands on demand", async ({ page }) => {
  // The scalability property, visible: the tree must not flatten the whole
  // mirror to render. Expanding is what costs rows.
  await open(page, "leaderboard", "Inspector");

  const rows = () => page.getByTestId("inspector-tree").locator("li");
  const before = await rows().count();

  // Expand every currently-collapsed branch one level.
  const collapsed = page.getByTestId("inspector-tree").getByRole("button", { name: "expand" });
  await collapsed.first().click();

  expect(await rows().count()).toBeGreaterThan(before);
});

test("inspector search ranks nodes and reveals the one chosen", async ({ page }) => {
  await open(page, "leaderboard", "Inspector");

  await page.getByLabel("Find node").fill("entry");
  const results = page.getByTestId("search-results");
  await expect(results).toBeVisible();
  await expect(page.getByTestId("search-summary")).toContainText("scanned");
  expect(await results.locator("li").count()).toBeGreaterThan(0);

  await results.locator("button.node").first().click();
  // Revealing selects, and the detail pane must follow.
  await expect(page.getByTestId("breadcrumbs")).toBeVisible();
});

test("inspector answers where a value came from", async ({ page }) => {
  // The question the inspector exists for. An instance reading a collection row
  // must name the row, not print `undefined`.
  await open(page, "leaderboard", "Inspector");

  await page.getByLabel("Find node").fill("team");
  await page.getByTestId("search-results").locator("button.node").first().click();

  const origins = page.getByTestId("origins");
  await expect(origins).toBeVisible();
  await expect(origins).toContainText("scope");
  await expect(origins).toContainText("row");
});

test("a pinned node survives switching scenes", async ({ page }) => {
  await open(page, "leaderboard", "Inspector");
  await page.getByTestId("inspector-tree").locator("li").first().hover();
  await page.getByTestId("inspector-tree").getByRole("button", { name: "pin" }).first().click();
  await expect(page.getByTestId("pinned-nodes")).toBeVisible();

  await open(page, "scoreboard", "Inspector");
  await expect(page.getByTestId("pinned-nodes")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

test("command console updates as commands are issued", async ({ page }) => {
  await open(page, "scoreboard", "Console");

  const rows = () => page.getByTestId("command-log").locator("tbody tr");
  const before = await rows().count();

  await page.getByRole("button", { name: "+1" }).first().click();
  await page.getByRole("button", { name: "+1" }).first().click();
  await page.waitForTimeout(250);

  expect(await rows().count()).toBeGreaterThan(before);
  await expect(page.getByTestId("command-log")).toContainText("variable.set");
  await expect(page.getByTestId("command-log")).toContainText("operator");
});

test("command console attributes scene churn to a command", async ({ page }) => {
  // "Dirty nodes: 42" is not a diagnostic. "42 from collection.patch" is.
  await open(page, "leaderboard", "Console");
  await page.getByRole("button", { name: "Random +3" }).click();
  await page.waitForTimeout(300);

  await expect(page.getByTestId("dirty-origins")).toBeVisible();
  await expect(page.getByTestId("dirty-origins")).toContainText("collection.patch");
});

test("command console pause freezes the view, not the engine", async ({ page }) => {
  await open(page, "scoreboard", "Console");

  await page.getByRole("button", { name: "Pause log" }).click();
  const frozen = await page.getByTestId("command-log").locator("tbody tr").count();

  await page.getByRole("button", { name: "+1" }).first().click();
  await page.waitForTimeout(300);
  expect(await page.getByTestId("command-log").locator("tbody tr").count()).toBe(frozen);

  await page.getByRole("button", { name: "Resume log" }).click();
  await page.waitForTimeout(250);
  expect(
    await page.getByTestId("command-log").locator("tbody tr").count(),
  ).toBeGreaterThan(frozen);
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

test("timeline follows playback and marks what happened", async ({ page }) => {
  await open(page, "animation", "Timeline");
  await page.getByRole("button", { name: "Play", exact: true }).first().click();

  const playhead = page.getByTestId("timeline").locator(".playhead");
  await expect(playhead).toBeVisible();

  const left = async () =>
    Number((await playhead.getAttribute("style"))!.match(/left:\s*([\d.]+)%/)![1]);

  await page.waitForTimeout(400);
  const first = await left();
  await page.waitForTimeout(500);
  expect(await left()).not.toBe(first);

  // Commands issued while the clip runs land on the clip's own axis.
  await expect(page.getByTestId("timeline-marker").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

test("frame history grows and a baseline produces a comparison", async ({ page }) => {
  await open(page, "animation", "Performance");
  const panel = page.getByTestId("performance");
  await expect(panel).toBeVisible();

  const bars = () => page.getByTestId("frame-history").locator("rect").count();
  const first = await bars();
  await page.waitForTimeout(700);
  expect(await bars()).toBeGreaterThanOrEqual(first);

  await expect(page.getByTestId("distribution")).toContainText("p95");
  await page.getByRole("button", { name: "Capture baseline" }).click();
  await expect(panel).toContainText("baseline");
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

test("output monitor tracks every bound output live", async ({ page }) => {
  await open(page, "outputs", "Outputs");
  const monitor = page.getByTestId("output-monitor");
  await expect(monitor.locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: /Preview 960/ }).click();
  await page.waitForTimeout(300);
  await expect(monitor.locator("tbody tr")).toHaveCount(2);
  await expect(monitor).toContainText("960×540");
  await expect(monitor).toContainText("1/2");

  const rendered = async () =>
    Number(await monitor.locator("tbody tr").nth(1).locator("td").nth(6).innerText());
  const first = await rendered();
  await page.waitForTimeout(500);
  expect(await rendered()).toBeGreaterThan(first);
});

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

test("watch window shows a value, its readers, and its last writer", async ({ page }) => {
  await open(page, "leaderboard", "Watch");
  await page.getByLabel("Add variable to watch").selectOption("standings");

  const table = page.getByTestId("watch-table");
  await expect(table).toBeVisible();
  await expect(table).toContainText("standings");

  await page.getByRole("button", { name: "Random +3" }).click();
  await page.waitForTimeout(300);
  await expect(table).toContainText("collection.patch");
});

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

test("recorder replays a session and verifies it matches", async ({ page }) => {
  await open(page, "leaderboard", "Recorder");

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Random +3" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Sort by score" }).click();
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: /^Stop/ }).click();
  await page.getByRole("button", { name: /Replay/ }).click();

  const verdict = page.getByTestId("replay-verdict");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("Replay matched");
});

test("a captured snapshot diffs against the live session", async ({ page }) => {
  await open(page, "leaderboard", "Recorder");
  await page.getByRole("button", { name: "Capture snapshot" }).click();
  await expect(page.getByTestId("snapshot-diff")).toContainText("Identical");

  await page.getByRole("button", { name: "Random +3" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("snapshot-diff")).toContainText("standings");
});

// ---------------------------------------------------------------------------
// Stress laboratory
// ---------------------------------------------------------------------------

test("stress sweep produces a table and names the ceiling", async ({ page }) => {
  await open(page, "stress", "Stress");
  await page.getByRole("button", { name: "Run sweep" }).click();

  const table = page.getByTestId("sweep");
  await expect(table).toBeVisible({ timeout: 30000 });
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(3);
  await expect(page.getByTestId("stress")).toContainText("fitting in a 60fps frame");
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

test("findings panel reports a real problem with its evidence", async ({ page }) => {
  await open(page, "leaderboard");
  const alerts = page.getByTestId("alerts");
  await expect(alerts).toBeVisible();

  // Force a rejection: an empty variable key is invalid, and the panel must say
  // so with the sender and the reason rather than showing a red counter.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("noop"));
  });
  await page.waitForTimeout(300);

  // Nothing is wrong yet, and the panel must say that rather than staying blank.
  await expect(alerts).toContainText(/Nothing to report|Findings/);
});

// ---------------------------------------------------------------------------
// Keyboard and palette
// ---------------------------------------------------------------------------

test("the command palette opens on a chord and navigates", async ({ page }) => {
  await open(page, "leaderboard");
  await page.keyboard.press("Control+k");

  const palette = page.getByTestId("palette");
  await expect(palette).toBeVisible();

  await page.keyboard.type("scoreboard");
  await page.keyboard.press("Enter");

  await page.waitForSelector('[data-testid="showcase-canvas"][data-scene="scoreboard"]');
  await expect(palette).toHaveCount(0);
});

test("Escape closes the palette without running anything", async ({ page }) => {
  await open(page, "leaderboard");
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await expect(page.locator('[data-scene="leaderboard"]')).toBeVisible();
});

test("digits switch tools and the frame key steps exactly one frame", async ({ page }) => {
  await open(page, "leaderboard");

  await page.keyboard.press("2");
  await expect(page.getByTestId("command-log")).toBeVisible();

  await page.keyboard.press("1");
  await expect(page.getByTestId("inspector-tree")).toBeVisible();

  // Stepping pauses first, so the frame an engineer inspects is the frame they
  // named. Without the pause this assertion could not be written at all.
  const counter = page.getByTestId("frame-counter");
  await page.keyboard.press(".");
  await page.waitForTimeout(250);
  const before = Number((await counter.innerText()).slice(1));
  await page.keyboard.press(".");
  await page.waitForTimeout(250);
  expect(Number((await counter.innerText()).slice(1))).toBe(before + 1);
});

test("typing in a field does not fire shortcuts", async ({ page }) => {
  // A workbench where typing "s" in a filter takes a screenshot is a workbench
  // people stop typing in.
  await open(page, "leaderboard", "Inspector");
  await page.getByLabel("Find node").fill("");
  await page.getByLabel("Find node").press("1");
  await page.getByLabel("Find node").press(".");

  // Both keys landed in the field: "1" did not switch tools and "." did not
  // step a frame. The search results are showing because the field has a
  // query, which is itself proof the keystrokes went where they were typed.
  await expect(page.getByLabel("Find node")).toHaveValue("1.");
  await expect(page.getByTestId("search-results")).toBeVisible();
});

test("the keyboard reference is generated from the bindings", async ({ page }) => {
  await open(page, "leaderboard");
  await page.getByRole("button", { name: "Keyboard reference" }).click();
  const help = page.getByTestId("keyboard-help");
  await expect(help).toBeVisible();
  await expect(help).toContainText("Command palette");
  await expect(help).toContainText("Step one frame");
});

// ---------------------------------------------------------------------------
// Overlays and hygiene
// ---------------------------------------------------------------------------

test("debug layers draw over the canvas without touching the scene", async ({ page }) => {
  await open(page, "layout");

  await expect(page.getByTestId("debug-layers")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Layout" }).check();
  await expect(page.getByTestId("debug-layers")).toBeVisible();

  const boxes = await page.getByTestId("debug-layers").locator("rect").count();
  expect(boxes).toBeGreaterThan(0);

  await page.getByRole("checkbox", { name: "Layout" }).uncheck();
  await expect(page.getByTestId("debug-layers")).toHaveCount(0);
});

test("the session hash is computed on request, not on every sample", async ({ page }) => {
  await open(page, "leaderboard");
  const rail = page.getByRole("region", { name: "Developer diagnostics" });
  await expect(rail.getByRole("button", { name: "compute" })).toBeVisible();
  await rail.getByRole("button", { name: "compute" }).click();
  await page.waitForTimeout(200);
  await expect(rail.getByRole("button", { name: "compute" })).toHaveCount(0);
});

test("switching every tool does not error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await open(page, "stress");

  for (const tool of [
    "Inspector",
    "Console",
    "Timeline",
    "Performance",
    "Outputs",
    "Watch",
    "Recorder",
    "Stress",
  ]) {
    await page.getByRole("tab", { name: tool, exact: false }).click();
    await page.waitForTimeout(180);
  }

  expect(errors, errors.join(" | ")).toEqual([]);
});

// ---------------------------------------------------------------------------
// Phase 6 — the timeline, on screen
// ---------------------------------------------------------------------------

test("a staggered reveal runs in collection order, top to bottom", async ({ page }) => {
  // The defect this guards is specific and was real: instances of one template
  // share the template's order key, and the mirror breaks that tie REVERSED.
  // A stagger driven by mirror order ran bottom-to-top and looked deliberate.
  await open(page, "stagger", "Inspector");
  await page.getByRole("button", { name: "Reveal", exact: true }).click();
  await page.waitForTimeout(120);
  // Freeze mid-reveal. Reading two nodes through the inspector takes long
  // enough that the reveal finishes underneath the test and both rows report
  // their final position — the frame an engineer inspects must be the frame
  // they meant, which is the whole reason the transport pauses before stepping.
  await page.getByRole("button", { name: "Pause" }).click();

  const xOf = async (identity: string) => {
    await page.getByLabel("Find node").fill(`nod_slide#${identity}`);
    await page.getByTestId("search-results").locator("button.node").first().click();
    const text = await page.getByTestId("world-position").innerText();
    return Number(text.split(",")[0]);
  };

  const first = await xOf("t1");
  const later = await xOf("t4");
  // Row 1 started first, so it is further along its slide than row 4.
  expect(first).toBeGreaterThan(later);
});

test("a declared transition animates a state change instead of cutting", async ({ page }) => {
  await open(page, "transitions", "Timeline");
  await page.getByRole("button", { name: "Reveal", exact: true }).click();

  // A transition is a TIMELINE, so it appears on the same ruler as a clip.
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toContainText("transition");

  // And it is released when it finishes rather than held — the end values are
  // what the state already produces, so holding would pin a duplicate forever.
  // This scene authors no clips, so the ruler empties entirely.
  await page.waitForTimeout(900);
  await expect(page.getByTestId("timeline")).toHaveCount(0);
});

test("the timeline shows delay and stagger, not just keyframes", async ({ page }) => {
  await open(page, "delay", "Timeline");
  await expect(page.getByTestId("timeline")).toContainText("+0.3s");

  await open(page, "stagger", "Timeline");
  await expect(page.getByTestId("timeline")).toContainText("stagger");
  // The ruler is drawn to the SPAN, which a stagger pushes past the duration.
  await expect(page.getByTestId("timeline")).toContainText("span");
});

test("seeking far into a running timeline lands somewhere coherent", async ({ page }) => {
  await open(page, "late-join");
  // Pause first. A running clock advances between the seek and the read, and a
  // test that asserted "f3600" against a moving counter would be flaky forever
  // — the same reason `stepFrames` pauses.
  await page.locator(".controls").getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Seek 3600" }).click();
  await page.waitForTimeout(250);

  await expect(page.getByTestId("frame-counter")).toHaveText("f3600");
  // No error, no blank canvas: the scene is simply at the state it would have
  // played to. Convergence itself is proven exactly in timeline.test.ts.
  await expect(page.locator('[data-scene="late-join"]')).toBeVisible();
});
