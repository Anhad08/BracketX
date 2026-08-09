/**
 * V-1 · THE FRAME IS THE WORLD.
 *
 * ============================================================================
 * WHAT §03 SAYS, AND WHAT IT MEANS
 * ============================================================================
 * "The viewport shows a fixed raster at the production's delivery resolution.
 * There is no space outside the frame to place things in — objects may extend
 * past the edge, but nothing can be parked there. The pasteboard that every
 * design tool provides is where forgotten objects go to be rendered
 * accidentally at 20:00. Streamatrix has none. An object dragged fully outside
 * the frame snaps back to the nearest edge with 25 % of its bounds inside, and
 * the layer is flagged off frame."
 *
 * ============================================================================
 * THE FRAME, NOT THE VIEWPORT
 * ============================================================================
 * The boundary is the DELIVERY RASTER — 1920×1080, or whatever the production
 * is — and not the stage element the designer happens to be looking through.
 * The rule's own title says so: the frame is the world.
 *
 * That distinction is the whole feature. If the boundary were the viewport,
 * then zooming out would make more places legal to park something, and zooming
 * in would push objects around on its own. Where a graphic is ALLOWED to be
 * cannot depend on how somebody is looking at it — otherwise two designers at
 * different zooms would disagree about what is on air.
 *
 * So everything here is in WORLD units. The result is identical at 10% and at
 * 800%, and at any pan, which is asserted rather than assumed.
 *
 * ============================================================================
 * WHY 25%
 * ============================================================================
 * §03 fixes it, and the reason is legibility of the CONSEQUENCE: a sliver
 * peeking in is easy to miss, and a half-in object looks deliberate. A quarter
 * is unmistakably "this is not where you left it" while still leaving the
 * object out of the way of the shot it was dragged off.
 */
import type { Rect } from "./viewport";

/** The share of an object that must remain inside. §03 fixes this at 25%. */
export const INSIDE_SHARE = 0.25;

/** Which edge an object was pushed back through. */
export type FrameEdge = "left" | "right" | "top" | "bottom";

export interface FrameRect {
  /** Half-width and half-height in world units, centred on the origin. */
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/**
 * Is this object ENTIRELY outside the frame?
 *
 * Touching counts as inside. An object flush against the edge with a single
 * unit showing has not been parked outside — it is a graphic that bleeds, and
 * bleeding off the edge is ordinary broadcast design. §03 only refuses the
 * pasteboard, not the bleed.
 */
export function isFullyOutside(rect: Rect, frame: FrameRect): boolean {
  const halfWidth = Math.abs(rect.width) / 2;
  const halfHeight = Math.abs(rect.height) / 2;
  return (
    rect.x - halfWidth >= frame.halfWidth ||
    rect.x + halfWidth <= -frame.halfWidth ||
    rect.y - halfHeight >= frame.halfHeight ||
    rect.y + halfHeight <= -frame.halfHeight
  );
}

/**
 * The edge an object went out through.
 *
 * The one it is furthest past, so an object dragged into a corner comes back
 * through the edge it travelled furthest beyond rather than through whichever
 * axis happened to be tested first. Ties go to the horizontal, because a
 * broadcast frame is wider than it is tall and a corner exit is more often a
 * sideways gesture.
 */
export function nearestEdge(rect: Rect, frame: FrameRect): FrameEdge {
  const halfWidth = Math.abs(rect.width) / 2;
  const halfHeight = Math.abs(rect.height) / 2;

  const past = {
    left: -frame.halfWidth - (rect.x + halfWidth),
    right: rect.x - halfWidth - frame.halfWidth,
    bottom: -frame.halfHeight - (rect.y + halfHeight),
    top: rect.y - halfHeight - frame.halfHeight,
  };

  let edge: FrameEdge = past.right >= past.left ? "right" : "left";
  const horizontal = Math.max(past.left, past.right);
  const vertical = Math.max(past.top, past.bottom);
  if (vertical > horizontal) edge = past.top >= past.bottom ? "top" : "bottom";
  return edge;
}

/**
 * Where an object must be moved to so a quarter of it sits inside.
 *
 * Returns the CENTRE, in world units, and moves along one axis only — the one
 * it left through. An object dragged off the right comes back at the same
 * height it was dragged to, because the designer's vertical intent was not the
 * thing being refused.
 */
export function snappedBack(rect: Rect, frame: FrameRect): { x: number; y: number } {
  const halfWidth = Math.abs(rect.width) / 2;
  const halfHeight = Math.abs(rect.height) / 2;
  const edge = nearestEdge(rect, frame);

  // The inside share is measured on the axis it crossed: a quarter of the
  // object's WIDTH past a vertical edge, a quarter of its HEIGHT past a
  // horizontal one. Using one dimension for both would put a wide, short
  // banner mostly on screen when nudged off the top.
  switch (edge) {
    case "right":
      return { x: frame.halfWidth + halfWidth - Math.abs(rect.width) * INSIDE_SHARE, y: rect.y };
    case "left":
      return { x: -frame.halfWidth - halfWidth + Math.abs(rect.width) * INSIDE_SHARE, y: rect.y };
    case "top":
      return { x: rect.x, y: frame.halfHeight + halfHeight - Math.abs(rect.height) * INSIDE_SHARE };
    case "bottom":
      return {
        x: rect.x,
        y: -frame.halfHeight - halfHeight + Math.abs(rect.height) * INSIDE_SHARE,
      };
  }
}

/**
 * How much of an object is inside the frame, as a share of its own bounds.
 *
 * Used by the tests to check the 25% rule against the object rather than
 * against a pixel count, and by the Scene tree to decide what to flag. Measured
 * per axis and taken as the smaller, because an object fully on screen
 * vertically and entirely off it horizontally is not three-quarters present.
 */
export function insideShare(rect: Rect, frame: FrameRect): number {
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  if (width === 0 || height === 0) return 0;

  const overlap = (centre: number, half: number, limit: number): number =>
    Math.max(0, Math.min(centre + half, limit) - Math.max(centre - half, -limit));

  return Math.min(
    overlap(rect.x, width / 2, frame.halfWidth) / width,
    overlap(rect.y, height / 2, frame.halfHeight) / height,
  );
}

/**
 * Should the Scene tree flag this object as off frame?
 *
 * ==========================================================================
 * DERIVED, NEVER STORED
 * ==========================================================================
 * §03 asks for the layer to be "flagged off frame". It would be easy to write
 * a boolean onto the node when the snap happens — and it would be wrong: the
 * object could then be dragged back into shot with the flag still set, or
 * moved out by an animation with the flag clear. Two facts about one thing,
 * disagreeing.
 *
 * So the flag is a QUESTION asked of the bounds, answered fresh every time the
 * tree draws. It persists because the position it is derived from persists,
 * and it can never be stale because it is never stored.
 *
 * THE THRESHOLD IS THE SNAP'S OWN. An ordinary broadcast graphic bleeds off
 * the edge and must not be flagged for it — §03 explicitly allows that. What
 * is flagged is an object with no more of itself inside than the snap-back
 * leaves: a quarter. That is exactly the state V-1 puts an object into, and it
 * is well past what any deliberate bleed would use.
 */
export function isOffFrame(rect: Rect, frame: FrameRect): boolean {
  // A hair of tolerance, because the snap lands ON the threshold and floating
  // point should not decide whether the thing it just did counts.
  return insideShare(rect, frame) <= INSIDE_SHARE + 1e-6;
}
