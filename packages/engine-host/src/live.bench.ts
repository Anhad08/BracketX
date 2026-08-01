import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { bench, describe } from "vitest";

import { SceneHost } from "./host";
import type { LiveCommand } from "./live";

/**
 * Live Control benchmarks. Phase 7.
 *
 * Measures what a live show actually does: an operator typing, a feed pushing
 * scores, a leaderboard reordering, all while animation runs.
 *
 * A 60fps frame is 16.67ms. Every figure here competes with rendering for it.
 *
 * Run: pnpm --filter @bracketx/engine-host bench
 */

interface Row {
  id: string;
  color: string;
  score: number;
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    color: `#${((i * 37) % 255).toString(16).padStart(2, "0")}2040`,
    score: i,
  }));
}

function scene(count: number): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_live_bench",
    meta: {
      name: "Live",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [
      { id: "var_rows", key: "rows", type: "string", label: "Rows", default: rows(count) },
      { id: "var_title", key: "title", type: "string", label: "Title", default: "LIVE" },
    ],
    assets: [],
    states: [],
    animations: [
      {
        id: "anm_drift",
        name: "Drift",
        duration: 4,
        loop: true,
        tracks: [
          {
            target: "nod_list",
            path: "transform.position.1",
            keyframes: [
              { time: 0, value: 0, easing: "easeInOutSine" },
              { time: 2, value: 0.4, easing: "easeInOutSine" },
              { time: 4, value: 0 },
            ],
          },
        ],
      },
    ],
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
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
              props: {
                projection: "orthographic",
                orthographicSize: 5,
                near: 0.1,
                far: 100,
              },
            },
          ],
        },
        {
          id: "nod_list",
          name: "List",
          order: "V",
          transform: IDENTITY_TRANSFORM,
          size: { width: 6, height: 8 },
          layout: { mode: "vertical", gap: 0.02, align: "stretch" },
          repeat: { source: "rows", as: "row", key: "id", limit: 20_000 },
          children: [
            {
              id: "nod_row",
              name: "Row",
              order: generateKeyBetween(null, null),
              transform: IDENTITY_TRANSFORM,
              size: { width: 6, height: 0.3 },
              components: [
                {
                  id: "cmp_row",
                  type: "rect",
                  props: { width: 6, height: 0.3, fill: { $var: "row.color" } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function harness(count: number): SceneHost {
  const host = new SceneHost(new MockMirrorBackend());
  host.load(scene(count));
  return host;
}

// ---------------------------------------------------------------------------

describe("live variable updates", () => {
  // A variable nothing binds — the pure command-path cost.
  const small = harness(10);
  const large = harness(1_000);
  let tick = 0;

  bench("unbound variable, 10-row scene", () => {
    small.applyLive({ type: "variable.set", key: "title", value: `T${tick++}` });
  });

  bench("unbound variable, 1,000-row scene", () => {
    large.applyLive({ type: "variable.set", key: "title", value: `T${tick++}` });
  });
});

for (const size of [10, 100, 1_000, 10_000]) {
  describe(`collection of ${size.toLocaleString("en-US")}`, () => {
    const patch = harness(size);
    const reorder = harness(size);
    const insert = harness(size);
    let tick = 0;

    bench("patch one row", () => {
      // The single most common live action: one score changes.
      patch.applyLive({
        type: "collection.patch",
        key: "rows",
        id: "r0",
        keyField: "id",
        patch: { score: tick++ },
      });
    });

    bench("reorder, all survive", () => {
      reorder.applyLive({
        type: "collection.reorder",
        key: "rows",
        ids: [`r${tick++ % size}`],
        keyField: "id",
      });
    });

    bench("insert one row", () => {
      insert.applyLive({
        type: "collection.insert",
        key: "rows",
        at: "end",
        items: [{ id: `x${tick++}`, color: "#ffffff", score: 0 }],
      });
    });
  });
}

describe("command throughput", () => {
  const host = harness(100);
  let tick = 0;

  const batch = (count: number): LiveCommand[] =>
    Array.from({ length: count }, () => ({
      type: "variable.set" as const,
      key: "title",
      value: `T${tick++}`,
    }));

  const ten = batch(10);
  const hundred = batch(100);

  bench("10 commands", () => {
    host.applyBatch(ten);
  });

  bench("100 commands", () => {
    host.applyBatch(hundred);
  });
});

describe("replay", () => {
  const source = harness(100);
  const script: LiveCommand[] = [];
  for (let i = 0; i < 100; i += 1) {
    script.push({
      type: "collection.patch",
      key: "rows",
      id: `r${i % 100}`,
      keyField: "id",
      patch: { score: i },
    });
  }
  source.applyBatch(script);
  const log = source.log.replayable();

  bench("replay 100 commands into a fresh session", () => {
    const target = new SceneHost(new MockMirrorBackend());
    target.load(scene(100));
    target.replay(log);
  });

  bench("session snapshot", () => {
    source.session();
  });

  bench("session hash", () => {
    source.sessionHash();
  });
});

describe("live updates while animating", () => {
  // The real production case: a clip running, a feed pushing, frames going out.
  const host = harness(200);
  host.applyLive({ type: "playback.play" });
  host.applyLive({ type: "clip.play", clipId: "anm_drift" });
  host.applyLive({
    type: "output.bind",
    output: { id: "preview", width: 640, height: 360, cadence: 2 },
  });

  let frame = 0;
  let tick = 0;

  bench("frame with no live input", () => {
    host.renderFrame((++frame * 1000) / 60);
  });

  bench("frame plus one patch", () => {
    host.applyLive({
      type: "collection.patch",
      key: "rows",
      id: `r${tick++ % 200}`,
      keyField: "id",
      patch: { score: tick },
    });
    host.renderFrame((++frame * 1000) / 60);
  });
});
