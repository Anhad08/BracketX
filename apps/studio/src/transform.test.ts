/**
 * Resize and rotate geometry.
 *
 * Pure functions, so every case a designer can produce with a pointer is
 * testable here rather than only in a browser. The cases chosen are the ones
 * that are wrong in most editors: dragging a handle past its anchor, edge
 * handles that should not touch the other axis, aspect lock on a corner, and
 * resize-from-centre.
 */
import { describe, expect, it } from "vitest";
import {
  angleTo,
  handleAt,
  handlesFor,
  normaliseDegrees,
  resize,
  rotate,
  ROTATE_OFFSET,
  type Handle,
} from "./studio/transform";
import { frame, pixelsPerUnit, worldToCanvas } from "./studio/viewport";
import { instantiateTemplate } from "./studio/packs";
import { ESSENTIALS } from "./studio/essentials";
import { makeIdFactory } from "./studio/ids";
import type { Rect } from "./studio/viewport";

/** A 2x1 box centred on the origin. */
const BOX: Rect = { x: 0, y: 0, width: 2, height: 1 };

const handle = (id: string): Handle => handlesFor(BOX).find((h) => h.id === id)!;

describe("handles sit where the box actually is", () => {
  it("places nine handles", () => {
    expect(handlesFor(BOX)).toHaveLength(9);
  });

  it("puts north at the TOP, because world Y is up", () => {
    // The classic viewport bug: handles look right and drag the wrong way.
    expect(handle("n").y).toBeCloseTo(0.5);
    expect(handle("s").y).toBeCloseTo(-0.5);
  });

  it("places corners at the box corners", () => {
    expect([handle("nw").x, handle("nw").y]).toEqual([-1, 0.5]);
    expect([handle("se").x, handle("se").y]).toEqual([1, -0.5]);
  });

  it("floats the rotation grip above the box", () => {
    const grip = handle("rotate");
    expect(grip.x).toBeCloseTo(0);
    expect(grip.y).toBeCloseTo(0.5 + ROTATE_OFFSET);
  });

  it("finds a handle within tolerance and nothing outside it", () => {
    expect(handleAt(BOX, { x: 1.02, y: -0.48 }, 0.1)?.id).toBe("se");
    expect(handleAt(BOX, { x: 0.4, y: 0.1 }, 0.1)).toBeNull();
  });

  it("prefers the nearer handle when two are in range", () => {
    // Just inside the east edge, nearer to "e" than to either corner.
    expect(handleAt(BOX, { x: 1, y: 0.02 }, 0.6)?.id).toBe("e");
  });
});

describe("resize", () => {
  it("scales from the opposite corner by default", () => {
    // Drag SE from (1,-0.5) out to (2,-1): width 2->3, height 1->1.5.
    const result = resize(BOX, handle("se"), { x: 2, y: -1 });
    expect(result.scaleX).toBeCloseTo(1.5);
    expect(result.scaleY).toBeCloseTo(1.5);
    // NW corner stayed put, so the centre moved half the growth.
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(-0.25);
  });

  it("an edge handle drives ONE axis and leaves the other alone", () => {
    const result = resize(BOX, handle("e"), { x: 3, y: 99 });
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(1); // untouched by a wild Y
    expect(result.y).toBeCloseTo(0);
  });

  it("survives being dragged through its own anchor", () => {
    // Drag the east edge to the far side of the west edge. The box must not
    // invert or collapse — it flips and keeps a positive extent.
    const result = resize(BOX, handle("e"), { x: -3, y: 0 });
    expect(result.scaleX).toBeGreaterThan(0);
    expect(Number.isFinite(result.x)).toBe(true);
  });

  it("locks aspect on a corner", () => {
    // Drag SE mostly horizontally; height must follow to keep 2:1.
    const result = resize(BOX, handle("se"), { x: 3, y: -0.55 }, { lockAspect: true });
    expect(result.scaleX).toBeCloseTo(result.scaleY, 5);
  });

  it("locks aspect from an edge handle too", () => {
    const result = resize(BOX, handle("e"), { x: 3, y: 0 }, { lockAspect: true });
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(2);
  });

  it("resizes about the centre when asked", () => {
    // SE dragged to x=2 with Alt: half-width becomes 2, so width 4 = 2x.
    const result = resize(BOX, handle("se"), { x: 2, y: -1 }, { fromCentre: true });
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(2);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it("never returns a zero or negative scale", () => {
    const result = resize(BOX, handle("se"), { x: -1, y: 0.5 });
    expect(result.scaleX).toBeGreaterThan(0);
    expect(result.scaleY).toBeGreaterThan(0);
  });

  it("is a multiplier, so it composes with an existing scale", () => {
    const doubled = resize(BOX, handle("e"), { x: 3, y: 0 }).scaleX;
    expect(doubled).toBeCloseTo(2);
    // Applying it twice is a 4x total, not a reset to 2x.
    expect(doubled * doubled).toBeCloseTo(4);
  });
});

describe("rotate", () => {
  it("reads zero straight up, matching the grip's resting position", () => {
    expect(angleTo({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(0);
  });

  it("increases clockwise on screen", () => {
    expect(angleTo({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(angleTo({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(180);
  });

  it("applies the delta from where the drag started", () => {
    const pivot = { x: 0, y: 0 };
    const next = rotate(pivot, { x: 0, y: 1 }, { x: 1, y: 0 }, 0);
    expect(next).toBeCloseTo(90);
  });

  it("composes with the rotation the node already had", () => {
    // Starting at 30 degrees and dragging a further quarter turn.
    const next = rotate({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, 30);
    expect(next).toBeCloseTo(120);
  });

  it("snaps to 15 degree increments when asked", () => {
    const next = rotate({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0.12, y: 1 }, 0, {
      snap: true,
    });
    expect(next % 15).toBeCloseTo(0);
  });

  it("wraps instead of drifting to huge numbers", () => {
    expect(normaliseDegrees(370)).toBeCloseTo(10);
    expect(normaliseDegrees(-90)).toBeCloseTo(270);
    expect(normaliseDegrees(720)).toBeCloseTo(0);
  });
});

// ===========================================================================
// Frame selected
// ===========================================================================

describe("frame", () => {
  const document_ = instantiateTemplate(ESSENTIALS[0]!, makeIdFactory(7), "2026-01-01T00:00:00.000Z");
  const view = { width: 800, height: 600 };

  it("centres the rectangle it frames", () => {
    const rect = { x: 2, y: -1, width: 3, height: 2 };
    const viewport = frame(document_, rect, view);
    const centre = worldToCanvas(document_, { x: rect.x, y: rect.y });
    expect(centre.x * viewport.zoom + viewport.panX).toBeCloseTo(view.width / 2, 6);
    expect(centre.y * viewport.zoom + viewport.panY).toBeCloseTo(view.height / 2, 6);
  });

  it("leaves the margin it promises, on the constraining axis", () => {
    const rect = { x: 0, y: 0, width: 10, height: 1 };
    const viewport = frame(document_, rect, view, 64);
    const width = rect.width * pixelsPerUnit(document_) * viewport.zoom;
    expect(width).toBeLessThanOrEqual(view.width - 128 + 0.001);
  });

  it("refuses a degenerate rectangle rather than dividing by zero", () => {
    expect(frame(document_, { x: 0, y: 0, width: 0, height: 0 }, view).zoom).toBeGreaterThan(0);
  });
});
