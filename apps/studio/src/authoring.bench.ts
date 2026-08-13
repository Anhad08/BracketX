import { bench, describe } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { canonicalize, type SceneDocument } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { testIdFactory, type IdFactory } from "./studio/ids";
import { createNode, setProp } from "./studio/editing";
import { newDocument } from "./studio/project";
import { nodeBounds } from "./studio/viewport";
import { align, distribute, group, reorder } from "./studio/arrange";
import { applyPreset, presetById } from "./studio/presets";
import {
  copyKeyframes,
  createTimeline,
  deleteKeyframes,
  moveKeyframes,
  pasteKeyframes,
  scaleTiming,
  setEasing,
  setKeyframe,
  timelineById,
} from "./studio/keyframes";
import { ProgramBus } from "./studio/program";
import { describeDocument, promoteToTemplate, setTokens, STARTER_TOKENS } from "./studio/library";

/**
 * Phase 3A authoring overhead.
 *
 * ============================================================================
 * THE THING THESE ARE ACTUALLY WATCHING FOR
 * ============================================================================
 * Every keyframe edit rewrites a WHOLE timeline in one operation, deliberately
 * (`keyframes.ts` argues why). That is a correctness decision with a cost
 * attached, and the cost is O(timeline) per gesture rather than O(1). These
 * benchmarks exist to say what that costs at a size a real broadcast graphic
 * reaches — because "it is only kilobytes" is an assertion, and an assertion
 * about performance that nobody measured is a guess.
 *
 * Tolerances, from what the gesture is:
 *
 *   keyframe drag    fires on every pointer move. Must be well under a frame.
 *   preset apply     a click. Tens of milliseconds is fine.
 *   align / group    a click.
 *   take to air      once per graphic. Must not drop a frame on the way.
 *
 * Numbers are published in STUDIO_PHASE_3_VERIFICATION.md.
 *
 * Run: pnpm --filter studio bench
 */

interface Fixture {
  readonly session: StudioSession;
  readonly ids: IdFactory;
  readonly nodeIds: readonly string[];
  readonly timelineId: string;
}

/**
 * A scene of `nodes` rects, each with `keysPer` keyframes on one track.
 *
 * Sized at the top end of what a graphic reaches rather than at demo size: a
 * benchmark at three keyframes proves nothing about the whole-timeline rewrite,
 * which is precisely the cost worth watching.
 */
function build(nodes: number, keysPer: number): Fixture {
  const ids = testIdFactory();
  const session = new StudioSession(new MockMirrorBackend(), newDocument("Bench", ids));
  const root = session.document.root.id;

  const nodeIds: string[] = [];
  for (let index = 0; index < nodes; index += 1) {
    const created = createNode(session.document, "rect", root, ids);
    session.store.apply(created.transaction);
    session.store.apply(
      setProp(session.document, created.nodeId, "transform.position", [
        (index % 8) * 1.5 - 5,
        Math.floor(index / 8) * 0.8 - 3,
        0,
      ])!,
    );
    nodeIds.push(created.nodeId);
  }

  const timeline = createTimeline(session.document, "Bench", ids, { duration: 4 });
  session.store.apply(timeline.transaction);
  for (const nodeId of nodeIds) {
    for (let key = 0; key < keysPer; key += 1) {
      session.store.apply(
        setKeyframe(
          session.document,
          timeline.timelineId,
          nodeId,
          "transform.position.0",
          (key / keysPer) * 4,
          key,
        )!,
      );
    }
  }

  session.render();
  return { session, ids, nodeIds, timelineId: timeline.timelineId };
}

const small = build(8, 4); // 8 tracks, 32 keyframes. A lower third.
const large = build(64, 8); // 64 tracks, 512 keyframes. A full title sequence.

// ---------------------------------------------------------------------------
// Keyframe editing — the O(timeline) rewrite
// ---------------------------------------------------------------------------

describe("keyframe drag", () => {
  // Applied and undone in one iteration. Without the undo the timeline would
  // drift further from its start with every sample, so the thousandth
  // measurement would describe a different timeline from the first — the same
  // trap the Phase 1 "create a node" benchmark fell into.
  for (const [label, fixture] of [
    ["32 keyframes", small],
    ["512 keyframes", large],
  ] as const) {
    bench(`move one keyframe, ${label}`, () => {
      fixture.session.store.apply(
        moveKeyframes(fixture.session.document, fixture.timelineId, [{ track: 0, index: 1 }], 0.1),
      );
      fixture.session.store.undo();
    });

    bench(`move twenty keyframes, ${label}`, () => {
      const refs = Array.from({ length: 20 }, (_, index) => ({
        track: index % fixture.nodeIds.length,
        index: 0,
      }));
      fixture.session.store.apply(
        moveKeyframes(fixture.session.document, fixture.timelineId, refs, 0.05),
      );
      fixture.session.store.undo();
    });
  }
});

describe("keyframe CRUD", () => {
  let flip = 0;
  bench("record a keyframe, 512 keyframes", () => {
    flip = 1 - flip;
    large.session.store.apply(
      setKeyframe(
        large.session.document,
        large.timelineId,
        large.nodeIds[0]!,
        "transform.scale.0",
        1.5,
        flip,
      ),
    );
    large.session.store.undo();
  });

  bench("delete a keyframe, 512 keyframes", () => {
    large.session.store.apply(
      deleteKeyframes(large.session.document, large.timelineId, [{ track: 0, index: 0 }]),
    );
    large.session.store.undo();
  });

  bench("set easing on twenty keyframes, 512 keyframes", () => {
    const refs = Array.from({ length: 20 }, (_, index) => ({ track: index, index: 0 }));
    large.session.store.apply(
      setEasing(large.session.document, large.timelineId, refs, "easeOutCubic"),
    );
    large.session.store.undo();
  });

  bench("retime the whole timeline, 512 keyframes", () => {
    large.session.store.apply(scaleTiming(large.session.document, large.timelineId, 2));
    large.session.store.undo();
  });
});

describe("keyframe clipboard", () => {
  const timeline = timelineById(large.session.document, large.timelineId)!;
  const refs = Array.from({ length: 8 }, (_, index) => ({ track: 0, index }));

  bench("copy eight keyframes", () => {
    copyKeyframes(timeline, refs);
  });

  const clipboard = copyKeyframes(timeline, refs)!;
  bench("paste onto twenty nodes", () => {
    large.session.store.apply(
      pasteKeyframes(
        large.session.document,
        large.timelineId,
        clipboard,
        2,
        large.nodeIds.slice(0, 20),
      ),
    );
    large.session.store.undo();
  });
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

describe("animation presets", () => {
  const slide = presetById("slide-in-left")!;
  const fade = presetById("fade-in")!;

  bench("apply a slide to one node", () => {
    small.session.store.apply(
      applyPreset(small.session.document, [small.nodeIds[0]!], slide, small.ids),
    );
    small.session.store.undo();
  });

  bench("apply a fade to sixty-four nodes", () => {
    large.session.store.apply(
      applyPreset(large.session.document, large.nodeIds, fade, large.ids),
    );
    large.session.store.undo();
  });

  bench("merge a preset into a 512-keyframe timeline", () => {
    large.session.store.apply(
      applyPreset(large.session.document, [large.nodeIds[0]!], slide, large.ids, {
        timelineId: large.timelineId,
      }),
    );
    large.session.store.undo();
  });
});

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

describe("arrangement", () => {
  // Bounds are recomputed per gesture in the real editor too, because a cached
  // set would align to where things were before the last edit. Measured
  // separately so the alignment cost is not hidden inside it.
  bench("compute world bounds, 64 nodes", () => {
    nodeBounds(large.session.document, (id) => large.session.worldMatrixOf(id));
  });

  const bounds = nodeBounds(large.session.document, (id) => large.session.worldMatrixOf(id));

  bench("align twenty nodes left", () => {
    large.session.store.apply(
      align(large.session.document, large.nodeIds.slice(0, 20), bounds, "left"),
    );
    large.session.store.undo();
  });

  bench("distribute twenty nodes", () => {
    large.session.store.apply(
      distribute(large.session.document, large.nodeIds.slice(0, 20), bounds, "horizontal"),
    );
    large.session.store.undo();
  });

  bench("group twenty nodes", () => {
    const result = group(large.session.document, large.nodeIds.slice(0, 20), large.ids);
    if (result !== null) {
      large.session.store.apply(result.transaction);
      large.session.store.undo();
    }
  });

  let flip = false;
  bench("reorder one node", () => {
    flip = !flip;
    large.session.store.apply(
      reorder(large.session.document, large.nodeIds[0]!, flip ? "forward" : "backward"),
    );
  });
});

// ---------------------------------------------------------------------------
// Preview and Program
// ---------------------------------------------------------------------------

describe("take to air", () => {
  // A Take reparses the whole document and reloads a second engine. That is the
  // price of Program having its own clock and its own mirror, and it is paid
  // once per graphic rather than per frame — but it must not stall the frame it
  // lands on, so it is measured at full scene size.
  const program = new StudioSession(
    new MockMirrorBackend(),
    newDocument("Program", testIdFactory()),
  );
  const bus = new ProgramBus(large.session, () => program);

  bench("cut a 64-node scene to Program", () => {
    bus.cut("lower");
  });

  bench("check whether Preview differs from air", () => {
    void bus.pendingOn("lower");
  });
});

// ---------------------------------------------------------------------------
// Templates and the library
// ---------------------------------------------------------------------------

describe("library", () => {
  bench("describe a 64-node document for a library card", () => {
    describeDocument(large.session.document, "2026-08-02T00:00:00.000Z");
  });

  bench("promote to a template", () => {
    large.session.store.apply(
      promoteToTemplate(large.session.document, "Bench", large.ids),
    );
    large.session.store.undo();
  });

  bench("merge the starter palette", () => {
    large.session.store.apply(setTokens(large.session.document, STARTER_TOKENS));
    large.session.store.undo();
  });

  bench("canonicalize a 64-node document", () => {
    canonicalize(large.session.document as SceneDocument);
  });
});
