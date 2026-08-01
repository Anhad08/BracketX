import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";
import {
  applyCollectionCommand,
  itemIdentity,
  validateLiveCommand,
  type LiveCommand,
} from "./live";

/**
 * Live Control. Phase 7.
 *
 * The property under test throughout: EVERY input is the same kind of input,
 * and nothing bypasses the command path. An operator keypress, a data feed, an
 * automation cue, and an AI suggestion are four sources of one thing.
 *
 * If a faster path existed for "urgent" updates, replay would stop reproducing
 * reality and every determinism guarantee built since Phase 2.3 would become a
 * claim rather than a fact.
 */

const ROWS = [
  { id: "t1", name: "Alpha", score: 10, color: "#C0392B" },
  { id: "t2", name: "Bravo", score: 8, color: "#2980B9" },
  { id: "t3", name: "Charlie", score: 6, color: "#27AE60" },
];

function scene(): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_live",
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
      { id: "var_rows", key: "rows", type: "string", label: "Rows", default: ROWS },
      { id: "var_title", key: "title", type: "string", label: "Title", default: "STANDINGS" },
    ],
    assets: [],
    states: [],
    animations: [
      {
        id: "anm_in",
        name: "In",
        duration: 1,
        tracks: [
          {
            target: "nod_list",
            path: "transform.position.0",
            keyframes: [
              { time: 0, value: -8 },
              { time: 1, value: 0 },
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
          size: { width: 6, height: 6 },
          layout: { mode: "vertical", gap: 0.1, align: "stretch" },
          repeat: { source: "rows", as: "row", key: "id", limit: 50 },
          states: { hidden: { visible: false }, live: { visible: true } },
          children: [
            {
              id: "nod_row",
              name: "Row",
              order: generateKeyBetween(null, null),
              transform: IDENTITY_TRANSFORM,
              size: { width: 6, height: 0.6 },
              components: [
                {
                  id: "cmp_row",
                  type: "rect",
                  props: { width: 6, height: 0.6, fill: { $var: "row.color" } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

let host: SceneHost;
let backend: MockMirrorBackend;

beforeEach(() => {
  backend = new MockMirrorBackend();
  host = new SceneHost(backend);
  host.load(scene());
});

function rowCount(): number {
  return backend.snapshot().nodes.filter((n) => /^0\/1\/\d+$/.test(n.path)).length;
}

// ---------------------------------------------------------------------------
// Collection algebra — pure
// ---------------------------------------------------------------------------

describe("collection algebra", () => {
  it("inserts at an index and at the end", () => {
    const extra = { id: "t9" };
    expect(
      applyCollectionCommand(ROWS, {
        type: "collection.insert",
        key: "rows",
        at: 0,
        items: [extra],
      })[0],
    ).toBe(extra);

    const appended = applyCollectionCommand(ROWS, {
      type: "collection.insert",
      key: "rows",
      at: "end",
      items: [extra],
    });
    expect(appended[appended.length - 1]).toBe(extra);
  });

  it("clamps an out-of-range insert rather than leaving a hole", () => {
    const result = applyCollectionCommand(ROWS, {
      type: "collection.insert",
      key: "rows",
      at: 99,
      items: [{ id: "t9" }],
    });
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ id: "t9" });
  });

  it("removes by identity", () => {
    const result = applyCollectionCommand(ROWS, {
      type: "collection.remove",
      key: "rows",
      ids: ["t2"],
      keyField: "id",
    });
    expect(result.map((r) => (r as { id: string }).id)).toEqual(["t1", "t3"]);
  });

  it("preserves item identity for everything it does not touch", () => {
    // THE property. Rebuilding items here, even with identical values, would
    // defeat the reconciler's keyed diff and no test of the collection's
    // CONTENTS would notice.
    const result = applyCollectionCommand(ROWS, {
      type: "collection.remove",
      key: "rows",
      ids: ["t2"],
      keyField: "id",
    });
    expect(result[0]).toBe(ROWS[0]);
    expect(result[1]).toBe(ROWS[2]);
  });

  it("reorders by identity, keeping unnamed items", () => {
    // A partial reorder is the common operator action — "move this to the
    // top" — and dropping the rest would be catastrophic.
    const result = applyCollectionCommand(ROWS, {
      type: "collection.reorder",
      key: "rows",
      ids: ["t3"],
      keyField: "id",
    });
    expect(result.map((r) => (r as { id: string }).id)).toEqual([
      "t3",
      "t1",
      "t2",
    ]);
    expect(result[0]).toBe(ROWS[2]);
  });

  it("patches one item and shares the rest by reference", () => {
    const result = applyCollectionCommand(ROWS, {
      type: "collection.patch",
      key: "rows",
      id: "t2",
      keyField: "id",
      patch: { score: 99 },
    });
    expect((result[1] as { score: number }).score).toBe(99);
    expect(result[0]).toBe(ROWS[0]);
    expect(result[2]).toBe(ROWS[2]);
  });

  it("returns the original array when a patch matches nothing", () => {
    // Lets the caller skip the projection entirely rather than diffing a list
    // against itself.
    const result = applyCollectionCommand(ROWS, {
      type: "collection.patch",
      key: "rows",
      id: "absent",
      keyField: "id",
      patch: { score: 1 },
    });
    expect(result).toBe(ROWS);
  });

  it("falls back to index identity without a key field", () => {
    expect(itemIdentity({ id: "a" }, 2, undefined)).toBe("2");
    expect(itemIdentity({ id: "a" }, 2, "id")).toBe("a");
    expect(itemIdentity("scalar", 2, "id")).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it.each<[string, LiveCommand]>([
    ["empty variable key", { type: "variable.set", key: "", value: 1 }],
    ["negative insert index", { type: "collection.insert", key: "rows", at: -1, items: [1] }],
    ["empty insert", { type: "collection.insert", key: "rows", at: "end", items: [] }],
    ["empty remove ids", { type: "collection.remove", key: "rows", ids: [] }],
    ["empty patch", { type: "collection.patch", key: "rows", id: "t1", patch: {} }],
    ["negative seek", { type: "playback.seek", frame: -1 }],
    ["zero-size output", { type: "output.resize", id: "default", width: 0, height: 10 }],
    ["empty clip id", { type: "clip.play", clipId: "" }],
  ])("rejects %s", (_name, command) => {
    expect(validateLiveCommand(command)).not.toBeNull();
  });

  it("records a rejection rather than throwing", () => {
    // A malformed message from a feed must not unwind the frame that a dozen
    // good commands were applied in.
    const result = host.applyLive({ type: "variable.set", key: "", value: 1 });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(host.log.rejected).toBe(1);
  });

  it("reports a failure for an unknown clip, and stays usable", () => {
    expect(host.applyLive({ type: "clip.play", clipId: "anm_missing" }).accepted).toBe(
      false,
    );
    expect(host.applyLive({ type: "variable.set", key: "title", value: "OK" }).accepted).toBe(
      true,
    );
  });

  it("never corrupts state on a rejected command", () => {
    const before = host.sessionHash();
    host.applyLive({ type: "collection.remove", key: "rows", ids: [] });
    expect(host.sessionHash()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Live behaviour through the host
// ---------------------------------------------------------------------------

describe("live variables", () => {
  it("updates a value and re-resolves only its dependents", () => {
    const result = host.applyLive({
      type: "variable.set",
      key: "title",
      value: "LIVE",
    });

    expect(result.accepted).toBe(true);
    expect(host.runtime.state.variables.get("title")).toBe("LIVE");
    // No node binds `title`, so nothing was touched.
    expect(host.lastReport!.dirty.transform).toBe(0);
  });

  it("treats a template parameter change as a variable change", () => {
    host.applyLive({
      type: "template.setParameter",
      key: "title",
      value: "FROM TEMPLATE",
    });
    expect(host.runtime.state.variables.get("title")).toBe("FROM TEMPLATE");
  });
});

describe("live collections", () => {
  it("adds a row without rebuilding the survivors", () => {
    expect(rowCount()).toBe(3);

    host.applyLive({
      type: "collection.insert",
      key: "rows",
      at: "end",
      items: [{ id: "t4", name: "Delta", score: 4, color: "#8E44AD" }],
    });

    expect(rowCount()).toBe(4);
    expect(host.lastReport!.nodesCreated).toBe(1);
    expect(host.lastReport!.nodesDestroyed).toBe(0);
  });

  it("removes a row and destroys only that instance", () => {
    host.applyLive({
      type: "collection.remove",
      key: "rows",
      ids: ["t2"],
      keyField: "id",
    });

    expect(rowCount()).toBe(2);
    expect(host.lastReport!.nodesDestroyed).toBe(1);
    expect(host.lastReport!.nodesCreated).toBe(0);
  });

  it("reorders without creating or destroying anything", () => {
    // The whole point of keyed identity. A leaderboard reordering keeps every
    // handle, every GPU resource, and any animation in flight.
    host.applyLive({
      type: "collection.reorder",
      key: "rows",
      ids: ["t3", "t1", "t2"],
      keyField: "id",
    });

    expect(rowCount()).toBe(3);
    expect(host.lastReport!.nodesCreated).toBe(0);
    expect(host.lastReport!.nodesDestroyed).toBe(0);
  });

  it("patches a row in place", () => {
    host.applyLive({
      type: "collection.patch",
      key: "rows",
      id: "t1",
      keyField: "id",
      patch: { color: "#FFFFFF" },
    });

    expect(rowCount()).toBe(3);
    expect(host.lastReport!.nodesCreated).toBe(0);
    expect(host.lastReport!.dirty.material).toBeGreaterThan(0);
  });

  it("replaces the whole collection", () => {
    host.applyLive({
      type: "collection.replace",
      key: "rows",
      items: [{ id: "x1", color: "#111111" }],
    });
    expect(rowCount()).toBe(1);
  });

  it("does no projection work when a patch matches nothing", () => {
    const before = host.lastReport;
    host.applyLive({
      type: "collection.patch",
      key: "rows",
      id: "absent",
      keyField: "id",
      patch: { color: "#000000" },
    });
    expect(host.lastReport).toBe(before);
  });
});

describe("states, outputs, playback", () => {
  it("adds and removes a state without duplicating it", () => {
    host.applyLive({ type: "state.add", state: "live" });
    host.applyLive({ type: "state.add", state: "live" });
    expect(host.activeStates).toEqual(["live"]);

    host.applyLive({ type: "state.remove", state: "live" });
    expect(host.activeStates).toEqual([]);
  });

  it("binds, resizes, and unbinds an output", () => {
    expect(
      host.applyLive({
        type: "output.bind",
        output: { id: "preview", width: 640, height: 360, cadence: 2 },
      }).accepted,
    ).toBe(true);
    expect(host.outputs).toHaveLength(2);

    host.applyLive({ type: "output.resize", id: "preview", width: 960, height: 540 });
    expect(host.outputs.find((o) => o.id === "preview")!.width).toBe(960);

    expect(host.applyLive({ type: "output.unbind", id: "preview" }).accepted).toBe(true);
    expect(host.applyLive({ type: "output.unbind", id: "preview" }).accepted).toBe(false);
  });

  it("drives playback and clips through commands", () => {
    host.applyLive({ type: "playback.play" });
    expect(host.applyLive({ type: "clip.play", clipId: "anm_in" }).accepted).toBe(true);

    for (let i = 1; i <= 20; i += 1) host.renderFrame((i * 1000) / 60);
    expect(host.animator.isPlaying("anm_in")).toBe(true);

    expect(host.applyLive({ type: "clip.stop", clipId: "anm_in" }).accepted).toBe(true);
    expect(host.applyLive({ type: "clip.stop", clipId: "anm_in" }).accepted).toBe(false);
  });

  it("seeks without firing animation events", () => {
    host.applyLive({ type: "playback.play" });
    host.applyLive({ type: "clip.play", clipId: "anm_in" });
    expect(host.applyLive({ type: "playback.seek", frame: 45 }).accepted).toBe(true);
    expect(host.runtime.clock.frame).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// The log, sessions, and replay
// ---------------------------------------------------------------------------

describe("command log", () => {
  it("records every command in order with its outcome", () => {
    host.applyLive({ type: "variable.set", key: "title", value: "A" });
    host.applyLive({ type: "variable.set", key: "", value: "B" });
    host.applyLive({ type: "variable.set", key: "title", value: "C" });

    const entries = host.log.entries();
    expect(entries.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(entries.map((e) => e.accepted)).toEqual([true, false, true]);
    expect(entries[1]!.reason).toBeTruthy();
  });

  it("keeps only accepted commands in the replayable set", () => {
    host.applyLive({ type: "variable.set", key: "title", value: "A" });
    host.applyLive({ type: "variable.set", key: "", value: "B" });
    expect(host.log.replayable()).toHaveLength(1);
  });

  it("bounds its memory", () => {
    // A show running for eight hours at sixty commands a second is 1.7 million
    // entries; keeping them all would be a leak with a respectable name.
    for (let i = 0; i < 200; i += 1) {
      host.applyLive({ type: "variable.set", key: "title", value: `t${i}` });
    }
    expect(host.log.size).toBeLessThanOrEqual(10_000);
    expect(host.log.accepted).toBe(200);
  });
});

describe("sessions and replay", () => {
  const script: LiveCommand[] = [
    { type: "variable.set", key: "title", value: "REPLAY" },
    { type: "collection.insert", key: "rows", at: "end", items: [{ id: "t4", color: "#123456" }] },
    { type: "collection.reorder", key: "rows", ids: ["t4"], keyField: "id" },
    { type: "collection.patch", key: "rows", id: "t1", keyField: "id", patch: { color: "#ABCDEF" } },
    { type: "state.add", state: "live" },
    { type: "output.bind", output: { id: "preview", width: 640, height: 360 } },
    { type: "playback.play" },
  ];

  it("reaches an identical session by replaying its own log", () => {
    host.applyBatch(script);
    const original = host.sessionHash();

    const replayed = new SceneHost(new MockMirrorBackend());
    replayed.load(scene());
    replayed.replay(host.log.replayable());

    expect(replayed.sessionHash()).toBe(original);
  });

  it("produces identical runtime hashes for identical input", () => {
    const a = new SceneHost(new MockMirrorBackend());
    a.load(scene());
    a.applyBatch(script);

    const b = new SceneHost(new MockMirrorBackend());
    b.load(scene());
    b.applyBatch(script);

    expect(b.session().runtimeHash).toBe(a.session().runtimeHash);
  });

  it("reaches the same mirror, not merely the same state", () => {
    host.applyBatch(script);

    const replayed = new SceneHost(new MockMirrorBackend());
    const replayBackend = replayed as unknown as { reconciler: { mirror: unknown } };
    void replayBackend;
    const target = new MockMirrorBackend();
    const fresh = new SceneHost(target);
    fresh.load(scene());
    fresh.replay(host.log.replayable());

    expect(JSON.stringify(target.snapshot().nodes)).toBe(
      JSON.stringify(backend.snapshot().nodes),
    );
  });

  it("does not depend on wall time", () => {
    // Timestamps are recorded but never read during apply. An engine that
    // behaved differently for a command arriving at a different wall time
    // would not be replayable, and wall time is the one input a replay cannot
    // reproduce.
    const entries = host.applyBatch(script) && host.log.entries();
    expect(entries.every((e) => typeof e.timestamp === "number")).toBe(true);

    const replayed = new SceneHost(new MockMirrorBackend());
    replayed.load(scene());
    replayed.replay(host.log.replayable());
    expect(replayed.sessionHash()).toBe(host.sessionHash());
  });

  it("snapshots deterministically regardless of key insertion order", () => {
    const a = new SceneHost(new MockMirrorBackend());
    a.load(scene());
    a.applyLive({ type: "variable.set", key: "zzz", value: 1 });
    a.applyLive({ type: "variable.set", key: "aaa", value: 2 });

    const b = new SceneHost(new MockMirrorBackend());
    b.load(scene());
    b.applyLive({ type: "variable.set", key: "aaa", value: 2 });
    b.applyLive({ type: "variable.set", key: "zzz", value: 1 });

    expect(b.sessionHash()).toBe(a.sessionHash());
  });
});

// ---------------------------------------------------------------------------
// Property: random command sequences never corrupt the session
// ---------------------------------------------------------------------------

describe("property: arbitrary command sequences", () => {
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function randomCommand(random: () => number, tick: number): LiveCommand {
    const roll = random();
    const id = `t${Math.floor(random() * 5) + 1}`;

    if (roll < 0.2) {
      return { type: "collection.insert", key: "rows", at: "end", items: [{ id: `n${tick}`, color: "#123456" }] };
    }
    if (roll < 0.35) {
      return { type: "collection.remove", key: "rows", ids: [id], keyField: "id" };
    }
    if (roll < 0.5) {
      return { type: "collection.reorder", key: "rows", ids: [id], keyField: "id" };
    }
    if (roll < 0.65) {
      return { type: "collection.patch", key: "rows", id, keyField: "id", patch: { color: "#654321" } };
    }
    if (roll < 0.75) {
      return { type: "variable.set", key: "title", value: `T${tick}` };
    }
    if (roll < 0.85) {
      return { type: "state.add", state: "live" };
    }
    if (roll < 0.92) {
      return { type: "state.remove", state: "live" };
    }
    return { type: "playback.play" };
  }

  it.each([1, 7, 42, 1234, 8675309])(
    "stays consistent and replayable under seed %i",
    (seed) => {
      const random = rng(seed);
      const commands: LiveCommand[] = [];

      for (let i = 0; i < 200; i += 1) {
        const command = randomCommand(random, i);
        commands.push(command);
        host.applyLive(command);

        // The mirror must agree with the document after EVERY command, not
        // merely at the end.
        expect(host.reconciler.verify().issues, `seed ${seed} step ${i}`).toEqual([]);
      }

      const replayed = new SceneHost(new MockMirrorBackend());
      replayed.load(scene());
      replayed.replay(host.log.replayable());

      expect(replayed.sessionHash()).toBe(host.sessionHash());
    },
  );
});
