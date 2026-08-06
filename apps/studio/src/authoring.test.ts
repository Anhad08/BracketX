import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { HostTextProvider } from "@bracketx/engine-host/text";
import {
  applyTransaction,
  canonicalize,
  childrenOf,
  findNode,
  invertTransaction,
  parentOf,
  validateDocument,
  validateTimeline,
  type SceneDocument,
  type Timeline,
} from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { makeIdFactory, testIdFactory, type IdFactory } from "./studio/ids";
import {
  TOOLBOX,
  createNode,
  defineVariable,
  hasLight,
  resetTransactionIds,
  setProp,
  type NodeKind,
} from "./studio/editing";
import { newDocument, serializeDocument } from "./studio/project";
import { DEFAULT_FONT_ASSET } from "./studio/editing";
import { align, distribute, group, reorder, ungroup } from "./studio/arrange";
import { nodeBounds } from "./studio/viewport";
import {
  PRESETS,
  applyPreset,
  presetById,
  withAlpha,
} from "./studio/presets";
import {
  copyKeyframes,
  createTimeline,
  deleteKeyframes,
  moveKeyframes,
  pasteKeyframes,
  quantize,
  removeMarker,
  removeTimeline,
  scaleTiming,
  setEasing,
  setKeyframe,
  setMarker,
  setTimelineLoop,
  setTrackDelay,
  setTrackStagger,
  timelineById,
  timelinesOf,
} from "./studio/keyframes";
import { ProgramBus, entranceOf, exitOf } from "./studio/program";
import {
  STARTER_TOKENS,
  colourTokens,
  demoteTemplate,
  describeDocument,
  instantiate,
  loadLibrary,
  promoteToTemplate,
  removeFromLibrary,
  removeToken,
  saveToLibrary,
  searchLibrary,
  setToken,
  templateDrift,
} from "./studio/library";

/**
 * Studio Phase 3A verification — authoring.
 *
 * ============================================================================
 * WHAT THESE ASSERT THAT THE PHASE 1 SUITE DOES NOT
 * ============================================================================
 * Phase 1 proved the editor could hold a document without corrupting it. This
 * proves it can AUTHOR one: that a keyframe a designer drags lands where the
 * engine will sample it, that a preset applied to two different nodes produces
 * two different animations, that arranging nodes moves them where they look
 * like they moved, and — the one the brief made mandatory — that nothing a
 * designer does to Preview can reach air without an explicit Take.
 *
 * Still entirely headless, for the reason the Phase 1 suite gave: every claim
 * here is about a document, a transaction or engine state, and a test that
 * needed a browser to check one would eventually be skipped.
 */

/** The font Studio ships, read from the engine's own fixtures. */
function interFont(): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL("../../../packages/engine-text/fixtures/fonts/inter-latin-400.ttf", import.meta.url),
      ),
    ),
  );
}

let ids: IdFactory;

function session(document_?: SceneDocument): StudioSession {
  return new StudioSession(new MockMirrorBackend(), document_ ?? newDocument("Test", ids));
}

/** A session plus one node of a kind, rendered once so the mirror is populated. */
function withNode(kind: NodeKind = "rect"): {
  studio: StudioSession;
  nodeId: string;
} {
  const studio = session();
  const created = createNode(studio.document, kind, studio.document.root.id, ids);
  studio.store.apply(created.transaction);
  studio.render();
  return { studio, nodeId: created.nodeId };
}

function apply(studio: StudioSession, txn: ReturnType<typeof align>): void {
  expect(txn).not.toBeNull();
  studio.store.apply(txn!);
}

function timelineOf(studio: StudioSession, index = 0): Timeline {
  const timeline = timelinesOf(studio.document)[index];
  expect(timeline).toBeDefined();
  return timeline!;
}

beforeEach(() => {
  ids = testIdFactory();
  resetTransactionIds();
});

// ===========================================================================
// Preview and Program
//
// The invariant the brief made non-negotiable: "Preview should never affect
// Live. Changes occur only after explicit transition."
// ===========================================================================

describe("Preview never reaches Program without a Take", () => {
  function bus(): { bus: ProgramBus; preview: StudioSession; program: StudioSession } {
    const preview = session();
    const program = new StudioSession(new MockMirrorBackend(), newDocument("Program", ids));
    return { bus: new ProgramBus(preview, program), preview, program };
  }

  it("leaves Program byte-identical through arbitrary Preview editing", () => {
    // The whole feature, asserted the only way that means anything: edit
    // Preview as hard as an editor can, and Program must not observe any of it.
    const { bus: program, preview } = bus();
    program.program.render();
    const hash = program.program.host.sessionHash();
    const json = serializeDocument(program.program.document);

    for (let index = 0; index < 5; index += 1) {
      const created = createNode(preview.document, "rect", preview.document.root.id, ids);
      preview.store.apply(created.transaction);
      apply(preview, setProp(preview.document, created.nodeId, "name", `Bar ${index}`));
      preview.render();
      preview.play();
      preview.seek(index * 7);
    }
    preview.store.undo();

    expect(program.program.host.sessionHash()).toBe(hash);
    expect(serializeDocument(program.program.document)).toBe(json);
    expect(program.onAir).toBe(false);

    preview.dispose();
    program.program.dispose();
  });

  it("takes by value, so a later Preview edit does not leak on air", () => {
    const { bus: program, preview } = bus();
    const created = createNode(preview.document, "rect", preview.document.root.id, ids);
    preview.store.apply(created.transaction);
    program.cut();

    const aired = serializeDocument(program.program.document);
    apply(preview, setProp(preview.document, created.nodeId, "name", "Renamed after air"));

    // Program still shows what was taken. A shared reference would have made
    // the rename appear on air mid-word, which is the exact failure a
    // preview/program split exists to prevent.
    expect(serializeDocument(program.program.document)).toBe(aired);
    expect(findNode(program.program.document.root, created.nodeId)?.name).toBe("Rectangle");

    preview.dispose();
    program.program.dispose();
  });

  it("reports pending only while Preview differs from what aired", () => {
    const { bus: program, preview } = bus();
    // Air something non-trivial first, so the aired document is not also the
    // save point — otherwise "pending" and "dirty" agree by accident.
    const first = createNode(preview.document, "rect", preview.document.root.id, ids);
    preview.store.apply(first.transaction);
    program.cut();
    expect(program.pending).toBe(false);

    const second = createNode(preview.document, "rect", preview.document.root.id, ids);
    preview.store.apply(second.transaction);
    expect(program.pending).toBe(true);

    // Undo returns Preview to the aired document. There is nothing to take,
    // even though the editor is still dirty relative to the last SAVE —
    // "dirty" and "pending" are different questions and this is where they
    // diverge. An operator must not be told there is something to take
    // because the file is unsaved.
    preview.store.undo();
    expect(program.pending).toBe(false);
    expect(preview.store.dirty).toBe(true);

    preview.dispose();
    program.program.dispose();
  });

  it("keeps its own clock, so scrubbing Preview does not move air", () => {
    // Two sessions rather than two views of one runtime, asserted. One runtime
    // cannot be at two frames, and a graphic must keep animating while a
    // designer scrubs.
    const { bus: program, preview } = bus();
    program.cut();
    program.program.seek(40);
    const frame = program.program.frame;

    preview.seek(0);
    preview.play();
    preview.seek(5);

    expect(program.program.frame).toBe(frame);
    expect(preview.frame).toBe(5);

    preview.dispose();
    program.program.dispose();
  });

  it("cuts without playing an entrance, and takes with one", () => {
    const { bus: program, preview } = bus();
    const created = createNode(preview.document, "rect", preview.document.root.id, ids);
    preview.store.apply(created.transaction);
    const timeline = createTimeline(preview.document, "In", ids);
    preview.store.apply(timeline.transaction);
    apply(
      preview,
      setKeyframe(preview.document, timeline.timelineId, created.nodeId, "transform.position.0", 0, -4),
    );

    expect(program.cut().played).toBeNull();
    expect(program.take().played).toBe(timeline.timelineId);

    preview.dispose();
    program.program.dispose();
  });

  it("holds without rewinding, and continues from where it stopped", () => {
    // `stop` would rewind. A graphic that jumps to frame zero when an operator
    // says "wait" is the worst possible response to "wait".
    const { bus: program } = bus();
    program.take();
    program.program.seek(24);
    program.hold();

    expect(program.state).toBe("holding");
    expect(program.program.frame).toBe(24);
    expect(program.program.playing).toBe(false);

    program.continue();
    expect(program.state).toBe("on-air");
    expect(program.program.frame).toBe(24);
    expect(program.program.playing).toBe(true);

    program.preview.dispose();
    program.program.dispose();
  });

  it("clearing the surface does not make an unchanged Preview pending again", () => {
    const { bus: program } = bus();
    program.cut();
    program.clear();
    expect(program.onAir).toBe(false);
    expect(program.pending).toBe(false);

    program.preview.dispose();
    program.program.dispose();
  });

  it("caches the canonical form without letting it go stale", () => {
    // `pending` is read on every render of the Program row and canonicalizing
    // is O(document) — the benchmark had it costing more than three quarters of
    // a whole Take. Cached on the document's object identity, which is exact
    // because documents are immutable: an edit produces a NEW object, so the
    // cache cannot answer for a document that changed.
    //
    // Asserted by making the cache wrong if it were keyed on anything weaker:
    // edit, undo back to the aired document, and `pending` must be false again.
    const { bus: program, preview } = bus();
    const created = createNode(preview.document, "rect", preview.document.root.id, ids);
    preview.store.apply(created.transaction);
    program.cut();

    for (let round = 0; round < 3; round += 1) {
      expect(program.pending).toBe(false);
      apply(preview, setProp(preview.document, created.nodeId, "name", `Round ${round}`));
      expect(program.pending).toBe(true);
      preview.store.undo();
    }
    expect(program.pending).toBe(false);

    preview.dispose();
    program.program.dispose();
  });

  it("finds the entrance and exit by name, and copes when there is neither", () => {
    const document = newDocument("Naming", ids);
    const named = (id: string, name: string): Timeline => ({
      id,
      name,
      duration: 1,
      tracks: [],
    });

    expect(entranceOf(document)).toBeNull();
    expect(exitOf(document)).toBeNull();

    const both = { ...document, animations: [named("a", "Fade Out"), named("b", "Slide In")] };
    expect(entranceOf(both)?.id).toBe("b");
    expect(exitOf(both)?.id).toBe("a");

    // No convention followed: the first timeline is the entrance and there is
    // no exit, which is right for a graphic with one animation.
    const neither = { ...document, animations: [named("c", "Wiggle")] };
    expect(entranceOf(neither)?.id).toBe("c");
    expect(exitOf(neither)).toBeNull();
  });
});

// ===========================================================================
// Animation presets
// ===========================================================================

describe("animation presets", () => {
  it("are relative — the same preset on two nodes ends where each node is", () => {
    // "Slide in from the left" cannot mean "start at x = -8". If it did, the
    // preset would move every node it was applied to onto the same spot.
    const studio = session();
    const a = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(a.transaction);
    const b = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(b.transaction);
    apply(studio, setProp(studio.document, a.nodeId, "transform.position", [3, 1, 0]));
    apply(studio, setProp(studio.document, b.nodeId, "transform.position", [-2, -1, 0]));

    apply(
      studio,
      applyPreset(studio.document, [a.nodeId, b.nodeId], presetById("slide-in-left")!, ids),
    );

    const timeline = timelineOf(studio);
    const forNode = (nodeId: string) =>
      timeline.tracks.find((track) => track.target === nodeId)!;
    // Each ends at its OWN authored x, and starts a screen-width left of it.
    expect(forNode(a.nodeId).keyframes.at(-1)!.value).toBe(3);
    expect(forNode(a.nodeId).keyframes[0]!.value).toBe(3 - 12);
    expect(forNode(b.nodeId).keyframes.at(-1)!.value).toBe(-2);
    expect(forNode(b.nodeId).keyframes[0]!.value).toBe(-2 - 12);

    studio.dispose();
  });

  it("compile to an ordinary timeline the animator plays with no special case", () => {
    // The core design claim: after it is applied, a preset does not exist.
    const { studio, nodeId } = withNode();
    apply(studio, setProp(studio.document, nodeId, "transform.position", [0, 0, 0]));
    apply(studio, applyPreset(studio.document, [nodeId], presetById("slide-in-left")!, ids));

    const timeline = timelineOf(studio);
    expect(validateTimeline(timeline)).toEqual([]);
    expect(studio.host.animator.clips.map((clip) => clip.id)).toEqual([timeline.id]);

    studio.play();
    studio.playClip(timeline.id);
    studio.seek(18); // 0.3s of a 0.6s slide, at 60fps.
    const value = studio.host.animator.values.get(nodeId)?.get("transform.position.0") as number;
    // Mid-flight: somewhere between off-screen and home, and not at either end.
    expect(value).toBeGreaterThan(-12);
    expect(value).toBeLessThan(0);

    studio.seek(36);
    expect(studio.host.animator.values.get(nodeId)?.get("transform.position.0")).toBeCloseTo(0, 5);
    studio.dispose();
  });

  it("fades through hex alpha, which the engine already interpolates", () => {
    // The discovery that made presets pure Studio: there is no `opacity` on a
    // rect, but SCENE_FORMAT colours may be #RRGGBBAA and `interpolate` blends
    // them. A fade needed no engine change at all.
    expect(withAlpha("#2f6feb", 0)).toBe("#2f6feb00");
    expect(withAlpha("#2f6feb", 1)).toBe("#2f6febff");
    expect(withAlpha("#2f6feb", 2)).toBe("#2f6febff");
    expect(withAlpha("#abc", 0.5)).toBe("#abc00080");

    const { studio, nodeId } = withNode();
    apply(studio, applyPreset(studio.document, [nodeId], presetById("fade-in")!, ids));
    const timeline = timelineOf(studio);
    expect(timeline.tracks[0]!.path).toBe("components.0.props.fill");

    studio.play();
    studio.playClip(timeline.id);
    studio.seek(24); // Past the 0.4s fade.
    expect(studio.host.animator.values.get(nodeId)?.get("components.0.props.fill")).toBe(
      "#2f6febff",
    );
    studio.dispose();
  });

  it("refuses to produce a timeline that would drive nothing", () => {
    // A fade on a node with no colour. A timeline with a track that drives
    // nothing is worse than no timeline: it looks applied and does nothing.
    const { studio, nodeId } = withNode("group");
    expect(applyPreset(studio.document, [nodeId], presetById("fade-in")!, ids)).toBeNull();
    expect(timelinesOf(studio.document)).toEqual([]);
    studio.dispose();
  });

  it("returns emphasis to the authored value, so it can loop", () => {
    const { studio, nodeId } = withNode();
    apply(studio, setProp(studio.document, nodeId, "transform.scale", [1.5, 1.5, 1]));
    apply(studio, applyPreset(studio.document, [nodeId], presetById("pulse")!, ids));

    for (const track of timelineOf(studio).tracks) {
      expect(track.keyframes[0]!.value).toBe(track.keyframes.at(-1)!.value);
      expect(track.keyframes[0]!.value).toBe(1.5);
    }
    studio.dispose();
  });

  it("claims no effect the engine cannot produce", () => {
    // Blur In, Dissolve and Glow are absent on purpose: the engine has no blur,
    // no dissolve and no bloom, and a designer who picks "Glow" and gets a fade
    // has been lied to by the tool.
    const ids_ = PRESETS.map((preset) => preset.id).join(" ");
    for (const forbidden of ["blur", "glow", "dissolve", "bloom", "shadow"]) {
      expect(ids_).not.toContain(forbidden);
    }
    // And every preset that IS listed builds something for a plain rect.
    const { studio, nodeId } = withNode();
    const node = findNode(studio.document.root, nodeId)!;
    for (const preset of PRESETS) {
      expect(preset.build(node, preset.duration).length).toBeGreaterThan(0);
    }
    studio.dispose();
  });

  it("is one undo step, and inverts exactly", () => {
    const { studio, nodeId } = withNode();
    const before = serializeDocument(studio.document);
    const depth = studio.store.depth;

    apply(studio, applyPreset(studio.document, [nodeId], presetById("pop-in")!, ids));
    expect(studio.store.depth).toBe(depth + 1);

    studio.store.undo();
    expect(serializeDocument(studio.document)).toBe(before);
    expect(studio.host.animator.clips).toEqual([]);
    studio.dispose();
  });

  it("merges into an existing timeline rather than stacking clips", () => {
    const { studio, nodeId } = withNode();
    apply(studio, applyPreset(studio.document, [nodeId], presetById("fade-in")!, ids));
    const first = timelineOf(studio);

    apply(
      studio,
      applyPreset(studio.document, [nodeId], presetById("slide-in-left")!, ids, {
        timelineId: first.id,
        delay: 0.2,
      }),
    );

    expect(timelinesOf(studio.document)).toHaveLength(1);
    const merged = timelineOf(studio);
    expect(merged.tracks).toHaveLength(2);
    expect(merged.tracks[1]!.delay).toBe(0.2);
    // The timeline grew to contain what was added; without this the tail of the
    // slide is clamped away and the preset looks broken.
    expect(merged.duration).toBeCloseTo(0.8, 5);
    studio.dispose();
  });
});

// ===========================================================================
// Keyframe authoring
// ===========================================================================

describe("keyframe authoring", () => {
  function keyed(): { studio: StudioSession; nodeId: string; timelineId: string } {
    const { studio, nodeId } = withNode();
    const created = createTimeline(studio.document, "Move", ids, { duration: 2 });
    studio.store.apply(created.transaction);
    for (const [time, value] of [[0, 0], [0.5, 1], [1, 2]] as const) {
      apply(
        studio,
        setKeyframe(studio.document, created.timelineId, nodeId, "transform.position.0", time, value),
      );
    }
    return { studio, nodeId, timelineId: created.timelineId };
  }

  it("keeps keyframes sorted after a drag that crosses a neighbour", () => {
    // THE assertion of this module. The engine sorts keyframes ONCE at load and
    // never again — that was a deliberate performance change. An editor that
    // leaves a track out of order animates wrongly in the session and correctly
    // after a save and reload, which is the worst way to find out.
    const { studio, timelineId } = keyed();
    apply(studio, moveKeyframes(studio.document, timelineId, [{ track: 0, index: 0 }], 0.75));

    const keyframes = timelineById(studio.document, timelineId)!.tracks[0]!.keyframes;
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0.5, 0.75, 1]);
    // And the values travelled with their keyframes rather than staying put.
    expect(keyframes.map((keyframe) => keyframe.value)).toEqual([1, 0, 2]);
    studio.dispose();
  });

  it("replaces rather than appends when keying the same time twice", () => {
    // "No, like THIS." Two keyframes at one time makes the value at that time
    // depend on iteration order.
    const { studio, nodeId, timelineId } = keyed();
    apply(
      studio,
      setKeyframe(studio.document, timelineId, nodeId, "transform.position.0", 0.5, 9),
    );
    const keyframes = timelineById(studio.document, timelineId)!.tracks[0]!.keyframes;
    expect(keyframes).toHaveLength(3);
    expect(keyframes[1]).toEqual({ time: 0.5, value: 9 });
    studio.dispose();
  });

  it("does not record a keyframe identical to the one already there", () => {
    const { studio, nodeId, timelineId } = keyed();
    expect(
      setKeyframe(studio.document, timelineId, nodeId, "transform.position.0", 0.5, 1),
    ).toBeNull();
    studio.dispose();
  });

  it("quantizes to the frame grid, so a keyframe is reproducible", () => {
    expect(quantize(0.4166666, 60)).toBeCloseTo(25 / 60, 10);
    expect(quantize(-1, 60)).toBe(0);
    expect(quantize(0.5, 0)).toBe(0);

    const { studio, nodeId, timelineId } = keyed();
    apply(
      studio,
      setKeyframe(studio.document, timelineId, nodeId, "transform.scale.0", 0.4166666, 2),
    );
    const track = timelineById(studio.document, timelineId)!.tracks[1]!;
    expect(track.keyframes[0]!.time).toBeCloseTo(25 / 60, 10);
    studio.dispose();
  });

  it("preserves group spacing when a drag is clamped at zero", () => {
    // Clamping each keyframe independently would pile the group up on zero and
    // destroy the timing the designer selected them to protect.
    const { studio, timelineId } = keyed();
    apply(
      studio,
      moveKeyframes(
        studio.document,
        timelineId,
        [{ track: 0, index: 0 }, { track: 0, index: 1 }, { track: 0, index: 2 }],
        -5,
      ),
    );
    expect(
      timelineById(studio.document, timelineId)!.tracks[0]!.keyframes.map((k) => k.time),
    ).toEqual([0, 0.5, 1]);
    studio.dispose();
  });

  it("grows the duration to contain a keyframe dragged past the end", () => {
    // Clamping would leave the keyframe in the document, unreachable, which
    // looks like the drag was ignored.
    const { studio, timelineId } = keyed();
    apply(studio, moveKeyframes(studio.document, timelineId, [{ track: 0, index: 2 }], 4));
    expect(timelineById(studio.document, timelineId)!.duration).toBe(5);
    studio.dispose();
  });

  it("deletes a track when its last keyframe goes, leaving a valid timeline", () => {
    // A track with no keyframes is invalid; leaving one behind would put a
    // document on disk the engine refuses to load.
    const { studio, timelineId } = keyed();
    apply(
      studio,
      deleteKeyframes(studio.document, timelineId, [
        { track: 0, index: 0 },
        { track: 0, index: 1 },
        { track: 0, index: 2 },
      ]),
    );
    const timeline = timelineById(studio.document, timelineId)!;
    expect(timeline.tracks).toEqual([]);
    expect(validateTimeline(timeline)).toEqual([]);
    expect(validateDocument(studio.document).valid).toBe(true);
    studio.dispose();
  });

  it("is one operation per edit, so indices cannot shift mid-transaction", () => {
    const { studio, timelineId } = keyed();
    const txn = moveKeyframes(studio.document, timelineId, [
      { track: 0, index: 0 },
      { track: 0, index: 2 },
    ], 0.25);
    expect(txn!.operations).toHaveLength(1);
    expect(txn!.operations[0]!.type).toBe("doc.setMeta");
    studio.dispose();
  });

  it("retimes keyframes, delay, stagger and duration together", () => {
    // Scaling any subset changes the SHAPE of the animation rather than its
    // speed, and a stagger that kept its interval stops reading as one gesture.
    const { studio, timelineId } = keyed();
    apply(studio, setTrackDelay(studio.document, timelineId, 0, 0.4));
    apply(studio, setTrackStagger(studio.document, timelineId, 0, { interval: 0.1 }));

    apply(studio, scaleTiming(studio.document, timelineId, 0.5));
    const timeline = timelineById(studio.document, timelineId)!;
    expect(timeline.duration).toBe(1);
    expect(timeline.tracks[0]!.delay).toBe(0.2);
    expect(timeline.tracks[0]!.stagger!.interval).toBe(0.05);
    expect(timeline.tracks[0]!.keyframes.map((k) => k.time)).toEqual([0, 0.25, 0.5]);

    // A no-op factor is not an undo step.
    expect(scaleTiming(studio.document, timelineId, 1)).toBeNull();
    expect(scaleTiming(studio.document, timelineId, 0)).toBeNull();
    studio.dispose();
  });

  it("copies positionally and pastes onto other nodes", () => {
    // "Animate one row, apply to the other seven" as two gestures instead of
    // eight. Relative times are what make paste mean "here".
    const { studio, nodeId, timelineId } = keyed();
    const second = createNode(studio.document, "rect", studio.document.root.id, ids);
    studio.store.apply(second.transaction);

    const clipboard = copyKeyframes(timelineById(studio.document, timelineId)!, [
      { track: 0, index: 1 },
      { track: 0, index: 2 },
    ])!;
    expect(clipboard.tracks[0]!.keyframes.map((k) => k.time)).toEqual([0, 0.5]);

    apply(
      studio,
      pasteKeyframes(studio.document, timelineId, clipboard, 1.5, [second.nodeId]),
    );
    const timeline = timelineById(studio.document, timelineId)!;
    const pasted = timeline.tracks.find((track) => track.target === second.nodeId)!;
    expect(pasted.path).toBe("transform.position.0");
    expect(pasted.keyframes.map((k) => k.time)).toEqual([1.5, 2]);
    // The source node's own track is untouched.
    expect(
      timeline.tracks.find((track) => track.target === nodeId)!.keyframes,
    ).toHaveLength(3);
    studio.dispose();
  });

  it("lets a paste win a time collision", () => {
    const { studio, timelineId } = keyed();
    const clipboard = copyKeyframes(timelineById(studio.document, timelineId)!, [
      { track: 0, index: 2 },
    ])!;
    apply(studio, pasteKeyframes(studio.document, timelineId, clipboard, 0.5));

    const keyframes = timelineById(studio.document, timelineId)!.tracks[0]!.keyframes;
    expect(keyframes).toHaveLength(3);
    // 0.5 now carries the pasted value (2), not the original (1).
    expect(keyframes[1]).toEqual({ time: 0.5, value: 2 });
    studio.dispose();
  });

  it("sets easing on a selection, and clears it back to the default", () => {
    const { studio, timelineId } = keyed();
    apply(
      studio,
      setEasing(studio.document, timelineId, [{ track: 0, index: 0 }], "easeOutCubic"),
    );
    expect(
      timelineById(studio.document, timelineId)!.tracks[0]!.keyframes[0]!.easing,
    ).toBe("easeOutCubic");

    apply(studio, setEasing(studio.document, timelineId, [{ track: 0, index: 0 }], null));
    // Omitted, not set to "linear": canonical form drops an absent field, and a
    // document carrying an explicit default fails to round-trip byte for byte.
    expect(
      "easing" in timelineById(studio.document, timelineId)!.tracks[0]!.keyframes[0]!,
    ).toBe(false);
    studio.dispose();
  });

  it("omits `loop: false` rather than writing it", () => {
    const { studio, timelineId } = keyed();
    const before = serializeDocument(studio.document);
    apply(studio, setTimelineLoop(studio.document, timelineId, true));
    apply(studio, setTimelineLoop(studio.document, timelineId, false));
    expect(serializeDocument(studio.document)).toBe(before);
    expect(setTimelineLoop(studio.document, timelineId, false)).toBeNull();
    studio.dispose();
  });

  it("keeps markers unique and sorted, and drops the field when empty", () => {
    const { studio, timelineId } = keyed();
    apply(studio, setMarker(studio.document, timelineId, { id: "b", time: 1, kind: "cue" }));
    apply(studio, setMarker(studio.document, timelineId, { id: "a", time: 0.25, kind: "cue" }));
    apply(studio, setMarker(studio.document, timelineId, { id: "b", time: 0.5, kind: "cue" }));

    const markers = timelineById(studio.document, timelineId)!.markers!;
    expect(markers.map((marker) => marker.id)).toEqual(["a", "b"]);
    expect(markers.map((marker) => marker.time)).toEqual([0.25, 0.5]);
    expect(validateTimeline(timelineById(studio.document, timelineId)!)).toEqual([]);

    apply(studio, removeMarker(studio.document, timelineId, "a"));
    apply(studio, removeMarker(studio.document, timelineId, "b"));
    expect("markers" in timelineById(studio.document, timelineId)!).toBe(false);
    expect(removeMarker(studio.document, timelineId, "gone")).toBeNull();
    studio.dispose();
  });

  it("removes a timeline by rewriting the array, so later indices stay addressable", () => {
    const { studio, nodeId } = withNode();
    const first = createTimeline(studio.document, "One", ids);
    studio.store.apply(first.transaction);
    const second = createTimeline(studio.document, "Two", ids);
    studio.store.apply(second.transaction);
    apply(
      studio,
      setKeyframe(studio.document, second.timelineId, nodeId, "transform.position.1", 0, 3),
    );

    apply(studio, removeTimeline(studio.document, first.timelineId));
    expect(timelinesOf(studio.document).map((timeline) => timeline.id)).toEqual([
      second.timelineId,
    ]);
    // The survivor is still editable at its new index.
    apply(
      studio,
      setKeyframe(studio.document, second.timelineId, nodeId, "transform.position.1", 1, 0),
    );
    expect(timelineById(studio.document, second.timelineId)!.tracks[0]!.keyframes).toHaveLength(2);
    studio.dispose();
  });

  it("round-trips a mixed authoring session under undo", () => {
    const { studio, nodeId, timelineId } = keyed();
    const before = serializeDocument(studio.document);

    const edits = [
      () => moveKeyframes(studio.document, timelineId, [{ track: 0, index: 1 }], 0.25),
      () => setEasing(studio.document, timelineId, [{ track: 0, index: 0 }], "easeInOutSine"),
      () => setKeyframe(studio.document, timelineId, nodeId, "transform.scale.0", 0.5, 1.2),
      () => setTrackDelay(studio.document, timelineId, 0, 0.1),
      () => scaleTiming(studio.document, timelineId, 2),
      () => setMarker(studio.document, timelineId, { id: "hit", time: 1, kind: "event" }),
      () => deleteKeyframes(studio.document, timelineId, [{ track: 1, index: 0 }]),
    ];
    for (const edit of edits) apply(studio, edit());

    const after = serializeDocument(studio.document);
    for (let index = 0; index < edits.length; index += 1) studio.store.undo();
    expect(serializeDocument(studio.document)).toBe(before);
    for (let index = 0; index < edits.length; index += 1) studio.store.redo();
    expect(serializeDocument(studio.document)).toBe(after);
    studio.dispose();
  });
});

// ===========================================================================
// Arrangement
// ===========================================================================

describe("arrangement", () => {
  /** Three rects in a row, one of them nested inside an offset group. */
  function scene(): {
    studio: StudioSession;
    a: string;
    b: string;
    c: string;
  } {
    const studio = session();
    const root = studio.document.root.id;
    const a = createNode(studio.document, "rect", root, ids);
    studio.store.apply(a.transaction);
    const holder = createNode(studio.document, "group", root, ids);
    studio.store.apply(holder.transaction);
    const b = createNode(studio.document, "rect", holder.nodeId, ids);
    studio.store.apply(b.transaction);
    const c = createNode(studio.document, "rect", root, ids);
    studio.store.apply(c.transaction);

    apply(studio, setProp(studio.document, a.nodeId, "transform.position", [-4, 2, 0]));
    apply(studio, setProp(studio.document, holder.nodeId, "transform.position", [3, 0, 0]));
    apply(studio, setProp(studio.document, b.nodeId, "transform.position", [0, 0, 0]));
    apply(studio, setProp(studio.document, c.nodeId, "transform.position", [1, -2, 0]));
    studio.render();

    return { studio, a: a.nodeId, b: b.nodeId, c: c.nodeId };
  }

  function bounds(studio: StudioSession) {
    return nodeBounds(studio.document, (id) => studio.worldMatrixOf(id));
  }

  it("aligns in WORLD space, so nodes in different parents line up on screen", () => {
    // `b` sits at local x = 0 inside a group offset to x = 3, so its world x is
    // 3. Aligning it left with `a` at -4 has to move it by -7 in its own
    // parent's space. An editor that set both local x to the same number would
    // leave them visibly apart.
    const { studio, a, b } = scene();
    apply(studio, align(studio.document, [a, b], bounds(studio), "left"));
    studio.render();

    const after = bounds(studio);
    const left = (id: string) => {
      const rect = after.find((entry) => entry.nodeId === id)!.rect;
      return rect.x - rect.width / 2;
    };
    expect(left(b)).toBeCloseTo(left(a), 6);
    expect(findNode(studio.document.root, b)!.transform!.position![0]).toBeCloseTo(-7, 6);
    studio.dispose();
  });

  it("aligns to the selection, not to the frame", () => {
    const { studio, a, c } = scene();
    apply(studio, align(studio.document, [a, c], bounds(studio), "top"));
    studio.render();

    const after = bounds(studio);
    const top = (id: string) => {
      const rect = after.find((entry) => entry.nodeId === id)!.rect;
      return rect.y + rect.height / 2;
    };
    // Both at the higher of the two, which is `a` — nowhere near the canvas edge.
    expect(top(c)).toBeCloseTo(top(a), 6);
    expect(top(a)).toBeCloseTo(2.5, 6);
    studio.dispose();
  });

  it("is a no-op the second time, so it cannot become an undo-stack of nothing", () => {
    const { studio, a, c } = scene();
    apply(studio, align(studio.document, [a, c], bounds(studio), "middle"));
    studio.render();
    expect(align(studio.document, [a, c], bounds(studio), "middle")).toBeNull();
    // And one node is not an alignment.
    expect(align(studio.document, [a], bounds(studio), "left")).toBeNull();
    studio.dispose();
  });

  it("distributes without moving the outermost, and is idempotent", () => {
    const studio = session();
    const root = studio.document.root.id;
    const nodes = [0, 5, 6].map((x) => {
      const created = createNode(studio.document, "rect", root, ids);
      studio.store.apply(created.transaction);
      studio.store.apply(setProp(studio.document, created.nodeId, "transform.position", [x, 0, 0])!);
      return created.nodeId;
    });
    studio.render();

    apply(studio, distribute(studio.document, nodes, bounds(studio), "horizontal"));
    studio.render();

    const xOf = (id: string) => bounds(studio).find((entry) => entry.nodeId === id)!.rect.x;
    expect(xOf(nodes[0]!)).toBeCloseTo(0, 6);
    expect(xOf(nodes[2]!)).toBeCloseTo(6, 6);
    expect(xOf(nodes[1]!)).toBeCloseTo(3, 6);

    expect(distribute(studio.document, nodes, bounds(studio), "horizontal")).toBeNull();
    // Two nodes are already evenly spaced by definition.
    expect(distribute(studio.document, nodes.slice(0, 2), bounds(studio), "horizontal")).toBeNull();
    studio.dispose();
  });

  it("groups in place, preserving draw order", () => {
    // A group appended to the end of its parent's children jumps in front of
    // everything, which silently changes what is on top.
    const { studio, a, c } = scene();
    const root = studio.document.root.id;
    const orderBefore = childrenOf(studio.document.root).map((child) => child.id);
    const slot = orderBefore.indexOf(a);

    const grouped = group(studio.document, [a, c], ids)!;
    studio.store.apply(grouped.transaction);

    const container = findNode(studio.document.root, grouped.groupId)!;
    expect(childrenOf(container).map((child) => child.id)).toEqual([a, c]);
    expect(parentOf(studio.document.root, grouped.groupId)!.id).toBe(root);
    // The group sits exactly where the FIRST selected node was, rather than
    // being appended — an appended group draws in front of everything.
    expect(childrenOf(studio.document.root)[slot]!.id).toBe(grouped.groupId);
    expect(childrenOf(studio.document.root).at(-1)!.id).not.toBe(grouped.groupId);
    studio.dispose();
  });

  it("does not move anything it groups", () => {
    // A group that recentred itself and offset its children would be tidier on
    // paper and would move the graphic on screen.
    const { studio, a, c } = scene();
    const before = new Map(bounds(studio).map((entry) => [entry.nodeId, entry.rect]));

    studio.store.apply(group(studio.document, [a, c], ids)!.transaction);
    studio.render();

    for (const id of [a, c]) {
      const after = bounds(studio).find((entry) => entry.nodeId === id)!.rect;
      expect(after.x).toBeCloseTo(before.get(id)!.x, 6);
      expect(after.y).toBeCloseTo(before.get(id)!.y, 6);
    }
    studio.dispose();
  });

  it("refuses to group across parents rather than choosing whose parent wins", () => {
    const { studio, a, b } = scene();
    expect(group(studio.document, [a, b], ids)).toBeNull();
    expect(group(studio.document, [studio.document.root.id], ids)).toBeNull();
    studio.dispose();
  });

  it("ungroups back into the slot the group occupied", () => {
    // Generating order keys with an open upper bound would push the children
    // past the group's following siblings and silently reorder the layers.
    const { studio, a, c } = scene();
    const orderBefore = childrenOf(studio.document.root).map((child) => child.id);
    const slot = orderBefore.indexOf(a);

    const grouped = group(studio.document, [a, c], ids)!;
    studio.store.apply(grouped.transaction);
    const beforeUngroup = childrenOf(studio.document.root).map((child) => child.id);

    apply(studio, ungroup(studio.document, grouped.groupId));
    expect(findNode(studio.document.root, grouped.groupId)).toBeNull();

    const after = childrenOf(studio.document.root).map((child) => child.id);
    // `a` and `c` land back in the group's slot, in order, still AHEAD of
    // whatever followed the group.
    expect(after.slice(slot, slot + 2)).toEqual([a, c]);
    expect(after.slice(0, slot)).toEqual(beforeUngroup.slice(0, slot));
    expect(after.slice(slot + 2)).toEqual(beforeUngroup.slice(slot + 1));
    studio.dispose();
  });

  it("group and ungroup are each one undo step", () => {
    const { studio, a, c } = scene();
    const before = serializeDocument(studio.document);
    const depth = studio.store.depth;

    const grouped = group(studio.document, [a, c], ids)!;
    studio.store.apply(grouped.transaction);
    apply(studio, ungroup(studio.document, grouped.groupId));
    expect(studio.store.depth).toBe(depth + 2);

    studio.store.undo();
    studio.store.undo();
    expect(serializeDocument(studio.document)).toBe(before);
    studio.dispose();
  });

  it("reorders among siblings and refuses a move that changes nothing", () => {
    const { studio, a, c } = scene();
    const root = studio.document.root;
    const order = () => childrenOf(studio.document.root).map((child) => child.id);
    const initial = order();

    apply(studio, reorder(studio.document, a, "front"));
    expect(order().at(-1)).toBe(a);

    apply(studio, reorder(studio.document, a, "back"));
    expect(order()[0]).toBe(a);
    expect(reorder(studio.document, a, "back")).toBeNull();
    expect(reorder(studio.document, a, "backward")).toBeNull();

    apply(studio, reorder(studio.document, a, "forward"));
    expect(order()[1]).toBe(a);
    expect(reorder(studio.document, root.id, "front")).toBeNull();
    expect(initial).toContain(c);
    studio.dispose();
  });

  it("survives an arrangement session as a valid document", () => {
    const { studio, a, c } = scene();
    const grouped = group(studio.document, [a, c], ids)!;
    studio.store.apply(grouped.transaction);
    studio.render();
    apply(studio, align(studio.document, [a, c], bounds(studio), "centerX"));
    apply(studio, reorder(studio.document, grouped.groupId, "front"));
    apply(studio, ungroup(studio.document, grouped.groupId));

    expect(validateDocument(studio.document).valid).toBe(true);
    studio.dispose();
  });
});

// ===========================================================================
// The toolbox
// ===========================================================================

describe("the object toolbox", () => {
  it("draws something for every entry that is not a container", () => {
    // The rule that excludes Text, Image and SVG today: a tool exists only when
    // the projector attaches something for it and a backend puts it on screen.
    // A toolbox entry that produces an invisible node teaches a designer to
    // distrust the whole palette.
    // Counted rather than looked up by id: a backend snapshot addresses nodes
    // by tree PATH, deliberately, so that two backends are comparable without
    // sharing an id space. The delta against a bare document is the honest
    // question anyway — "did adding this tool attach anything new?"
    const attachments = (studio: StudioSession, backend: MockMirrorBackend) => {
      studio.render();
      const counts = new Map<string, number>();
      for (const node of backend.snapshot().nodes) {
        counts.set(node.attachment, (counts.get(node.attachment) ?? 0) + 1);
      }
      return counts;
    };

    for (const entry of TOOLBOX) {
      const backend = new MockMirrorBackend();
      const factory = testIdFactory();
      // Text needs a provider with a real font, exactly as it does in the
      // running editor. Wiring it here rather than exempting `text` is what
      // keeps this assertion honest: the rule is that every tool DRAWS.
      const provider = new HostTextProvider({ pageSize: 512, pxRange: 4 });
      provider.addFont(DEFAULT_FONT_ASSET, interFont());
      const studio = new StudioSession(backend, newDocument("Toolbox", factory), {
        text: provider,
      });
      const before = attachments(studio, backend);

      const created = createNode(studio.document, entry.kind, studio.document.root.id, factory);
      studio.store.apply(created.transaction);
      const after = attachments(studio, backend);

      expect(validateDocument(studio.document).valid).toBe(true);
      expect(studio.exists(created.nodeId), `${entry.kind} never reached the mirror`).toBe(true);

      const expected =
        entry.kind === "group"
          ? "none"
          : entry.kind === "camera"
            ? "camera"
            : entry.kind === "light"
              ? "light"
              : "mesh";
      // Text attaches its mesh to a CHILD of the node, one per atlas page,
      // because a mesh samples one texture. The node itself carries nothing.
      if (entry.kind === "text") {
        expect(
          [...studio.host.reconciler.mirror.nodeIds()].some((id) =>
            id.startsWith(`${created.nodeId}\u00a7text`),
          ),
          "text attached no mesh",
        ).toBe(true);
        studio.dispose();
        continue;
      }
      expect(
        (after.get(expected) ?? 0) - (before.get(expected) ?? 0),
        `${entry.kind} attached no ${expected}`,
      ).toBe(1);
      studio.dispose();
    }
  });

  it("names no broadcast noun", () => {
    // No "lower third" tool, ever. A lower third is a group with a rectangle
    // and some text; a component that knows what one IS makes the Marketplace
    // ship code instead of data.
    const labels = TOOLBOX.map((entry) => `${entry.kind} ${entry.label}`.toLowerCase()).join(" ");
    for (const noun of ["lower third", "ticker", "scoreboard", "bug", "bracket", "leaderboard"]) {
      expect(labels).not.toContain(noun);
    }
  });

  it("promises nothing the engine cannot draw", () => {
    // Text, Image and SVG are absent by the same rule, and IF-003 is why.
    const kinds = TOOLBOX.map((entry) => entry.kind);
    // `text` left this list in Phase 3B — the engine can draw it now, and the
    // rule was never "no text", it was "nothing the engine cannot draw".
    expect(kinds).toContain("text");
    for (const missing of ["image", "svg", "video"]) {
      expect(kinds).not.toContain(missing);
    }
  });

  it("makes a group with no empty children array, so it round-trips", () => {
    const { studio, nodeId } = withNode("group");
    expect("children" in findNode(studio.document.root, nodeId)!).toBe(false);
    const before = serializeDocument(studio.document);
    const child = createNode(studio.document, "rect", nodeId, ids);
    studio.store.apply(child.transaction);
    studio.store.undo();
    expect(serializeDocument(studio.document)).toBe(before);
    studio.dispose();
  });

  it("keyframes an ellipse with exactly the code that keyframes a rectangle", () => {
    // The generic-node requirement: the authoring tools must treat every node
    // the same, so a future TextNode gains every capability with no Studio
    // change. Nothing in `keyframes.ts` or `presets.ts` knows what a node is.
    const { studio, nodeId } = withNode("ellipse");
    apply(studio, applyPreset(studio.document, [nodeId], presetById("slide-in-left")!, ids));
    const timeline = timelineOf(studio);
    expect(timeline.tracks[0]!.target).toBe(nodeId);

    apply(studio, applyPreset(studio.document, [nodeId], presetById("fade-in")!, ids, {
      timelineId: timeline.id,
    }));
    // The fade found the mesh material's colour rather than a rect fill.
    expect(timelineOf(studio).tracks[1]!.path).toBe("components.0.props.material.baseColor");
    studio.dispose();
  });
});

// ===========================================================================
// Variables — the override / default split
// ===========================================================================

describe("variable overrides", () => {
  function withVariable(): StudioSession {
    const studio = session();
    const defined = defineVariable("title", "string", "DEFAULT", ids);
    studio.store.apply(defined.transaction);
    return studio;
  }

  it("changes the runtime and not the document", () => {
    // RFC-002 §4.3: a variable's default is a document edit; its current value
    // is runtime state. A designer trying values must not have every trial land
    // in the file and on the undo stack.
    const studio = withVariable();
    const json = serializeDocument(studio.document);
    const depth = studio.store.depth;

    studio.overrideVariable("title", "LIVE");
    expect(studio.variableValue("title")).toBe("LIVE");
    expect(serializeDocument(studio.document)).toBe(json);
    expect(studio.store.depth).toBe(depth);
    expect(studio.isOverridden("title")).toBe(true);
    studio.dispose();
  });

  it("resets to the default rather than to nothing", () => {
    // `variable.clear` alone leaves the key ABSENT — the runtime has no memory
    // of the document — and a designer who resets a field and sees it go blank
    // has lost their default.
    const studio = withVariable();
    studio.overrideVariable("title", "LIVE");
    studio.resetVariable("title");

    expect(studio.variableValue("title")).toBe("DEFAULT");
    expect(studio.isOverridden("title")).toBe(false);
    studio.dispose();
  });

  it("clears a key that has no variable behind it", () => {
    const studio = withVariable();
    studio.overrideVariable("ghost", 1);
    studio.resetVariable("ghost");
    expect(studio.variableValue("ghost")).toBeUndefined();
    expect(studio.isOverridden("ghost")).toBe(false);
    studio.dispose();
  });
});

// ===========================================================================
// Templates, tokens and the library
// ===========================================================================

describe("templates and the library", () => {
  function withVariables(): StudioSession {
    const studio = session();
    studio.store.apply(defineVariable("title", "string", "Name", ids).transaction);
    studio.store.apply(defineVariable("score", "number", null, ids).transaction);
    return studio;
  }

  it("declares a parameter per variable, required when there is no default", () => {
    // A variable nobody is meant to set is a variable that should have been a
    // literal, so every variable is a parameter. A template that ships a blank
    // name should refuse to air rather than air a blank name.
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "Lower Third", ids));

    const template = studio.document.template!;
    expect(template.name).toBe("Lower Third");
    expect(template.parameters.map((parameter) => parameter.key)).toEqual(["title", "score"]);
    expect(template.parameters[0]!.default).toBe("Name");
    expect(template.parameters[0]!.required).toBeUndefined();
    expect(template.parameters[1]!.required).toBe(true);
    expect(validateDocument(studio.document).valid).toBe(true);
    studio.dispose();
  });

  it("keeps its template id when re-saved, so lineage survives", () => {
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "First", ids));
    const templateId = studio.document.template!.id;
    studio.store.apply(promoteToTemplate(studio.document, "Renamed", ids));

    expect(studio.document.template!.id).toBe(templateId);
    expect(studio.document.template!.name).toBe("Renamed");
    studio.dispose();
  });

  it("reports drift when a variable and a parameter stop agreeing", () => {
    // A template drifts the moment somebody renames a variable, and the failure
    // shows up as an instantiation that silently ignores a parameter — which
    // looks like the data feed is broken.
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "Lower Third", ids));
    expect(templateDrift(studio.document)).toEqual([]);

    studio.store.apply(defineVariable("extra", "string", "x", ids).transaction);
    expect(templateDrift(studio.document)).toEqual(['variable "extra" is not a parameter']);
    studio.dispose();
  });

  it("demotes without touching the variables", () => {
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "T", ids));
    studio.store.apply(demoteTemplate(studio.document)!);

    expect(studio.document.template).toBeUndefined();
    expect(studio.document.variables).toHaveLength(2);
    expect(demoteTemplate(studio.document)).toBeNull();
    expect(validateDocument(studio.document).valid).toBe(true);
    studio.dispose();
  });

  it("instantiates a new document that remembers which template it came from", () => {
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "Lower Third", ids));
    const entry = describeDocument(studio.document, "2026-08-02T00:00:00.000Z");

    const copy = instantiate(entry, ids, "2026-08-03T00:00:00.000Z");
    expect(copy.id).not.toBe(studio.document.id);
    expect(copy.template!.id).toBe(studio.document.template!.id);
    expect(copy.meta.name).toBe("Lower Third");
    expect(copy.meta.createdAt).toBe("2026-08-03T00:00:00.000Z");
    expect(validateDocument(copy).valid).toBe(true);
    studio.dispose();
  });

  it("describes a document from the document, so a card cannot go stale", () => {
    const studio = session();
    const first = describeDocument(studio.document, "t0");
    expect(first.name).toBe("Test");

    studio.store.apply(
      // `meta.name` is a document-level path, not a node path.
      {
        id: "txn_rename",
        label: "Rename",
        actorId: "studio",
        operations: [
          { type: "doc.setMeta", path: "meta.name", value: "Renamed", previousValue: "Test" },
        ],
      },
    );
    expect(describeDocument(studio.document, "t1").name).toBe("Renamed");
    studio.dispose();
  });

  it("stores by document id, so saving twice updates rather than duplicating", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };

    const studio = session();
    let library = loadLibrary(storage);
    library = saveToLibrary(library, describeDocument(studio.document, "t0"), storage);
    library = saveToLibrary(library, describeDocument(studio.document, "t1"), storage);
    expect(library).toHaveLength(1);
    expect(library[0]!.savedAt).toBe("t1");

    expect(loadLibrary(storage)).toHaveLength(1);
    library = removeFromLibrary(library, studio.document.id, storage);
    expect(loadLibrary(storage)).toEqual([]);
    studio.dispose();
  });

  it("survives a corrupt or absent library store", () => {
    expect(loadLibrary(null)).toEqual([]);
    const broken = {
      getItem: () => "{not json",
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadLibrary(broken)).toEqual([]);
  });

  it("searches by name, description and tag", () => {
    const entry = (name: string, tags: string[]) => ({
      id: name,
      name,
      tags,
      isTemplate: true,
      savedAt: "t",
      json: "{}",
    });
    const library = [entry("Sponsor Wipe", ["motion"]), entry("Bar", ["static"])];
    expect(searchLibrary(library, "motion").map((e) => e.name)).toEqual(["Sponsor Wipe"]);
    expect(searchLibrary(library, "")).toHaveLength(2);
  });

  it("keeps tokens in the document, sorted, and drops the field when empty", () => {
    // A brand colour is part of the graphic. A palette kept beside the file
    // would not survive being sent to another designer.
    const studio = session();
    for (const token of [...STARTER_TOKENS].reverse()) {
      apply(studio, setToken(studio.document, token));
    }
    const names = studio.document.tokens!.map((token) => token.name);
    expect(names).toEqual([...names].sort());
    expect(colourTokens(studio.document).map((token) => token.name)).toEqual([
      "color.ink",
      "color.muted",
      "color.primary",
      "color.surface",
    ]);
    expect(validateDocument(studio.document).valid).toBe(true);

    // Setting the same value again is not an undo step.
    expect(setToken(studio.document, STARTER_TOKENS[0]!)).toBeNull();

    for (const token of STARTER_TOKENS) {
      apply(studio, removeToken(studio.document, token.name));
    }
    // Asserted on the canonical BYTES, not with `in`. `setAtPath` writes
    // `undefined` rather than deleting the key, and canonical JSON drops it —
    // which is what round-tripping actually depends on. Checking `in` here
    // would be checking an implementation detail that does not reach disk.
    expect(studio.document.tokens).toBeUndefined();
    expect(serializeDocument(studio.document)).not.toContain("tokens");
    expect(removeToken(studio.document, "gone")).toBeNull();
    studio.dispose();
  });

  it("round-trips a template through canonical JSON", () => {
    const studio = withVariables();
    studio.store.apply(promoteToTemplate(studio.document, "Lower Third", ids));
    apply(studio, setToken(studio.document, STARTER_TOKENS[0]!));

    const entry = describeDocument(studio.document, "t0");
    expect(entry.json).toBe(canonicalize(studio.document));
    expect(canonicalize(instantiate(entry, ids, "t1"))).not.toBe(entry.json);
    studio.dispose();
  });
});

// ===========================================================================
// A 3D object arrives lit
// ===========================================================================

describe("creating a 3D primitive", () => {
  const blank = () => newDocument("t", makeIdFactory(4), "2026-01-01T00:00:00.000Z");

  it("brings a key light and a fill, because a lit object in the dark is black", () => {
    // The complaint that produced this: "3D objects are not visible in 3D".
    // An unlit box has the same colour on every face and reads as a square;
    // a pbr box with no light renders black. Neither is a cube.
    const document_ = blank();
    expect(hasLight(document_)).toBe(false);

    const created = createNode(document_, "box", document_.root.id, makeIdFactory(5));
    const after = applyTransaction(document_, created.transaction);
    expect(hasLight(after)).toBe(true);

    // A key AND a fill. With one directional light every face turned away
    // renders pure black, so a cube reads as two bright faces and a hole.
    const lights = childrenOf(after.root).filter((node) =>
      (node.components ?? []).some((component) => component.type === "light"),
    );
    expect(lights.length).toBe(2);
    const kinds = lights.map(
      (node) =>
        (node.components ?? []).find((component) => component.type === "light")?.props as {
          kind?: string;
        },
    );
    expect(kinds.some((props) => props?.kind === "ambient")).toBe(true);
    expect(kinds.some((props) => props?.kind === "directional")).toBe(true);
  });

  it("is one undo step, so the scene cannot keep a light nobody asked for", () => {
    const document_ = blank();
    const created = createNode(document_, "sphere", document_.root.id, makeIdFactory(6));
    const after = applyTransaction(document_, created.transaction);
    const back = applyTransaction(after, invertTransaction(created.transaction));
    expect(childrenOf(back.root).length).toBe(childrenOf(document_.root).length);
    expect(hasLight(back)).toBe(false);
  });

  it("does not add a second rig to a scene that already has light", () => {
    const document_ = blank();
    const lit = applyTransaction(
      document_,
      createNode(document_, "box", document_.root.id, makeIdFactory(7)).transaction,
    );
    const before = childrenOf(lit.root).length;
    const again = applyTransaction(
      lit,
      createNode(lit, "sphere", lit.root.id, makeIdFactory(8)).transaction,
    );
    expect(childrenOf(again.root).length).toBe(before + 1);
  });

  it("gives a flat shape no lighting rig at all", () => {
    const document_ = blank();
    const after = applyTransaction(
      document_,
      createNode(document_, "rect", document_.root.id, makeIdFactory(9)).transaction,
    );
    expect(hasLight(after)).toBe(false);
  });
});
