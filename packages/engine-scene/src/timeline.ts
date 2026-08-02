/**
 * The timeline. Phase 6 R1, SCENE_FORMAT §10.
 *
 * ============================================================================
 * THERE IS EXACTLY ONE TIMELINE MODEL IN BRACKETX, AND IT IS THIS ONE
 * ============================================================================
 * An animation clip is a timeline. A state transition compiles to a timeline.
 * A cue sequence (Phase 9) will be a timeline. The Studio timeline editor binds
 * to this interface. Replay samples it.
 *
 * They are not five similar things; they are five READERS of one thing. That is
 * a deliberate constraint, and the reason for it is concrete: two timelines
 * means two playhead calculations, and two playhead calculations disagree. The
 * disagreement shows up as a cue firing one frame late in a show, which is the
 * class of bug nobody can reproduce.
 *
 * A timeline is three things and nothing else:
 *
 *   duration   how long it is
 *   tracks     what it drives, keyed by node and property path
 *   markers    ordered, addressable positions with typed payloads
 *
 * A timeline with no tracks is a pure cue list. A timeline with no markers is a
 * pure animation. Phase 9 adds marker KINDS and a reader; it adds no model.
 *
 * ============================================================================
 * PURITY
 * ============================================================================
 * Everything here is a pure function of (timeline, time). Nothing stores a
 * current value, advances a playhead, or remembers a previous frame. That single
 * rule is what makes scrubbing, seeking, replay, reverse, multi-output and
 * late-join all free rather than each needing a special case — an evaluator that
 * accumulated per frame would break all six at once, silently, and only after a
 * show had been running for an hour.
 */
import { ease, interpolate, sampleTrack, type Keyframe } from "./animation";

// ---------------------------------------------------------------------------
// Markers — ordered addressable positions with typed payloads
// ---------------------------------------------------------------------------

/**
 * A position on a timeline.
 *
 * `kind` is a free-form string and the engine assigns meaning to none of them.
 * That is the same decision `LiveCommandRecord.source` made and for the same
 * reason: an engine that enumerates its readers needs extending for every new
 * one, which is exactly the coupling this model exists to avoid. Phase 9 will
 * write `kind: "cue"`; nothing here needs to know.
 */
export interface TimelineMarker {
  /** Addressable. Unique within the timeline. */
  readonly id: string;
  /** Seconds from the timeline's start. */
  readonly time: number;
  /** Typed. `"event"` is what animation emits; Phase 9 adds its own. */
  readonly kind: string;
  readonly payload?: unknown;
}

/** What an animation event is. Reserved so two subsystems cannot collide. */
export const MARKER_EVENT = "event";
/** Reserved for Phase 9. Declared now so adding it is not a model change. */
export const MARKER_CUE = "cue";

// ---------------------------------------------------------------------------
// Stagger
// ---------------------------------------------------------------------------

export type StaggerDirection = "forward" | "reverse" | "center" | "edges";

/**
 * Spreads a track across the instances of a repeat.
 *
 * ========================================================================
 * WHY THIS IS A TIMELINE CONCERN AND NOT AN APPLICATION ONE
 * ========================================================================
 * A staggered reveal — rows appearing a few hundredths of a second apart — is
 * the most common animation in broadcast graphics. Before this existed the only
 * way to express one was a clip per row with hand-offset keyframes, and that is
 * impossible for a collection, because a collection's instance ids do not exist
 * until the data resolves. So a staggered reveal over live data was not
 * expressible at all, and every consumer would have written the same
 * application-side loop.
 *
 * `interval` is per instance. `total` overrides it with a fixed overall spread,
 * which is what data-driven content actually wants: "reveal over 0.6 seconds"
 * holds whether eight rows arrive or eighty.
 */
export interface TimelineStagger {
  /** Seconds between successive instances. Ignored when `total` is set. */
  readonly interval?: number;
  /** Total spread across all instances. The interval is derived to fit. */
  readonly total?: number;
  /** Defaults to `forward`. */
  readonly direction?: StaggerDirection;
}

/**
 * Seconds instance `index` of `count` is offset by.
 *
 * Pure and total: a count of one is offset zero in every direction, and a
 * missing interval is zero rather than NaN.
 */
export function staggerOffset(
  stagger: TimelineStagger,
  index: number,
  count: number,
): number {
  if (count <= 1 || index < 0) return 0;

  const span = count - 1;
  const interval =
    stagger.total !== undefined && Number.isFinite(stagger.total)
      ? stagger.total / span
      : (stagger.interval ?? 0);
  if (!Number.isFinite(interval) || interval === 0) return 0;

  const middle = span / 2;
  switch (stagger.direction ?? "forward") {
    case "reverse":
      return (span - index) * interval;
    // Outermost first, meeting in the middle. Reads as a collapse.
    case "center":
      return Math.abs(index - middle) * interval;
    // Middle first, spreading outwards. Reads as an expansion.
    case "edges":
      return (middle - Math.abs(index - middle)) * interval;
    case "forward":
    default:
      return index * interval;
  }
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface TimelineTrack {
  /**
   * Node the track drives.
   *
   * With `stagger`, this is the TEMPLATE id of a repeat and the track fans out
   * across its instances. Without it, the node itself.
   */
  readonly target: string;
  /** Dot path within the node, e.g. `transform.position.1`. */
  readonly path: string;
  /** Ascending by time. Guaranteed by `normalizeTimeline` at load. */
  readonly keyframes: readonly Keyframe[];
  /** Seconds this track waits before it starts. */
  readonly delay?: number;
  /** Spreads the track across a repeat's instances. */
  readonly stagger?: TimelineStagger;
}

export interface Timeline {
  readonly id: string;
  readonly name: string;
  /** Seconds. Sampling past it clamps, or wraps when `loop` is set. */
  readonly duration: number;
  readonly loop?: boolean;
  readonly tracks: readonly TimelineTrack[];
  /** Ordered addressable positions. Normalised from `events` at load. */
  readonly markers?: readonly TimelineMarker[];
  /**
   * The authored form of animation events.
   *
   * Kept because documents in the wild carry it and SCENE_FORMAT §13 rule 4
   * makes removing a field a version bump. `normalizeTimeline` folds these into
   * `markers` at load, and **nothing at runtime reads this field** — there is
   * one representation once a document is loaded, which is the point.
   */
  readonly events?: readonly { time: number; name: string; payload?: unknown }[];
}

/**
 * An animation clip IS a timeline.
 *
 * An alias, not a subtype. If it were a subtype there would be two models the
 * day someone added a field to one of them.
 */
export type AnimationClip = Timeline;
export type AnimationTrack = TimelineTrack;
/** The legacy shape of an animation event. A marker of kind `"event"`. */
export interface AnimationEvent {
  readonly time: number;
  readonly name: string;
  readonly payload?: unknown;
}

/** Values a timeline produced, by node then by path. */
export type AnimatedValues = ReadonlyMap<string, ReadonlyMap<string, unknown>>;

// ---------------------------------------------------------------------------
// The cursor — the one playhead calculation
// ---------------------------------------------------------------------------

/**
 * Where a reader is on a timeline.
 *
 * ========================================================================
 * ONE PLAYHEAD CALCULATION, USED BY EVERY READER
 * ========================================================================
 * The playhead is NOT stored. It is `(frame - startFrame) * speed / rate`,
 * recomputed from the runtime clock every sample. ENGINE_RUNTIME's delta-time
 * prohibition applies here directly: a playhead advanced by per-frame deltas
 * drifts, and the drift is invisible until a show has been running for an hour.
 *
 * The animator, the transition driver, Phase 9's sequencer and Studio all
 * derive their position through `cursorSeconds`. That is what "one timeline"
 * means operationally — not that they share an interface, but that they cannot
 * disagree about what time it is.
 */
export interface TimelineCursor {
  readonly timelineId: string;
  /** Frame the timeline is anchored to. */
  readonly startFrame: number;
  /** Negative runs it backwards. Zero is refused by callers. */
  readonly speed: number;
  readonly loop: boolean;
}

/** Seconds into a timeline at a frame. Never accumulated. */
export function cursorSeconds(
  cursor: Pick<TimelineCursor, "startFrame" | "speed">,
  frame: number,
  rate: number,
): number {
  if (rate === 0) return 0;
  return ((frame - cursor.startFrame) * cursor.speed) / rate;
}

/** The frame a timeline position maps back to. The inverse of `cursorSeconds`. */
export function frameForSeconds(
  cursor: Pick<TimelineCursor, "startFrame" | "speed">,
  seconds: number,
  rate: number,
): number {
  if (cursor.speed === 0) return cursor.startFrame;
  return cursor.startFrame + (seconds * rate) / cursor.speed;
}

/** Normalises a time into the timeline, honouring `loop`. */
export function timelineTime(timeline: Timeline, seconds: number): number {
  if (timeline.duration <= 0) return 0;
  if (timeline.loop !== true) {
    return seconds < 0
      ? 0
      : seconds > timeline.duration
        ? timeline.duration
        : seconds;
  }
  // Positive modulo, so a clock running backwards wraps rather than going
  // negative and sampling before the first keyframe forever.
  const wrapped = seconds % timeline.duration;
  return wrapped < 0 ? wrapped + timeline.duration : wrapped;
}

/** Kept as the animation-facing name. Same function, one implementation. */
export const clipTime = timelineTime;

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface SampleOptions {
  /**
   * Ordered instance ids for a repeat template, for staggered tracks.
   *
   * Injected rather than looked up, because instances live in the mirror and
   * this package must not know the mirror exists. The host supplies it; a
   * headless caller can supply a literal map.
   */
  readonly instancesOf?: (templateId: string) => readonly string[];
}

/**
 * Samples a whole timeline.
 *
 * Pure. Returns only the paths the timeline drives, so a caller can apply
 * exactly those and leave everything else to the document.
 *
 * A staggered track fans out across the template's instances, each sampled at
 * its own offset. Identity is untouched: this shifts sample TIME, never a node
 * id, so a staggered reveal cannot churn the mirror.
 */
export function sampleTimeline(
  timeline: Timeline,
  seconds: number,
  options: SampleOptions = {},
): AnimatedValues {
  // Clamped to the SPAN, not the duration.
  //
  // A staggered track is still moving after the nominal duration, so clamping
  // at `duration` freezes the tail of every reveal part-way through — the last
  // row would stop where it started and stay there. A LOOPING timeline still
  // wraps on its duration, because that is what the author asked for; a loop
  // whose stagger outruns its duration is an authoring error, not a sampling
  // one.
  const local =
    timeline.loop === true
      ? timelineTime(timeline, seconds)
      : clampToSpan(timeline, seconds, options);
  const byNode = new Map<string, Map<string, unknown>>();

  const write = (nodeId: string, path: string, value: unknown): void => {
    let paths = byNode.get(nodeId);
    if (paths === undefined) {
      paths = new Map();
      byNode.set(nodeId, paths);
    }
    // Later tracks on the same path win, which makes track order the author's
    // precedence control rather than an accident of iteration.
    paths.set(path, value);
  };

  for (const track of timeline.tracks) {
    const delay = track.delay ?? 0;

    if (track.stagger === undefined) {
      const value = sampleTrack(track, local - delay);
      if (value !== undefined) write(track.target, track.path, value);
      continue;
    }

    const instances = options.instancesOf?.(track.target) ?? [];
    if (instances.length === 0) {
      // No instances resolved — the target is an ordinary node and the stagger
      // is inert. Silently dropping the track instead would make a scene that
      // has not loaded its collection yet look like a broken animation.
      const value = sampleTrack(track, local - delay);
      if (value !== undefined) write(track.target, track.path, value);
      continue;
    }

    for (let index = 0; index < instances.length; index += 1) {
      const offset = staggerOffset(track.stagger, index, instances.length);
      const value = sampleTrack(track, local - delay - offset);
      if (value !== undefined) write(instances[index]!, track.path, value);
    }
  }

  return byNode;
}

/** Kept as the animation-facing name. Same function, one implementation. */
export const sampleClip = sampleTimeline;

function clampToSpan(
  timeline: Timeline,
  seconds: number,
  options: SampleOptions,
): number {
  if (seconds <= 0) return 0;
  const instancesOf = options.instancesOf;
  const span =
    instancesOf === undefined
      ? timeline.duration
      : timelineSpan(timeline, (templateId) => instancesOf(templateId).length);
  return seconds > span ? span : seconds;
}

/**
 * The time at which a timeline is truly finished.
 *
 * A staggered track is still moving after the timeline's nominal duration: the
 * last instance starts `offset` late and takes as long as the track does. A
 * timeline that completed at `duration` would freeze the tail of every
 * staggered reveal part-way, which is the bug this function exists to prevent.
 */
export function timelineSpan(
  timeline: Timeline,
  instanceCount: (templateId: string) => number = () => 0,
): number {
  let span = timeline.duration;
  for (const track of timeline.tracks) {
    const delay = track.delay ?? 0;
    const stagger =
      track.stagger === undefined
        ? 0
        : staggerMax(track.stagger, instanceCount(track.target));
    const last = track.keyframes[track.keyframes.length - 1]?.time ?? 0;
    const end = delay + stagger + last;
    if (end > span) span = end;
  }
  return span;
}

/**
 * The largest offset a stagger produces. Closed form, not a loop.
 *
 * `timelineSpan` is on the sampled path — it decides where a non-looping
 * timeline clamps — so an O(instances) maximum here would make every sample
 * O(collection), which is the cost class the whole engine is built to avoid.
 */
function staggerMax(stagger: TimelineStagger, count: number): number {
  if (count <= 1) return 0;
  const span = count - 1;
  const interval =
    stagger.total !== undefined && Number.isFinite(stagger.total)
      ? stagger.total / span
      : (stagger.interval ?? 0);
  if (!Number.isFinite(interval) || interval <= 0) return 0;

  // forward and reverse reach the full span; center and edges both peak at the
  // midpoint distance — center at the two ends, edges in the middle.
  const direction = stagger.direction ?? "forward";
  return direction === "center" || direction === "edges"
    ? (span / 2) * interval
    : span * interval;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * Markers the playhead crossed moving from `previous` to `current`.
 *
 * Fires on ADVANCE only. A seek or a scrub crosses arbitrarily many markers at
 * once, and firing them would mean dragging a timeline slider triggers every cue
 * in a show — exactly the accident that takes a graphic on air during rehearsal.
 * Playback fires; seeking does not, and the caller says which it is doing.
 *
 * Half-open interval `(previous, current]`, so a marker exactly at the current
 * time fires once and never twice.
 *
 * `kind` filters, which is how two readers share one timeline without seeing
 * each other's positions: the animator asks for `"event"`, Phase 9 for `"cue"`.
 */
export function crossedMarkers(
  timeline: Timeline,
  previousSeconds: number,
  currentSeconds: number,
  kind?: string,
): readonly TimelineMarker[] {
  const markers = timeline.markers;
  if (markers === undefined || markers.length === 0) return [];
  if (currentSeconds === previousSeconds) return [];

  const forward = currentSeconds > previousSeconds;
  const low = forward ? previousSeconds : currentSeconds;
  const high = forward ? currentSeconds : previousSeconds;

  const crossed = markers.filter(
    (marker) =>
      marker.time > low &&
      marker.time <= high &&
      (kind === undefined || marker.kind === kind),
  );
  // Chronological in the direction of travel, so a handler sees them in the
  // order they happened rather than in document order.
  return forward
    ? [...crossed].sort((a, b) => a.time - b.time)
    : [...crossed].sort((a, b) => b.time - a.time);
}

/** Animation's view of `crossedMarkers`. */
export function crossedEvents(
  timeline: Timeline,
  previousSeconds: number,
  currentSeconds: number,
): readonly AnimationEvent[] {
  return crossedMarkers(
    timeline,
    previousSeconds,
    currentSeconds,
    MARKER_EVENT,
  ).map((marker) => ({
    time: marker.time,
    name: marker.id,
    ...(marker.payload === undefined ? {} : { payload: marker.payload }),
  }));
}

// ---------------------------------------------------------------------------
// Load-time normalisation
// ---------------------------------------------------------------------------

function isSorted(items: readonly { time: number }[]): boolean {
  for (let i = 1; i < items.length; i += 1) {
    if (items[i - 1]!.time > items[i]!.time) return false;
  }
  return true;
}

/**
 * Returns a timeline whose keyframes and markers are in ascending time order,
 * with authored `events` folded into `markers`.
 *
 * Call once, when a document is loaded. Documents arrive from disk, other
 * clients, and generators, so ordering cannot be assumed — but it also must not
 * be re-checked sixty times a second per track. Sorting is a load-time concern,
 * exactly as font parsing is.
 *
 * Returns the SAME timeline by reference when nothing needed doing, so a
 * well-formed document costs one scan per track at load and nothing after.
 */
export function normalizeTimeline(timeline: Timeline): Timeline {
  let changed = false;

  const tracks = timeline.tracks.map((track) => {
    if (isSorted(track.keyframes)) return track;
    changed = true;
    return {
      ...track,
      keyframes: [...track.keyframes].sort((a, b) => a.time - b.time),
    };
  });

  // One representation at runtime. `events` is authored; `markers` is read.
  const folded: TimelineMarker[] = [...(timeline.markers ?? [])];
  if (timeline.events !== undefined && timeline.events.length > 0) {
    changed = true;
    for (const event of timeline.events) {
      folded.push({
        id: event.name,
        time: event.time,
        kind: MARKER_EVENT,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
      });
    }
  }
  if (!isSorted(folded)) {
    changed = true;
    folded.sort((a, b) => a.time - b.time);
  }

  if (!changed) return timeline;
  const { events: _authored, ...rest } = timeline;
  return { ...rest, tracks, markers: folded };
}

/** Kept as the animation-facing name. Same function, one implementation. */
export const normalizeClip = normalizeTimeline;

/** Every node a timeline touches directly. Lets a caller invalidate exactly those. */
export function targetsOf(timeline: Timeline): readonly string[] {
  return [...new Set(timeline.tracks.map((track) => track.target))];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Rejects a timeline that cannot evaluate deterministically. */
export function validateTimeline(timeline: Timeline): string[] {
  const problems: string[] = [];

  if (typeof timeline.id !== "string" || timeline.id.length === 0) {
    problems.push("timeline id must be a non-empty string");
  }
  if (!Number.isFinite(timeline.duration) || timeline.duration < 0) {
    problems.push(
      `timeline "${timeline.id}" has invalid duration ${timeline.duration}`,
    );
  }
  if (timeline.loop === true && timeline.duration <= 0) {
    // Would divide by zero on every wrap.
    problems.push(`timeline "${timeline.id}" loops but has zero duration`);
  }

  for (const track of timeline.tracks) {
    if (typeof track.target !== "string" || track.target.length === 0) {
      problems.push(`timeline "${timeline.id}" has a track with no target`);
    }
    if (typeof track.path !== "string" || track.path.length === 0) {
      problems.push(`timeline "${timeline.id}" has a track with no path`);
      continue;
    }
    if (track.keyframes.length === 0) {
      problems.push(
        `timeline "${timeline.id}" track "${track.path}" has no keyframes`,
      );
    }
    for (const keyframe of track.keyframes) {
      if (!Number.isFinite(keyframe.time)) {
        problems.push(
          `timeline "${timeline.id}" track "${track.path}" has a non-finite keyframe time`,
        );
      }
    }
    if (track.delay !== undefined && (!Number.isFinite(track.delay) || track.delay < 0)) {
      problems.push(
        `timeline "${timeline.id}" track "${track.path}" has an invalid delay`,
      );
    }
    const stagger = track.stagger;
    if (stagger !== undefined) {
      if (stagger.interval === undefined && stagger.total === undefined) {
        problems.push(
          `timeline "${timeline.id}" track "${track.path}" staggers with neither interval nor total`,
        );
      }
      for (const [name, value] of [
        ["interval", stagger.interval],
        ["total", stagger.total],
      ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          problems.push(
            `timeline "${timeline.id}" track "${track.path}" has an invalid stagger ${name}`,
          );
        }
      }
    }
  }

  const seen = new Set<string>();
  for (const marker of timeline.markers ?? []) {
    if (!Number.isFinite(marker.time)) {
      problems.push(`timeline "${timeline.id}" has a non-finite marker time`);
    }
    if (typeof marker.id !== "string" || marker.id.length === 0) {
      problems.push(`timeline "${timeline.id}" has a marker with no id`);
      continue;
    }
    if (typeof marker.kind !== "string" || marker.kind.length === 0) {
      problems.push(
        `timeline "${timeline.id}" marker "${marker.id}" has no kind`,
      );
    }
    // Addressable means unique. Two markers with one id makes "seek to
    // `midpoint`" ambiguous, which is the whole point of an addressable position.
    if (seen.has(marker.id)) {
      problems.push(
        `timeline "${timeline.id}" has two markers named "${marker.id}"`,
      );
    }
    seen.add(marker.id);
  }

  for (const event of timeline.events ?? []) {
    if (!Number.isFinite(event.time)) {
      problems.push(`timeline "${timeline.id}" has a non-finite event time`);
    }
    if (typeof event.name !== "string" || event.name.length === 0) {
      problems.push(`timeline "${timeline.id}" has an event with no name`);
    }
  }

  return problems;
}

/** Kept as the animation-facing name. Same function, one implementation. */
export const validateClip = validateTimeline;

/** A marker by id. Addressable positions are addressable. */
export function markerAt(
  timeline: Timeline,
  markerId: string,
): TimelineMarker | undefined {
  return timeline.markers?.find((marker) => marker.id === markerId);
}

// Re-exported so a consumer of the timeline never has to reach past it for the
// two value operations that belong to it.
export { ease, interpolate };
