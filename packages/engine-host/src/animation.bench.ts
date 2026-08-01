import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  ease,
  generateKeyBetween,
  sampleClip,
  type AnimationClip,
  type Keyframe,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import { SceneHost } from "./host";

/**
 * Animation benchmarks. Phase 5.
 *
 * The claims under test:
 *
 *   1. Sampling is O(tracks), not O(scene). A lower third animating in must
 *      not cost what the 500-node package around it costs.
 *   2. Keyframe count is O(log n) per sample, because tracks binary-search.
 *   3. An idle frame is free. Most frames of most shows animate nothing.
 *
 * A 60fps frame is 16.67ms and TEXT_ENGINE §7 already claims 2ms of it.
 * Animation must be a rounding error against that or it is not viable.
 *
 * Run: pnpm --filter @bracketx/engine-host bench
 */

function keyframes(count: number, span = 10): Keyframe[] {
  const out: Keyframe[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      time: (i / Math.max(1, count - 1)) * span,
      value: (i % 2 === 0 ? -1 : 1) * (i % 7),
      easing: "easeInOutCubic",
    });
  }
  return out;
}

function clip(tracks: number, keys: number): AnimationClip {
  return {
    id: "anm_bench",
    name: "Bench",
    duration: 10,
    loop: true,
    tracks: Array.from({ length: tracks }, (_, i) => ({
      target: `nod_n${i}`,
      path: "transform.position.0",
      keyframes: keyframes(keys),
    })),
  };
}

function node(id: string): SceneNode {
  return {
    id,
    name: id,
    order: generateKeyBetween(null, null),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: 1, height: 1 },
    components: [
      {
        id: `cmp_${id.slice(4)}`,
        type: "rect",
        props: { width: 1, height: 1, fill: "#0B1F3A" },
      },
    ],
  };
}

function scene(nodes: number, clips: AnimationClip[]): SceneDocument {
  const children: SceneNode[] = [
    {
      id: "nod_cam",
      name: "Camera",
      order: "1",
      transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [
        {
          id: "cmp_cam",
          type: "camera",
          props: {
            projection: "orthographic",
            orthographicSize: 5,
            near: 0.1,
            far: 100,
          },
        },
      ],
    },
  ];
  for (let i = 0; i < nodes; i += 1) children.push(node(`nod_n${i}`));

  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_bench",
    meta: {
      name: "Bench",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    animations: clips,
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      children,
    },
  };
}

function running(nodes: number, tracks: number, keys: number): SceneHost {
  const host = new SceneHost(new MockMirrorBackend());
  host.load(scene(nodes, [clip(tracks, keys)]));
  host.play();
  host.playClip("anm_bench", { startFrame: 0 });
  return host;
}

// ---------------------------------------------------------------------------
// Pure sampling
// ---------------------------------------------------------------------------

describe("sampling by track count", () => {
  const one = clip(1, 8);
  const ten = clip(10, 8);
  const hundred = clip(100, 8);

  let t = 0;
  const next = () => (t = (t + 0.017) % 10);

  bench("1 track", () => {
    sampleClip(one, next());
  });
  bench("10 tracks", () => {
    sampleClip(ten, next());
  });
  bench("100 tracks", () => {
    sampleClip(hundred, next());
  });
});

describe("sampling by keyframe count", () => {
  // Binary search means 10x the keyframes should cost far less than 10x.
  const few = clip(10, 8);
  const many = clip(10, 80);
  const lots = clip(10, 800);

  let t = 0;
  const next = () => (t = (t + 0.017) % 10);

  bench("8 keyframes/track", () => {
    sampleClip(few, next());
  });
  bench("80 keyframes/track", () => {
    sampleClip(many, next());
  });
  bench("800 keyframes/track", () => {
    sampleClip(lots, next());
  });
});

describe("easing", () => {
  bench("named curve", () => {
    ease("easeInOutCubic", 0.37);
  });
  bench("cubic-bezier solve", () => {
    ease([0.25, 0.1, 0.25, 1], 0.37);
  });
});

// ---------------------------------------------------------------------------
// Whole frames, through the host
// ---------------------------------------------------------------------------

describe("frame cost against the 16.67ms budget", () => {
  // The claim: cost tracks ANIMATED nodes, not scene size. Both scenes below
  // animate 10 nodes; one has 500 around them.
  const small = running(20, 10, 16);
  const large = running(500, 10, 16);
  const heavy = running(500, 200, 16);

  let frame = 0;
  const step = () => ((frame += 1) * 1000) / 60;

  bench("10 animated in a 20-node scene", () => {
    small.renderFrame(step());
  });
  bench("10 animated in a 500-node scene", () => {
    large.renderFrame(step());
  });
  bench("200 animated in a 500-node scene", () => {
    heavy.renderFrame(step());
  });
});

describe("idle frames", () => {
  // Most frames of most shows animate nothing. That path must be free.
  const idle = new SceneHost(new MockMirrorBackend());
  idle.load(scene(500, [clip(10, 16)]));
  idle.play();

  const held = running(500, 10, 16);
  // Run it past its duration so every clip is held rather than advancing.
  for (let i = 1; i <= 700; i += 1) held.renderFrame((i * 1000) / 60);

  let frame = 0;
  const step = () => ((frame += 1) * 1000) / 60;

  bench("nothing playing, 500 nodes", () => {
    idle.renderFrame(step());
  });
  bench("clip held at its final frame, 500 nodes", () => {
    held.renderFrame(step());
  });
});
