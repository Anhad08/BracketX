/**
 * Animation presets.
 *
 * ============================================================================
 * A PRESET COMPILES TO ORDINARY TRACKS AND THEN STOPS EXISTING
 * ============================================================================
 * "Slide Left" is not a thing the runtime knows about. It is a function from a
 * node to two keyframes, applied once, and after that the document contains a
 * timeline indistinguishable from one somebody keyed by hand.
 *
 * That is the whole design, and the reason for it is concrete: the moment a
 * preset is a runtime concept, the engine has to understand every preset
 * anybody ever writes, presets cannot be edited after they are applied, and the
 * Marketplace becomes a source of code rather than data. Compiling means a
 * preset is a Studio-side authoring convenience and a Marketplace asset is a
 * JSON blob — which is exactly what Phase 10 needs.
 *
 * ============================================================================
 * PRESETS ARE RELATIVE, NOT ABSOLUTE
 * ============================================================================
 * "Slide in from the left" cannot mean "start at x = −8". It has to mean "start
 * one screen-width left of wherever this node actually is, and end where it
 * is". So every preset reads the node's AUTHORED values and animates around
 * them. Applying the same preset to two nodes in different places produces two
 * different timelines, which is what makes it reusable at all.
 *
 * A consequence worth stating: the authored value is the RESTING value. An
 * entrance ends there; an exit begins there. That is why applying an entrance
 * never moves the node — it only describes how it arrives.
 */
import {
  findNode,
  makeSetDocProp,
  type Keyframe,
  type SceneDocument,
  type SceneNode,
  type Timeline,
  type TimelineTrack,
  type Transaction,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";
import type { IdFactory } from "./ids";

export type PresetKind = "entrance" | "exit" | "emphasis";

export interface AnimationPreset {
  readonly id: string;
  readonly label: string;
  readonly kind: PresetKind;
  /** Seconds. The author can scale it after applying; this is a starting point. */
  readonly duration: number;
  readonly hint: string;
  /**
   * Builds the tracks. Returns nothing when the node cannot express the
   * preset — a fade needs something with a colour, and a node without one must
   * produce no tracks rather than a timeline that does nothing.
   */
  readonly build: (node: SceneNode, duration: number) => readonly TimelineTrack[];
}

// ---------------------------------------------------------------------------
// Reading a node's resting values
// ---------------------------------------------------------------------------

function position(node: SceneNode): readonly [number, number, number] {
  const value = node.transform?.position ?? [0, 0, 0];
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function scale(node: SceneNode): readonly [number, number, number] {
  const value = node.transform?.scale ?? [1, 1, 1];
  return [value[0] ?? 1, value[1] ?? 1, value[2] ?? 1];
}

/**
 * The index of the first component carrying a colour, and the property path to
 * it. `null` when the node has none.
 *
 * Rect uses `fill`; a meshRenderer uses `material.baseColor`. Both are hex, and
 * both are what a fade has to move.
 */
function colourPath(node: SceneNode): { path: string; value: string } | null {
  const components = node.components ?? [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    const props = component.props as Record<string, unknown>;
    if (component.type === "rect" && typeof props.fill === "string") {
      return { path: `components.${index}.props.fill`, value: props.fill };
    }
    if (component.type === "meshRenderer") {
      const material = props.material as Record<string, unknown> | undefined;
      if (material !== undefined && typeof material.baseColor === "string") {
        return {
          path: `components.${index}.props.material.baseColor`,
          value: material.baseColor,
        };
      }
    }
  }
  return null;
}

/**
 * The same colour at a different alpha.
 *
 * ========================================================================
 * WHY A FADE IS A COLOUR ANIMATION AND NOT AN OPACITY ONE
 * ========================================================================
 * There is no `opacity` property on a rect, and adding one would be an engine
 * change for an authoring convenience — exactly what the boundary discipline
 * refuses. But SCENE_FORMAT colours are `#RRGGBB` **or `#RRGGBBAA`**, and the
 * engine's `interpolate` already blends hex colours including their alpha.
 *
 * So a fade is expressible today, with zero engine work, by animating the
 * colour between its transparent and opaque forms. Found while writing this
 * file, and it is the difference between "presets need an engine change" and
 * "presets are pure Studio".
 */
export function withAlpha(hex: string, alpha: number): string {
  const body = hex.replace("#", "").slice(0, 6).padEnd(6, "0");
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${body}${byte}`;
}

function track(
  target: string,
  path: string,
  keyframes: readonly Keyframe[],
): TimelineTrack {
  return { target, path, keyframes };
}

/** How far off-screen "off-screen" is. The world is 17.78 x 10 units. */
const OFFSCREEN_X = 12;
const OFFSCREEN_Y = 7;

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

function slide(
  id: string,
  label: string,
  kind: PresetKind,
  axis: 0 | 1,
  distance: number,
): AnimationPreset {
  const path = `transform.position.${axis}`;
  const entrance = kind === "entrance";
  return {
    id,
    label,
    kind,
    duration: 0.6,
    hint: entrance
      ? "Arrives at its authored position from off-screen."
      : "Leaves its authored position for off-screen.",
    build: (node, duration) => {
      const resting = position(node)[axis]!;
      const away = resting + distance;
      return [
        track(node.id, path, [
          {
            time: 0,
            value: entrance ? away : resting,
            // Out-easing on the way in, in-easing on the way out. A graphic
            // that decelerates into place and accelerates out of frame reads
            // as deliberate; the reverse reads as a mistake.
            easing: entrance ? "easeOutCubic" : "easeInCubic",
          },
          { time: duration, value: entrance ? resting : away },
        ]),
      ];
    },
  };
}

function fade(id: string, label: string, kind: PresetKind): AnimationPreset {
  const entrance = kind === "entrance";
  return {
    id,
    label,
    kind,
    duration: 0.4,
    hint: "Animates the node's colour between transparent and opaque.",
    build: (node, duration) => {
      const colour = colourPath(node);
      // No colour, no fade. A timeline with a track that drives nothing is
      // worse than no timeline: it looks applied and does nothing.
      if (colour === null) return [];
      return [
        track(node.id, colour.path, [
          {
            time: 0,
            value: withAlpha(colour.value, entrance ? 0 : 1),
            easing: "easeInOutSine",
          },
          { time: duration, value: withAlpha(colour.value, entrance ? 1 : 0) },
        ]),
      ];
    },
  };
}

function scalePreset(
  id: string,
  label: string,
  kind: PresetKind,
  from: number,
  to: number,
  easing: Keyframe["easing"],
): AnimationPreset {
  return {
    id,
    label,
    kind,
    duration: 0.45,
    hint: "Scales around the node's own origin, which is its centre.",
    build: (node, duration) => {
      const resting = scale(node);
      return ([0, 1] as const).map((axis) =>
        track(node.id, `transform.scale.${axis}`, [
          { time: 0, value: resting[axis]! * from, easing },
          { time: duration, value: resting[axis]! * to },
        ]),
      );
    },
  };
}

/** A preset that returns to where it started. Emphasis never displaces. */
function pulse(
  id: string,
  label: string,
  path: (node: SceneNode) => string,
  offsets: readonly number[],
  base: (node: SceneNode) => number,
  duration: number,
): AnimationPreset {
  return {
    id,
    label,
    kind: "emphasis",
    duration,
    hint: "Returns to the authored value, so it can be looped or repeated.",
    build: (node, span) => {
      const resting = base(node);
      const keyframes: Keyframe[] = offsets.map((offset, index) => ({
        time: (index / (offsets.length - 1)) * span,
        value: resting + offset,
        easing: "easeInOutSine",
      }));
      return [track(node.id, path(node), keyframes)];
    },
  };
}

/**
 * Every preset Studio ships.
 *
 * Deliberately shorter than the phase brief asked for. Blur In, Dissolve and
 * Glow are NOT here, and not because they are hard: the engine has no blur, no
 * dissolve and no bloom. Approximating them with opacity would put a preset in
 * the menu whose name describes something the graphic does not do, and a
 * designer who picks "Glow" and gets a fade has been lied to by the tool. They
 * arrive when the effects do.
 */
export const PRESETS: readonly AnimationPreset[] = [
  // -- Entrance -----------------------------------------------------------
  fade("fade-in", "Fade in", "entrance"),
  slide("slide-in-left", "Slide in from left", "entrance", 0, -OFFSCREEN_X),
  slide("slide-in-right", "Slide in from right", "entrance", 0, OFFSCREEN_X),
  slide("slide-in-up", "Slide in from below", "entrance", 1, -OFFSCREEN_Y),
  slide("slide-in-down", "Slide in from above", "entrance", 1, OFFSCREEN_Y),
  scalePreset("zoom-in", "Zoom in", "entrance", 0.6, 1, "easeOutCubic"),
  // Overshoot is what makes a pop read as a pop rather than a fast zoom.
  scalePreset("pop-in", "Pop in", "entrance", 0.4, 1, "easeOutBack"),

  // -- Exit ---------------------------------------------------------------
  fade("fade-out", "Fade out", "exit"),
  slide("slide-out-left", "Slide out left", "exit", 0, -OFFSCREEN_X),
  slide("slide-out-right", "Slide out right", "exit", 0, OFFSCREEN_X),
  slide("slide-out-up", "Slide out up", "exit", 1, OFFSCREEN_Y),
  slide("slide-out-down", "Slide out down", "exit", 1, -OFFSCREEN_Y),
  scalePreset("collapse", "Collapse", "exit", 1, 0, "easeInCubic"),

  // -- Emphasis -----------------------------------------------------------
  {
    ...pulse(
      "pulse",
      "Pulse",
      () => "transform.scale.0",
      [0, 0.08, 0],
      (node) => scale(node)[0]!,
      0.5,
    ),
    build: (node, span) => {
      const resting = scale(node);
      return ([0, 1] as const).map((axis) =>
        track(node.id, `transform.scale.${axis}`, [
          { time: 0, value: resting[axis]!, easing: "easeInOutSine" },
          { time: span / 2, value: resting[axis]! * 1.08, easing: "easeInOutSine" },
          { time: span, value: resting[axis]! },
        ]),
      );
    },
  },
  pulse(
    "bounce",
    "Bounce",
    () => "transform.position.1",
    [0, 0.35, 0, 0.15, 0],
    (node) => position(node)[1]!,
    0.7,
  ),
  pulse(
    "shake",
    "Shake",
    () => "transform.position.0",
    [0, 0.12, -0.12, 0.08, -0.08, 0],
    (node) => position(node)[0]!,
    0.4,
  ),
];

export function presetById(id: string): AnimationPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface ApplyPresetOptions {
  readonly duration?: number;
  /** Seconds before the preset starts. Becomes a track delay. */
  readonly delay?: number;
  /** Spread across a repeat's instances, when the target is a template. */
  readonly stagger?: { readonly total: number; readonly direction?: "forward" | "reverse" };
  /** Append to this timeline instead of creating one. */
  readonly timelineId?: string;
}

/**
 * Applies a preset to nodes, as one undoable transaction.
 *
 * The result is an ordinary `Timeline` in `document.animations`. Nothing marks
 * it as preset-derived, and that is intentional: the moment a timeline
 * remembers which preset made it, editing it becomes a question of whether the
 * preset still applies, and the answer is a synchronisation problem nobody
 * wants. A preset is a starting point, not a live link.
 */
export function applyPreset(
  document: SceneDocument,
  nodeIds: readonly string[],
  preset: AnimationPreset,
  ids: IdFactory,
  options: ApplyPresetOptions = {},
): Transaction | null {
  const duration = options.duration ?? preset.duration;
  const tracks: TimelineTrack[] = [];

  for (const nodeId of nodeIds) {
    const node = findNode(document.root, nodeId);
    if (node === null) continue;
    for (const built of preset.build(node, duration)) {
      tracks.push({
        ...built,
        ...(options.delay === undefined || options.delay === 0
          ? {}
          : { delay: options.delay }),
        ...(options.stagger === undefined ? {} : { stagger: options.stagger }),
      });
    }
  }
  if (tracks.length === 0) return null;

  const existing = (document.animations ?? []) as readonly Timeline[];
  const index =
    options.timelineId === undefined
      ? -1
      : existing.findIndex((timeline) => timeline.id === options.timelineId);

  if (index >= 0) {
    const target = existing[index]!;
    const merged: Timeline = {
      ...target,
      // The timeline has to be long enough to contain what was just added, or
      // the tail of the new tracks is clamped away and the preset looks broken.
      duration: Math.max(target.duration, duration + (options.delay ?? 0)),
      tracks: [...target.tracks, ...tracks],
    };
    return transaction(`Add ${preset.label}`, [
      makeSetDocProp(document, `animations.${index}`, merged),
    ]);
  }

  const timeline: Timeline = {
    id: ids("timeline"),
    name: preset.label,
    duration: duration + (options.delay ?? 0),
    tracks,
  };
  return transaction(`Add ${preset.label}`, [
    makeSetDocProp(document, "animations", [...existing, timeline]),
  ]);
}
