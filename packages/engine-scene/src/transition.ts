/**
 * Declared state transitions. Phase 6 R3, SCENE_FORMAT §10.4.
 *
 * ============================================================================
 * A STATE TRANSITION IS A TIMELINE. IT IS NOT A SECOND ANIMATION SYSTEM.
 * ============================================================================
 * Before this existed, a state change was an instantaneous swap: `warning`
 * became `success` on one frame with no motion between. States named things;
 * they could not move.
 *
 * The obvious implementation is a transition engine — a thing that watches state
 * changes and tweens properties. That would be a second timeline, with a second
 * playhead, and the two would disagree about what time it is. So instead a
 * transition is COMPILED to a `Timeline` and handed to the same player that runs
 * animation clips. There is one playhead, one seek, one replay, and Studio's
 * timeline can show a transition on the same ruler as a clip because it is the
 * same object.
 *
 * The compiler is a pure function of (document, from-states, to-states,
 * resolution). Nothing here reads a clock or holds a value.
 */
import type { Easing } from "./animation";
import { applyStates } from "./compose";
import { getAtPath } from "./property-path";
import type { Timeline, TimelineStagger, TimelineTrack } from "./timeline";
import type { SceneDocument, SceneNode, NodeStateOverride } from "./types";

/**
 * How to move between two named states.
 *
 * `from` and `to` are state NAMES, or `"*"` for any. The engine assigns no
 * meaning to any name: `hidden → visible`, `warning → success` and
 * `idle → active` are all equally ordinary, and `in`/`idle`/`out` is a
 * convention of a broadcast pack rather than a rule of the engine.
 */
export interface StateTransition {
  readonly id: string;
  /** State being left, or `"*"`. */
  readonly from: string;
  /** State being entered, or `"*"`. */
  readonly to: string;
  /** Seconds. Zero means the change is instant, which is the old behaviour. */
  readonly duration: number;
  readonly easing?: Easing;
  /** Seconds to wait before moving. */
  readonly delay?: number;
  /** Spreads the transition across a repeat's instances. */
  readonly stagger?: TimelineStagger;
}

export interface TransitionResolution {
  /** The transition that matched, or null when only a state default applied. */
  readonly transition: StateTransition | null;
  readonly duration: number;
  readonly easing?: Easing;
  readonly delay?: number;
  readonly stagger?: TimelineStagger;
  /** Why this resolution won. Diagnostics — the workbench displays it. */
  readonly reason: "declared" | "state-default";
}

/**
 * Picks the transition for a state change.
 *
 * Two sources, in order:
 *
 *  1. A declared `StateTransition` whose `from` was active and is not any more,
 *     and whose `to` is now active. `"*"` matches anything.
 *  2. The `duration` declared on the state being ENTERED — which is what
 *     `SceneState.duration` has meant in SCENE_FORMAT since §10 was written,
 *     and which nothing read until now.
 *
 * First match in document order wins. Ordering rather than specificity scoring,
 * because an author who writes two overlapping rules can reorder them and see
 * the result, whereas a scoring rule has to be reverse-engineered.
 *
 * Returns null when nothing applies, and null means instant — the behaviour
 * every existing scene already has.
 */
export function resolveTransition(
  document: SceneDocument,
  fromStates: readonly string[],
  toStates: readonly string[],
): TransitionResolution | null {
  const before = new Set(fromStates);
  const after = new Set(toStates);

  const entering = toStates.filter((state) => !before.has(state));
  const leaving = fromStates.filter((state) => !after.has(state));
  if (entering.length === 0 && leaving.length === 0) return null;

  for (const transition of document.transitions ?? []) {
    const fromMatches =
      transition.from === "*" ||
      leaving.includes(transition.from) ||
      // A transition INTO a state from nothing is written `from: "*"`, but an
      // author who writes the previous state name should also match when that
      // state is still active — `idle → active` with both held is a real case.
      before.has(transition.from);
    const toMatches = transition.to === "*" || entering.includes(transition.to);

    if (!fromMatches || !toMatches) continue;
    if (!Number.isFinite(transition.duration) || transition.duration <= 0) {
      // An explicitly zero-duration rule is a deliberate cut, and it must beat
      // a state default rather than falling through to it.
      return null;
    }
    return {
      transition,
      duration: transition.duration,
      ...(transition.easing === undefined ? {} : { easing: transition.easing }),
      ...(transition.delay === undefined ? {} : { delay: transition.delay }),
      ...(transition.stagger === undefined ? {} : { stagger: transition.stagger }),
      reason: "declared",
    };
  }

  for (const name of entering) {
    const declared = (document.states ?? []).find((state) => state.name === name);
    if (declared === undefined) continue;
    if (!Number.isFinite(declared.duration) || declared.duration <= 0) continue;
    return {
      transition: null,
      duration: declared.duration,
      reason: "state-default",
    };
  }

  return null;
}

/**
 * Property paths a state override can reach.
 *
 * Derived from the override's own shape rather than from a fixed list of
 * "animatable properties": the override declares exactly what the state
 * changes, so anything else is by definition unchanged and diffing it would be
 * work with a guaranteed empty result.
 */
export const ANIMATABLE_STATE_PATHS = {
  transform: [
    "transform.position.0",
    "transform.position.1",
    "transform.position.2",
    "transform.rotation.0",
    "transform.rotation.1",
    "transform.rotation.2",
    "transform.scale.0",
    "transform.scale.1",
    "transform.scale.2",
  ],
  size: ["size.width", "size.height"],
  visible: ["visible"],
} as const;

function pathsFor(node: SceneNode, override: NodeStateOverride): string[] {
  const paths: string[] = [];
  if (override.transform !== undefined) paths.push(...ANIMATABLE_STATE_PATHS.transform);
  if (override.size !== undefined) paths.push(...ANIMATABLE_STATE_PATHS.size);
  if (override.visible !== undefined) paths.push(...ANIMATABLE_STATE_PATHS.visible);

  for (const [componentId, props] of Object.entries(override.props ?? {})) {
    const index = (node.components ?? []).findIndex(
      (component) => component.id === componentId,
    );
    if (index < 0) continue;
    for (const key of Object.keys(props)) {
      paths.push(`components.${index}.props.${key}`);
    }
  }
  return paths;
}

/** Every path any of a node's declared states can reach. */
function candidatePaths(node: SceneNode): readonly string[] {
  const declared = node.states;
  if (declared === undefined) return [];
  const paths = new Set<string>();
  for (const override of Object.values(declared)) {
    for (const path of pathsFor(node, override)) paths.add(path);
  }
  return [...paths];
}

/**
 * Builds the keyframes for one property.
 *
 * Three cases, and the boolean one is the one that matters in practice:
 *
 *   numeric / colour   interpolates, using the transition's easing
 *   boolean            holds `from || to` and steps at the END
 *   anything else      holds `from` and steps at the END
 *
 * Stepping at the end rather than the midpoint is what makes an out-transition
 * work: a node going `visible: true → false` must stay visible for the whole
 * animation and disappear when it finishes, not blink out halfway through it.
 * And `from || to` covers the other direction — a node becoming visible must be
 * visible from the first frame, or its entrance animates something nobody sees.
 */
function keyframesFor(
  from: unknown,
  to: unknown,
  duration: number,
  easing: Easing | undefined,
): readonly { time: number; value: unknown; easing?: Easing }[] {
  if (typeof from === "boolean" || typeof to === "boolean") {
    return [
      { time: 0, value: from === true || to === true, easing: "step" },
      { time: duration, value: to },
    ];
  }

  const interpolable =
    (typeof from === "number" && typeof to === "number") ||
    (typeof from === "string" && typeof to === "string" && from.startsWith("#")) ||
    (Array.isArray(from) && Array.isArray(to));

  if (!interpolable) {
    return [
      { time: 0, value: from, easing: "step" },
      { time: duration, value: to },
    ];
  }

  return [
    { time: 0, value: from, ...(easing === undefined ? {} : { easing }) },
    { time: duration, value: to },
  ];
}

/**
 * Compiles a state change into a timeline.
 *
 * Walks the document once, resolves each node under both state sets, and emits
 * a two-keyframe track for every property that differs. Returns null when
 * nothing moved — a state change that alters no property must not create an
 * empty timeline for the player to run.
 *
 * Iterative, not recursive: R-001 logged the engine's traversal-depth ceiling,
 * and a transition that overflowed on a deep document would fail at the moment
 * a graphic goes on air.
 */
export function compileStateTransition(
  document: SceneDocument,
  fromStates: readonly string[],
  toStates: readonly string[],
  resolution: TransitionResolution,
  id = "transition",
): Timeline | null {
  const tracks: TimelineTrack[] = [];
  const stack: SceneNode[] = [document.root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.children ?? []) stack.push(child);
    if (node.states === undefined) continue;

    const before = applyStates(node, fromStates);
    const after = applyStates(node, toStates);
    // `applyStates` returns the SAME object when nothing applies, so reference
    // equality is an exact "this node is unaffected" test.
    if (before === after) continue;

    for (const path of candidatePaths(node)) {
      const a = getAtPath(before, path);
      const b = getAtPath(after, path);
      if (Object.is(a, b)) continue;
      if (a === undefined || b === undefined) continue;

      tracks.push({
        target: node.id,
        path,
        keyframes: keyframesFor(a, b, resolution.duration, resolution.easing),
        ...(resolution.delay === undefined ? {} : { delay: resolution.delay }),
        ...(resolution.stagger === undefined ? {} : { stagger: resolution.stagger }),
      });
    }
  }

  if (tracks.length === 0) return null;

  return {
    id,
    name:
      resolution.transition === null
        ? `${fromStates.join("+") || "∅"} → ${toStates.join("+") || "∅"}`
        : resolution.transition.id,
    duration: resolution.duration,
    tracks,
  };
}
