/**
 * V-1, as arithmetic.
 *
 * §03: "An object dragged fully outside the frame snaps back to the nearest
 * edge with 25 % of its bounds inside, and the layer is flagged off frame."
 *
 * Every assertion below is against the OBJECT'S OWN BOUNDS, never a pixel
 * count — a 4-unit banner and a 0.4-unit bug must both come back with a
 * quarter of themselves showing.
 */
import { describe, expect, it } from "vitest";

import {
  INSIDE_SHARE,
  insideShare,
  isFullyOutside,
  nearestEdge,
  snappedBack,
} from "./studio/offframe";
import type { Rect } from "./studio/viewport";

/** A 16:9 frame in world units, as a broadcast scene uses. */
const FRAME = { halfWidth: 8.888, halfHeight: 5 };

const rect = (x: number, y: number, width = 2, height = 1): Rect => ({ x, y, width, height });

describe("what counts as outside", () => {
  it("is not outside merely because it bleeds off an edge", () => {
    // Broadcast graphics bleed. §03 refuses the PASTEBOARD, not the bleed:
    // "objects may extend past the edge, but nothing can be parked there".
    expect(isFullyOutside(rect(FRAME.halfWidth, 0), FRAME)).toBe(false);
    expect(isFullyOutside(rect(0, FRAME.halfHeight), FRAME)).toBe(false);
  });

  it("counts an object flush against the boundary as outside", () => {
    // ZERO OVERLAP IS OUTSIDE. An object whose trailing edge sits exactly on
    // the frame edge renders nothing — it is parked, not bleeding. An earlier
    // version of this test claimed the opposite and the arithmetic disagreed;
    // the arithmetic was right.
    expect(isFullyOutside(rect(FRAME.halfWidth + 1, 0), FRAME)).toBe(true);
    // One unit further in, and a sliver shows: that is a bleed, and allowed.
    expect(isFullyOutside(rect(FRAME.halfWidth + 0.99, 0), FRAME)).toBe(false);
  });

  it("is outside once its nearest edge has cleared the frame", () => {
    expect(isFullyOutside(rect(FRAME.halfWidth + 1.01, 0), FRAME)).toBe(true);
    expect(isFullyOutside(rect(-FRAME.halfWidth - 1.01, 0), FRAME)).toBe(true);
    expect(isFullyOutside(rect(0, FRAME.halfHeight + 0.51), FRAME)).toBe(true);
    expect(isFullyOutside(rect(0, -FRAME.halfHeight - 0.51), FRAME)).toBe(true);
  });
});

describe("which edge it comes back through", () => {
  it("names the edge it left by", () => {
    expect(nearestEdge(rect(20, 0), FRAME)).toBe("right");
    expect(nearestEdge(rect(-20, 0), FRAME)).toBe("left");
    expect(nearestEdge(rect(0, 20), FRAME)).toBe("top");
    expect(nearestEdge(rect(0, -20), FRAME)).toBe("bottom");
  });

  it("picks the edge it travelled furthest past, in a corner", () => {
    // Far right, barely above: it left sideways, so it returns sideways.
    expect(nearestEdge(rect(40, 5.6), FRAME)).toBe("right");
    // Barely right, far above: it left upwards.
    expect(nearestEdge(rect(10, 40), FRAME)).toBe("top");
  });
});

describe("where it lands", () => {
  const share = (r: Rect): number => insideShare({ ...r }, FRAME);

  it("leaves exactly a quarter of it inside, off the right", () => {
    const dragged = rect(40, 1.5);
    const landed = { ...dragged, ...snappedBack(dragged, FRAME) };
    expect(share(landed)).toBeCloseTo(INSIDE_SHARE, 6);
  });

  it("leaves exactly a quarter inside off every edge", () => {
    for (const dragged of [rect(40, 0), rect(-40, 0), rect(0, 40), rect(0, -40)]) {
      const landed = { ...dragged, ...snappedBack(dragged, FRAME) };
      expect(share(landed)).toBeCloseTo(INSIDE_SHARE, 6);
    }
  });

  /**
   * THE RULE IS A SHARE OF THE OBJECT, NOT A DISTANCE.
   *
   * A hardcoded offset would put a quarter of a small bug on screen and a
   * sliver of a full-width banner, or the reverse.
   */
  it("measures the quarter against the object's own size", () => {
    const tiny = rect(40, 0, 0.4, 0.4);
    const huge = rect(40, 0, 18, 9);
    expect(share({ ...tiny, ...snappedBack(tiny, FRAME) })).toBeCloseTo(INSIDE_SHARE, 6);
    expect(share({ ...huge, ...snappedBack(huge, FRAME) })).toBeCloseTo(INSIDE_SHARE, 6);

    // And the two land in different places, because they are different sizes.
    expect(snappedBack(tiny, FRAME).x).not.toBeCloseTo(snappedBack(huge, FRAME).x, 3);
  });

  it("moves along one axis only", () => {
    // An object dragged off the right returns at the height it was left at:
    // the vertical intent was not the thing being refused.
    const dragged = rect(40, 3.25);
    expect(snappedBack(dragged, FRAME).y).toBe(3.25);

    const up = rect(-2.5, 40);
    expect(snappedBack(up, FRAME).x).toBe(-2.5);
  });

  it("lands somewhere that is no longer fully outside", () => {
    for (const dragged of [rect(40, 0), rect(-40, 2), rect(1, 40), rect(-3, -40)]) {
      const landed = { ...dragged, ...snappedBack(dragged, FRAME) };
      expect(isFullyOutside(landed, FRAME)).toBe(false);
    }
  });

  it("is idempotent — a snapped object does not move again", () => {
    const dragged = rect(40, 0);
    const once = { ...dragged, ...snappedBack(dragged, FRAME) };
    expect(isFullyOutside(once, FRAME)).toBe(false);
    // Nothing calls it twice, but if anything ever did, the object must not
    // creep further in on each pass.
    const twice = { ...once, ...snappedBack(once, FRAME) };
    expect(twice.x).toBeCloseTo(once.x, 6);
  });
});

describe("scaled and rotated objects", () => {
  it("uses the bounds it is given, whatever produced them", () => {
    // A scaled object arrives here as a bigger rect; a rotated one as its
    // axis-aligned extent. This module does not know or care which — it is
    // handed WORLD BOUNDS, which is what makes it correct for both.
    const scaled = rect(40, 0, 6, 3);
    expect(insideShare({ ...scaled, ...snappedBack(scaled, FRAME) }, FRAME)).toBeCloseTo(
      INSIDE_SHARE,
      6,
    );

    // A square turned 45° has bounds √2 wider than its side.
    const turned = rect(40, 0, 2 * Math.SQRT2, 2 * Math.SQRT2);
    expect(insideShare({ ...turned, ...snappedBack(turned, FRAME) }, FRAME)).toBeCloseTo(
      INSIDE_SHARE,
      6,
    );
  });
});

describe("the frame is the world, not the viewport", () => {
  it("gives the same answer whatever the frame's shape", () => {
    // The rule is in WORLD units, so a production at a different delivery
    // resolution gets the same treatment rather than a different one.
    const tall = { halfWidth: 5, halfHeight: 8.888 };
    const dragged = rect(40, 0);
    expect(insideShare({ ...dragged, ...snappedBack(dragged, tall) }, tall)).toBeCloseTo(
      INSIDE_SHARE,
      6,
    );
  });

  it("has no notion of zoom or pan at all", () => {
    // Asserted by the SHAPE of the module: nothing here takes a viewport. If
    // it ever did, where a graphic is allowed to be would depend on how
    // somebody was looking at it, and two designers at different zooms would
    // disagree about what is on air.
    expect(snappedBack.length).toBe(2);
    expect(isFullyOutside.length).toBe(2);
  });
});
