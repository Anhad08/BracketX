import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import "../scenes";
import { getScene } from "../registry";
import { ShowcaseSession } from "../engine/session";
import {
  debugBoxes,
  filterCommands,
  filterTree,
  inspectorTree,
  nodeDetail,
  outputRows,
  timeline,
} from "./model";
import { SessionRecorder, replayRecording } from "./recorder";

/**
 * Tooling overhead.
 *
 * The claim under test: the workbench must never significantly affect the
 * measurements it displays. A profiler that costs more than the thing it
 * profiles reports its own cost and calls it the engine's.
 *
 * Every figure is compared against a frame, which the Phase 1 benchmarks put at
 * 0.0007ms for a small scene. Anything here that approaches a frame must be
 * sampled at a lower rate than frames, and the numbers below are what decides
 * that rather than a guess.
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

// Give the console something to filter.
for (let i = 0; i < 400; i += 1) {
  small.send({ type: "variable.set", key: "noise", value: i });
}

describe("frame, for comparison", () => {
  let frame = 0;
  bench("step a small scene", () => {
    small.step((++frame * 1000) / 60);
  });
  bench("step a 50-row scene", () => {
    large.step((++frame * 1000) / 60);
  });
});

describe("inspector", () => {
  const tree = inspectorTree(small);
  const firstId = tree[0]!.id;

  bench("build the tree (small)", () => {
    inspectorTree(small);
  });
  bench("build the tree (50 rows)", () => {
    inspectorTree(large);
  });
  bench("filter the tree", () => {
    filterTree(tree, "entry");
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
  bench("filter 400 records by source", () => {
    filterCommands(records, { text: "", acceptedOnly: true, source: "operator" });
  });
});

describe("timeline", () => {
  const animation = make("animation");
  animation.send({ type: "playback.play" });
  animation.send({ type: "clip.play", clipId: "anm_sweep" });

  bench("read clips and playhead", () => {
    timeline(animation);
  });
});

describe("debug layers", () => {
  bench("project boxes (small)", () => {
    debugBoxes(small, { canvasWidth: 1920, canvasHeight: 1080, orthographicSize: 5 });
  });
  bench("project boxes (50 rows)", () => {
    debugBoxes(large, { canvasWidth: 1920, canvasHeight: 1080, orthographicSize: 5 });
  });
});

describe("output monitor", () => {
  small.send({
    type: "output.bind",
    output: { id: "preview", width: 960, height: 540, cadence: 2 },
  });

  bench("read output rows", () => {
    outputRows(small, 60);
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
