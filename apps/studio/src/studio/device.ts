/**
 * What kind of machine this is, and what the interface should therefore offer.
 *
 * ==========================================================================
 * THE HONEST POSITION
 * ==========================================================================
 * A resize handle is eight pixels. A fingertip is about forty-four. Those two
 * numbers do not reconcile, and pretending otherwise produces an authoring
 * interface that technically runs on a phone and cannot actually be used on
 * one — which is worse than not offering it, because the failure is silent and
 * the user assumes they are holding it wrong.
 *
 * So the product does different things on different machines, deliberately:
 *
 *   phone / small tablet   view and OPERATE. Home, Marketplace, Assets,
 *                          content editing, cue and take. The stage can be
 *                          looked at and navigated, not authored in.
 *   large tablet / laptop  everything, with touch-sized controls where the
 *                          pointer is coarse.
 *   desktop                everything.
 *
 * This is a capability decision, not a screen-width one: a laptop with a touch
 * screen still authors, and a 1024px window on a desktop is still a desktop.
 * Width alone would demote a designer who narrowed their window.
 */

export type DeviceClass = "phone" | "tablet" | "laptop" | "desktop";

export interface DeviceInput {
  readonly width: number;
  readonly height: number;
  /**
   * True when the primary pointer is a finger.
   *
   * From `pointer: coarse`, not from a user-agent string. Sniffing the agent
   * is how a product ends up serving the phone layout to a laptop because a
   * browser changed its version string.
   */
  readonly coarsePointer: boolean;
  /** `navigator.hardwareConcurrency`, when the browser reports it. */
  readonly cores?: number;
  /** `navigator.deviceMemory` in GB, when the browser reports it. */
  readonly memoryGb?: number;
}

export interface DeviceProfile {
  readonly deviceClass: DeviceClass;
  /** The stage accepts authoring gestures: gizmos, marquee, axis drags. */
  readonly canAuthor: boolean;
  /** Side and bottom docks are available at all. */
  readonly canDock: boolean;
  /** Controls are grown to a finger-sized target. */
  readonly touchTargets: boolean;
  /** Why the interface looks like this. Shown to the user, never inferred. */
  readonly reason: string;
}

/** Below this width a dock leaves no usable stage, whatever the device is. */
const DOCK_MINIMUM = 900;

export function classify(input: DeviceInput): DeviceClass {
  const shortest = Math.min(input.width, input.height);
  const longest = Math.max(input.width, input.height);

  if (input.coarsePointer) {
    // Touch-first. The short edge is what decides, because a phone in
    // landscape is still a phone and its long edge would say otherwise.
    if (shortest < 600) return "phone";
    return "tablet";
  }
  // Mouse or trackpad. Small windows are still desktops — a designer who
  // narrowed their window has not changed machine.
  return longest < 1280 ? "laptop" : "desktop";
}

export function profileFor(input: DeviceInput): DeviceProfile {
  const deviceClass = classify(input);

  if (deviceClass === "phone") {
    return {
      deviceClass,
      canAuthor: false,
      canDock: false,
      touchTargets: true,
      reason: "On a phone, Streamatrix edits content and goes to air. Design on a larger screen.",
    };
  }

  if (deviceClass === "tablet") {
    // A large tablet is a real authoring machine; a small one is not. The
    // line is drawn where a dock still leaves a usable stage.
    //
    // WIDTH, not the longer edge: docks are on the left and the right, so a
    // portrait tablet 744 wide and 1133 tall has no room for them however
    // tall it is. Measuring the long edge claimed it did.
    const roomy = input.width >= DOCK_MINIMUM;
    return {
      deviceClass,
      canAuthor: roomy,
      canDock: roomy,
      touchTargets: true,
      reason: roomy
        ? "Controls are sized for touch."
        : "This screen edits content and goes to air. Design on a larger screen.",
    };
  }

  return {
    deviceClass,
    canAuthor: true,
    canDock: input.width >= DOCK_MINIMUM,
    touchTargets: false,
    reason:
      input.width >= DOCK_MINIMUM
        ? "Full authoring."
        : "The window is too narrow for the panels. Widen it to design.",
  };
}

/**
 * Reads the device from the browser.
 *
 * Every value is optional in some browser somewhere, so each has a defined
 * fallback and none of them throws. A missing `deviceMemory` must not be the
 * reason a designer is served the phone layout.
 */
export function readDevice(): DeviceInput {
  const coarse =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
    coarsePointer: coarse,
    ...(typeof nav?.hardwareConcurrency === "number"
      ? { cores: nav.hardwareConcurrency }
      : {}),
    ...(typeof (nav as { deviceMemory?: number } | undefined)?.deviceMemory === "number"
      ? { memoryGb: (nav as unknown as { deviceMemory: number }).deviceMemory }
      : {}),
  };
}
