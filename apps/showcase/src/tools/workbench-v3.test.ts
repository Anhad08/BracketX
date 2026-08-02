import { beforeEach, describe, expect, it } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import "../scenes";
import { getScene } from "../registry";
import { ShowcaseSession } from "../engine/session";
import {
  FRAME_BUDGET_MS,
  FrameHistory,
  bucketMax,
  compareToBaseline,
  distribution,
  findSpikes,
  medianAbsoluteDeviation,
  movingAverage,
  percentile,
  type FrameSample,
} from "../engine/history";
import { alerts, worstSeverity } from "./alerts";
import { diffRecordings, diffSnapshots } from "./diff";
import { fuzzyMatch, rank } from "./search";
import { KEYMAP, buildPalette, matchBinding, searchActions, shortcutFor } from "./palette";
import { sceneIndex, splitInstanceId } from "./scene-index";
import {
  DEFAULT_STRESS,
  STRESS_PRESETS,
  budgetCeiling,
  configCommands,
  parseConfig,
  runSweep,
  serializeConfig,
  stressRows,
} from "./stress";
import {
  dirtyOrigins,
  inspectorRows,
  nodeDetail,
  pathTo,
  previewValue,
  searchNodes,
  timeline,
  variableWriters,
  watchRows,
} from "./model";
import { SessionRecorder } from "./recorder";
import { DEFAULT_SETTINGS, loadSettings, pushRecent, saveSettings, toggleInList } from "../settings";

/**
 * Workbench V3 verification.
 *
 * Headless, like everything else that matters. Three properties are load-bearing
 * and each has its own section below:
 *
 *   1. The tool never diverges from the engine. Anything the workbench derives
 *      rather than reads is asserted against what the engine actually did.
 *   2. The tool's cost is proportional to what is on screen, not to the scene.
 *      A tool that is O(scene) on a timer becomes the load it is measuring.
 *   3. Every diagnostic can be wrong. A rule that cannot fire is decoration;
 *      each one below is driven into firing and into staying quiet.
 */

function make(sceneId: string): ShowcaseSession {
  const session = new ShowcaseSession(getScene(sceneId)!, new MockMirrorBackend(), {
    replayBackend: () => new MockMirrorBackend(),
  });
  session.load();
  return session;
}

let session: ShowcaseSession;
beforeEach(() => {
  session = make("leaderboard");
});

// ---------------------------------------------------------------------------
// Scene index
// ---------------------------------------------------------------------------

describe("scene index", () => {
  it("is cached against the document object, which is the version stamp", () => {
    const document = session.host.document!;
    expect(sceneIndex(document)).toBe(sceneIndex(document));
  });

  it("resolves an instance id back to its authored template", () => {
    const instance = [...session.host.reconciler.mirror.nodeIds()].find((id) =>
      id.includes("#"),
    )!;
    const index = sceneIndex(session.host.document!);
    const { templateId } = splitInstanceId(instance);

    expect(index.isInstance(instance)).toBe(true);
    expect(index.sourceFor(instance)).toBe(index.get(templateId)!.node);
    expect(index.isInstance(templateId)).toBe(false);
  });

  it("treats an id with no separator as its own template", () => {
    expect(splitInstanceId("nod_root")).toEqual({ templateId: "nod_root", identity: null });
    expect(splitInstanceId("nod_row#t3")).toEqual({ templateId: "nod_row", identity: "t3" });
  });

  it("walks iteratively, so a deep document cannot overflow the stack", () => {
    // R-001 logged the engine's own traversal ceiling. A debugging tool that
    // dies on an unusual document fails exactly when it is needed.
    let node: Record<string, unknown> = { id: "leaf", name: "leaf", order: "V" };
    for (let depth = 0; depth < 20000; depth += 1) {
      node = { id: `n${depth}`, name: `n${depth}`, order: "V", children: [node] };
    }
    const index = sceneIndex({
      ...session.host.document!,
      root: node as never,
    });
    expect(index.size).toBe(20001);
  });
});

// ---------------------------------------------------------------------------
// Inspector — the scalability property
// ---------------------------------------------------------------------------

describe("inspector scalability", () => {
  it("costs one row for a collapsed collection of any size", () => {
    const stress = make("stress");
    stress.send({ type: "collection.replace", key: "items", items: stressRows(2000) } as never);
    stress.step(0);

    expect(stress.host.reconciler.mirror.size).toBeGreaterThan(1000);
    const rows = inspectorRows(stress, { expanded: new Set() }).rows;
    expect(rows).toHaveLength(1);

    stress.dispose();
  });

  it("emits rows in document order, parents before children", () => {
    const expanded = new Set(session.host.reconciler.mirror.nodeIds());
    const rows = inspectorRows(session, { expanded, limit: 5000 }).rows;
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.parentId !== null) expect(seen.has(row.parentId), row.id).toBe(true);
      seen.add(row.id);
    }
  });

  it("reveals a searched node by expanding exactly its ancestors", () => {
    const target = [...session.host.reconciler.mirror.nodeIds()].find((id) =>
      id.includes("#"),
    )!;
    const path = pathTo(session, target);
    expect(path.length).toBeGreaterThan(0);

    const rows = inspectorRows(session, { expanded: new Set(path) }).rows;
    expect(rows.some((row) => row.id === target)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inspector — "where did this come from"
// ---------------------------------------------------------------------------

describe("value origins", () => {
  it("names a document variable and the command that last wrote it", () => {
    session.send({ type: "variable.set", key: "title", value: "Round 2" });
    session.step(0);

    const withTitle = [...session.host.reconciler.mirror.nodeIds()]
      .map((id) => nodeDetail(session, id)!)
      .find((detail) => detail.origins.some((origin) => origin.key === "title"));

    if (withTitle === undefined) return; // scene does not bind `title`
    const origin = withTitle.origins.find((entry) => entry.key === "title")!;
    expect(origin.kind).toBe("variable");
    expect(origin.lastWrite?.type).toBe("variable.set");
    expect(origin.lastWrite?.source).toBe("operator");
  });

  it("resolves a repeat scope to the ROW the instance actually renders", () => {
    // The one place the workbench derives rather than reads: the engine's
    // scopes are transient, so this re-applies the documented keyed-identity
    // rule. Asserting it against the collection is what keeps the derivation
    // honest — if the engine's rule changed, this fails.
    // The instance ROOT has no components of its own; the node that binds
    // `row.color` is inside it, which is exactly why the scope has to be
    // resolved through authored ancestors rather than from the node itself.
    const scoped = [...session.host.reconciler.mirror.nodeIds()]
      .filter((id) => id.includes("#"))
      .flatMap((id) => nodeDetail(session, id)!.origins)
      .find((origin) => origin.kind === "scope");

    expect(scoped, "an instance should read a scoped value").toBeDefined();
    expect(scoped!.via).toBeDefined();

    const collection = session.host.runtime.state.variables.get(scoped!.via!.source) as
      | { id?: string }[]
      | undefined;
    expect(Array.isArray(collection)).toBe(true);
    expect((scoped!.value as { id?: string }).id).toBe(scoped!.via!.identity);
    expect(collection!.some((row) => row.id === scoped!.via!.identity)).toBe(true);
  });

  it("marks a name nothing resolves as unresolved rather than showing undefined", () => {
    // An inspector that renders `undefined` for a scope it could not resolve
    // teaches an engineer to distrust the whole panel.
    const detail = nodeDetail(session, session.host.reconciler.mirror.rootId!)!;
    for (const origin of detail.origins) {
      expect(["variable", "scope", "token", "unresolved"]).toContain(origin.kind);
    }
  });

  it("gives breadcrumbs that match the mirror's ancestors", () => {
    const instance = [...session.host.reconciler.mirror.nodeIds()].find((id) =>
      id.includes("#"),
    )!;
    const detail = nodeDetail(session, instance)!;
    expect(detail.ancestors.map((entry) => entry.id)).toEqual(
      session.host.reconciler.mirror.ancestorsOf(instance),
    );
  });

  it("names the animation clips that target a node", () => {
    const animation = make("animation");
    animation.send({ type: "playback.play" });
    animation.send({ type: "clip.play", clipId: "anm_sweep" });
    for (let i = 1; i <= 20; i += 1) animation.step((i * 1000) / 60);

    const target = animation.host.animator.clips[0]!.tracks[0]!.target;
    const detail = nodeDetail(animation, target)!;

    expect(detail.animation.length).toBeGreaterThan(0);
    expect(detail.animation[0]!.clipId).toBe("anm_sweep");
    expect(detail.animation.some((entry) => entry.driving)).toBe(true);

    animation.dispose();
  });

  it("names the container that positions a laid-out child", () => {
    const layout = make("layout");
    layout.step(0);

    const detail = [...layout.host.reconciler.mirror.nodeIds()]
      .map((id) => nodeDetail(layout, id)!)
      .find((entry) => entry.layoutFrom !== null);

    expect(detail, "a layout scene should have a laid-out child").toBeDefined();
    expect(detail!.layoutFrom!.mode.length).toBeGreaterThan(0);
    layout.dispose();
  });
});

describe("global search", () => {
  it("ranks by relevance rather than filtering", () => {
    const result = searchNodes(session, "entry", 5);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.length).toBeLessThanOrEqual(5);
    expect(result.scanned).toBe(session.host.reconciler.mirror.size);

    const scores = result.hits.map((hit) => hit.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("carries the path needed to reveal a hit", () => {
    const hit = searchNodes(session, "entry", 1).hits[0];
    if (hit === undefined) return;
    expect(hit.item.path).toEqual(pathTo(session, hit.item.id));
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchNodes(session, "   ").hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

describe("fuzzy matching", () => {
  it("matches a subsequence, which substring search cannot", () => {
    expect(fuzzyMatch("neb", "nod_entry_background")).not.toBeNull();
    expect(fuzzyMatch("xyz", "nod_entry")).toBeNull();
  });

  it("prefers consecutive runs over scattered characters", () => {
    const tight = fuzzyMatch("entry", "nod_entry")!;
    const loose = fuzzyMatch("entry", "exxnxxtxxrxxy")!;
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it("treats a separator as a word start, which is usually what was meant", () => {
    // `e_n_t_r_y` outranks `nod_entry` for the query "entry", and that is
    // correct: every character sits at a word boundary. Recording it because
    // it looks like a bug and is not.
    expect(fuzzyMatch("entry", "e_n_t_r_y")!.score).toBeGreaterThan(
      fuzzyMatch("entry", "exxnxxtxxrxxy")!.score,
    );
  });

  it("prefers a word boundary over a mid-word match", () => {
    const boundary = fuzzyMatch("bg", "node_background")!;
    const middle = fuzzyMatch("bg", "unbigounding")!;
    expect(boundary.score).toBeGreaterThan(middle.score);
  });

  it("prefers the shortest candidate on a tie", () => {
    expect(fuzzyMatch("row", "row")!.score).toBeGreaterThan(
      fuzzyMatch("row", "row_with_a_very_long_suffix")!.score,
    );
  });

  it("keeps only the top N without sorting everything", () => {
    const items = Array.from({ length: 5000 }, (_, index) => `node_${index}`);
    const top = rank(items, "node", (item) => [item], 10);
    expect(top).toHaveLength(10);
    expect(top[0]!.score).toBeGreaterThanOrEqual(top[9]!.score);
  });
});

// ---------------------------------------------------------------------------
// Frame history
// ---------------------------------------------------------------------------

function sample(frame: number, total: number): FrameSample {
  return {
    frame,
    total,
    runtime: total * 0.5,
    animation: total * 0.2,
    render: total * 0.3,
    backendWrites: 0,
    dirtyNodes: 0,
    nodesCreated: 0,
    nodesDestroyed: 0,
  };
}

describe("frame history", () => {
  it("uses nearest-rank percentiles, so every reported value is a real frame", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.95)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
  });

  it("summarises a series", () => {
    const stats = distribution([1, 2, 3, 4]);
    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(2.5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(4);
  });

  it("bounds its memory and keeps the newest samples", () => {
    const history = new FrameHistory(10);
    for (let frame = 0; frame < 100; frame += 1) history.push(sample(frame, 1));
    expect(history.size).toBe(10);
    expect(history.samples()[0]!.frame).toBe(90);
    expect(history.samples()[9]!.frame).toBe(99);
  });

  it("finds a spike that standard deviation would have hidden", () => {
    // Twenty quiet frames and four enormous ones. sigma would be inflated by
    // the spikes themselves until they stopped looking like spikes.
    const samples = [
      ...Array.from({ length: 40 }, (_, i) => sample(i, 2)),
      sample(40, 40),
      sample(41, 38),
      sample(42, 44),
      sample(43, 41),
    ];
    const spikes = findSpikes(samples);
    expect(spikes.map((spike) => spike.frame)).toEqual([40, 41, 42, 43]);
    expect(spikes[0]!.dominant).toBe("runtime");
  });

  it("does not cry wolf on a perfectly steady series", () => {
    // MAD is zero here, which without a floor makes any deviation infinite.
    const steady = Array.from({ length: 60 }, (_, i) => sample(i, 1));
    expect(findSpikes(steady)).toHaveLength(0);
  });

  it("ignores microsecond noise", () => {
    const tiny = [
      ...Array.from({ length: 40 }, (_, i) => sample(i, 0.001)),
      sample(40, 0.02),
    ];
    // 20x the median, and completely irrelevant. Nobody debugs 20 microseconds.
    expect(findSpikes(tiny)).toHaveLength(0);
  });

  it("compares p95 against a baseline and calls a real regression", () => {
    const before = new FrameHistory(100);
    for (let i = 0; i < 100; i += 1) before.push(sample(i, 4));
    const baseline = before.captureBaseline("main")!;

    const after = new FrameHistory(100);
    for (let i = 0; i < 100; i += 1) after.push(sample(i, 5));

    const regression = compareToBaseline(baseline, after.stats()).find(
      (entry) => entry.field === "total",
    )!;
    expect(regression.verdict).toBe("slower");
    expect(regression.delta).toBeCloseTo(0.25, 2);
  });

  it("does not call a regression on two tiny numbers", () => {
    const before = new FrameHistory(50);
    for (let i = 0; i < 50; i += 1) before.push(sample(i, 0.001));
    const after = new FrameHistory(50);
    for (let i = 0; i < 50; i += 1) after.push(sample(i, 0.004));

    // Four times slower, arithmetically. Three microseconds, materially.
    const regression = compareToBaseline(before.captureBaseline("x")!, after.stats()).find(
      (entry) => entry.field === "total",
    );
    expect(regression).toBeUndefined();
  });

  it("keeps the worst sample when downsampling, never the average", () => {
    const samples = [
      ...Array.from({ length: 99 }, (_, i) => sample(i, 1)),
      sample(99, 100),
    ];
    const buckets = bucketMax(samples, "total", 10);
    expect(buckets).toHaveLength(10);
    expect(buckets[9]!.value).toBe(100);
  });

  it("computes a trailing moving average", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it("reports zero deviation for a constant series", () => {
    expect(medianAbsoluteDeviation([5, 5, 5, 5])).toBe(0);
  });

  it("returns the newest samples in order, before and after the ring wraps", () => {
    const history = new FrameHistory(10);
    for (let frame = 0; frame < 6; frame += 1) history.push(sample(frame, 1));
    expect(history.recent(3).map((entry) => entry.frame)).toEqual([3, 4, 5]);
    expect(history.recent(99).map((entry) => entry.frame)).toEqual([0, 1, 2, 3, 4, 5]);

    for (let frame = 6; frame < 23; frame += 1) history.push(sample(frame, 1));
    expect(history.recent(3).map((entry) => entry.frame)).toEqual([20, 21, 22]);
    expect(history.recent(10)).toEqual(history.samples());
  });

  it("hands out a copy, so a held window cannot grow under its holder", () => {
    // REGRESSION GUARD. `samples()` returned the live internal array before the
    // ring wrapped, so anything that kept a window watched it fill. A benchmark
    // caught it: two windows of very different sizes reported identical cost,
    // because they were the same array.
    const history = new FrameHistory(100);
    for (let i = 0; i < 5; i += 1) history.push(sample(i, 1));

    const held = history.samples();
    const window = history.recent(3);
    for (let i = 5; i < 40; i += 1) history.push(sample(i, 1));

    expect(held).toHaveLength(5);
    expect(window).toHaveLength(3);
  });

  it("records real frames from a session", () => {
    for (let i = 1; i <= 20; i += 1) session.step((i * 1000) / 60);
    expect(session.history.size).toBe(20);
    expect(session.history.samples().at(-1)!.frame).toBe(session.frame);
  });
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function alertInput(overrides: Partial<Parameters<typeof alerts>[0]> = {}) {
  const history = new FrameHistory(60);
  for (let i = 0; i < 60; i += 1) history.push(sample(i, 1));
  return {
    diagnostics: session.diagnostics(),
    stats: history.stats(),
    baseline: null,
    spikes: [],
    origins: [],
    records: session.host.log.entries(),
    ...overrides,
  } as Parameters<typeof alerts>[0];
}

describe("actionable diagnostics", () => {
  it("stays quiet when everything is fine", () => {
    const fired = alerts(alertInput());
    // The scene binds an output on load, so "no outputs" must not fire, and a
    // 1ms frame is well inside budget.
    expect(fired.map((alert) => alert.id)).not.toContain("budget.over");
    expect(fired.map((alert) => alert.id)).not.toContain("output.none");
  });

  it("names the phase responsible when the budget is missed", () => {
    const history = new FrameHistory(60);
    for (let i = 0; i < 60; i += 1) history.push(sample(i, 30));

    const fired = alerts(alertInput({ stats: history.stats() }));
    const budget = fired.find((alert) => alert.id === "budget.over")!;

    expect(budget.severity).toBe("error");
    expect(budget.title).toContain("runtime");
    // The evidence must be enough to disagree with.
    expect(budget.detail).toContain("p95");
    expect(budget.detail).toContain(FRAME_BUDGET_MS.toFixed(2));
  });

  it("explains a regression in terms of the captured baseline", () => {
    const before = new FrameHistory(60);
    for (let i = 0; i < 60; i += 1) before.push(sample(i, 4));
    const after = new FrameHistory(60);
    for (let i = 0; i < 60; i += 1) after.push(sample(i, 5));

    const fired = alerts(
      alertInput({ baseline: before.captureBaseline("main"), stats: after.stats() }),
    );
    const regression = fired.find((alert) => alert.id === "regression.total")!;
    expect(regression.title).toContain("+25%");
    expect(regression.title).toContain("main");
  });

  it("attributes scene churn to the command that caused it", () => {
    // "Dirty nodes: 42" is not a diagnostic. This is.
    const fired = alerts(
      alertInput({
        origins: [
          { commandType: "collection.patch", source: "feed", commands: 6, dirtyNodes: 42, backendWrites: 84 },
          { commandType: "variable.set", source: "operator", commands: 1, dirtyNodes: 3, backendWrites: 3 },
        ],
      }),
    );
    const churn = fired.find((alert) => alert.id === "dirty.origin")!;
    expect(churn.title).toContain("collection.patch");
    expect(churn.title).toContain("feed");
    expect(churn.detail).toContain("42 of 45");
  });

  it("reports a rejected command with its reason and sender", () => {
    session.send({ type: "variable.set", key: "", value: 1 });
    const fired = alerts(alertInput({ diagnostics: session.diagnostics() }));
    const rejected = fired.find((alert) => alert.id === "commands.rejected")!;
    expect(rejected.severity).toBe("error");
    expect(rejected.detail).toContain("operator");
  });

  it("detects a mirror that only grows", () => {
    const fired = alerts(
      alertInput({ nodeCountWindow: { first: 100, last: 400, seconds: 10 } }),
    );
    const growth = fired.find((alert) => alert.id === "mirror.growth")!;
    expect(growth.title).toContain("300");
  });

  it("sorts errors above warnings above information", () => {
    const history = new FrameHistory(60);
    for (let i = 0; i < 60; i += 1) history.push(sample(i, 30));
    session.send({ type: "variable.set", key: "", value: 1 });

    const fired = alerts(
      alertInput({ stats: history.stats(), diagnostics: session.diagnostics() }),
    );
    const severities = fired.map((alert) => alert.severity);
    const order = { error: 0, warn: 1, info: 2 } as const;
    expect(severities.map((s) => order[s])).toEqual(
      [...severities.map((s) => order[s])].sort((a, b) => a - b),
    );
    expect(worstSeverity(fired)).toBe("error");
  });

  it("reports no severity for an empty set", () => {
    expect(worstSeverity([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

describe("snapshot diffing", () => {
  it("agrees with the session hash — the hash decides, the diff explains", () => {
    // If these two ever disagree, the diff is wrong, not the hash. Asserting
    // the relationship is what keeps the readable output from becoming the
    // thing people trust instead of the authority.
    const before = session.session();
    expect(diffSnapshots(before, session.session()).identical).toBe(true);

    session.send({ type: "variable.set", key: "title", value: "changed" });
    const after = session.session();

    expect(diffSnapshots(before, after).identical).toBe(false);
    expect(
      diffSnapshots(before, after).differences.some((d) => d.path.includes("title")),
    ).toBe(true);
  });

  it("summarises a length change rather than listing every row", () => {
    const stress = make("stress");
    const before = stress.session();
    stress.send({ type: "collection.replace", key: "items", items: stressRows(500) } as never);
    const diff = diffSnapshots(before, stress.session());

    expect(diff.differences.some((d) => d.path.endsWith(".length"))).toBe(true);
    expect(diff.differences.length).toBeLessThanOrEqual(200);
    stress.dispose();
  });

  it("finds the FIRST frame two recordings disagree on", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);
    for (let frame = 1; frame <= 90; frame += 1) {
      session.step((frame * 1000) / 60);
      recorder.tick(session);
    }
    const first = recorder.stop(session);

    const tampered = {
      ...first,
      checkpoints: first.checkpoints.map((checkpoint, index) =>
        index >= 2 ? { ...checkpoint, sessionHash: "different" } : checkpoint,
      ),
    };

    const diff = diffRecordings(first, tampered);
    expect(diff.sameScene).toBe(true);
    expect(diff.divergedAtFrame).toBe(first.checkpoints[2]!.frame);
  });

  it("refuses to compare recordings of different scenes", () => {
    const recorder = new SessionRecorder();
    recorder.start(session);
    const recording = recorder.stop(session);
    const other = { ...recording, sceneId: "elsewhere" };
    expect(diffRecordings(recording, other).sameScene).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Palette and keyboard
// ---------------------------------------------------------------------------

function paletteContext(overrides: Partial<Parameters<typeof buildPalette>[0]> = {}) {
  const calls: string[] = [];
  const context = {
    scenes: [getScene("leaderboard")!, getScene("stress")!, getScene("animation")!],
    currentSceneId: "leaderboard",
    tools: [{ id: "inspector", label: "Inspector" }],
    recentSceneIds: ["animation"],
    playing: true,
    goToScene: (id: string) => calls.push(`scene:${id}`),
    openTool: (id: string) => calls.push(`tool:${id}`),
    toggleTransport: () => calls.push("transport"),
    step: (frames: number) => calls.push(`step:${frames}`),
    restart: () => calls.push("restart"),
    captureBaseline: () => calls.push("baseline"),
    captureSnapshot: () => calls.push("snapshot"),
    screenshot: () => calls.push("screenshot"),
    toggleLayer: (layer: string) => calls.push(`layer:${layer}`),
    toggleWorkbench: () => calls.push("workbench"),
    resetWorkspace: () => calls.push("reset"),
    showKeys: () => calls.push("keys"),
    ...overrides,
  };
  return { context, calls };
}

describe("command palette", () => {
  it("puts recently viewed scenes first", () => {
    const { context } = paletteContext();
    const scenes = buildPalette(context).filter((action) => action.section === "Scene");
    expect(scenes[0]!.id).toBe("scene.animation");
    expect(scenes[0]!.hint).toContain("recent");
  });

  it("runs the action it was given, and nothing else", () => {
    const { context, calls } = paletteContext();
    buildPalette(context).find((action) => action.id === "transport.toggle")!.run();
    expect(calls).toEqual(["transport"]);
  });

  it("finds an action by a fragment of its name", () => {
    const { context } = paletteContext();
    const results = searchActions(buildPalette(context), "baseline");
    expect(results[0]!.item.id).toBe("perf.baseline");
  });

  it("finds a scene by its capability, not only its title", () => {
    const { context } = paletteContext();
    const results = searchActions(buildPalette(context), "scale under live load");
    expect(results.map((entry) => entry.item.id)).toContain("scene.stress");
  });

  it("shows something for an empty query rather than nothing", () => {
    const { context } = paletteContext();
    expect(searchActions(buildPalette(context), "").length).toBeGreaterThan(0);
  });

  it("labels the transport action with the current state", () => {
    const { context } = paletteContext({ playing: false });
    expect(
      buildPalette(context).find((action) => action.id === "transport.toggle")!.title,
    ).toBe("Play");
  });
});

describe("keyboard", () => {
  const event = (key: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: false,
    shiftKey: mods.shift ?? false,
  });

  it("matches a chord exactly, modifiers included", () => {
    expect(matchBinding(event("k", { ctrl: true }), false)?.id).toBe("palette.open");
    expect(matchBinding(event("k"), false)).toBeNull();
  });

  it("distinguishes a shifted binding from its unshifted twin", () => {
    expect(matchBinding(event("."), false)?.id).toBe("transport.stepForward");
    expect(matchBinding(event(".", { shift: true }), false)?.id).toBe(
      "transport.stepForwardTen",
    );
  });

  it("does not steal keys while a text field has focus", () => {
    // A workbench where typing "s" in a filter takes a screenshot is a
    // workbench people stop typing in.
    expect(matchBinding(event("s", { shift: true }), true)).toBeNull();
    expect(matchBinding(event("k", { ctrl: true }), true)?.id).toBe("palette.open");
    expect(matchBinding(event("escape"), true)?.id).toBe("ui.escape");
  });

  it("has no duplicate chords", () => {
    const chords = KEYMAP.map(
      (binding) => `${binding.mod ? "mod+" : ""}${binding.shift ? "shift+" : ""}${binding.key}`,
    );
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("labels every binding, so the generated help sheet cannot be blank", () => {
    for (const binding of KEYMAP) {
      expect(binding.label.length, binding.id).toBeGreaterThan(0);
      expect(binding.description.length, binding.id).toBeGreaterThan(0);
      expect(shortcutFor(binding.id)).toBe(binding.label);
    }
  });

  it("has a palette entry for every non-navigational binding", () => {
    // An action without a palette entry is undiscoverable. This is the audit
    // that keeps a future tool from adding a shortcut nobody can find.
    const { context } = paletteContext();
    const actions = new Set(buildPalette(context).map((action) => action.id));
    const exempt = new Set([
      "palette.open",
      "palette.scenes",
      "search.nodes",
      "scene.previous",
      "scene.next",
      "ui.escape",
    ]);
    for (const binding of KEYMAP) {
      if (exempt.has(binding.id)) continue;
      expect(actions.has(binding.id), binding.id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe("frame stepping", () => {
  it("advances exactly the frames asked for, with the clock stopped", () => {
    const start = session.frame;
    expect(session.stepFrames(5)).toBe(start + 5);
    expect(session.host.runtime.clock.snapshot().status).not.toBe("playing");
  });

  it("is deterministic — two sessions stepped alike agree exactly", () => {
    // The property that makes "reproduce at frame N" mean anything.
    const other = make("leaderboard");
    session.stepFrames(12);
    other.stepFrames(12);
    expect(session.sessionHash()).toBe(other.sessionHash());
    other.dispose();
  });

  it("stops the loop first, so nothing advances underneath the step", () => {
    // A manual scheduler, because headless has no requestAnimationFrame — and
    // because a test that let the real clock run could not assert this at all.
    const pending: ((wall: number) => void)[] = [];
    const stepper = new ShowcaseSession(getScene("leaderboard")!, new MockMirrorBackend(), {
      scheduler: {
        request: (callback) => pending.push(callback),
        cancel: () => pending.splice(0, pending.length).length,
        now: () => 0,
      },
    });
    stepper.load();
    stepper.start();
    expect(stepper.running).toBe(true);

    stepper.stepFrames(1);
    expect(stepper.running).toBe(false);
    stepper.dispose();
  });
});

// ---------------------------------------------------------------------------
// Command attribution
// ---------------------------------------------------------------------------

describe("command attribution", () => {
  it("attributes a projection to the command that caused it, with no engine change", () => {
    // `color`, not `score`. The leaderboard rows bind `{ $var: "row.color" }`
    // and nothing in the scene renders `score`, so patching the score correctly
    // produces ZERO backend writes — there is nothing to redraw.
    //
    // This test previously patched `score` and passed, because a projector bug
    // re-resolved collection instances against the DOCUMENT variable source
    // instead of the row's scope: `row.color` came back undefined, the row was
    // repainted white, and that repaint was the write being asserted. The rows
    // stayed white afterwards. Fixed in Phase 3B; see the implementation report.
    session.send({
      type: "collection.patch",
      key: "standings",
      id: "t2",
      keyField: "id",
      patch: { color: "#00FF88" },
    });
    const record = session.host.log.entries().at(-1)!;
    const report = session.attributionFor(record.sequence);

    expect(report, "a collection patch must project").toBeDefined();
    expect(report!.backendWrites).toBeGreaterThan(0);
  });

  it("attributes nothing to a command that changed no scene state", () => {
    // playback.pause moves the clock, not the scene. Claiming it dirtied nodes
    // would be worse than saying nothing.
    session.send({ type: "playback.pause" });
    const record = session.host.log.entries().at(-1)!;
    expect(session.attributionFor(record.sequence)).toBeUndefined();
  });

  it("aggregates churn by command type and source", () => {
    for (let i = 0; i < 5; i += 1) {
      session.send(
        { type: "collection.patch", key: "standings", id: "t2", keyField: "id", patch: { score: i } },
        "feed",
      );
    }
    const origins = dirtyOrigins(session, session.host.log.entries());
    const feed = origins.find(
      (origin) => origin.commandType === "collection.patch" && origin.source === "feed",
    )!;
    expect(feed.commands).toBe(5);
    expect(feed.dirtyNodes).toBeGreaterThan(0);
  });

  it("is bounded, so a long session cannot accumulate a report per command", () => {
    for (let i = 0; i < 700; i += 1) {
      session.send({
        type: "collection.patch",
        key: "standings",
        id: "t2",
        keyField: "id",
        patch: { score: i },
      });
    }
    const records = session.host.log.entries();
    // The oldest attributions are dropped; the newest survive.
    expect(session.attributionFor(records.at(-1)!.sequence)).toBeDefined();
    expect(session.attributionFor(0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Watch window
// ---------------------------------------------------------------------------

describe("variable watch", () => {
  it("counts readers from the engine's own reverse index", () => {
    const [row] = watchRows(session, ["standings"]);
    expect(row!.dependents).toBe(
      session.host.reconciler.projector.dependencies.dependents("standings").size,
    );
  });

  it("names the last command that wrote a variable", () => {
    session.send({ type: "variable.set", key: "title", value: "x" }, "automation");
    const [row] = watchRows(session, ["title"]);
    expect(row!.lastWrite?.source).toBe("automation");
  });

  it("previews a large collection instead of stringifying it", () => {
    expect(previewValue(Array.from({ length: 3000 }))).toBe("array(3000)");
    expect(previewValue({ a: 1, b: 2, c: 3, d: 4 })).toBe("{a, b, c, …}");
    expect(previewValue(undefined)).toBe("undefined");
    expect(previewValue("x".repeat(200)).length).toBeLessThan(70);
  });

  it("flags a value that changed since the previous sample", () => {
    const before = new Map([["title", session.host.runtime.state.variables.get("title")]]);
    session.send({ type: "variable.set", key: "title", value: "different" });
    expect(watchRows(session, ["title"], before)[0]!.changed).toBe(true);
  });

  it("indexes only the most recent writer per key", () => {
    session.send({ type: "variable.set", key: "title", value: "a" }, "first");
    session.send({ type: "variable.set", key: "title", value: "b" }, "second");
    expect(variableWriters(session.host.log.entries()).get("title")!.source).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// Timeline markers
// ---------------------------------------------------------------------------

describe("timeline markers", () => {
  it("places commands on the clip's own time axis", () => {
    const animation = make("animation");
    animation.send({ type: "playback.play" });
    animation.send({ type: "clip.play", clipId: "anm_sweep" });
    for (let i = 1; i <= 30; i += 1) animation.step((i * 1000) / 60);
    animation.send({ type: "variable.set", key: "headline", value: "mid" });

    const [clip] = timeline(animation, { markers: true });
    const marker = clip!.markers.find((entry) => entry.label === "variable.set");

    expect(marker, "a command inside the clip window must appear").toBeDefined();
    // (frame - startFrame) * speed / rate, which is the inverse of the
    // animator's own playhead. Anything else would be a second clock.
    const state = animation.host.animator.clipState("anm_sweep")!;
    expect(marker!.time).toBeCloseTo(
      ((animation.frame - state.startFrame) * state.speed) / 60,
      5,
    );
    animation.dispose();
  });

  it("omits markers outside the clip's duration", () => {
    const animation = make("animation");
    animation.send({ type: "playback.play" });
    animation.send({ type: "clip.play", clipId: "anm_sweep" });
    const duration = animation.host.animator.clips[0]!.duration;

    for (let i = 1; i <= Math.ceil(duration * 60) + 200; i += 1) {
      animation.step((i * 1000) / 60);
    }
    animation.send({ type: "variable.set", key: "headline", value: "late" });

    const [clip] = timeline(animation, { markers: true });
    for (const marker of clip!.markers) {
      expect(marker.time).toBeLessThanOrEqual(clip!.duration);
      expect(marker.time).toBeGreaterThanOrEqual(0);
    }
    animation.dispose();
  });

  it("costs nothing when markers are off", () => {
    expect(timeline(make("animation"))[0]?.markers ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stress laboratory
// ---------------------------------------------------------------------------

describe("stress laboratory", () => {
  it("generates rows deterministically, so two runs are comparable", () => {
    expect(stressRows(100)).toEqual(stressRows(100));
  });

  it("expresses a configuration as commands and nothing else", () => {
    const commands = configCommands(
      { ...DEFAULT_STRESS, collectionSize: 100, clips: 1, outputs: 2 },
      { collectionKey: "items", clipIds: ["a", "b"] },
    );
    expect(commands.map((command) => command.type)).toContain("collection.replace");
    expect(commands.filter((command) => command.type === "clip.play")).toHaveLength(1);
    expect(commands.filter((command) => command.type === "clip.stop")).toHaveLength(1);
    expect(commands.some((command) => command.type === "output.bind")).toBe(true);
  });

  it("is idempotent — applying the same configuration twice is a no-op", () => {
    const stress = make("stress");
    const config = { ...DEFAULT_STRESS, collectionSize: 40, outputs: 3 };
    const commands = configCommands(config, { collectionKey: "items", clipIds: [] });

    for (const command of commands) stress.send(command, "stress");
    stress.step(0);
    const first = stress.sessionHash();

    for (const command of commands) stress.send(command, "stress");
    stress.step(1000 / 60);
    expect(stress.sessionHash()).toBe(first);
    stress.dispose();
  });

  it("sweeps and reports where the budget breaks", () => {
    const stress = make("stress");
    const points = runSweep(stress, [10, 100], {
      collectionKey: "items",
      framesPerPoint: 10,
      warmupFrames: 3,
    });

    expect(points).toHaveLength(2);
    expect(points[1]!.nodeCount).toBeGreaterThan(points[0]!.nodeCount);
    expect(points[0]!.stats.total.count).toBe(10);
    expect(points[0]!.frames).toBe(10);
    stress.dispose();
  });

  it("reports no ceiling rather than zero when nothing fits", () => {
    // "0 rows fit" and "the smallest size tried already missed" are different
    // findings and must not be reported the same way.
    expect(budgetCeiling([])).toBeNull();
    expect(
      budgetCeiling([
        { label: "10", collectionSize: 10, nodeCount: 1, frames: 1, stats: {} as never, budgetRatio: 4, fits: false },
      ]),
    ).toBeNull();
  });

  it("round-trips a saved configuration", () => {
    const parsed = parseConfig(serializeConfig(STRESS_PRESETS[1]!));
    expect(parsed.id).toBe(STRESS_PRESETS[1]!.id);
    expect(parsed.collectionSize).toBe(STRESS_PRESETS[1]!.collectionSize);
    expect(() => parseConfig("{}")).toThrow(/not a stress configuration/);
  });

  it("declares presets that are actually distinct", () => {
    const shapes = STRESS_PRESETS.map((preset) =>
      [preset.collectionSize, preset.clips, preset.outputs, preset.commandRate, preset.playbackSpeed].join(":"),
    );
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

describe("workspace persistence", () => {
  function memoryStore() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it("round-trips pins, watches, and the open tool", () => {
    const store = memoryStore();
    saveSettings(
      {
        ...DEFAULT_SETTINGS,
        tool: "performance",
        pinnedNodeIds: ["nod_a", "nod_b"],
        watchedKeys: ["standings"],
        workbenchSize: 55,
      },
      store,
    );
    const loaded = loadSettings(store);
    expect(loaded.tool).toBe("performance");
    expect(loaded.pinnedNodeIds).toEqual(["nod_a", "nod_b"]);
    expect(loaded.watchedKeys).toEqual(["standings"]);
    expect(loaded.workbenchSize).toBe(55);
  });

  it("clamps a hostile panel size instead of rendering a broken layout", () => {
    const store = memoryStore();
    store.setItem("bracketx.workbench.v2", JSON.stringify({ workbenchSize: 9999 }));
    expect(loadSettings(store).workbenchSize).toBe(80);
  });

  it("drops unknown keys from a stale or hostile store", () => {
    const store = memoryStore();
    store.setItem(
      "bracketx.workbench.v2",
      JSON.stringify({ tool: "inspector", evil: true, pinnedNodeIds: [1, "ok", null] }),
    );
    const loaded = loadSettings(store) as unknown as Record<string, unknown>;
    expect(loaded.evil).toBeUndefined();
    expect(loaded.pinnedNodeIds).toEqual(["ok"]);
  });

  it("keeps recents most-recent-first without duplicates", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a"], "c")).toEqual(["c", "a"]);
  });

  it("toggles a list entry without reordering the rest", () => {
    expect(toggleInList(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(toggleInList(["a"], "b")).toEqual(["a", "b"]);
  });
});
