/**
 * The viewport interaction model, checked row by row against the spec.
 *
 * ============================================================================
 * WHY THIS FILE READS LIKE A CHECKLIST
 * ============================================================================
 * `studio-specification.html` §03 is a TABLE: behaviour, specification,
 * reasoning. Two of its rows were violated in the product for weeks — bare
 * wheel zoomed and the middle button orbited — because the code was written
 * from another tool's conventions and nobody compared the two.
 *
 * So each test below names its row. A spec row with no test here is a row
 * nothing is holding.
 */
import { describe, expect, it } from "vitest";

import {
  ZOOM_STEPS,
  nearestStep,
  pointerIntent,
  scrolled,
  snappedToStep,
  steppedZoom,
  wheelIntent,
  zoomedStep,
  type InputEvent,
} from "./studio/interaction";
import { DEFAULT_VIEWPORT, type Viewport } from "./studio/viewport";

const at = { x: 100, y: 50 };
const input = (patch: Partial<InputEvent> = {}): InputEvent => ({
  alt: false,
  shift: false,
  mod: false,
  at,
  ...patch,
});

// ===========================================================================
// §03 · "Zoom steps — 10 · 25 · 50 · 66 · 100 · 200 · 400 · 800 %"
// ===========================================================================

describe("zoom steps are the ladder the spec names", () => {
  it("is exactly the eight rungs, in order", () => {
    expect(ZOOM_STEPS).toEqual([0.1, 0.25, 0.5, 0.66, 1, 2, 4, 8]);
  });

  it("includes 100% exactly, because 1:1 has to be reachable", () => {
    // "At 100 % one viewport pixel is one output pixel... It must be exact,
    // not approximately exact."
    expect(ZOOM_STEPS).toContain(1);
  });

  it("steps up and down one rung at a time", () => {
    expect(steppedZoom(1, 1)).toBe(2);
    expect(steppedZoom(1, -1)).toBe(0.66);
    expect(steppedZoom(8, 1)).toBe(8); // Held at the top, not multiplied past it.
    expect(steppedZoom(0.1, -1)).toBe(0.1);
  });

  it("lands a value between rungs on the one it is heading towards", () => {
    // At 87%, one notch up must reach 100 — not snap back to 66 first, which
    // would make the notch feel like nothing happened.
    expect(steppedZoom(0.87, 1)).toBe(1);
    expect(steppedZoom(0.87, -1)).toBe(0.66);
  });

  it("chooses the nearest rung in log space, not linear", () => {
    // 1.45 is the case that tells the two apart. Linearly it is nearer 1
    // (0.45 away, against 0.55); proportionally it is nearer 2, because
    // 1.45 is 1.45× of 1 and 2 is only 1.38× of it. Proportion is what zoom
    // IS — a rung is a ratio, not an offset — so 2 is the right answer.
    expect(nearestStep(1.45)).toBe(2);
    expect(nearestStep(0.4)).toBe(0.5);
    // 2.83 is the geometric midpoint of 2 and 4, so 2.5 lands on 2 and 3 on 4.
    // Linear arithmetic would put both on 2 and make the upper half of every
    // interval snap downwards.
    expect(nearestStep(2.5)).toBe(2);
    expect(nearestStep(3)).toBe(4);
    expect(nearestStep(0.95)).toBe(1);
  });
});

// ===========================================================================
// §03 · "Default — Fit, then snap to nearest step"
// ===========================================================================

describe("Fit lands on a rung", () => {
  const element = { width: 1000, height: 600 };

  it("snaps an arbitrary computed scale to the ladder", () => {
    // "Opening at an arbitrary 87 % teaches nothing."
    const fitted: Viewport = { zoom: 0.87, panX: 20, panY: 30 };
    expect(snappedToStep(fitted, element).zoom).toBe(1);
  });

  it("keeps the same centre while it snaps", () => {
    const fitted: Viewport = { zoom: 0.87, panX: 20, panY: 30 };
    const snapped = snappedToStep(fitted, element);
    // The point at the middle of the element before must be the point at the
    // middle after — a snap that also slid the graphic would undo Fit.
    const centre = { x: element.width / 2, y: element.height / 2 };
    const before = { x: (centre.x - fitted.panX) / fitted.zoom, y: (centre.y - fitted.panY) / fitted.zoom };
    const after = { x: (centre.x - snapped.panX) / snapped.zoom, y: (centre.y - snapped.panY) / snapped.zoom };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("leaves a scale that is already on a rung alone", () => {
    const exact: Viewport = { zoom: 1, panX: 5, panY: 7 };
    expect(snappedToStep(exact, element)).toBe(exact);
  });
});

// ===========================================================================
// §03 · "Wheel — Scrolls vertically. ⌘+wheel zooms about the pointer."
// ===========================================================================

describe("the wheel", () => {
  /**
   * THE ROW THAT WAS VIOLATED.
   *
   * "Bare-wheel zoom is the single most complained-about behaviour in design
   * tools and it fires constantly on trackpads." It shipped anyway, because
   * the wheel handler was written from Blender's conventions.
   */
  it("scrolls on its own, and never zooms", () => {
    const intent = wheelIntent(input({ deltaX: 0, deltaY: 120 }));
    expect(intent.kind, "the bare wheel is zooming again").toBe("scroll");
    expect(intent.kind === "scroll" && intent.dy).toBe(120);
  });

  it("scrolls sideways on shift", () => {
    const intent = wheelIntent(input({ shift: true, deltaX: 0, deltaY: 120 }));
    expect(intent.kind === "scroll" && intent.dx).toBe(120);
    expect(intent.kind === "scroll" && intent.dy).toBe(0);
  });

  it("zooms about the pointer on the modifier, one rung a notch", () => {
    const up = wheelIntent(input({ mod: true, deltaY: -120 }));
    expect(up.kind).toBe("zoom");
    expect(up.kind === "zoom" && up.direction).toBe(1);
    expect(up.kind === "zoom" && up.at).toEqual(at);

    const down = wheelIntent(input({ mod: true, deltaY: 120 }));
    expect(down.kind === "zoom" && down.direction).toBe(-1);
  });

  it("holds the pixel under the pointer while it zooms", () => {
    const before: Viewport = { zoom: 1, panX: 0, panY: 0 };
    const after = zoomedStep(before, at, 1);
    expect(after.zoom).toBe(2);
    // Same canvas point under the same screen point, which is what "about the
    // pointer" means. Zooming about the centre is what makes an editor feel
    // like it is fighting you.
    const canvasBefore = { x: (at.x - before.panX) / before.zoom, y: (at.y - before.panY) / before.zoom };
    const canvasAfter = { x: (at.x - after.panX) / after.zoom, y: (at.y - after.panY) / after.zoom };
    expect(canvasAfter.x).toBeCloseTo(canvasBefore.x, 6);
    expect(canvasAfter.y).toBeCloseTo(canvasBefore.y, 6);
  });

  it("moves the content the way the fingers went", () => {
    const panned = scrolled(DEFAULT_VIEWPORT, 0, 100);
    expect(panned.panY).toBe(-100);
  });
});

// ===========================================================================
// §03 · "Pan — Space-drag, middle-drag, or two-finger scroll."
// ===========================================================================

describe("the pointer", () => {
  /** THE OTHER ROW THAT WAS VIOLATED: the middle button orbited. */
  it("pans on the middle button, in both views", () => {
    expect(pointerIntent(input({ button: 1 }), false).kind).toBe("pan");
    expect(
      pointerIntent(input({ button: 1 }), true).kind,
      "the middle button is orbiting again",
    ).toBe("pan");
  });

  it("pans on space-drag, for anyone without a middle button", () => {
    expect(pointerIntent(input({ button: 0, space: true }), true).kind).toBe("pan");
    expect(pointerIntent(input({ button: 0, space: true }), false).kind).toBe("pan");
  });

  it("orbits on alt-drag, where there is something to orbit", () => {
    expect(pointerIntent(input({ button: 0, alt: true }), true).kind).toBe("orbit");
  });

  it("refuses to orbit the flat view", () => {
    // A lower third is designed square-on and stays square-on. A camera nudged
    // off axis by a stray Alt-drag makes every later judgement about alignment
    // and letter-spacing wrong, and the designer never learns why.
    expect(pointerIntent(input({ button: 0, alt: true }), false).kind).toBe("select");
  });

  it("selects on a plain click", () => {
    expect(pointerIntent(input({ button: 0 }), true).kind).toBe("select");
    expect(pointerIntent(input({ button: 0 }), false).kind).toBe("select");
  });
});

// ===========================================================================
// The model as a whole
// ===========================================================================

describe("one gesture, one meaning", () => {
  it("gives every input exactly one intent", () => {
    // The failure this guards is two handlers both claiming a gesture — which
    // is how one wheel notch used to dolly the camera AND rescale the picture.
    const cases: InputEvent[] = [
      input({ deltaY: 120 }),
      input({ shift: true, deltaY: 120 }),
      input({ mod: true, deltaY: 120 }),
    ];
    const kinds = cases.map((event) => wheelIntent(event).kind);
    expect(kinds).toEqual(["scroll", "scroll", "zoom"]);
  });

  it("never returns a zoom with no direction to zoom in", () => {
    expect(wheelIntent(input({ mod: true, deltaY: 0 })).kind).toBe("none");
  });
});
