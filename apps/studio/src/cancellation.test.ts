/**
 * The Escape ladder.
 *
 * Escape was claimed in six places with six listeners, three in capture phase
 * so they could win. Whichever mounted last took the key, which is why closing
 * a context menu also deselected, and why the fix for that — swallowing the
 * key — then broke Escape for everything behind it.
 *
 * These tests are about ORDER and EXCLUSIVITY: exactly one layer takes the
 * key, and it is the innermost one that has anything to give up.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  CANCEL_ORDER,
  cancel,
  claimEscape,
  claimedLayers,
  resetEscape,
} from "./studio/cancellation";

beforeEach(() => {
  resetEscape();
});

describe("the ladder", () => {
  it("runs innermost first", () => {
    expect(CANCEL_ORDER).toEqual(["overlay", "gesture", "mode", "air", "selection"]);
  });

  it("gives the key to the innermost layer that has something to cancel", () => {
    const taken: string[] = [];
    claimEscape("selection", () => {
      taken.push("selection");
      return true;
    });
    claimEscape("overlay", () => {
      taken.push("overlay");
      return true;
    });

    expect(cancel()).toBe("overlay");
    // AND NOTHING ELSE RAN. A menu closing and the selection clearing on one
    // press is the exact bug this replaces.
    expect(taken).toEqual(["overlay"]);
  });

  it("falls through a layer that has nothing open", () => {
    const taken: string[] = [];
    claimEscape("overlay", () => false); // A menu that is not open.
    claimEscape("gesture", () => {
      taken.push("gesture");
      return true;
    });

    expect(cancel()).toBe("gesture");
    expect(taken).toEqual(["gesture"]);
  });

  it("does nothing when nothing anywhere is open", () => {
    claimEscape("overlay", () => false);
    claimEscape("selection", () => false);
    // Null rather than "close something": Escape with nothing to back out of
    // should not reach for the nearest closable thing.
    expect(cancel()).toBeNull();
  });

  it("lets several surfaces share a layer, and asks each one", () => {
    // Three menus are all overlays; only the open one answers.
    let asked = 0;
    claimEscape("overlay", () => {
      asked += 1;
      return false;
    });
    claimEscape("overlay", () => {
      asked += 1;
      return false;
    });
    claimEscape("overlay", () => {
      asked += 1;
      return true;
    });

    expect(cancel()).toBe("overlay");
    expect(asked).toBe(3);
  });

  /**
   * THE ONE THAT MATTERS MOST.
   *
   * A drag in flight outranks walk mode, a cued output and the selection. If
   * Escape reached past it, the gesture would be left half-applied — the
   * object dropped wherever the pointer was, with no way back but undo.
   */
  it("cancels a gesture before a mode, an armed output or the selection", () => {
    const order: string[] = [];
    for (const layer of ["selection", "air", "mode", "gesture"] as const) {
      claimEscape(layer, () => {
        order.push(layer);
        return true;
      });
    }
    expect(cancel()).toBe("gesture");
    expect(order).toEqual(["gesture"]);
  });

  it("un-cues before it deselects", () => {
    // Un-cueing has consequences outside the editor; a selection is cheap to
    // rebuild. Two presses should disarm first and clear second.
    let cued = true;
    let selected = true;
    claimEscape("air", () => {
      if (!cued) return false;
      cued = false;
      return true;
    });
    claimEscape("selection", () => {
      if (!selected) return false;
      selected = false;
      return true;
    });

    expect(cancel()).toBe("air");
    expect(cued).toBe(false);
    expect(selected).toBe(true);

    expect(cancel()).toBe("selection");
    expect(selected).toBe(false);
  });
});

describe("claims are given up", () => {
  it("stops asking a surface that unmounted", () => {
    let asked = 0;
    const release = claimEscape("overlay", () => {
      asked += 1;
      return true;
    });

    expect(cancel()).toBe("overlay");
    release();

    // A closed menu that kept its claim is how Escape came to be eaten by
    // something no longer on screen.
    expect(cancel()).toBeNull();
    expect(asked).toBe(1);
  });

  it("reports which layers are claimed at all", () => {
    claimEscape("overlay", () => false);
    claimEscape("air", () => false);
    expect(claimedLayers()).toEqual(["overlay", "air"]);
  });
});
