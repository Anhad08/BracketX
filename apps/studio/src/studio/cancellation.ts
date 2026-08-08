/**
 * ONE ESCAPE.
 *
 * ============================================================================
 * WHAT IT WAS
 * ============================================================================
 * Escape was claimed in six places, each with its own window listener, three
 * of them in capture phase so they could win: the menu bar, the Scene tree's
 * row menu, the stage's context menu, walk mode, the command palette, and the
 * keymap — where it was contested between un-cue and deselect and resolved by
 * a special case.
 *
 * Six listeners in capture phase do not compose. Whichever mounted last won,
 * which is why pressing Escape over an open context menu once closed the menu
 * AND deselected, and why the stage's menu had to `stopPropagation` to survive
 * — a fix that then swallowed Escape from everything behind it.
 *
 * ============================================================================
 * THE LADDER
 * ============================================================================
 * Escape means "back out of where I am", and where you are is a stack. So
 * there is one listener and one ordered ladder, and the FIRST layer that has
 * something to cancel takes it — nothing below it hears the key:
 *
 *   overlay     a menu, a palette, a dialog. Innermost thing on screen.
 *   gesture     a drag in flight. Escape must put the object BACK, not drop
 *               it where the pointer happens to be — a half-applied transform
 *               is worse than no cancel at all.
 *   mode        walk mode, and anything else you are "in".
 *   air         a cued output, disarmed.
 *   selection   the last thing to give up, because it is the cheapest to
 *               rebuild and the most annoying to lose by accident.
 *
 * `overlay` sits above `gesture` deliberately: if a menu is open, the drag
 * that opened it is over, and the menu is what the user is looking at.
 *
 * `air` sits above `selection` because un-cueing is the one on this list with
 * consequences beyond the editor. A designer hitting Escape twice with
 * something cued should disarm it before losing their selection, not after.
 *
 * ============================================================================
 * WHY A MODULE-LEVEL REGISTRY
 * ============================================================================
 * There is one Studio per page. A context would thread a provider through
 * every panel to express a fact that is already global, and the point of this
 * file is that the ownership is singular and visible. Registration returns its
 * own removal, so a surface that unmounts cannot leave a claim behind — which
 * is how a closed menu used to keep eating the key.
 */

export type CancelLayer = "overlay" | "gesture" | "mode" | "air" | "selection";

/** Innermost first. The order IS the policy. */
export const CANCEL_ORDER: readonly CancelLayer[] = [
  "overlay",
  "gesture",
  "mode",
  "air",
  "selection",
];

/**
 * Returns true if it had something to cancel.
 *
 * Returning false is not a failure — it means "nothing of mine is open", and
 * the key falls through to the next layer down.
 */
export type CancelHandler = () => boolean;

interface Claim {
  readonly layer: CancelLayer;
  readonly handler: CancelHandler;
}

const claims = new Set<Claim>();

/**
 * Claims a layer. Call the returned function to give it up.
 *
 * More than one claim per layer is allowed and expected — three different
 * menus are all `overlay`, and only the ones that are actually open will
 * return true.
 */
export function claimEscape(layer: CancelLayer, handler: CancelHandler): () => void {
  const claim: Claim = { layer, handler };
  claims.add(claim);
  return () => {
    claims.delete(claim);
  };
}

/**
 * Runs the ladder. Returns the layer that took the key, or null.
 *
 * Null means nothing anywhere had anything to back out of, which is when
 * Escape should do nothing at all rather than reach for something to close.
 */
export function cancel(): CancelLayer | null {
  for (const layer of CANCEL_ORDER) {
    for (const claim of claims) {
      if (claim.layer !== layer) continue;
      if (claim.handler()) return layer;
    }
  }
  return null;
}

/** Every layer currently claimed. For tests and for the keyboard reference. */
export function claimedLayers(): readonly CancelLayer[] {
  return CANCEL_ORDER.filter((layer) => [...claims].some((claim) => claim.layer === layer));
}

/** Drops every claim. For tests — a leaked claim would poison the next one. */
export function resetEscape(): void {
  claims.clear();
}
