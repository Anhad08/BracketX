import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  MARKER_CUE,
  MARKER_EVENT,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  compileStateTransition,
  crossedEvents,
  crossedMarkers,
  cursorSeconds,
  frameForSeconds,
  generateKeyBetween,
  markerAt,
  normalizeTimeline,
  resolveTransition,
  sampleTimeline,
  staggerOffset,
  timelineSpan,
  timelineTime,
  validateDocument,
  validateTimeline,
  type SceneDocument,
  type SceneNode,
  type Timeline,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";

/**
 * Phase 6 — Time & Animation.
 *
 * ============================================================================
 * WHAT THIS FILE IS FOR
 * ============================================================================
 * ROADMAP_V2 Phase 6 has five requirements. The Phase 6 audit found three of
 * them unmet and one untested, and the reason none of that was noticed is that
 * nobody had written the mapping from requirement to assertion.
 *
 * So this file is organised BY REQUIREMENT, not by module. Each describe block
 * names the requirement it discharges, and
 * `docs/PHASE_6_REQUIREMENT_TRACE.md` points at these blocks. A requirement
 * with no block here is a requirement that is not done.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROWS = [
  { id: "r1", label: "One" },
  { id: "r2", label: "Two" },
  { id: "r3", label: "Three" },
  { id: "r4", label: "Four" },
];

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

function document_(overrides: Partial<SceneDocument> = {}): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_timeline",
    meta: {
      name: "Timeline",
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
      { id: "var_rows", key: "rows", type: "string", label: "Rows", default: ROWS },
    ],
    assets: [],
    states: [],
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
          layout: { mode: "vertical", gap: 0.1, align: "stretch" },
          repeat: { source: "rows", as: "row", key: "id", limit: 100 },
          children: [box("nod_row")],
        },
      ],
    },
    ...overrides,
  };
}

function host(document: SceneDocument = document_()): SceneHost {
  const scene = new SceneHost(new MockMirrorBackend());
  scene.load(document);
  scene.play();
  return scene;
}

/**
 * Runs a host until its clock reaches `targetFrame`, one frame at a time.
 *
 * Loops on the CLOCK rather than on an iteration count. The clock derives its
 * frame from wall time, so N calls to `renderFrame` do not land on frame N —
 * they landed on 13 for N=15 the first time this file was written, and an
 * assertion built on the wrong frame is a test that passes for the wrong
 * reason. Returns the frame actually reached.
 */
function runTo(scene: SceneHost, targetFrame: number): number {
  let wall = 0;
  let guard = 0;
  while (scene.runtime.clock.frame < targetFrame && guard < targetFrame * 4 + 240) {
    wall += 1000 / 60;
    scene.renderFrame(wall);
    guard += 1;
  }
  return scene.runtime.clock.frame;
}

const REVEAL: Timeline = {
  id: "tl_reveal",
  name: "Reveal",
  duration: 0.5,
  tracks: [
    {
      target: "nod_row",
      path: "transform.position.0",
      keyframes: [
        { time: 0, value: -4, easing: "linear" },
        { time: 0.5, value: 0 },
      ],
      stagger: { interval: 0.25, direction: "forward" },
    },
  ],
};

// ===========================================================================
// R1 — one timeline model
// ===========================================================================

describe("R1 · one timeline model", () => {
  it("uses one playhead calculation for every reader", () => {
    // The operational meaning of "one timeline": not that readers share an
    // interface, but that they cannot disagree about what time it is.
    const cursor = { startFrame: 30, speed: 1 };
    expect(cursorSeconds(cursor, 90, 60)).toBe(1);
    expect(cursorSeconds({ startFrame: 30, speed: -2 }, 90, 60)).toBe(-2);
    expect(cursorSeconds(cursor, 90, 0)).toBe(0);

    // And the inverse, which is what a Studio ruler click needs.
    expect(frameForSeconds(cursor, 1, 60)).toBe(90);
    expect(frameForSeconds({ startFrame: 0, speed: 2 }, 1, 60)).toBe(30);
  });

  it("runs an authored clip and a compiled transition through the SAME player", () => {
    // If these needed two players there would be two playheads, and two
    // playheads drift. This is the assertion that the model is actually one.
    const scene = host(
      document_({
        animations: [
          {
            id: "tl_clip",
            name: "Clip",
            duration: 1,
            tracks: [
              {
                target: "nod_list",
                path: "transform.position.1",
                keyframes: [
                  { time: 0, value: 0 },
                  { time: 1, value: 2 },
                ],
              },
            ],
          },
        ],
      }),
    );

    scene.playClip("tl_clip");
    const adhoc: Timeline = {
      id: "tl_adhoc",
      name: "Ad hoc",
      duration: 1,
      tracks: [
        {
          target: "nod_cam",
          path: "transform.position.2",
          keyframes: [
            { time: 0, value: 10 },
            { time: 1, value: 20 },
          ],
        },
      ],
    };
    scene.animator.playTimeline(adhoc, scene.runtime.clock.frame);
    runTo(scene, 30);

    // Both are playing, both are addressable, and both report through the
    // same ClipState shape.
    expect([...scene.animator.playing].sort()).toEqual(["tl_adhoc", "tl_clip"]);
    expect(scene.animator.clipState("tl_clip")!.seconds).toBeCloseTo(
      scene.animator.clipState("tl_adhoc")!.seconds,
      10,
    );
    expect(scene.animator.isTransient("tl_adhoc")).toBe(true);
    expect(scene.animator.isTransient("tl_clip")).toBe(false);
    scene.dispose();
  });

  it("carries ordered, addressable, typed positions", () => {
    const timeline = normalizeTimeline({
      id: "tl_markers",
      name: "Markers",
      duration: 2,
      tracks: [],
      markers: [
        { id: "cue_b", time: 1.5, kind: MARKER_CUE, payload: { go: 2 } },
        { id: "cue_a", time: 0.5, kind: MARKER_CUE },
      ],
      events: [{ time: 1, name: "midpoint" }],
    });

    // Ordered.
    expect(timeline.markers!.map((m) => m.time)).toEqual([0.5, 1, 1.5]);
    // Addressable.
    expect(markerAt(timeline, "cue_b")!.time).toBe(1.5);
    expect(markerAt(timeline, "nope")).toBeUndefined();
    // Typed, and the payload survives.
    expect(markerAt(timeline, "cue_b")!.payload).toEqual({ go: 2 });
    expect(markerAt(timeline, "midpoint")!.kind).toBe(MARKER_EVENT);
  });

  it("lets two readers share one timeline without seeing each other", () => {
    // Phase 9 readiness, asserted rather than asserted-in-prose: a sequencer
    // reads `cue` markers off the same timeline the animator reads `event`
    // markers off, and neither sees the other's positions.
    const timeline = normalizeTimeline({
      id: "tl_shared",
      name: "Shared",
      duration: 2,
      tracks: [],
      markers: [
        { id: "cue_1", time: 0.5, kind: MARKER_CUE },
        { id: "evt_1", time: 0.7, kind: MARKER_EVENT },
      ],
    });

    expect(crossedMarkers(timeline, 0, 1, MARKER_CUE).map((m) => m.id)).toEqual(["cue_1"]);
    expect(crossedEvents(timeline, 0, 1).map((e) => e.name)).toEqual(["evt_1"]);
    expect(crossedMarkers(timeline, 0, 1).map((m) => m.id)).toEqual(["cue_1", "evt_1"]);
  });

  it("refuses two markers with one id, because addressable means unique", () => {
    expect(
      validateTimeline({
        id: "tl_dup",
        name: "Dup",
        duration: 1,
        tracks: [],
        markers: [
          { id: "same", time: 0, kind: MARKER_CUE },
          { id: "same", time: 1, kind: MARKER_CUE },
        ],
      }),
    ).toContainEqual(expect.stringContaining('two markers named "same"'));
  });

  it("clamps or wraps, depending only on loop", () => {
    const once: Timeline = { id: "a", name: "a", duration: 2, tracks: [] };
    expect(timelineTime(once, -1)).toBe(0);
    expect(timelineTime(once, 5)).toBe(2);
    const looped: Timeline = { ...once, loop: true };
    expect(timelineTime(looped, 5)).toBe(1);
    expect(timelineTime(looped, -0.5)).toBe(1.5);
  });
});

// ===========================================================================
// R2 — delay and stagger
// ===========================================================================

describe("R2 · delay", () => {
  it("shifts a track without shifting the timeline", () => {
    const timeline: Timeline = {
      id: "tl_delay",
      name: "Delay",
      duration: 2,
      tracks: [
        {
          target: "nod_a",
          path: "x",
          delay: 1,
          keyframes: [
            { time: 0, value: 0, easing: "linear" },
            { time: 1, value: 10 },
          ],
        },
      ],
    };

    // Before the delay elapses the track holds its first keyframe.
    expect(sampleTimeline(timeline, 0).get("nod_a")!.get("x")).toBe(0);
    expect(sampleTimeline(timeline, 0.9).get("nod_a")!.get("x")).toBe(0);
    // Then it runs.
    expect(sampleTimeline(timeline, 1.5).get("nod_a")!.get("x")).toBe(5);
    expect(sampleTimeline(timeline, 2).get("nod_a")!.get("x")).toBe(10);
  });

  it("rejects a negative delay rather than sampling before the start", () => {
    expect(
      validateTimeline({
        id: "tl_bad",
        name: "Bad",
        duration: 1,
        tracks: [{ target: "n", path: "x", delay: -1, keyframes: [{ time: 0, value: 0 }] }],
      }),
    ).toContainEqual(expect.stringContaining("invalid delay"));
  });
});

describe("R2 · stagger offsets", () => {
  const stagger = { interval: 0.1 };

  it("offsets forward by default", () => {
    expect([0, 1, 2, 3].map((i) => staggerOffset(stagger, i, 4))).toEqual([
      0, 0.1, 0.2, 0.30000000000000004,
    ]);
  });

  it("reverses", () => {
    expect([0, 1, 2, 3].map((i) => staggerOffset({ ...stagger, direction: "reverse" }, i, 4))).toEqual(
      [0.30000000000000004, 0.2, 0.1, 0],
    );
  });

  it("runs from the centre outwards and from the edges inwards", () => {
    // `center` starts at the outside and collapses inward; `edges` starts in
    // the middle and expands. Both are named for where the LAST item is.
    const centre = [0, 1, 2, 3, 4].map((i) =>
      staggerOffset({ ...stagger, direction: "center" }, i, 5),
    );
    expect(centre[2]).toBe(0);
    expect(centre[0]).toBeCloseTo(0.2, 10);
    expect(centre[4]).toBeCloseTo(0.2, 10);

    const edges = [0, 1, 2, 3, 4].map((i) =>
      staggerOffset({ ...stagger, direction: "edges" }, i, 5),
    );
    expect(edges[0]).toBe(0);
    expect(edges[4]).toBe(0);
    expect(edges[2]).toBeCloseTo(0.2, 10);
  });

  it("derives the interval from a total, which is what data-driven content wants", () => {
    // "Reveal over 0.6 seconds" must hold whether four rows arrive or forty.
    const four = [0, 1, 2, 3].map((i) => staggerOffset({ total: 0.6 }, i, 4));
    const forty = Array.from({ length: 40 }, (_, i) => staggerOffset({ total: 0.6 }, i, 40));
    expect(four.at(-1)).toBeCloseTo(0.6, 10);
    expect(forty.at(-1)).toBeCloseTo(0.6, 10);
  });

  it("is inert for a single instance in every direction", () => {
    for (const direction of ["forward", "reverse", "center", "edges"] as const) {
      expect(staggerOffset({ interval: 1, direction }, 0, 1)).toBe(0);
    }
  });
});

describe("R2 · staggered collections", () => {
  it("fans a track across a collection's instances with no application code", () => {
    // The capability the audit found missing entirely. A collection's instance
    // ids do not exist until the data resolves, so before this the only way to
    // stagger a live list was a clip per row — impossible to author.
    const scene = host(document_({ animations: [REVEAL] }));
    scene.playClip("tl_reveal");
    runTo(scene, 15); // 0.25s — row 1 half done, row 2 exactly starting

    const values = scene.animator.values;
    const at = (identity: string) =>
      values.get(`nod_row#${identity}`)?.get("transform.position.0");

    expect(at("r1")).toBe(-2);
    expect(at("r2")).toBe(-4);
    expect(at("r3")).toBe(-4);
    // Each row is at or behind the one before it. That IS the stagger.
    expect(at("r1") as number).toBeGreaterThan(at("r2") as number);
    scene.dispose();
  });

  it("preserves identity — a staggered reveal creates and destroys nothing", () => {
    // Stagger shifts sample TIME, never a node id. If it touched ids, every
    // reveal would churn the mirror and every GPU resource with it.
    const scene = host(document_({ animations: [REVEAL] }));
    runTo(scene, 5);
    const before = scene.reconciler.mirror.size;

    scene.playClip("tl_reveal");
    let wall = 5000 / 60;
    for (let i = 0; i < 90; i += 1) {
      wall += 1000 / 60;
      scene.renderFrame(wall);
      expect(scene.lastReport?.nodesCreated ?? 0).toBe(0);
      expect(scene.lastReport?.nodesDestroyed ?? 0).toBe(0);
    }
    expect(scene.reconciler.mirror.size).toBe(before);
    scene.dispose();
  });

  it("stays inert when the collection has not resolved yet", () => {
    // A scene whose data has not arrived must look unanimated, not broken.
    const empty = document_({
      animations: [REVEAL],
      variables: [
        { id: "var_rows", key: "rows", type: "string", label: "Rows", default: [] },
      ],
    });
    const scene = host(empty);
    scene.playClip("tl_reveal");
    runTo(scene, 10);
    // The template itself is driven, and nothing throws.
    expect(scene.animator.values.get("nod_row")).toBeDefined();
    scene.dispose();
  });

  it("finishes only when the LAST instance finishes", () => {
    // A staggered track is still moving after the nominal duration. Completing
    // at `duration` would freeze the tail of every reveal part-way.
    expect(timelineSpan(REVEAL, () => 4)).toBeCloseTo(0.5 + 0.75, 10);
    expect(timelineSpan(REVEAL, () => 0)).toBe(0.5);

    const scene = host(document_({ animations: [REVEAL] }));
    scene.playClip("tl_reveal");
    runTo(scene, 40); // 0.67s — past the 0.5s duration, inside the stagger tail
    expect(scene.animator.isPlaying("tl_reveal")).toBe(true);

    runTo(scene, 90); // 1.5s — past the whole 1.25s span
    expect(scene.animator.isPlaying("tl_reveal")).toBe(false);
    expect(scene.animator.isHeld("tl_reveal")).toBe(true);
    // Held at the END of the span, so every row is at its final value.
    expect(
      scene.animator.values.get("nod_row#r4")!.get("transform.position.0"),
    ).toBe(0);
    scene.dispose();
  });

  it("produces values for a laid-out child, but LAYOUT still owns its position", () => {
    // Found by a browser test that could not explain why a staggered reveal
    // computed perfectly and did not move. A laid-out child takes its position
    // from its container, so `transform.position` animation on it is real and
    // invisible. Recorded here so the next person reads it instead of
    // rediscovering it: animate something INSIDE what layout placed.
    const scene = host(document_({ animations: [REVEAL] }));
    scene.playClip("tl_reveal");
    runTo(scene, 15);

    // The value is computed and correct...
    expect(
      scene.animator.values.get("nod_row#r1")!.get("transform.position.0"),
    ).toBe(-2);
    // ...and the world matrix ignores it, because the vertical layout placed
    // the row. Both statements are true at once, which is the confusing part.
    expect(scene.reconciler.mirror.get("nod_row#r1")!.worldMatrix[12]).toBe(0);
    scene.dispose();
  });

  it("refuses a stagger that declares neither an interval nor a total", () => {
    expect(
      validateTimeline({
        id: "tl_bad",
        name: "Bad",
        duration: 1,
        tracks: [
          { target: "n", path: "x", stagger: {}, keyframes: [{ time: 0, value: 0 }] },
        ],
      }),
    ).toContainEqual(expect.stringContaining("neither interval nor total"));
  });
});

// ===========================================================================
// R3 — declared state transitions
// ===========================================================================

const STATEFUL = () =>
  document_({
    states: [
      { id: "st_hidden", name: "hidden", duration: 0 },
      { id: "st_visible", name: "visible", duration: 0.25 },
      { id: "st_warning", name: "warning", duration: 0 },
      { id: "st_success", name: "success", duration: 0 },
    ],
    transitions: [
      { id: "tr_reveal", from: "hidden", to: "visible", duration: 0.5, easing: "easeOutCubic" },
      { id: "tr_alert", from: "warning", to: "success", duration: 0.4 },
    ],
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
        box("nod_card", {
          visible: false,
          states: {
            hidden: { visible: false, transform: { position: [0, -2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            visible: { visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            warning: { props: { cmp_nod_card: { fill: "#ff0000" } } },
            success: { props: { cmp_nod_card: { fill: "#00ff00" } } },
          },
        }),
      ],
    },
  });

describe("R3 · declared transitions", () => {
  it("resolves a declared rule over a state default", () => {
    const document = STATEFUL();
    const resolved = resolveTransition(document, ["hidden"], ["visible"])!;
    expect(resolved.reason).toBe("declared");
    expect(resolved.duration).toBe(0.5);
    expect(resolved.easing).toBe("easeOutCubic");
  });

  it("falls back to the duration declared on the state being entered", () => {
    // `SceneState.duration` has been in SCENE_FORMAT since §10 was written and
    // nothing read it — `validate.ts` collected the ids and dropped them with a
    // bare `void stateIds;`. It now means what the original example implied.
    const document = STATEFUL();
    const resolved = resolveTransition(document, [], ["visible"])!;
    expect(resolved.reason).toBe("state-default");
    expect(resolved.duration).toBe(0.25);
  });

  it("cuts when nothing declares a duration", () => {
    expect(resolveTransition(STATEFUL(), [], ["warning"])).toBeNull();
    expect(resolveTransition(STATEFUL(), ["visible"], ["visible"])).toBeNull();
  });

  it("privileges no state name", () => {
    // The ROADMAP_V2 exit criterion, stated as a test: `warning → success` and
    // `hidden → visible` behave identically, and neither is in/idle/out.
    const document = STATEFUL();
    expect(resolveTransition(document, ["warning"], ["success"])!.duration).toBe(0.4);
    expect(resolveTransition(document, ["hidden"], ["visible"])!.duration).toBe(0.5);
  });

  it("compiles a state change into a timeline, not into a second system", () => {
    const document = STATEFUL();
    const resolution = resolveTransition(document, ["hidden"], ["visible"])!;
    const timeline = compileStateTransition(document, ["hidden"], ["visible"], resolution)!;

    expect(timeline.duration).toBe(0.5);
    expect(validateTimeline(timeline)).toEqual([]);
    const paths = timeline.tracks.map((track) => track.path).sort();
    expect(paths).toContain("transform.position.1");
    expect(paths).toContain("visible");
    expect(timeline.tracks.every((track) => track.target === "nod_card")).toBe(true);
  });

  it("holds visibility across the whole transition, in both directions", () => {
    // The subtlety that makes an out-transition work at all. A node going
    // visible → hidden must stay visible for the animation and disappear when
    // it ends; a node going hidden → visible must be visible from frame one.
    const document = STATEFUL();
    const out = compileStateTransition(
      document,
      ["visible"],
      ["hidden"],
      resolveTransition(document, ["visible"], ["hidden"]) ?? {
        transition: null,
        duration: 0.5,
        reason: "declared",
      },
    )!;
    const visibleTrack = out.tracks.find((track) => track.path === "visible")!;
    expect(visibleTrack.keyframes[0]!.value).toBe(true);
    expect(visibleTrack.keyframes[0]!.easing).toBe("step");
    expect(visibleTrack.keyframes.at(-1)!.value).toBe(false);

    const inward = compileStateTransition(
      document,
      ["hidden"],
      ["visible"],
      resolveTransition(document, ["hidden"], ["visible"])!,
    )!;
    const inTrack = inward.tracks.find((track) => track.path === "visible")!;
    expect(inTrack.keyframes[0]!.value).toBe(true);
  });

  it("interpolates a colour a state changed", () => {
    const document = STATEFUL();
    const timeline = compileStateTransition(
      document,
      ["warning"],
      ["success"],
      resolveTransition(document, ["warning"], ["success"])!,
    )!;
    const fill = timeline.tracks.find((track) => track.path.endsWith(".fill"))!;
    expect(fill.keyframes[0]!.value).toBe("#ff0000");
    expect(fill.keyframes.at(-1)!.value).toBe("#00ff00");
    expect(sampleTimeline(timeline, 0.2).get("nod_card")!.get(fill.path)).toBe("#808000");
  });

  it("compiles nothing when a state change moves nothing", () => {
    const document = STATEFUL();
    expect(
      compileStateTransition(document, ["warning"], ["warning"], {
        transition: null,
        duration: 1,
        reason: "declared",
      }),
    ).toBeNull();
  });

  it("animates automatically when the state is set, through the same player", () => {
    const scene = host(STATEFUL());
    scene.setStates(["hidden"]);
    runTo(scene, 2);

    const before = scene.reconciler.mirror.get("nod_card")!.worldMatrix[13];
    scene.setStates(["visible"]);

    // A transition is now playing, and it is a timeline like any other.
    const playing = scene.animator.playing;
    expect(playing).toHaveLength(1);
    expect(scene.animator.isTransient(playing[0]!)).toBe(true);

    runTo(scene, 15); // mid-transition
    const middle = scene.reconciler.mirror.get("nod_card")!.worldMatrix[13]!;
    expect(middle).toBeGreaterThan(before!);
    expect(middle).toBeLessThan(0);
    // Visible throughout, not only at the end.
    expect(scene.reconciler.mirror.get("nod_card")!.effectiveVisible).toBe(true);

    runTo(scene, 45); // past the end
    expect(scene.reconciler.mirror.get("nod_card")!.worldMatrix[13]).toBe(0);
    // Released, not held: the end values are what the state already produces,
    // and holding would pin a duplicate on top of itself forever.
    expect(scene.animator.playing).toEqual([]);
    expect(scene.animator.clips.some((clip) => clip.id.startsWith("transition_"))).toBe(false);
    scene.dispose();
  });

  it("cuts instantly when no transition is declared, exactly as before", () => {
    const scene = host(STATEFUL());
    scene.setStates(["warning"]);
    expect(scene.animator.playing).toEqual([]);
    scene.dispose();
  });

  it("rejects a transition naming an undeclared state", () => {
    const document = STATEFUL();
    const bad = {
      ...document,
      transitions: [{ id: "tr_bad", from: "hidden", to: "nowhere", duration: 1 }],
    };
    expect(
      validateDocument(bad).errors.some((issue) => issue.code === "unresolved-state"),
    ).toBe(true);
  });
});

// ===========================================================================
// R4 — late join, seeking and replay converge
// ===========================================================================

describe("R4 · late join converges", () => {
  const CLIP: Timeline = {
    id: "tl_long",
    name: "Long",
    duration: 4,
    tracks: [
      {
        target: "nod_list",
        path: "transform.position.1",
        keyframes: [
          { time: 0, value: -3, easing: "easeInOutCubic" },
          { time: 4, value: 3 },
        ],
      },
    ],
  };

  const TARGET_FRAME = 137;

  /** Everything that must agree, in one comparable string. */
  function fingerprint(scene: SceneHost): string {
    const animated = [...scene.animator.values].map(([nodeId, paths]) => [
      nodeId,
      [...paths].map(([path, value]) => `${path}=${JSON.stringify(value)}`).sort(),
    ]);
    const world = [...scene.reconciler.mirror.nodeIds()]
      .sort()
      .map((id) => [id, [...scene.reconciler.mirror.get(id)!.worldMatrix]]);
    return JSON.stringify({
      frame: scene.runtime.clock.frame,
      session: scene.sessionHash(),
      animated,
      world,
    });
  }

  it("a session that PLAYED there and one that SEEKED there are identical", () => {
    // The claim the audit found Derived-but-untested. Stateless sampling says
    // it must hold; nothing asserted it.
    const played = host(document_({ animations: [CLIP] }));
    played.playClip("tl_long", { startFrame: 0 });
    const reached = runTo(played, TARGET_FRAME);

    const seeked = host(document_({ animations: [CLIP] }));
    seeked.playClip("tl_long", { startFrame: 0 });
    seeked.seek(reached);

    expect(fingerprint(seeked)).toBe(fingerprint(played));
    played.dispose();
    seeked.dispose();
  });

  it("a session JOINING mid-flight settles to the running one, with no warm-up", () => {
    // The render surface loaded late — the case old Phase 5 exit criterion 5
    // and ROADMAP_V2 R4 both name.
    const running = host(document_({ animations: [CLIP] }));
    running.playClip("tl_long", { startFrame: 0 });
    const reached = runTo(running, TARGET_FRAME);

    const joining = host(document_({ animations: [CLIP] }));
    joining.playClip("tl_long", { startFrame: 0 });
    // One seek. Not a settle period, not a play-from-the-start.
    joining.seek(reached);

    expect(fingerprint(joining)).toBe(fingerprint(running));
    running.dispose();
    joining.dispose();
  });

  it("replaying the command sequence reaches the same state", () => {
    const live = host(document_({ animations: [CLIP] }));
    live.applyLive({ type: "clip.play", clipId: "tl_long" }, "operator");
    runTo(live, 60);
    live.applyLive({ type: "state.set", states: [] }, "operator");
    runTo(live, TARGET_FRAME);

    const replayed = host(document_({ animations: [CLIP] }));
    replayed.replay([{ type: "clip.play", clipId: "tl_long" }]);
    runTo(replayed, 60);
    replayed.replay([{ type: "state.set", states: [] }]);
    runTo(replayed, TARGET_FRAME);

    expect(fingerprint(replayed)).toBe(fingerprint(live));
    live.dispose();
    replayed.dispose();
  });

  it("converges for a STAGGERED timeline too, where per-instance offsets could drift", () => {
    // Stagger is where a naive implementation would accumulate per instance.
    const played = host(document_({ animations: [REVEAL] }));
    played.playClip("tl_reveal", { startFrame: 0 });
    const reached = runTo(played, 40);

    const seeked = host(document_({ animations: [REVEAL] }));
    seeked.playClip("tl_reveal", { startFrame: 0 });
    seeked.seek(reached);

    expect(fingerprint(seeked)).toBe(fingerprint(played));
    played.dispose();
    seeked.dispose();
  });

  it("does not fire markers on a seek, however many it crosses", () => {
    // Dragging a timeline slider must not trigger every cue in a show.
    const withMarkers: Timeline = {
      ...CLIP,
      events: [
        { time: 0.5, name: "a" },
        { time: 1.5, name: "b" },
        { time: 2.5, name: "c" },
      ],
    };
    const scene = host(document_({ animations: [withMarkers] }));
    const fired: string[] = [];
    for (const name of ["a", "b", "c"]) {
      scene.runtime.events.subscribe(`animation.${name}`, () => fired.push(name));
    }

    scene.playClip("tl_long", { startFrame: 0 });

    // Playing across a marker fires it.
    runTo(scene, 45); // past 0.5s
    expect(fired).toEqual(["a"]);

    // Seeking across two more fires neither, however far it jumps.
    scene.seek(200);
    expect(fired).toEqual(["a"]);
    scene.dispose();
  });
});
