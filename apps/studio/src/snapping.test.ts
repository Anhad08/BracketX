/**
 * Snapping tests.
 *
 * Snapping is a feel feature, and feel is where "it works" and "it is right"
 * diverge most. So these assert the things that make it feel wrong when they
 * are subtly off: that a candidate beats a nearer grid line, that a snap out of
 * reach does nothing at all, that square pulls harder than 15°, and that no
 * snap can round a graphic down to nothing.
 */
import { describe, expect, it } from "vitest";

import {
  ASPECT_DETENTS,
  DEFAULT_SNAP,
  angularDistance,
  equalGapCandidates,
  frameCandidates,
  neighboursOn,
  objectCandidates,
  snapAlongAxis,
  snapAngle,
  snapAspect,
  snapExtent,
  snapResizePointer,
  snapScale,
  snapValue,
  withModifiers,
  type SnapCandidate,
  type SnapSettings,
} from "./studio/snapping";
import type { NodeBounds } from "./studio/viewport";

const SETTINGS: SnapSettings = { ...DEFAULT_SNAP, gridStep: 1, thresholdPx: 8 };
/** A generous world threshold, so tests are about the logic and not the zoom. */
const T = 0.2;

function bounds(
  nodeId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): NodeBounds {
  return { nodeId, rect: { x, y, width, height } };
}

describe("scalar snapping", () => {
  it("returns the input untouched when snapping is off", () => {
    const off = { ...SETTINGS, enabled: false };
    const hit = snapValue(0.97, [{ at: 1, reason: "edge" }], off, T);
    expect(hit.value).toBe(0.97);
    expect(hit.guide).toBeNull();
  });

  it("takes a candidate within the threshold and says why", () => {
    const hit = snapValue(0.95, [{ at: 1, reason: "edge", nodeId: "nod_a" }], SETTINGS, T);
    expect(hit.value).toBe(1);
    expect(hit.guide?.reason).toBe("edge");
    expect(hit.guide?.nodeId).toBe("nod_a");
    expect(hit.guide?.label).toBe("Edge");
  });

  it("leaves a candidate outside the threshold alone", () => {
    // Nothing within reach, and the grid is far too — so nothing moves. An
    // implementation that always rounds is what makes a coarse grid feel like
    // a magnet the object cannot escape.
    const coarse = { ...SETTINGS, gridStep: 10 };
    const hit = snapValue(4.5, [{ at: 9, reason: "edge" }], coarse, T);
    expect(hit.value).toBe(4.5);
    expect(hit.guide).toBeNull();
  });

  it("prefers a candidate over a NEARER grid line", () => {
    // The grid line at 3 is 0.02 away; the edge at 3.1 is 0.08. The edge wins,
    // because a designer aiming at another object's edge means the edge.
    const hit = snapValue(3.02, [{ at: 3.1, reason: "edge" }], SETTINGS, T);
    expect(hit.value).toBe(3.1);
    expect(hit.guide?.reason).toBe("edge");
  });

  it("falls back to the grid with no guide, because the grid is already drawn", () => {
    const hit = snapValue(2.95, [], SETTINGS, T);
    expect(hit.value).toBe(3);
    expect(hit.guide).toBeNull();
  });

  it("breaks a tie towards the stronger reason, so the label cannot flicker", () => {
    const tied: SnapCandidate[] = [
      { at: 5, reason: "safe" },
      { at: 5, reason: "centre", nodeId: "nod_b" },
    ];
    expect(snapValue(4.9, tied, SETTINGS, T).guide?.reason).toBe("centre");
  });

  it("honours each per-kind toggle independently", () => {
    const noObjects = { ...SETTINGS, toObjects: false };
    // The edge is ignored; the grid still applies.
    expect(snapValue(3.05, [{ at: 3.1, reason: "edge" }], noObjects, T).value).toBe(3);

    const noGrid = { ...SETTINGS, toGrid: false };
    expect(snapValue(2.95, [], noGrid, T).value).toBe(2.95);
  });
});

describe("candidates", () => {
  it("offers three coordinates per axis per node, and excludes the dragged one", () => {
    const all = [bounds("nod_a", 0, 0, 2, 1), bounds("nod_b", 5, 3, 4, 2)];
    const candidates = objectCandidates(all, new Set(["nod_b"]));
    expect(candidates.x.map((c) => c.at).sort((a, b) => a - b)).toEqual([-1, 0, 1]);
    expect(candidates.y.map((c) => c.at).sort((a, b) => a - b)).toEqual([-0.5, 0, 0.5]);
  });

  it("never offers a dragged node its own edge", () => {
    // A node that can snap to itself locks the moment the drag begins, which
    // reads as the editor having frozen.
    const all = [bounds("nod_a", 0, 0, 2, 1)];
    const candidates = objectCandidates(all, new Set(["nod_a"]));
    expect(candidates.x).toHaveLength(0);
    expect(candidates.y).toHaveLength(0);
  });

  it("offers the safe areas and the frame centre", () => {
    const frame = {
      canvas: { x: 960, y: 540, width: 1920, height: 1080 },
      title: { x: 960, y: 540, width: 1728, height: 972 },
      action: { x: 960, y: 540, width: 1786, height: 1004 },
    };
    const candidates = frameCandidates(frame);
    const xs = candidates.x.map((c) => c.at);
    expect(xs).toContain(96); // title-safe left: 960 - 1728/2
    expect(xs).toContain(0); // frame edge
    expect(candidates.x.some((c) => c.at === 960 && c.reason === "centre")).toBe(true);
    expect(candidates.x.some((c) => c.reason === "safe")).toBe(true);
  });

  it("snaps a graphic onto title-safe, which is where a lower third goes", () => {
    const frame = {
      canvas: { x: 0, y: 0, width: 16, height: 9 },
      title: { x: 0, y: 0, width: 14.4, height: 8.1 },
      action: { x: 0, y: 0, width: 14.88, height: 8.37 },
    };
    const hit = snapValue(-7.15, frameCandidates(frame).x, SETTINGS, T);
    expect(hit.value).toBeCloseTo(-7.2, 5);
    expect(hit.guide?.label).toBe("Title safe");
  });
});

describe("equal-gap snapping", () => {
  it("finds the centre between two neighbours", () => {
    // Neighbours at -5 and +5, each 2 wide: inner edges at -4 and 4, so the
    // midpoint is 0.
    const candidates = equalGapCandidates(1, [
      { centre: -5, extent: 2 },
      { centre: 5, extent: 2 },
    ]);
    expect(candidates.some((c) => Math.abs(c.at - 0) < 1e-9)).toBe(true);
    expect(candidates.every((c) => c.reason === "gap")).toBe(true);
  });

  it("refuses a gap the box cannot fit in", () => {
    const candidates = equalGapCandidates(10, [
      { centre: -2, extent: 2 },
      { centre: 2, extent: 2 },
    ]);
    // The only space is 2 wide and the box is 10. Offering a position there
    // would be offering an overlap and calling it an equal gap.
    expect(candidates.some((c) => Math.abs(c.at) < 1e-9)).toBe(false);
  });

  it("extends an existing rhythm past the end of the run", () => {
    // Two boxes 2 wide at 0 and 4 leave a gap of 2. A third continues at 8.
    const candidates = equalGapCandidates(2, [
      { centre: 0, extent: 2 },
      { centre: 4, extent: 2 },
    ]);
    expect(candidates.some((c) => Math.abs(c.at - 8) < 1e-9)).toBe(true);
    expect(candidates.some((c) => Math.abs(c.at + 4) < 1e-9)).toBe(true);
  });

  it("ignores overlapping neighbours, which describe no gap", () => {
    const candidates = equalGapCandidates(1, [
      { centre: 0, extent: 4 },
      { centre: 1, extent: 4 },
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("reads neighbours off bounds on the axis asked for", () => {
    const all = [bounds("nod_a", 1, 7, 2, 3), bounds("nod_b", 9, 9, 4, 5)];
    expect(neighboursOn("x", all, new Set())).toEqual([
      { centre: 1, extent: 2 },
      { centre: 9, extent: 4 },
    ]);
    expect(neighboursOn("y", all, new Set())).toEqual([
      { centre: 7, extent: 3 },
      { centre: 9, extent: 5 },
    ]);
  });
});

describe("angle snapping", () => {
  it("snaps to the step", () => {
    expect(snapAngle(43, SETTINGS).degrees).toBe(45);
    expect(snapAngle(43, SETTINGS).detent).toBe(true);
  });

  it("pulls harder towards square than towards the step", () => {
    // 83° is 7° from 90 and 2° from 75. Square still wins, because a graphic
    // 7° off square is a mistake and 75° is a choice.
    expect(snapAngle(83, SETTINGS).degrees).toBe(90);
  });

  it("still reaches the angles between the cardinals", () => {
    // The bias must not swallow its neighbours entirely, or a 15° step becomes
    // a 90° step.
    expect(snapAngle(45, SETTINGS).degrees).toBe(45);
    expect(snapAngle(60, SETTINGS).degrees).toBe(60);
    expect(snapAngle(120, SETTINGS).degrees).toBe(120);
  });

  it("wraps, so 359 is one degree from square and not 359", () => {
    expect(snapAngle(359, SETTINGS).degrees).toBe(0);
    expect(angularDistance(359, 1)).toBe(2);
    expect(angularDistance(-90, 270)).toBe(0);
  });

  it("does nothing when angle snapping is off, and everything when forced", () => {
    const off = { ...SETTINGS, toAngle: false };
    expect(snapAngle(43, off).degrees).toBe(43);
    expect(snapAngle(43, off).detent).toBe(false);
    // Shift keeps meaning "snap the angle" even with snapping off globally.
    const allOff = { ...SETTINGS, enabled: false };
    expect(snapAngle(43, allOff, { force: true }).degrees).toBe(45);
  });

  it("respects a custom step", () => {
    const fine = { ...SETTINGS, angleStep: 5 };
    expect(snapAngle(43, fine).degrees).toBe(45);
    expect(snapAngle(41, fine).degrees).toBe(40);
  });
});

describe("size snapping", () => {
  it("matches another object's extent in preference to the grid", () => {
    const hit = snapExtent(3.1, [{ extent: 3.15, nodeId: "nod_a" }], SETTINGS, T);
    expect(hit.value).toBe(3.15);
    expect(hit.reason).toBe("size");
    expect(hit.nodeId).toBe("nod_a");
  });

  it("falls back to a grid multiple", () => {
    const hit = snapExtent(2.95, [], SETTINGS, T);
    expect(hit.value).toBe(3);
    expect(hit.reason).toBe("grid");
  });

  it("never rounds an extent down to zero", () => {
    // A box with no width cannot be grabbed again. The grid must not be able to
    // delete a graphic by rounding.
    const hit = snapExtent(0.2, [], { ...SETTINGS, gridStep: 1 }, 0.5);
    expect(hit.value).toBeGreaterThan(0);
  });

  it("ignores a zero-extent neighbour", () => {
    const hit = snapExtent(0.05, [{ extent: 0, nodeId: "nod_a" }], SETTINGS, T);
    expect(hit.reason).not.toBe("size");
  });

  it("leaves an extent alone when nothing is in reach", () => {
    const hit = snapExtent(2.5, [{ extent: 9, nodeId: "nod_a" }], { ...SETTINGS, toGrid: false }, T);
    expect(hit.value).toBe(2.5);
    expect(hit.reason).toBeNull();
  });
});

describe("aspect detents", () => {
  it("nudges a near-16:9 box onto 16:9", () => {
    const hit = snapAspect(16.1, 9, SETTINGS);
    expect(hit.label).toBe("16:9");
    expect(hit.width / hit.height).toBeCloseTo(16 / 9, 6);
  });

  it("holds the larger dimension so the box tracks the drag", () => {
    const hit = snapAspect(16.1, 9, SETTINGS);
    expect(hit.width).toBe(16.1);
  });

  it("leaves a deliberate ratio alone", () => {
    const hit = snapAspect(10, 3, SETTINGS);
    expect(hit.label).toBeNull();
    expect(hit.width).toBe(10);
    expect(hit.height).toBe(3);
  });

  it("offers the ratios a broadcast graphic is built to", () => {
    const labels = ASPECT_DETENTS.map((detent) => detent.label);
    expect(labels).toContain("16:9");
    expect(labels).toContain("9:16");
    expect(labels).toContain("1:1");
  });

  it("does nothing on a degenerate box", () => {
    expect(snapAspect(0, 5, SETTINGS).label).toBeNull();
  });
});

describe("resize pointer snapping", () => {
  const context = {
    candidates: {
      x: [{ at: 4, reason: "edge" as const, nodeId: "nod_a" }],
      y: [{ at: 2, reason: "edge" as const, nodeId: "nod_a" }],
    },
    extents: [],
    heights: [],
    thresholdWorld: T,
  };

  it("snaps both axes for a corner handle", () => {
    const hit = snapResizePointer({ x: 3.95, y: 1.95 }, SETTINGS, {
      ...context,
      dx: 1,
      dy: 1,
    });
    expect(hit.x).toBe(4);
    expect(hit.y).toBe(2);
    expect(hit.guideX?.reason).toBe("edge");
    expect(hit.guideY?.reason).toBe("edge");
  });

  it("snaps only the axis an edge handle actually drives", () => {
    // An "e" handle changes width. Snapping Y would move an edge the designer
    // is not dragging, which is the resize equivalent of the object drifting.
    const hit = snapResizePointer({ x: 3.95, y: 1.95 }, SETTINGS, {
      ...context,
      dx: 1,
      dy: 0,
    });
    expect(hit.x).toBe(4);
    expect(hit.y).toBe(1.95);
    expect(hit.guideY).toBeNull();
  });
});

describe("3D axis snapping", () => {
  it("snaps to the origin from further away than to a grid line", () => {
    const hit = snapAlongAxis(0.3, SETTINGS, T);
    expect(hit.value).toBe(0);
    expect(hit.guide?.label).toBe("Origin");
  });

  it("snaps to grid multiples along the axis", () => {
    const hit = snapAlongAxis(2.95, SETTINGS, T);
    expect(hit.value).toBe(3);
    expect(hit.guide).toBeNull();
  });

  it("leaves a position between grid lines alone", () => {
    const hit = snapAlongAxis(2.5, { ...SETTINGS, gridStep: 1 }, 0.1);
    expect(hit.value).toBe(2.5);
  });
});

describe("scale snapping", () => {
  it("takes the round multiples a person actually means", () => {
    expect(snapScale(1.98, SETTINGS).factor).toBe(2);
    expect(snapScale(0.51, SETTINGS).factor).toBe(0.5);
    expect(snapScale(1.01, SETTINGS).factor).toBe(1);
    expect(snapScale(1.98, SETTINGS).detent).toBe(true);
  });

  it("quantises to 10% steps between the detents, not to the nearest detent", () => {
    // 1.63 lands on 1.6, NOT dragged all the way to the 1.5 detent. This is the
    // assertion that keeps the step grid from collapsing into the detent list.
    expect(snapScale(1.63, SETTINGS).factor).toBeCloseTo(1.6, 6);
    expect(snapScale(1.74, SETTINGS).factor).toBeCloseTo(1.7, 6);
    expect(snapScale(2.31, SETTINGS).factor).toBeCloseTo(2.3, 6);
  });

  it("keeps a small factor's precision rather than quantising it to zero", () => {
    // A scale of zero collapses the object and it cannot be grabbed again.
    expect(snapScale(0.02, SETTINGS).factor).toBeCloseTo(0.02, 6);
    expect(snapScale(0.02, SETTINGS).detent).toBe(false);
  });

  it("leaves scale alone when size snapping is off", () => {
    expect(snapScale(1.63, { ...SETTINGS, toSize: false }).factor).toBe(1.63);
  });

  it("refuses a non-positive factor rather than inverting the object", () => {
    expect(snapScale(0, SETTINGS).factor).toBe(0);
    expect(snapScale(-2, SETTINGS).detent).toBe(false);
  });
});

describe("modifier overrides", () => {
  it("Alt suspends snapping entirely", () => {
    const suspended = withModifiers(SETTINGS, { alt: true });
    expect(suspended.enabled).toBe(false);
    expect(snapValue(0.95, [{ at: 1, reason: "edge" }], suspended, T).value).toBe(0.95);
  });

  it("returns the same object when no modifier is held, so nothing re-renders", () => {
    expect(withModifiers(SETTINGS, {})).toBe(SETTINGS);
    expect(withModifiers(SETTINGS, { alt: false })).toBe(SETTINGS);
  });
});
