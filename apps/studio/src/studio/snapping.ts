/**
 * Snapping — grid, object, angle and size, in one place.
 *
 * ============================================================================
 * WHY THIS IS ONE MODULE AND NOT FOUR
 * ============================================================================
 * Before this file, snapping existed twice and was missing four times:
 *
 *   2D move      grid + object edges          ✅
 *   2D resize    nothing                      ❌
 *   2D rotate    15°, and only while Shift    ⚠️
 *   3D axis move nothing                      ❌
 *   3D rotate    15°, and only while Shift    ⚠️
 *   3D stretch   nothing                      ❌
 *
 * The reason that pattern appears is that each gesture was wired separately, so
 * each one had to remember to snap. A gesture that forgets is not a bug anybody
 * files — it just feels slightly worse than the others, which is exactly how an
 * editor ends up feeling unfinished without a single reproducible fault.
 *
 * So every gesture now asks the SAME module, and adding a gesture means calling
 * it rather than reimplementing it.
 *
 * ============================================================================
 * A SNAP THAT DOES NOT SAY WHY IS HALF A FEATURE
 * ============================================================================
 * Every function here returns the REASON it snapped, not just the value. That
 * is not diagnostics — it is the product: a designer who sees a value jump and
 * cannot tell whether it hit the grid, another object's edge, or the title-safe
 * margin does not trust it, and turns snapping off. The reason is what the
 * guide labels itself with.
 *
 * ============================================================================
 * THRESHOLDS ARE IN SCREEN PIXELS
 * ============================================================================
 * Always. A world-space threshold is aggressive when zoomed out and unreachable
 * when zoomed in, because the distance that matters is the one between the
 * pointer and the thing on screen — not between two numbers in the document.
 * Callers convert once, through `thresholdWorld`.
 */
import type { NodeBounds, Rect } from "./viewport";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * What snapping is currently doing.
 *
 * Per-kind toggles rather than one switch, because the kinds genuinely conflict:
 * somebody nudging a graphic one grid step at a time wants the grid and not
 * other objects, and somebody aligning a row of sponsor logos wants the exact
 * opposite. One switch forces them to turn off the half that helps.
 */
export interface SnapSettings {
  /** The master switch. False means every function here returns its input. */
  readonly enabled: boolean;
  readonly toGrid: boolean;
  readonly toObjects: boolean;
  readonly toSafeAreas: boolean;
  readonly toAngle: boolean;
  readonly toSize: boolean;
  /** World units between grid lines. */
  readonly gridStep: number;
  /** Degrees between rotation detents. */
  readonly angleStep: number;
  /** Pointer distance, in SCREEN pixels, within which a candidate wins. */
  readonly thresholdPx: number;
}

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  toGrid: true,
  toObjects: true,
  toSafeAreas: true,
  toAngle: true,
  toSize: true,
  gridStep: 0.5,
  // 15° is the angle a broadcast set is actually built on, and it divides 90
  // and 45 exactly — a step that does not hit the cardinals is a step that
  // makes square alignment impossible, which is the only alignment that must
  // never be approximate.
  angleStep: 15,
  thresholdPx: 8,
};

/**
 * Why a value snapped. Ordered by how strongly it should win.
 *
 * `size` and `gap` are the two that make a layout look designed rather than
 * merely aligned: matching another object's width, and sitting an equal
 * distance between two neighbours.
 */
export type SnapReason =
  | "edge"
  | "centre"
  | "size"
  | "gap"
  | "safe"
  | "grid"
  | "angle";

/** A candidate position, and what it means. */
export interface SnapCandidate {
  readonly at: number;
  readonly reason: SnapReason;
  /** The node that produced it, when one did. Labels the guide. */
  readonly nodeId?: string;
}

export interface SnapHit {
  readonly value: number;
  /**
   * The guide to draw, or null when nothing was hit.
   *
   * Null is also what a grid snap returns: a grid line is already on screen, so
   * drawing a guide over it says nothing the designer cannot see.
   */
  readonly guide: SnapGuide | null;
}

export interface SnapGuide {
  readonly at: number;
  readonly reason: SnapReason;
  readonly nodeId?: string;
  /** What the guide should say. Empty for a guide that needs no words. */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Scalar snapping — the primitive every gesture is built on
// ---------------------------------------------------------------------------

/**
 * Snaps one coordinate to the nearest candidate, else to the grid.
 *
 * Candidates beat the grid unconditionally, at any distance within the
 * threshold: a designer dragging a caption towards another caption's edge means
 * the edge, and a grid line half a pixel closer is not a better answer. Making
 * this a plain distance contest instead is how "it snapped to nothing" happens.
 */
export function snapValue(
  value: number,
  candidates: readonly SnapCandidate[],
  settings: SnapSettings,
  thresholdWorld: number,
): SnapHit {
  if (!settings.enabled) return { value, guide: null };

  let best: SnapCandidate | null = null;
  let bestDistance = thresholdWorld;

  for (const candidate of candidates) {
    if (!isAllowed(candidate.reason, settings)) continue;
    const distance = Math.abs(candidate.at - value);
    // Strictly closer, or equal but a stronger reason. Without the tie-break an
    // edge and a grid line at the same coordinate resolve by array order, so
    // the label flickers between them while the value does not move.
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && strength(candidate.reason) > strength(best.reason))
    ) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best !== null) {
    return {
      value: best.at,
      guide: {
        at: best.at,
        reason: best.reason,
        ...(best.nodeId === undefined ? {} : { nodeId: best.nodeId }),
        label: labelFor(best.reason),
      },
    };
  }

  if (settings.toGrid && settings.gridStep > 0) {
    const stepped = Math.round(value / settings.gridStep) * settings.gridStep;
    // Only if the grid is actually within reach. Rounding unconditionally is
    // what makes a coarse grid feel like the object is stuck to a magnet it
    // cannot escape.
    if (Math.abs(stepped - value) <= thresholdWorld) {
      return { value: stepped, guide: null };
    }
  }

  return { value, guide: null };
}

function isAllowed(reason: SnapReason, settings: SnapSettings): boolean {
  switch (reason) {
    case "edge":
    case "centre":
    case "gap":
      return settings.toObjects;
    case "size":
      return settings.toSize;
    case "safe":
      return settings.toSafeAreas;
    case "grid":
      return settings.toGrid;
    case "angle":
      return settings.toAngle;
  }
}

/** Higher wins a tie. Object geometry beats a margin beats the grid. */
function strength(reason: SnapReason): number {
  switch (reason) {
    case "centre":
      return 6;
    case "edge":
      return 5;
    case "size":
      return 4;
    case "gap":
      return 3;
    case "safe":
      return 2;
    case "angle":
      return 1;
    case "grid":
      return 0;
  }
}

function labelFor(reason: SnapReason): string {
  switch (reason) {
    case "edge":
      return "Edge";
    case "centre":
      return "Centre";
    case "size":
      return "Same size";
    case "gap":
      return "Equal gap";
    case "safe":
      return "Title safe";
    case "angle":
      return "";
    case "grid":
      return "";
  }
}

// ---------------------------------------------------------------------------
// Candidates — what there is to snap to
// ---------------------------------------------------------------------------

export interface AxisCandidates {
  readonly x: readonly SnapCandidate[];
  readonly y: readonly SnapCandidate[];
}

/**
 * Edges and centres of everything except what is being dragged.
 *
 * Excluding the dragged nodes matters more than it looks: a node that can snap
 * to its own edge locks in place the moment the drag begins, which reads as the
 * editor having frozen.
 */
export function objectCandidates(
  bounds: readonly NodeBounds[],
  exclude: ReadonlySet<string>,
): AxisCandidates {
  const x: SnapCandidate[] = [];
  const y: SnapCandidate[] = [];

  for (const entry of bounds) {
    if (exclude.has(entry.nodeId)) continue;
    const { rect, nodeId } = entry;
    x.push(
      { at: rect.x, reason: "centre", nodeId },
      { at: rect.x - rect.width / 2, reason: "edge", nodeId },
      { at: rect.x + rect.width / 2, reason: "edge", nodeId },
    );
    y.push(
      { at: rect.y, reason: "centre", nodeId },
      { at: rect.y - rect.height / 2, reason: "edge", nodeId },
      { at: rect.y + rect.height / 2, reason: "edge", nodeId },
    );
  }
  return { x, y };
}

/**
 * The frame's own centre lines and safe-area edges.
 *
 * ==========================================================================
 * THE MOST USEFUL SNAP IN BROADCAST, AND IT WAS MISSING
 * ==========================================================================
 * Title-safe is where a lower third goes. Not near it — on it. Every graphics
 * department has the same rule and every operator eyeballed it here, because
 * the safe areas were drawn on screen and nothing snapped to them. Drawing a
 * margin you cannot land on is a ruler with no notches.
 */
export function frameCandidates(frame: {
  readonly title: Rect;
  readonly action: Rect;
  readonly canvas: Rect;
}): AxisCandidates {
  const x: SnapCandidate[] = [];
  const y: SnapCandidate[] = [];

  for (const [rect, reason] of [
    [frame.title, "safe"],
    [frame.action, "safe"],
    [frame.canvas, "edge"],
  ] as const) {
    x.push(
      { at: rect.x - rect.width / 2, reason },
      { at: rect.x + rect.width / 2, reason },
    );
    y.push(
      { at: rect.y - rect.height / 2, reason },
      { at: rect.y + rect.height / 2, reason },
    );
  }
  // The frame's centre lines. A graphic centred in frame is the single most
  // common intent there is, and it is a centre rather than an edge so it wins
  // the tie against the safe margins that share the axis.
  x.push({ at: frame.canvas.x, reason: "centre" });
  y.push({ at: frame.canvas.y, reason: "centre" });

  return { x, y };
}

/**
 * Positions where the moving box sits an EQUAL DISTANCE between two neighbours.
 *
 * ==========================================================================
 * WHY THIS IS WORTH THE ARITHMETIC
 * ==========================================================================
 * Alignment makes a row straight. Equal spacing makes it look designed, and it
 * is the one thing a designer genuinely cannot do by eye at speed — three
 * sponsor logos across a lower third are either evenly spaced or obviously not.
 * Every tool that has this is the tool people say "feels good".
 *
 * Only pairs whose gap is positive are considered: two overlapping neighbours
 * describe no gap to match, and treating their overlap as a negative gap
 * produces candidate positions that read as random.
 */
export function equalGapCandidates(
  movingExtent: number,
  neighbours: readonly { readonly centre: number; readonly extent: number }[],
): readonly SnapCandidate[] {
  const sorted = [...neighbours].sort((a, b) => a.centre - b.centre);
  const candidates: SnapCandidate[] = [];
  const half = movingExtent / 2;

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    const leftEdge = left.centre + left.extent / 2;
    const rightEdge = right.centre - right.extent / 2;
    const space = rightEdge - leftEdge;
    // Room for the box and two gaps of the same size, or there is nothing to
    // centre. `> movingExtent` and not `>=`: a zero gap either side is not a
    // gap, it is a tight fit, and offering it as "equal gap" is a lie.
    if (space <= movingExtent) continue;
    candidates.push({ at: leftEdge + space / 2, reason: "gap" });
  }

  // Outside the run, matching the gap that already exists between the two
  // nearest neighbours — how a fourth logo joins a row of three.
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const gap = b.centre - b.extent / 2 - (a.centre + a.extent / 2);
    if (gap <= 0) continue;
    if (i === 0) {
      candidates.push({ at: a.centre - a.extent / 2 - gap - half, reason: "gap" });
    }
    if (i === sorted.length - 2) {
      candidates.push({ at: b.centre + b.extent / 2 + gap + half, reason: "gap" });
    }
  }

  return candidates;
}

/** Neighbours on one axis, from bounds, for `equalGapCandidates`. */
export function neighboursOn(
  axis: "x" | "y",
  bounds: readonly NodeBounds[],
  exclude: ReadonlySet<string>,
): readonly { readonly centre: number; readonly extent: number }[] {
  return bounds
    .filter((entry) => !exclude.has(entry.nodeId))
    .map((entry) => ({
      centre: axis === "x" ? entry.rect.x : entry.rect.y,
      extent: axis === "x" ? entry.rect.width : entry.rect.height,
    }));
}

// ---------------------------------------------------------------------------
// Angle snapping
// ---------------------------------------------------------------------------

export interface AngleHit {
  readonly degrees: number;
  /** True when a detent was taken. Drives the readout and the click. */
  readonly detent: boolean;
  /** The detent's own angle, for the readout. */
  readonly at: number | null;
}

/**
 * The cardinal angles, which snap harder than the step does.
 *
 * ==========================================================================
 * WHY THE CARDINALS GET A WIDER WINDOW
 * ==========================================================================
 * Square is not one angle among twenty-four. A graphic 1° off square is not a
 * graphic at a jaunty angle — it is a mistake, and it is the single most
 * common thing an operator has to go back and fix. So 0, 90, 180 and 270 pull
 * from twice as far as 15 does, which makes "straight" the easy thing to hit
 * and "15° off straight" the deliberate one.
 */
const CARDINALS = [0, 90, 180, 270];
const CARDINAL_BIAS = 2;

/**
 * Snaps an angle to the step, with stronger detents on the cardinals.
 *
 * The window is a fraction of the step rather than a fixed number of degrees,
 * so a user who sets a 5° step gets a proportionally tighter window instead of
 * a step they can no longer land between.
 */
export function snapAngle(
  degrees: number,
  settings: SnapSettings,
  options: { readonly force?: boolean } = {},
): AngleHit {
  const active = options.force === true || (settings.enabled && settings.toAngle);
  if (!active || settings.angleStep <= 0) {
    return { degrees, detent: false, at: null };
  }

  const wrapped = normalise(degrees);
  // Half the step: every angle is within half a step of some detent, so this
  // window means "always snap", which is what a step is FOR. The cardinals
  // then win inside a window twice as wide, which is where the bias lives.
  const window = settings.angleStep / 2;

  let best: number | null = null;
  let bestDistance = Infinity;

  for (const cardinal of CARDINALS) {
    const distance = angularDistance(wrapped, cardinal);
    if (distance <= window * CARDINAL_BIAS && distance < bestDistance) {
      bestDistance = distance;
      best = cardinal;
    }
  }
  if (best !== null) return { degrees: best, detent: true, at: best };

  const stepped = normalise(Math.round(wrapped / settings.angleStep) * settings.angleStep);
  return { degrees: stepped, detent: true, at: stepped };
}

/**
 * The signed shortest turn from `from` to `to`, in degrees.
 *
 * ==========================================================================
 * WHY A RING DRAG NEEDS AN OFFSET RATHER THAN THE SNAPPED ANGLE
 * ==========================================================================
 * `snapAngle` wraps into 0..360, and a ring drag legitimately passes 360 — the
 * accumulated turn is what reaches 540°, and that is the whole reason the ring
 * accumulates deltas instead of measuring from the grab. Replacing the raw turn
 * with a wrapped snapped angle would silently undo two thirds of a long drag.
 *
 * So the snap is applied as a small correction to the raw turn instead, and
 * this is the correction: signed, and never more than half a turn, so a drag at
 * 359° nudges forward to 360 rather than backwards to 0.
 */
export function shortestOffset(from: number, to: number): number {
  const raw = (to - from) % 360;
  if (raw > 180) return raw - 360;
  if (raw < -180) return raw + 360;
  return raw;
}

/** Shortest distance between two angles, in degrees. Handles the wrap at 360. */
export function angularDistance(a: number, b: number): number {
  const raw = Math.abs(normalise(a) - normalise(b)) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function normalise(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// ---------------------------------------------------------------------------
// Size snapping
// ---------------------------------------------------------------------------

export interface SizeHit {
  readonly value: number;
  readonly reason: SnapReason | null;
  /** The node whose size was matched, when one was. */
  readonly nodeId?: string;
}

/**
 * Snaps an extent to a matching extent elsewhere, else to the grid.
 *
 * ==========================================================================
 * MATCHING ANOTHER OBJECT'S SIZE, NOT JUST ITS POSITION
 * ==========================================================================
 * Aligning edges is the snap everybody implements. Matching WIDTH is the one
 * that makes a stack of lower thirds look like a set rather than three
 * separate graphics, and it cannot be done by aligning edges — two boxes with
 * aligned left edges and widths differing by 3% look worse than two boxes that
 * are not aligned at all, because the eye reads the mismatch as a wobble.
 *
 * Grid multiples are offered too, so a resize lands on a round number even
 * when there is nothing to match.
 */
export function snapExtent(
  extent: number,
  others: readonly { readonly extent: number; readonly nodeId: string }[],
  settings: SnapSettings,
  thresholdWorld: number,
): SizeHit {
  if (!settings.enabled) return { value: extent, reason: null };

  if (settings.toSize) {
    let best: { extent: number; nodeId: string } | null = null;
    let bestDistance = thresholdWorld;
    for (const other of others) {
      if (other.extent <= 0) continue;
      const distance = Math.abs(other.extent - extent);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    if (best !== null) {
      return { value: best.extent, reason: "size", nodeId: best.nodeId };
    }
  }

  if (settings.toGrid && settings.gridStep > 0) {
    const stepped = Math.round(extent / settings.gridStep) * settings.gridStep;
    // Never snap an extent to zero. A box with no width cannot be grabbed
    // again, so the grid must not be able to delete a graphic by rounding.
    if (stepped > 0 && Math.abs(stepped - extent) <= thresholdWorld) {
      return { value: stepped, reason: "grid" };
    }
  }

  return { value: extent, reason: null };
}

/**
 * Aspect-ratio detents, for a corner resize.
 *
 * The ratios a broadcast graphic is actually built to. Offered as a snap on the
 * RATIO rather than on either dimension, because a designer reaching for 16:9
 * does not care which of the two numbers moves to get there.
 */
export const ASPECT_DETENTS: readonly { readonly ratio: number; readonly label: string }[] = [
  { ratio: 1, label: "1:1" },
  { ratio: 16 / 9, label: "16:9" },
  { ratio: 9 / 16, label: "9:16" },
  { ratio: 4 / 3, label: "4:3" },
  { ratio: 3 / 4, label: "3:4" },
  { ratio: 21 / 9, label: "21:9" },
];

export interface AspectHit {
  readonly width: number;
  readonly height: number;
  readonly label: string | null;
}

/**
 * Nudges a box onto a standard aspect ratio when it is already close.
 *
 * The tolerance is RELATIVE (a fraction of the ratio), because an absolute
 * tolerance on a ratio is meaninglessly tight at 1:1 and meaninglessly loose
 * at 21:9.
 *
 * The larger dimension is held and the smaller moved, so the box tracks the
 * pointer on the axis being dragged hardest rather than jumping away from it.
 */
export function snapAspect(
  width: number,
  height: number,
  settings: SnapSettings,
  tolerance = 0.02,
): AspectHit {
  if (!settings.enabled || !settings.toSize || width <= 0 || height <= 0) {
    return { width, height, label: null };
  }

  const ratio = width / height;
  for (const detent of ASPECT_DETENTS) {
    if (Math.abs(ratio - detent.ratio) / detent.ratio > tolerance) continue;
    return width >= height
      ? { width, height: width / detent.ratio, label: detent.label }
      : { width: height * detent.ratio, height, label: detent.label };
  }
  return { width, height, label: null };
}

// ---------------------------------------------------------------------------
// Composite: what a resize gesture needs
// ---------------------------------------------------------------------------

export interface ResizeSnapContext {
  /** Which edges the handle drives. Zero means the handle does not drive it. */
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
  /** Everything else on stage, for edges and matching sizes. */
  readonly candidates: AxisCandidates;
  readonly extents: readonly { readonly extent: number; readonly nodeId: string }[];
  readonly heights: readonly { readonly extent: number; readonly nodeId: string }[];
  readonly thresholdWorld: number;
}

export interface ResizeSnapResult {
  /** The snapped pointer position the resize should be computed from. */
  readonly x: number;
  readonly y: number;
  readonly guideX: SnapGuide | null;
  readonly guideY: SnapGuide | null;
}

/**
 * Snaps the pointer of a resize, before the resize arithmetic runs.
 *
 * ==========================================================================
 * WHY THE POINTER AND NOT THE RESULT
 * ==========================================================================
 * Snapping the resulting width would fight the anchor: a `nw` drag with a
 * snapped width has to move the centre to keep the `se` corner still, and
 * getting that wrong makes the opposite corner creep — the most disorienting
 * bug a resize can have.
 *
 * The dragged EDGE, on the other hand, is exactly the thing the designer is
 * aiming at another object's edge. Snap where they are pointing and the
 * existing `resize` arithmetic keeps the anchor fixed for free.
 *
 * Size snapping is applied separately, by the caller, through `snapExtent` —
 * because it needs the anchor to convert an extent back into a pointer, and the
 * anchor belongs to the gesture rather than to this function.
 */
export function snapResizePointer(
  pointer: { readonly x: number; readonly y: number },
  settings: SnapSettings,
  context: ResizeSnapContext,
): ResizeSnapResult {
  if (!settings.enabled) {
    return { x: pointer.x, y: pointer.y, guideX: null, guideY: null };
  }

  // A handle with dx === 0 drives no horizontal edge, so snapping X would move
  // an edge the designer is not dragging.
  const x =
    context.dx === 0
      ? { value: pointer.x, guide: null }
      : snapValue(pointer.x, context.candidates.x, settings, context.thresholdWorld);
  const y =
    context.dy === 0
      ? { value: pointer.y, guide: null }
      : snapValue(pointer.y, context.candidates.y, settings, context.thresholdWorld);

  return { x: x.value, y: y.value, guideX: x.guide, guideY: y.guide };
}

// ---------------------------------------------------------------------------
// Composite: what a 3D axis gesture needs
// ---------------------------------------------------------------------------

/**
 * Snaps a distance along a gizmo axis.
 *
 * ==========================================================================
 * WHY A 3D MOVE SNAPS TO THE GRID AND NOT TO OBJECT EDGES
 * ==========================================================================
 * Edge candidates are per-AXIS coordinates of a flat box. In three dimensions a
 * node's silhouette on the Z axis has nothing to do with its extent on X, so
 * "the nearest edge" is three different answers depending on which axis is
 * being dragged — and offering the wrong one snaps a plinth to a coordinate
 * that means nothing in the direction of travel.
 *
 * The grid IS meaningful on every axis, because it is the same spacing in all
 * three. So a 3D drag snaps to the grid and to the origin plane, and the honest
 * answer for object-relative placement in space is the alignment commands,
 * which already exist and already work in three dimensions.
 */
export function snapAlongAxis(
  position: number,
  settings: SnapSettings,
  thresholdWorld: number,
): SnapHit {
  if (!settings.enabled) return { value: position, guide: null };

  // Zero first: the ground plane and the origin are worth a wider window than a
  // grid line, for the same reason square is worth more than 15°.
  if (Math.abs(position) <= thresholdWorld * 2) {
    return {
      value: 0,
      guide: { at: 0, reason: "centre", label: "Origin" },
    };
  }
  if (settings.toGrid && settings.gridStep > 0) {
    const stepped = Math.round(position / settings.gridStep) * settings.gridStep;
    if (Math.abs(stepped - position) <= thresholdWorld) {
      return { value: stepped, guide: null };
    }
  }
  return { value: position, guide: null };
}

/**
 * Snaps a scale factor to the round multiples a person means.
 *
 * ==========================================================================
 * WHY THESE NUMBERS
 * ==========================================================================
 * Nobody wants 1.9873x. They wanted double. The detents are the fractions and
 * multiples a designer says out loud — half, three quarters, same, one and a
 * half, double, triple.
 *
 * Between them the factor is quantised to 10% steps UNCONDITIONALLY rather than
 * within a tolerance. The first version used a tolerance and the test written
 * to prove it "still moves continuously" failed: with 10% steps and a 3%
 * relative window, the snap zone covered most of the gap, so it was quantised
 * in practice while claiming to be continuous. Quantising honestly is both the
 * simpler rule and the better one — a scale a person can read back beats a
 * scale that is secretly notched. Alt suspends snapping when a true fine
 * adjustment is wanted, which is what the escape hatch is for.
 *
 * The detent threshold is RELATIVE, because 0.05 is a big error at 0.5x and a
 * rounding difference at 3x.
 */
const SCALE_DETENTS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export interface ScaleHit {
  readonly factor: number;
  readonly detent: boolean;
}

export function snapScale(
  factor: number,
  settings: SnapSettings,
  tolerance = 0.03,
): ScaleHit {
  if (!settings.enabled || !settings.toSize || !(factor > 0)) {
    return { factor, detent: false };
  }

  for (const detent of SCALE_DETENTS) {
    if (Math.abs(factor - detent) / detent <= tolerance) {
      return { factor: detent, detent: true };
    }
  }

  // 10% steps, so a drag always lands on a number somebody can read back.
  const stepped = Math.round(factor * 10) / 10;
  // Never quantise to zero: a scale of zero collapses the object to nothing and
  // it cannot be grabbed again, so a small factor keeps its precision instead.
  if (stepped <= 0) return { factor, detent: false };
  return { factor: stepped, detent: true };
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/**
 * Settings for the modifiers currently held.
 *
 * ==========================================================================
 * ALT SUSPENDS SNAPPING, AND NOTHING ELSE CHANGES MEANING
 * ==========================================================================
 * Snapping needs an escape hatch — a designer placing a graphic one pixel off
 * a margin deliberately must be able to, without opening a menu. Alt is used
 * because it is the only modifier not already spoken for in the Stage: Shift is
 * lock-aspect and force-angle, and Cmd/Ctrl is resize-from-centre.
 *
 * `force` exists so Shift keeps meaning "snap the angle" even when snapping is
 * off globally, which is what it did before this module and what the shortcut
 * documentation already says.
 */
export function withModifiers(
  settings: SnapSettings,
  modifiers: { readonly alt?: boolean },
): SnapSettings {
  if (modifiers.alt !== true) return settings;
  return { ...settings, enabled: false };
}
