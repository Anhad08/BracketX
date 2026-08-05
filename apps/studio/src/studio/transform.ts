/**
 * Resize and rotate handles.
 *
 * ============================================================================
 * PURE GEOMETRY, NO REACT, NO DOM
 * ============================================================================
 * The Stage already had pan, move, marquee, snap and smart guides. What it did
 * not have was a way to change a node's SIZE or ANGLE with the pointer — its
 * drag state only knew "pan" | "move" | "marquee".
 *
 * Everything here is a function from (bounds, handle, pointer) to a transform.
 * The caller turns the result into a Transaction; nothing in this file touches
 * the document, so every case below is testable without a browser.
 *
 * ============================================================================
 * WHY SCALE AND NOT SIZE
 * ============================================================================
 * A node's box is `size` (authored, in units) and its `transform.scale`. Both
 * could express a resize. Scale is used because:
 *
 *   - `size` participates in layout, so editing it fights the layout engine on
 *     any node inside a container;
 *   - text `fit` is resolved against `size`, so resizing by size would silently
 *     reshape text mid-drag;
 *   - `nodeBounds` already reports `size * scale`, so scaling is what the
 *     existing hit-testing and marquee code already understands.
 *
 * A resize is therefore always `{ position, scale }` — position because every
 * handle except the centre moves the box's centre.
 */
import type { Rect } from "./viewport";

/** The eight resize handles, plus the rotation grip. */
export type HandleId =
  | "nw" | "n" | "ne"
  | "w" | "e"
  | "sw" | "s" | "se"
  | "rotate";

export interface Handle {
  readonly id: HandleId;
  /** World position of the handle itself. */
  readonly x: number;
  readonly y: number;
  /** Unit direction from the box centre. Zero for a handle on an axis. */
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
}

/** How far above the box the rotation grip sits, in world units. */
export const ROTATE_OFFSET = 0.18;

/**
 * Handles for a selection box.
 *
 * Y is up in world space, so "n" is `y + height/2`. Getting this backwards is
 * the classic viewport bug — the handles look right and drag the wrong way.
 */
export function handlesFor(rect: Rect): readonly Handle[] {
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const at = (dx: -1 | 0 | 1, dy: -1 | 0 | 1, id: HandleId): Handle => ({
    id,
    x: rect.x + dx * hw,
    y: rect.y + dy * hh,
    dx,
    dy,
  });
  return [
    at(-1, 1, "nw"), at(0, 1, "n"), at(1, 1, "ne"),
    at(-1, 0, "w"), at(1, 0, "e"),
    at(-1, -1, "sw"), at(0, -1, "s"), at(1, -1, "se"),
    { id: "rotate", x: rect.x, y: rect.y + hh + ROTATE_OFFSET, dx: 0, dy: 1 },
  ];
}

/**
 * The handle under a world point, or null.
 *
 * `tolerance` is supplied by the caller in WORLD units, converted from a fixed
 * pixel radius at the current zoom — so a handle stays equally easy to grab at
 * 10 % and at 800 %. A fixed world tolerance would be unusable at either end.
 */
export function handleAt(
  rect: Rect,
  point: { x: number; y: number },
  tolerance: number,
): Handle | null {
  let best: Handle | null = null;
  let bestDistance = tolerance;
  for (const handle of handlesFor(rect)) {
    const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
    // <= so a later handle wins a tie: corners are listed before edges of the
    // same box, and a corner is the more useful grab.
    if (distance <= bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ResizeOptions {
  /** Shift — preserve the box's starting aspect ratio. */
  readonly lockAspect?: boolean;
  /** Alt — resize about the centre instead of the opposite corner. */
  readonly fromCentre?: boolean;
}

export interface ResizeResult {
  /** New world centre. */
  readonly x: number;
  readonly y: number;
  /** Multiplier to apply to the node's existing scale. */
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Below this the box is treated as degenerate and the axis stops shrinking. */
const MIN_EXTENT = 1e-4;

/**
 * Resizes `rect` by dragging `handle` to `pointer`.
 *
 * Returns a new centre and a scale MULTIPLIER — the caller multiplies it into
 * whatever scale the node already had, so a resize composes with an existing
 * scale instead of replacing it.
 */
export function resize(
  rect: Rect,
  handle: Handle,
  pointer: { x: number; y: number },
  options: ResizeOptions = {},
): ResizeResult {
  const hw = rect.width / 2;
  const hh = rect.height / 2;

  // The anchor is the opposite corner/edge, or the centre when Alt is held.
  const anchorX = options.fromCentre ? rect.x : rect.x - handle.dx * hw;
  const anchorY = options.fromCentre ? rect.y : rect.y - handle.dy * hh;

  // How far the dragged edge now sits from the anchor. A handle with dx === 0
  // does not drive width at all, which is what makes edge handles single-axis.
  const spanX = handle.dx === 0 ? rect.width : Math.abs(pointer.x - anchorX);
  const spanY = handle.dy === 0 ? rect.height : Math.abs(pointer.y - anchorY);

  let width = options.fromCentre && handle.dx !== 0 ? spanX * 2 : spanX;
  let height = options.fromCentre && handle.dy !== 0 ? spanY * 2 : spanY;

  if (options.lockAspect && rect.width > MIN_EXTENT && rect.height > MIN_EXTENT) {
    const aspect = rect.width / rect.height;
    if (handle.dx === 0) {
      width = height * aspect;
    } else if (handle.dy === 0) {
      height = width / aspect;
    } else {
      // A corner: the larger relative change wins, so the box tracks the
      // pointer on its dominant axis rather than jittering between them.
      const byWidth = width / rect.width;
      const byHeight = height / rect.height;
      if (byWidth > byHeight) height = width / aspect;
      else width = height * aspect;
    }
  }

  width = Math.max(width, MIN_EXTENT);
  height = Math.max(height, MIN_EXTENT);

  // Centre: halfway between the anchor and the moved edge, on driven axes only.
  const signX = handle.dx !== 0 ? Math.sign(pointer.x - anchorX) || handle.dx : 0;
  const signY = handle.dy !== 0 ? Math.sign(pointer.y - anchorY) || handle.dy : 0;

  const x = options.fromCentre
    ? rect.x
    : handle.dx === 0
      ? rect.x
      : anchorX + (signX * width) / 2;
  const y = options.fromCentre
    ? rect.y
    : handle.dy === 0
      ? rect.y
      : anchorY + (signY * height) / 2;

  return {
    x,
    y,
    scaleX: rect.width > MIN_EXTENT ? width / rect.width : 1,
    scaleY: rect.height > MIN_EXTENT ? height / rect.height : 1,
  };
}

/** Snap increment for rotation while Shift is held, in degrees. */
export const ROTATE_SNAP_DEGREES = 15;

/**
 * The angle, in degrees, from `pivot` to `pointer`.
 *
 * Zero points up, matching the rotation grip's resting position, and increases
 * clockwise because that is the direction a rotation control is expected to
 * follow on screen even though world Y is up.
 */
export function angleTo(
  pivot: { x: number; y: number },
  pointer: { x: number; y: number },
): number {
  const degrees = (Math.atan2(pointer.x - pivot.x, pointer.y - pivot.y) * 180) / Math.PI;
  return normaliseDegrees(degrees);
}

/**
 * Rotation to apply, given where the drag started and where it is now.
 *
 * Returns the node's NEW absolute Z rotation. `startRotation` is what the node
 * had when the drag began, so a second rotation composes with the first rather
 * than snapping back to zero.
 */
export function rotate(
  pivot: { x: number; y: number },
  startPointer: { x: number; y: number },
  pointer: { x: number; y: number },
  startRotation: number,
  options: { readonly snap?: boolean } = {},
): number {
  const delta = angleTo(pivot, pointer) - angleTo(pivot, startPointer);
  let next = normaliseDegrees(startRotation + delta);
  if (options.snap) {
    next = normaliseDegrees(
      Math.round(next / ROTATE_SNAP_DEGREES) * ROTATE_SNAP_DEGREES,
    );
  }
  return next;
}

/** Wraps to [0, 360). Keeps stored rotations from drifting to huge numbers. */
export function normaliseDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * The cursor a handle should show, as a compass direction.
 *
 * Returned as a direction rather than a CSS cursor so the caller can rotate it
 * with the node — a box turned 90° needs the "n" handle to show an east-west
 * cursor, and a component that hard-coded `ns-resize` would be wrong the moment
 * anything was rotated.
 */
export function handleDirection(handle: Handle, rotationDegrees = 0): number {
  if (handle.id === "rotate") return 0;
  const base = (Math.atan2(handle.dx, handle.dy) * 180) / Math.PI;
  return normaliseDegrees(base + rotationDegrees);
}
