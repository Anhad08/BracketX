/**
 * Animation values. Phase 6, SCENE_FORMAT §10.
 *
 * ============================================================================
 * WHAT LIVES HERE, AND WHAT LIVES IN timeline.ts
 * ============================================================================
 * This file is the VALUE layer: easing curves, interpolation between two
 * values, and sampling one keyframed track. It knows nothing about timelines,
 * markers, stagger, or playback.
 *
 * `timeline.ts` is the MODEL layer and imports this one. The split is what lets
 * there be exactly one timeline model: a timeline needs to interpolate, but
 * interpolation must not need a timeline, or the two would be circular and the
 * next subsystem would define its own copy of one of them.
 *
 * ============================================================================
 * ANIMATION DESCRIBES HOW STATE CHANGES OVER TIME. IT NEVER OWNS STATE.
 * ============================================================================
 * Everything in this file is a PURE FUNCTION of (clip, time). Nothing here
 * stores a current value, advances a playhead, or remembers a previous frame.
 * Sampling the same clip at the same time yields the same values, always, on
 * every machine.
 *
 * That single rule is what makes the hard things free:
 *
 *   scrubbing        seek the clock, sample — there is no state to unwind
 *   seeking          identical to scrubbing
 *   replay           the same frame sequence reproduces the same output
 *   reverse          sample at (duration - t), or run the clock backwards
 *   multi-output     two outputs at different cadences sample the same clock
 *                    and cannot drift, because neither accumulates
 *   cloud rendering  no warm-up, no settle time, no "play from the start"
 *
 * An evaluator that accumulated per frame would break all six at once, and
 * would break them silently — the failure only shows after minutes of playback.
 *
 * ============================================================================
 * TIME
 * ============================================================================
 * There is ONE clock (ENGINE_RUNTIME §1) and one timeline model above it
 * (Project Alpha A7). Keyframe times are in SECONDS because that is what an
 * author reasons in, and the caller derives the sample time from the clock's
 * frame — so sampling is automatically quantised to frame boundaries, which is
 * the only resolution a renderer can express anyway.
 */
import { round } from "./math";
import { getAtPath } from "./property-path";

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type EasingName =
  | "linear"
  | "step"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack";

/** `[x1, y1, x2, y2]`, the CSS cubic-bezier control points. */
export type CubicBezier = readonly [number, number, number, number];

export type Easing = EasingName | CubicBezier;

const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;

const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  // Holds the previous value until the next keyframe. What a cut is.
  step: () => 0,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,

  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,

  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  easeInBack: (t) => BACK_C3 * t * t * t - BACK_C1 * t * t,
  easeOutBack: (t) =>
    1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2),
  easeInOutBack: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) /
        2,
};

/**
 * Solves a cubic-bezier curve for y at x.
 *
 * Newton-Raphson with a fixed iteration count rather than a convergence
 * threshold: a loop that stops "when close enough" can take a different number
 * of steps on different hardware, and a deterministic engine cannot have that.
 * Eight iterations is well past visual precision for a curve on [0,1].
 */
function cubicBezier(curve: CubicBezier, x: number): number {
  const [x1, y1, x2, y2] = curve;
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const bezier = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const derivative = slope(x1, x2, t);
    if (derivative === 0) break;
    t -= (bezier(x1, x2, t) - x) / derivative;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return bezier(y1, y2, t);
}

export function ease(easing: Easing | undefined, t: number): number {
  if (easing === undefined) return t;
  if (Array.isArray(easing)) return cubicBezier(easing as CubicBezier, t);
  const fn = EASINGS[easing as EasingName];
  return fn === undefined ? t : fn(t);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export interface Keyframe {
  /** Seconds from the timeline's start. */
  readonly time: number;
  readonly value: unknown;
  /** Applied on the segment LEAVING this keyframe. */
  readonly easing?: Easing;
}

/**
 * Anything with keyframes can be sampled.
 *
 * Structural rather than named so `sampleTrack` does not need `TimelineTrack`,
 * which would make this file depend on the model that depends on it.
 */
export interface KeyframedTrack {
  readonly keyframes: readonly Keyframe[];
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/** Sub-micrometre at metre scale. Kills drift in repeated sampling. */
const PRECISION = 6;

const HEX = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3})$/;

function lerp(a: number, b: number, t: number): number {
  return round(a + (b - a) * t, PRECISION);
}

function parseHex(value: string): [number, number, number, number] | null {
  const match = HEX.exec(value.trim());
  if (match === null) return null;
  let body = match[1]!;
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const channel = (index: number) => parseInt(body.slice(index, index + 2), 16);
  return [
    channel(0),
    channel(2),
    channel(4),
    body.length === 8 ? channel(6) : 255,
  ];
}

function toHex(rgba: readonly number[]): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  const alpha = rgba[3] ?? 255;
  const base = `#${part(rgba[0]!)}${part(rgba[1]!)}${part(rgba[2]!)}`;
  return alpha >= 255 ? base : `${base}${part(alpha)}`;
}

/**
 * Interpolates two values of the same shape.
 *
 * Colours interpolate in sRGB space rather than linear. That is deliberate:
 * authors pick colours in sRGB and expect the midpoint of two swatches to look
 * like the swatch they would have picked. Linear interpolation is physically
 * correct and looks wrong to the person who authored it.
 *
 * Anything not numerically interpolable steps at the halfway point rather than
 * throwing — a string or boolean track is a legitimate way to express a cut.
 */
export function interpolate(from: unknown, to: unknown, t: number): unknown {
  if (t <= 0) return from;
  if (t >= 1) return to;

  if (typeof from === "number" && typeof to === "number") {
    return lerp(from, to, t);
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    const length = Math.min(from.length, to.length);
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) {
      const a = from[i];
      const b = to[i];
      out.push(
        typeof a === "number" && typeof b === "number" ? lerp(a, b, t) : a,
      );
    }
    return out;
  }

  if (typeof from === "string" && typeof to === "string") {
    const a = parseHex(from);
    const b = parseHex(to);
    if (a !== null && b !== null) {
      return toHex([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
      ]);
    }
  }

  return t < 0.5 ? from : to;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Value of one track at a time.
 *
 * ASSUMES KEYFRAMES ARE SORTED. Call `normalizeTimeline` once at load; do not sort
 * here. An earlier version checked sortedness defensively on every sample,
 * which is O(keyframes) and defeated the binary search below entirely —
 * measured at 22x for 100x the keyframes where log would be ~7x. Sorting is a
 * load-time concern, exactly as font parsing is.
 */
export function sampleTrack(track: KeyframedTrack, seconds: number): unknown {
  const sorted = track.keyframes;
  if (sorted.length === 0) return undefined;
  if (sorted.length === 1) return sorted[0]!.value;

  if (seconds <= sorted[0]!.time) return sorted[0]!.value;
  const last = sorted[sorted.length - 1]!;
  if (seconds >= last.time) return last.value;

  // Binary search. A 10-second clip at 60fps with a keyframe every frame is
  // 600 keyframes; a linear scan per track per frame is the kind of cost that
  // only shows up once a show is long.
  let low = 0;
  let high = sorted.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (sorted[middle]!.time <= seconds) low = middle;
    else high = middle;
  }

  const a = sorted[low]!;
  const b = sorted[high]!;
  const span = b.time - a.time;
  if (span <= 0) return b.value;

  const raw = (seconds - a.time) / span;
  return interpolate(a.value, b.value, ease(a.easing, raw));
}

/** Reads a node's current value at a track's path. For authoring tools. */
export function valueAtPath(node: unknown, path: string): unknown {
  return getAtPath(node, path);
}
