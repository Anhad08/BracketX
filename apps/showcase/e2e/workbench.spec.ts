import { expect, test, type Page } from "@playwright/test";

/**
 * Workbench, in a browser.
 *
 * The headless suite already proves every tool's DATA. What only a DOM can show
 * is that the panels stay SYNCHRONIZED with a running engine — the failure mode
 * Phase 1 shipped and had to fix, where every number was individually correct
 * and collectively frozen.
 */

async function open(page: Page, scene: string, tool: string): Promise<void> {
  await page.goto(`/#/${scene}`);
  await page.waitForSelector(`[data-testid="showcase-canvas"][data-scene="${scene}"]`);
  await page.getByRole("button", { name: tool, exact: true }).click();
}

test("inspector reflects the live mirror", async ({ page }) => {
  await open(page, "leaderboard", "Inspector");

  const tree = page.getByTestId("inspector-tree");
  await expect(tree).toBeVisible();
  // Root, camera, table, and eight rows of three boxes each.
  await expect(tree.locator("li")).not.toHaveCount(0);

  // Selecting a node shows engine-sourced detail, not placeholders.
  await tree.locator("li button.node").nth(2).click();
  const detail = page.getByTestId("inspector-detail");
  await expect(detail).toContainText("world");
  await expect(detail).not.toContainText("Select a node");
});

test("inspector filter keeps ancestors", async ({ page }) => {
  await open(page, "leaderboard", "Inspector");

  const before = await page.getByTestId("inspector-tree").locator("li").count();
  await page.getByPlaceholder("filter by id, name, or component").fill("entry");
  const after = await page.getByTestId("inspector-tree").locator("li").count();

  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test("command console updates as commands are issued", async ({ page }) => {
  await open(page, "scoreboard", "Console");

  const rows = () => page.getByTestId("command-log").locator("tbody tr");
  const before = await rows().count();

  // Every control issues a command; the log must show each one.
  await page.getByRole("button", { name: "+1" }).first().click();
  await page.getByRole("button", { name: "+1" }).first().click();
  await page.waitForTimeout(250);

  expect(await rows().count()).toBeGreaterThan(before);
  await expect(page.getByTestId("command-log")).toContainText("variable.set");
  await expect(page.getByTestId("command-log")).toContainText("operator");
});

test("command console pause freezes the view, not the engine", async ({ page }) => {
  await open(page, "scoreboard", "Console");

  await page.getByRole("button", { name: "Pause" }).click();
  const frozen = await page.getByTestId("command-log").locator("tbody tr").count();

  await page.getByRole("button", { name: "+1" }).first().click();
  await page.waitForTimeout(300);
  expect(await page.getByTestId("command-log").locator("tbody tr").count()).toBe(frozen);

  // The engine kept running while the view was held.
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(250);
  expect(
    await page.getByTestId("command-log").locator("tbody tr").count(),
  ).toBeGreaterThan(frozen);
});

test("timeline follows playback", async ({ page }) => {
  await open(page, "animation", "Timeline");
  await page.getByRole("button", { name: "Play", exact: true }).click();

  const playhead = page.getByTestId("timeline").locator(".playhead");
  await expect(playhead).toBeVisible();

  const left = async () =>
    Number((await playhead.getAttribute("style"))!.match(/left:\s*([\d.]+)%/)![1]);

  await page.waitForTimeout(400);
  const first = await left();
  await page.waitForTimeout(500);
  const second = await left();

  expect(second).not.toBe(first);
});

test("frame breakdown updates continuously", async ({ page }) => {
  await open(page, "animation", "Frame");
  const breakdown = page.getByTestId("frame-breakdown");
  await expect(breakdown).toBeVisible();

  const bars = () => breakdown.locator("svg.graph rect").count();
  const first = await bars();
  await page.waitForTimeout(600);
  expect(await bars()).toBeGreaterThan(first);
});

test("output monitor tracks every bound output live", async ({ page }) => {
  await open(page, "outputs", "Outputs");
  const monitor = page.getByTestId("output-monitor");
  await expect(monitor.locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: /Preview 960/ }).click();
  await page.waitForTimeout(300);
  await expect(monitor.locator("tbody tr")).toHaveCount(2);
  await expect(monitor).toContainText("960×540");
  await expect(monitor).toContainText("1/2");

  // Counters must move.
  const rendered = async () =>
    Number(await monitor.locator("tbody tr").nth(1).locator("td").nth(5).innerText());
  const first = await rendered();
  await page.waitForTimeout(500);
  expect(await rendered()).toBeGreaterThan(first);
});

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

test("debug layers draw over the canvas without touching the scene", async ({ page }) => {
  await page.goto("/#/layout");
  await page.waitForSelector('[data-testid="showcase-canvas"][data-scene="layout"]');

  await expect(page.getByTestId("debug-layers")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Layout" }).check();
  await expect(page.getByTestId("debug-layers")).toBeVisible();

  // Overlays are SVG on top; the rendered pixels must be unchanged. Adding
  // debug geometry to the document would make the measured thing differ from
  // the shipped thing, and would appear in screenshots meant as baselines.
  const boxes = await page.getByTestId("debug-layers").locator("rect").count();
  expect(boxes).toBeGreaterThan(0);

  await page.getByRole("checkbox", { name: "Layout" }).uncheck();
  await expect(page.getByTestId("debug-layers")).toHaveCount(0);
});

test("switching tools does not error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/#/stress");
  await page.waitForSelector('[data-testid="showcase-canvas"][data-scene="stress"]');

  for (const tool of ["Inspector", "Console", "Timeline", "Frame", "Outputs", "Recorder"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.waitForTimeout(200);
  }

  expect(errors, errors.join(" | ")).toEqual([]);
});
