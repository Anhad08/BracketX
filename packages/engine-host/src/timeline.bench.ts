import { bench, describe } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  compileStateTransition,
  generateKeyBetween,
  resolveTransition,
  sampleTimeline,
  staggerOffset,
  timelineSpan,
  type SceneDocument,
  type SceneNode,
  type Timeline,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";

/**
 * Phase 6 overhead.
 *
 * ============================================================================
 * WHAT IS BEING PROTECTED
 * ============================================================================
 * Two of the new features run on the SAMPLED path — once per frame, forever:
 *
 *   stagger   fans a track across every instance of a collection
 *   span      decides where a non-looping timeline clamps
 *
 * Both are therefore capable of turning an O(1) frame into an O(collection)
 * one, which is the failure the whole engine is built to avoid and the failure
 * the Workbench V3 audit found in the tooling. So they are measured here at
 * scale, against a frame on the same scene, and the numbers are published in
 * PHASE_6_VERIFICATION.md rather than asserted in prose.
 *
 * Transition compilation is NOT on the sampled path — it happens once per state
 * change — so it is measured separately and judged against a different bar.
 *
 * Run: pnpm --filter @bracketx/engine-host bench
 */

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    label: `Row ${index}`,
  }));
}

function box(id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    size: { width: 4, height: 0.5 },
    components: [
      {
        id: `cmp_${id}`,
        type: "rect",
        props: { width: 4, height: 0.5, fill: "#1f6feb" },
      },
    ],
    ...extra,
  };
}

function document_(count: number, animations: Timeline[]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_bench",
    meta: {
      name: "Bench",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [
      { id: "var_rows", key: "rows", type: "string", label: "Rows", default: rows(count) },
    ],
    assets: [],
    states: [],
    animations,
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      children: [
        {
          id: "nod_cam",
          name: "Camera",
          order: "1",
          transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
          components: [
            {
              id: "cmp_cam",
              type: "camera",
              props: { projection: "orthographic", orthographicSize: 5, near: 0.1, far: 100 },
            },
          ],
        },
        {
          id: "nod_list",
          name: "List",
          order: "V",
          transform: IDENTITY_TRANSFORM,
          size: { width: 4, height: 6 },
          layout: { mode: "vertical", gap: 0.02, align: "stretch" },
          repeat: { source: "rows", as: "row", key: "id", limit: 20000 },
          children: [box("nod_row")],
        },
      ],
    },
  };
}

const PLAIN: Timeline = {
  id: "tl_plain",
  name: "Plain",
  duration: 1,
  tracks: [
    {
      target: "nod_list",
      path: "transform.position.1",
      keyframes: [
        { time: 0, value: -3, easing: "easeInOutCubic" },
        { time: 1, value: 3 },
      ],
    },
  ],
};

function reveal(id = "tl_reveal"): Timeline {
  return {
    id,
    name: "Reveal",
    duration: 0.5,
    tracks: [
      {
        target: "nod_row",
        path: "transform.position.0",
        keyframes: [
          { time: 0, value: -4, easing: "easeOutCubic" },
          { time: 0.5, value: 0 },
        ],
        stagger: { total: 0.6 },
      },
    ],
  };
}

function make(count: number, animations: Timeline[], clip?: string): SceneHost {
  const scene = new SceneHost(new MockMirrorBackend());
  scene.load(document_(count, animations));
  scene.play();
  if (clip !== undefined) scene.playClip(clip, { startFrame: 0 });
  for (let i = 1; i <= 10; i += 1) scene.renderFrame((i * 1000) / 60);
  return scene;
}

// ---------------------------------------------------------------------------
// The frame, for comparison
// ---------------------------------------------------------------------------

describe("frame, for comparison", () => {
  const plain100 = make(100, [PLAIN], "tl_plain");
  const plain2000 = make(2000, [PLAIN], "tl_plain");
  let wall = 1000;

  bench("100 rows, unstaggered clip", () => {
    plain100.renderFrame((wall += 1000 / 60));
  });
  bench("2,000 rows, unstaggered clip", () => {
    plain2000.renderFrame((wall += 1000 / 60));
  });
});

// ---------------------------------------------------------------------------
// Stagger — the sampled path
// ---------------------------------------------------------------------------

describe("stagger evaluation", () => {
  const s100 = make(100, [reveal()], "tl_reveal");
  const s1000 = make(1000, [reveal()], "tl_reveal");
  const s5000 = make(5000, [reveal()], "tl_reveal");
  let wall = 1000;

  bench("frame with a staggered track, 100 instances", () => {
    s100.renderFrame((wall += 1000 / 60));
  });
  bench("frame with a staggered track, 1,000 instances", () => {
    s1000.renderFrame((wall += 1000 / 60));
  });
  bench("frame with a staggered track, 5,000 instances", () => {
    s5000.renderFrame((wall += 1000 / 60));
  });

  const timeline = reveal();
  const ids = Array.from({ length: 5000 }, (_, i) => `nod_row#r${i}`);
  bench("sampleTimeline alone, 5,000 instances", () => {
    sampleTimeline(timeline, 0.25, { instancesOf: () => ids });
  });

  const stagger = { total: 0.6 } as const;
  bench("one stagger offset", () => {
    staggerOffset(stagger, 2500, 5000);
  });
  bench("timelineSpan, closed form", () => {
    timelineSpan(timeline, () => 5000);
  });
});

// ---------------------------------------------------------------------------
// Transitions — the state-change path, not the frame path
// ---------------------------------------------------------------------------

function stateful(nodes: number): SceneDocument {
  const base = document_(4, []);
  const children: SceneNode[] = [base.root.children![0]!];
  for (let index = 0; index < nodes; index += 1) {
    children.push(
      box(`nod_card${index}`, {
        states: {
          hidden: {
            visible: false,
            transform: { position: [0, -2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
          visible: {
            visible: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        },
      }),
    );
  }
  return {
    ...base,
    states: [
      { id: "st_hidden", name: "hidden", duration: 0 },
      { id: "st_visible", name: "visible", duration: 0.25 },
    ],
    transitions: [
      { id: "tr_reveal", from: "hidden", to: "visible", duration: 0.5, easing: "easeOutCubic" },
    ],
    root: { ...base.root, children },
  };
}

describe("transition evaluation", () => {
  for (const nodes of [10, 200]) {
    const document = stateful(nodes);
    const resolution = resolveTransition(document, ["hidden"], ["visible"])!;
    const compiled = compileStateTransition(document, ["hidden"], ["visible"], resolution)!;

    bench(`resolve a transition, ${nodes} stateful nodes`, () => {
      resolveTransition(document, ["hidden"], ["visible"]);
    });
    bench(`compile a transition, ${nodes} stateful nodes`, () => {
      compileStateTransition(document, ["hidden"], ["visible"], resolution);
    });
    bench(`sample a compiled transition, ${nodes} stateful nodes`, () => {
      sampleTimeline(compiled, 0.25);
    });
  }

  const scene = new SceneHost(new MockMirrorBackend());
  scene.load(stateful(200));
  scene.play();
  scene.setStates(["hidden"]);
  let flip = false;
  bench("setStates end to end, 200 stateful nodes", () => {
    flip = !flip;
    scene.setStates(flip ? ["visible"] : ["hidden"]);
  });
});

// ---------------------------------------------------------------------------
// Seeking and late join
// ---------------------------------------------------------------------------

describe("timeline seeking", () => {
  const plain = make(1000, [PLAIN], "tl_plain");
  const staggered = make(1000, [reveal()], "tl_reveal");
  let target = 100;

  bench("seek, 1,000 rows, unstaggered", () => {
    plain.seek((target = target === 100 ? 250 : 100));
  });
  bench("seek, 1,000 rows, staggered", () => {
    staggered.seek((target = target === 100 ? 250 : 100));
  });
});

describe("late join", () => {
  // The whole cost of arriving mid-show: load, cue, seek, one frame. No
  // warm-up and no settle period, which is the point of stateless sampling —
  // this benchmark exists to show the number is small enough to be believable.
  for (const count of [100, 1000]) {
    const document = document_(count, [reveal()]);
    bench(`join at frame 3,600, ${count} rows`, () => {
      const scene = new SceneHost(new MockMirrorBackend());
      scene.load(document);
      scene.play();
      scene.playClip("tl_reveal", { startFrame: 0 });
      scene.seek(3600);
      scene.dispose();
    });
  }
});

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

describe("timeline scaling", () => {
  const many: Timeline = {
    id: "tl_many",
    name: "Many tracks",
    duration: 2,
    tracks: Array.from({ length: 200 }, (_, index) => ({
      target: `nod_card${index}`,
      path: "transform.position.1",
      keyframes: [
        { time: 0, value: 0, easing: "linear" as const },
        { time: 2, value: 1 },
      ],
    })),
  };
  bench("sample 200 tracks", () => {
    sampleTimeline(many, 1);
  });

  const dense: Timeline = {
    id: "tl_dense",
    name: "Dense keyframes",
    duration: 10,
    tracks: [
      {
        target: "nod_list",
        path: "transform.position.1",
        // A ten-second clip keyed every frame. Binary search territory.
        keyframes: Array.from({ length: 600 }, (_, index) => ({
          time: index / 60,
          value: index,
        })),
      },
    ],
  };
  bench("sample a 600-keyframe track", () => {
    sampleTimeline(dense, 7.13);
  });

  const manyStaggered: Timeline = {
    id: "tl_many_stagger",
    name: "Many staggered tracks",
    duration: 1,
    tracks: Array.from({ length: 8 }, (_, index) => ({
      target: "nod_row",
      path: `transform.position.${index % 3}`,
      keyframes: [
        { time: 0, value: 0, easing: "linear" as const },
        { time: 1, value: 1 },
      ],
      stagger: { total: 0.5 } as const,
    })),
  };
  const ids = Array.from({ length: 1000 }, (_, i) => `nod_row#r${i}`);
  bench("8 staggered tracks over 1,000 instances", () => {
    sampleTimeline(manyStaggered, 0.5, { instancesOf: () => ids });
  });
});
