import { beforeEach, describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  clipTime,
  crossedEvents,
  ease,
  generateKeyBetween,
  interpolate,
  normalizeClip,
  sampleClip,
  sampleTrack,
  validateClip,
  type AnimationClip,
  type SceneDocument,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";
import { AnimationError } from "./animator";

/**
 * Animation. Phase 5.
 *
 * The governing rule, asserted throughout:
 *
 *   ANIMATION DESCRIBES HOW STATE CHANGES OVER TIME. IT NEVER OWNS STATE.
 *
 * Everything follows from that. Sampling is pure, so seeking is free, replay is
 * exact, reverse is a sign change, and two outputs at different cadences cannot
 * drift because neither accumulates.
 */

const AUTHORED_SLIDE: AnimationClip = {
  id: "anm_slide",
  name: "Slide In",
  duration: 1,
  tracks: [
    {
      target: "nod_bar",
      path: "transform.position.0",
      keyframes: [
        { time: 0, value: -5, easing: "linear" },
        { time: 1, value: 0 },
      ],
    },
  ],
  events: [
    { time: 0.5, name: "halfway" },
    { time: 1, name: "arrived" },
  ],
};

/**
 * Normalised once, exactly as a document is at load.
 *
 * `events` is the AUTHORED form; `markers` is the one runtime representation.
 * Sampling and crossing read markers only — the same discipline `sampleTrack`
 * already follows by assuming sorted keyframes, and for the same reason: a
 * check that runs sixty times a second to verify something that can only change
 * at load is pure waste.
 */
const SLIDE: AnimationClip = normalizeClip(AUTHORED_SLIDE);

function scene(clips: AnimationClip[] = [SLIDE]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_anim",
    meta: {
      name: "Anim",
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
          id: "nod_bar",
          name: "Bar",
          order: "V",
          transform: { position: [-5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          size: { width: 4, height: 1 },
          components: [
            {
              id: "cmp_bar",
              type: "rect",
              props: { width: 4, height: 1, fill: "#0B1F3A" },
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

/** X position of the animated bar, straight out of the mirror. */
function barX(): number {
  return backend.snapshot().nodes.find((n) => n.path === "0/1")!.worldMatrix[12]!;
}

/** Advance the host by `frames` at 60fps. */
function advance(frames: number): void {
  for (let i = 1; i <= frames; i += 1) host.renderFrame((i * 1000) / 60);
}

// ---------------------------------------------------------------------------
// Pure evaluation
// ---------------------------------------------------------------------------

describe("easing", () => {
  it("pins the endpoints for every named curve", () => {
    const names = [
      "linear", "easeInQuad", "easeOutQuad", "easeInOutQuad",
      "easeInCubic", "easeOutCubic", "easeInOutCubic",
      "easeInQuart", "easeOutQuart", "easeInOutQuart",
      "easeInExpo", "easeOutExpo", "easeInOutExpo",
      "easeInSine", "easeOutSine", "easeInOutSine",
    ] as const;

    for (const name of names) {
      expect(ease(name, 0), name).toBeCloseTo(0, 6);
      expect(ease(name, 1), name).toBeCloseTo(1, 6);
    }
  });

  it("lets back curves overshoot, which is the point of them", () => {
    // easeOutBack must exceed 1 somewhere or it is not a back curve.
    const samples = Array.from({ length: 21 }, (_, i) => ease("easeOutBack", i / 20));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(ease("easeOutBack", 1)).toBeCloseTo(1, 6);
  });

  it("holds until the next keyframe on step", () => {
    expect(ease("step", 0.99)).toBe(0);
  });

  it("solves cubic-bezier deterministically", () => {
    const curve = [0.25, 0.1, 0.25, 1] as const;
    expect(ease(curve, 0)).toBe(0);
    expect(ease(curve, 1)).toBe(1);
    // Repeated solves must agree exactly — a convergence-threshold loop could
    // take a different number of steps on different hardware.
    expect(ease(curve, 0.37)).toBe(ease(curve, 0.37));
    expect(ease(curve, 0.5)).toBeGreaterThan(0.5);
  });
});

describe("interpolation", () => {
  it("interpolates numbers and vectors", () => {
    expect(interpolate(0, 10, 0.25)).toBe(2.5);
    expect(interpolate([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });

  it("interpolates colours in sRGB, where authors picked them", () => {
    // Physically, linear is correct. Perceptually, an author who picks two
    // swatches expects the midpoint to look like the swatch between them.
    expect(interpolate("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(interpolate("#f00", "#00f", 0)).toBe("#f00");
  });

  it("preserves alpha through a colour interpolation", () => {
    expect(interpolate("#00000000", "#000000ff", 0.5)).toBe("#00000080");
  });

  it("steps values it cannot interpolate rather than throwing", () => {
    // A string or boolean track is a legitimate way to express a cut.
    expect(interpolate("left", "right", 0.4)).toBe("left");
    expect(interpolate("left", "right", 0.6)).toBe("right");
    expect(interpolate(true, false, 0.6)).toBe(false);
  });
});

describe("sampling", () => {
  it("clamps a non-looping clip at both ends", () => {
    expect(clipTime(SLIDE, -3)).toBe(0);
    expect(clipTime(SLIDE, 5)).toBe(1);
  });

  it("wraps a looping clip, including backwards", () => {
    const loop = { ...SLIDE, loop: true };
    expect(clipTime(loop, 1.25)).toBeCloseTo(0.25, 6);
    // A clock running backwards must wrap rather than go negative and sample
    // before the first keyframe forever.
    expect(clipTime(loop, -0.25)).toBeCloseTo(0.75, 6);
  });

  it("samples a track between keyframes", () => {
    const track = SLIDE.tracks[0]!;
    expect(sampleTrack(track, 0)).toBe(-5);
    expect(sampleTrack(track, 0.5)).toBe(-2.5);
    expect(sampleTrack(track, 1)).toBe(0);
  });

  it("normalizes out-of-order keyframes at load, not on every sample", () => {
    // Documents arrive from disk, other clients, and generators, so the order
    // cannot be assumed — but checking it 60 times a second per track defeats
    // the binary search, measured at 22x for 100x the keyframes.
    const scrambled: AnimationClip = {
      id: "anm_scrambled",
      name: "Scrambled",
      duration: 1,
      tracks: [
        {
          target: "nod_bar",
          path: "transform.position.0",
          keyframes: [
            { time: 1, value: 10 },
            { time: 0, value: 0 },
          ],
        },
      ],
    };

    expect(sampleTrack(normalizeClip(scrambled).tracks[0]!, 0.5)).toBe(5);
    // A timeline that needs nothing done is returned BY REFERENCE — no
    // allocation. `scrambled` has no events, so normalising it twice is a
    // no-op the second time.
    const once = normalizeClip(scrambled);
    expect(normalizeClip(once)).toBe(once);
    // And normalising an already-normalised timeline is idempotent, which is
    // what lets the animator normalise defensively on every playTimeline.
    expect(normalizeClip(SLIDE)).toBe(SLIDE);
  });

  it("is a pure function of clip and time", () => {
    // The whole architecture rests on this one property.
    const a = sampleClip(SLIDE, 0.37);
    const b = sampleClip(SLIDE, 0.37);
    expect(JSON.stringify([...b])).toBe(JSON.stringify([...a]));
  });
});

describe("events", () => {
  it("folds authored events into markers at load, leaving one representation", () => {
    // Two ways to say the same thing at runtime is how two subsystems start
    // disagreeing. `events` is authored; `markers` is what anything reads.
    expect(AUTHORED_SLIDE.markers).toBeUndefined();
    expect(SLIDE.markers?.map((marker) => marker.id)).toEqual([
      "halfway",
      "arrived",
    ]);
    expect(SLIDE.markers?.every((marker) => marker.kind === "event")).toBe(true);
    expect(SLIDE.events).toBeUndefined();
  });

  it("fires on the half-open interval, so never twice", () => {
    expect(crossedEvents(SLIDE, 0, 0.5).map((e) => e.name)).toEqual(["halfway"]);
    // 0.5 was already fired above; crossing from it must not repeat it.
    expect(crossedEvents(SLIDE, 0.5, 0.9)).toEqual([]);
  });

  it("orders events in the direction of travel", () => {
    expect(crossedEvents(SLIDE, 0, 1).map((e) => e.name)).toEqual([
      "halfway",
      "arrived",
    ]);
    expect(crossedEvents(SLIDE, 1, 0).map((e) => e.name)).toEqual([
      "arrived",
      "halfway",
    ]);
  });

  it("fires nothing when time did not move", () => {
    expect(crossedEvents(SLIDE, 0.5, 0.5)).toEqual([]);
  });
});

describe("validation", () => {
  it("accepts a well-formed clip", () => {
    expect(validateClip(SLIDE)).toEqual([]);
  });

  it("rejects a looping clip with zero duration", () => {
    // Would divide by zero on every wrap.
    const problems = validateClip({ ...SLIDE, duration: 0, loop: true });
    expect(problems.join(" ")).toMatch(/loops but has zero duration/);
  });

  it("rejects non-finite times and empty tracks", () => {
    const problems = validateClip({
      id: "anm_bad",
      name: "Bad",
      duration: 1,
      tracks: [
        { target: "n", path: "p", keyframes: [{ time: NaN, value: 1 }] },
        { target: "n", path: "q", keyframes: [] },
      ],
    });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Driven by the runtime clock
// ---------------------------------------------------------------------------

describe("playback", () => {
  it("moves a node over the clip's duration", () => {
    expect(barX()).toBeCloseTo(-5, 5);

    host.play();
    host.playClip("anm_slide", { startFrame: host.runtime.clock.frame });

    advance(30);
    // Read the clock rather than assuming the frame: the harness supplies wall
    // time and the clock decides how many frames that is.
    const expected = -5 + 5 * Math.min(1, host.runtime.clock.frame / 60);
    expect(barX()).toBeCloseTo(expected, 4);

    advance(40);
    expect(barX()).toBeCloseTo(0, 4);
  });

  it("holds the final frame when a clip completes", () => {
    // A lower third that slides in and then snaps back off-screen the instant
    // its clip ends is broken. Completion stops advancing; it does not revert.
    host.play();
    host.playClip("anm_slide");
    advance(90);

    expect(host.animator.isPlaying("anm_slide")).toBe(false);
    expect(host.animator.isHeld("anm_slide")).toBe(true);
    expect(barX()).toBeCloseTo(0, 5);
  });

  it("keeps looping a looping clip", () => {
    host.load(scene([{ ...SLIDE, loop: true }]));
    host.play();
    host.playClip("anm_slide");
    advance(150);

    expect(host.animator.isPlaying("anm_slide")).toBe(true);
  });

  it("runs backwards at negative speed", () => {
    host.load(scene());
    host.play();
    // Start at the end and run back.
    host.playClip("anm_slide", { speed: -1, startFrame: 0 });
    host.seek(0);

    const start = barX();
    advance(10);
    // Sampling before zero clamps to the first keyframe, so it holds.
    expect(barX()).toBeLessThanOrEqual(start + 0.001);
  });

  it("refuses speed zero rather than silently freezing", () => {
    expect(() => host.playClip("anm_slide", { speed: 0 })).toThrow(
      AnimationError,
    );
  });

  it("refuses an unknown clip", () => {
    expect(() => host.playClip("anm_missing")).toThrow(/no clip/);
  });

  it("reverts a node to its document value when the clip stops", () => {
    host.play();
    host.playClip("anm_slide");
    advance(30);
    expect(barX()).toBeGreaterThan(-5);

    // An explicit stop DOES revert. That is the difference from completion.
    host.stopClip("anm_slide");
    expect(barX()).toBeCloseTo(-5, 5);
  });
});

describe("determinism", () => {
  it("replays a frame sequence to identical values", () => {
    const run = (): number[] => {
      const local = new SceneHost(new MockMirrorBackend());
      local.load(scene());
      local.play();
      local.playClip("anm_slide");
      const xs: number[] = [];
      for (let i = 1; i <= 40; i += 1) {
        local.renderFrame((i * 1000) / 60);
        xs.push(
          (
            local.reconciler.mirror.get("nod_bar")!.worldMatrix as number[]
          )[12]!,
        );
      }
      return xs;
    };

    expect(run()).toEqual(run());
  });

  it("seeking reaches the same value as playing there", () => {
    // The property that makes scrubbing trustworthy: there is no state to
    // unwind, so arriving at frame 30 by seeking or by playing is identical.
    host.play();
    host.playClip("anm_slide", { startFrame: 0 });
    advance(30);
    const frame = host.runtime.clock.frame;
    const played = barX();

    const seeker = new SceneHost(new MockMirrorBackend());
    seeker.load(scene());
    seeker.play();
    seeker.playClip("anm_slide", { startFrame: 0 });
    seeker.seek(frame);
    const sought = seeker.reconciler.mirror.get("nod_bar")!;

    expect((sought.worldMatrix as number[])[12]!).toBeCloseTo(played, 5);
  });

  it("does not drift over a long run", () => {
    // The delta-time prohibition, asserted. A playhead advanced by per-frame
    // deltas drifts, and the drift is invisible until a show has run for an
    // hour.
    host.load(scene([{ ...SLIDE, duration: 10, loop: true }]));
    host.play();
    host.playClip("anm_slide", { startFrame: 0 });

    advance(600); // exactly ten seconds — one full loop
    const afterOneLoop = barX();

    advance(600);
    expect(barX()).toBeCloseTo(afterOneLoop, 5);
  });
});

describe("cost", () => {
  it("re-projects only the animated nodes", () => {
    // O(animated), never O(scene). A lower third animating in must not
    // re-resolve the package around it.
    host.play();
    host.playClip("anm_slide");

    const result = host.animator.sample(30, 60, false);
    expect(result.changed).toEqual(["nod_bar"]);
  });

  it("reports nothing when values did not change", () => {
    host.play();
    host.playClip("anm_slide");
    host.animator.sample(30, 60, false);
    // Same frame again: identical values, so nothing to re-project.
    expect(host.animator.sample(30, 60, false).changed).toEqual([]);
  });

  it("does no work at all when nothing is playing", () => {
    expect(host.animator.sample(10, 60, false).changed).toEqual([]);
  });
});

describe("events reach the runtime", () => {
  it("publishes crossed events while playing", () => {
    const seen: string[] = [];
    host.runtime.events.subscribe("animation.halfway", () => {
      seen.push("halfway");
    });

    host.play();
    host.playClip("anm_slide");
    advance(40);

    expect(seen).toEqual(["halfway"]);
  });

  it("fires nothing when seeking", () => {
    // Dragging a timeline must not trigger every cue in a show.
    const seen: string[] = [];
    host.runtime.events.subscribe("animation.arrived", () => {
      seen.push("arrived");
    });

    host.play();
    host.playClip("anm_slide", { startFrame: 0 });
    host.seek(120);

    expect(seen).toEqual([]);
  });
});
