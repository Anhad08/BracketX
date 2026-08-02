import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import "../scenes";
import { getScene } from "../registry";
import { ShowcaseSession } from "../engine/session";
import { findSpikes } from "../engine/history";
import {
  commandImpact,
  debugBoxes,
  dirtyOrigins,
  filterCommands,
  inspectorRows,
  nodeDetail,
  outputRows,
  searchNodes,
  timeline,
  watchRows,
} from "./model";
import { alerts } from "./alerts";
import { diffSnapshots } from "./diff";
import { searchActions, buildPalette } from "./palette";
import { SessionRecorder, replayRecording } from "./recorder";
import { stressRows } from "./stress";

/**
 * Tooling overhead.
 *
 * The claim under test: the workbench must never significantly affect the
 * measurements it displays. A profiler that costs more than the thing it
 * profiles reports its own cost and calls it the engine's.
 *
 * ============================================================================
 * WHAT V3 ADDED TO THIS FILE
 * ============================================================================
 * V2 benchmarked the tools against a 35-node scene, where everything is free
 * and nothing is learned. The requirement is that the workbench stays usable at
 * hundreds of thousands of nodes, so the interesting benchmarks are the ones
 * below marked LARGE — and they are where V2's inspector, debug layer, and node
 * count turned out to be O(scene) on a 10Hz timer.
 *
 * The V2 shapes are kept as explicit `v2:` benchmarks rather than deleted. A
 * claim that something got faster needs the slow version still runnable, or it
 * is a number with nothing to compare to.
 *
 * Run: pnpm --filter showcase bench
 */

function make(sceneId: string, frames = 30): ShowcaseSession {
  const session = new ShowcaseSession(getScene(sceneId)!, new MockMirrorBackend(), {
    replayBackend: () => new MockMirrorBackend(),
  });
  session.load();
  for (let i = 1; i <= frames; i += 1) session.step((i * 1000) / 60);
  return session;
}

const small = make("leaderboard");
const large = make("stress");

/** A scene with a genuinely large mirror — the scalability case. */
const huge = make("stress", 0);
huge.send(
  { type: "collection.replace", key: "items", items: stressRows(4000) } as never,
  "bench",
);
// 400 frames so the retained history is genuinely full when the performance
// benchmarks capture their window. Measuring a 30-sample window and labelling
// it 300 is the kind of number this file exists not to publish.
for (let i = 1; i <= 400; i += 1) huge.step((i * 1000) / 60);

// Give the console something to filter.
for (let i = 0; i < 400; i += 1) {
  small.send({ type: "variable.set", key: "noise", value: i });
}

const allExpanded = new Set(small.host.reconciler.mirror.nodeIds());
const hugeExpanded = new Set(huge.host.reconciler.mirror.nodeIds());
const rootOnly = new Set([huge.host.reconciler.mirror.rootId!]);

describe("frame, for comparison", () => {
  let frame = 0;
  bench("step a small scene", () => {
    small.step((++frame * 1000) / 60);
  });
  bench("step a 50-row scene", () => {
    large.step((++frame * 1000) / 60);
  });
  bench("step a 4,000-row scene", () => {
    huge.step((++frame * 1000) / 60);
  });
});

describe("the sampled read — what runs at 10Hz", () => {
  bench("diagnostics, small", () => {
    small.diagnostics();
  });
  bench("diagnostics, 4,000 rows", () => {
    huge.diagnostics();
  });
  // The V2 shape: the session hash canonicalises every variable, and the node
  // count materialised an array of every id. Both on every sample.
  bench("v2: diagnostics with session hash, 4,000 rows", () => {
    huge.diagnostics({ hashes: true });
  });
  let sink = 0;
  bench("v2: node count by materialising every id", () => {
    sink += [...huge.host.reconciler.mirror.nodeIds()].length;
  });
  bench("v3: node count from mirror.size", () => {
    sink += huge.host.reconciler.mirror.size;
  });
  bench("sink guard", () => {
    // Keeps the two above from being optimised away as dead stores.
    if (sink < 0) throw new Error("unreachable");
  });
});

describe("inspector — LARGE", () => {
  bench("v3: collapsed tree, 4,000 rows in the scene", () => {
    inspectorRows(huge, { expanded: rootOnly });
  });
  bench("v3: expanded tree, capped at 400 rows", () => {
    inspectorRows(huge, { expanded: hugeExpanded, limit: 400 });
  });
  bench("v2: flatten the entire mirror", () => {
    inspectorRows(huge, { expanded: hugeExpanded, limit: Number.MAX_SAFE_INTEGER });
  });
  bench("search 4,000 nodes", () => {
    searchNodes(huge, "cell", 25);
  });
});

describe("inspector — small", () => {
  const firstId = inspectorRows(small, { expanded: allExpanded }).rows[0]!.id;

  bench("build the tree (small)", () => {
    inspectorRows(small, { expanded: allExpanded });
  });
  bench("detail one node", () => {
    nodeDetail(small, firstId);
  });
});

describe("command console", () => {
  const records = small.host.log.entries();

  bench("filter 400 records by text", () => {
    filterCommands(records, { text: "variable", acceptedOnly: false, source: null });
  });
  bench("attribution lookup", () => {
    commandImpact(small, records[records.length - 1]!);
  });
  bench("dirty origins over 200 records", () => {
    dirtyOrigins(small, records, 200);
  });
});

describe("timeline", () => {
  const animation = make("animation");
  animation.send({ type: "playback.play" });
  animation.send({ type: "clip.play", clipId: "anm_sweep" });

  bench("read clips and playhead", () => {
    timeline(animation);
  });
  bench("read clips with command markers", () => {
    timeline(animation, { markers: true });
  });
});

describe("performance tools", () => {
  const samples = huge.history.samples();
  // What the findings panel actually summarises: a bounded recent window, not
  // the whole retained history.
  const window = huge.history.recent(300);

  bench("distribution over 300 samples (the findings window)", () => {
    huge.history.stats(window);
  });
  bench("distribution over the full retained history", () => {
    huge.history.stats(samples);
  });
  bench("spike detection over 300 samples", () => {
    findSpikes(window);
  });

  // Inputs hoisted. Building them inside the body would measure diagnostics,
  // stats, spikes and attribution as if they were the rules' own cost, which
  // is exactly the kind of number this file exists not to publish.
  const input = {
    diagnostics: huge.diagnostics(),
    stats: huge.history.stats(window),
    baseline: null,
    spikes: findSpikes(window),
    origins: dirtyOrigins(huge, huge.host.log.entries(), 100),
    records: huge.host.log.entries(),
  };
  bench("derive alerts (rules only)", () => {
    alerts(input);
  });
  bench("the whole findings sample, end to end", () => {
    const live = huge.history.recent(300);
    alerts({
      diagnostics: huge.diagnostics(),
      stats: huge.history.stats(live),
      baseline: null,
      spikes: findSpikes(live),
      origins: dirtyOrigins(huge, huge.host.log.entries(), 100),
      records: huge.host.log.entries(),
    });
  });
});

describe("diff", () => {
  const before = huge.session();
  huge.send({ type: "collection.patch", key: "items", id: "s3", keyField: "id", patch: { score: 1 } }, "bench");
  const after = huge.session();

  bench("diff two 4,000-row snapshots", () => {
    diffSnapshots(before, after);
  });
});

describe("palette", () => {
  const actions = buildPalette({
    scenes: [],
    currentSceneId: null,
    tools: [],
    recentSceneIds: [],
    playing: false,
    goToScene: () => {},
    openTool: () => {},
    toggleTransport: () => {},
    step: () => {},
    restart: () => {},
    captureBaseline: () => {},
    captureSnapshot: () => {},
    screenshot: () => {},
    toggleLayer: () => {},
    toggleWorkbench: () => {},
    resetWorkspace: () => {},
    showKeys: () => {},
  });

  bench("rank the palette", () => {
    searchActions(actions, "step");
  });
});

describe("debug layers", () => {
  bench("project boxes (small)", () => {
    debugBoxes(small, { canvasWidth: 1920, canvasHeight: 1080, orthographicSize: 5 });
  });
  bench("v3: project boxes, capped at 500 (4,000 rows)", () => {
    debugBoxes(huge, { canvasWidth: 1920, canvasHeight: 1080, orthographicSize: 5 });
  });
  bench("v2: project every box (4,000 rows)", () => {
    debugBoxes(huge, {
      canvasWidth: 1920,
      canvasHeight: 1080,
      orthographicSize: 5,
      limit: Number.MAX_SAFE_INTEGER,
    });
  });
});

describe("watch and outputs", () => {
  small.send({
    type: "output.bind",
    output: { id: "preview", width: 960, height: 540, cadence: 2 },
  });

  bench("read output rows", () => {
    outputRows(small, 60);
  });
  bench("watch three variables", () => {
    watchRows(huge, ["items", "color.accent", "noise"]);
  });
});

describe("recorder", () => {
  const recorder = new SessionRecorder();
  recorder.start(small);

  bench("checkpoint tick (usually a comparison)", () => {
    recorder.tick(small);
  });

  const source = make("leaderboard", 5);
  const capture = new SessionRecorder();
  capture.start(source);
  for (let i = 1; i <= 60; i += 1) source.step((i * 1000) / 60);
  const recording = capture.stop(source);

  bench("replay and verify 60 frames", () => {
    const fresh = source.forkForReplay();
    replayRecording(fresh, recording);
    fresh.dispose();
  });
});
