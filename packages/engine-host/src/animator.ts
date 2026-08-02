/**
 * The animation driver. Phase 5.
 *
 * Turns "what time is it" into "what values does the scene have", once per
 * frame, and hands the result to the projector.
 *
 * ============================================================================
 * THIS IS THE ONLY PLACE ANIMATION TOUCHES TIME
 * ============================================================================
 * The evaluator in engine-scene is pure — it takes a clip and a number of
 * seconds. The Runtime owns the clock. This module is the seam between them,
 * and it is deliberately thin: derive seconds from the clock's frame, sample,
 * diff, invalidate.
 *
 * It stores exactly two things, and neither is scene state:
 *
 *   - which clips are playing, and from which frame each started
 *   - the previous sample, so an unchanged frame can skip the projector
 *
 * A playhead is NOT stored. It is `(frame - startFrame) / rate`, computed from
 * the clock every time. That is what makes seeking free: move the clock and the
 * next sample is already correct, with no state to unwind and no settle time.
 */
import {
  crossedEvents,
  cursorSeconds,
  normalizeTimeline,
  sampleTimeline,
  targetsOf,
  timelineSpan,
  type AnimatedValues,
  type AnimationEvent,
  type SampleOptions,
  type SceneDocument,
  type Timeline,
} from "@bracketx/engine-scene";

export class AnimationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnimationError";
  }
}

export interface PlayOptions {
  /** Frame the timeline is anchored to. Defaults to the current frame. */
  readonly startFrame?: number;
  /** Overrides the timeline's own `loop`. */
  readonly loop?: boolean;
  /** Playback rate multiplier. Negative runs it backwards. */
  readonly speed?: number;
  /**
   * Hold the final frame on completion. Defaults to true.
   *
   * True is right for a clip: a lower third that slides in must not snap back
   * off-screen the instant its clip ends. False is right for a compiled state
   * transition, whose end values are already what the state produces — holding
   * would pin a duplicate of the state on top of itself forever.
   */
  readonly hold?: boolean;
}

interface ActiveClip {
  readonly clip: Timeline;
  readonly startFrame: number;
  readonly loop: boolean;
  readonly speed: number;
  readonly hold: boolean;
  /** Seconds sampled last frame, for marker crossing. */
  lastSeconds: number;
}

/**
 * What a clip is doing right now.
 *
 * Read-only. A timeline view needs the playhead, the direction, and the anchor
 * to draw anything useful, and deriving them from the outside would mean
 * reimplementing `#secondsFor` — a second copy of the one calculation that must
 * never disagree with itself.
 */
export interface ClipState {
  readonly clipId: string;
  readonly playing: boolean;
  readonly held: boolean;
  /** Frame the clip is anchored to. */
  readonly startFrame: number;
  /** Negative runs the clip backwards. */
  readonly speed: number;
  readonly loop: boolean;
  /** Seconds into the clip, as of the last sample. */
  readonly seconds: number;
  readonly duration: number;
}

export interface AnimationFrame {
  /** Nodes whose values changed since the previous frame. */
  readonly changed: readonly string[];
  /** Events crossed this frame, in the order they happened. */
  readonly events: readonly { clipId: string; event: AnimationEvent }[];
  /** Clips that reached their end this frame and stopped. */
  readonly completed: readonly string[];
}

const EMPTY_FRAME: AnimationFrame = {
  changed: [],
  events: [],
  completed: [],
};

export class Animator {
  #clips = new Map<string, Timeline>();
  /**
   * Timelines that are not in the document — compiled state transitions.
   *
   * They live in the same map and run through the same player, because they
   * are the same model. Tracked separately only so `stop` can forget them; a
   * transition that outlived its state change would sit on Studio's ruler
   * forever.
   */
  #transient = new Set<string>();
  #active = new Map<string, ActiveClip>();
  /**
   * Clips that finished but whose final frame still applies.
   *
   * A non-looping clip that completes must HOLD its last value, not revert. A
   * lower third that slides in and then snaps back off-screen the instant its
   * clip ends is broken, and reverting is exactly what a naive "remove from
   * active" does. Only an explicit stop reverts.
   */
  #held = new Map<string, { clip: Timeline; seconds: number }>();
  #previous: AnimatedValues = new Map();
  #sample: AnimatedValues = new Map();

  /** Registers a document's clips. Replaces any previously registered. */
  load(document: SceneDocument): void {
    // Sorted once, here, so sampling never pays for the check. Documents
    // arrive from disk, other clients, and generators — the order cannot be
    // assumed, but it must not be re-verified 60 times a second either.
    this.#clips = new Map(
      (document.animations ?? []).map((clip) => {
        const normalized = normalizeTimeline(clip);
        return [normalized.id, normalized];
      }),
    );
    this.#transient.clear();
    this.#active.clear();
    this.#held.clear();
    this.#previous = new Map();
    this.#sample = new Map();
  }

  get clips(): readonly Timeline[] {
    return [...this.#clips.values()];
  }

  /** True when this timeline was compiled rather than authored. */
  isTransient(timelineId: string): boolean {
    return this.#transient.has(timelineId);
  }

  timeline(timelineId: string): Timeline | undefined {
    return this.#clips.get(timelineId);
  }

  get playing(): readonly string[] {
    return [...this.#active.keys()];
  }

  /** The values the last sample produced. */
  get values(): AnimatedValues {
    return this.#sample;
  }

  play(clipId: string, currentFrame: number, options: PlayOptions = {}): void {
    const clip = this.#clips.get(clipId);
    if (clip === undefined) {
      throw new AnimationError(`no clip "${clipId}" in the document`);
    }
    if (options.speed === 0) {
      throw new AnimationError(
        `clip "${clipId}" cannot play at speed 0; pause the clock instead`,
      );
    }

    const startFrame = options.startFrame ?? currentFrame;
    // Replaying a held clip restarts it rather than compounding with itself.
    this.#held.delete(clipId);
    this.#active.set(clipId, {
      clip,
      startFrame,
      loop: options.loop ?? clip.loop === true,
      speed: options.speed ?? 1,
      hold: options.hold ?? true,
      // Seeded so the first frame does not fire every event from zero to now.
      lastSeconds: 0,
    });
  }

  /**
   * Plays a timeline that is not in the document.
   *
   * The entry point compiled state transitions use, and the one Phase 9 will
   * use for a cue sequence. Deliberately the SAME player: a second one would
   * mean a second playhead, and two playheads disagree.
   */
  playTimeline(
    timeline: Timeline,
    currentFrame: number,
    options: PlayOptions = {},
  ): void {
    const normalized = normalizeTimeline(timeline);
    this.#clips.set(normalized.id, normalized);
    this.#transient.add(normalized.id);
    this.play(normalized.id, currentFrame, options);
  }

  /** Stops and RELEASES the hold, so the timeline's nodes revert. */
  stop(clipId: string): boolean {
    const held = this.#held.delete(clipId);
    const active = this.#active.delete(clipId);
    if (this.#transient.delete(clipId)) this.#clips.delete(clipId);
    return active || held;
  }

  stopAll(): void {
    this.#active.clear();
    this.#held.clear();
    for (const id of this.#transient) this.#clips.delete(id);
    this.#transient.clear();
  }

  /** True while the clip is still advancing. A held clip is not playing. */
  isPlaying(clipId: string): boolean {
    return this.#active.has(clipId);
  }

  /** True when the clip finished and its final frame is still applied. */
  isHeld(clipId: string): boolean {
    return this.#held.has(clipId);
  }

  /**
   * Samples every active clip for a frame.
   *
   * `emitEvents` is false when the caller is seeking. A scrub crosses
   * arbitrarily many events at once, and firing them would mean dragging a
   * timeline triggers every cue in a show — the accident that puts a graphic
   * on air during rehearsal.
   */
  sample(
    frame: number,
    rate: number,
    emitEvents = true,
    options: SampleOptions = {},
  ): AnimationFrame {
    if (this.#active.size === 0 && this.#held.size === 0) {
      if (this.#previous.size === 0) return EMPTY_FRAME;
      // Everything stopped: the nodes it drove must revert to the document.
      const changed = [...this.#previous.keys()];
      this.#previous = new Map();
      this.#sample = new Map();
      return { changed, events: [], completed: [] };
    }

    const merged = new Map<string, Map<string, unknown>>();

    // Held clips first, so a newly playing clip overrides a finished one on a
    // shared property rather than fighting it.
    for (const entry of this.#held.values()) {
      mergeInto(merged, sampleTimeline(entry.clip, entry.seconds, options));
    }
    const events: { clipId: string; event: AnimationEvent }[] = [];
    const completed: string[] = [];

    // Insertion order, so two clips driving one property resolve the same way
    // every run. Last play wins, which matches the operator's mental model:
    // the thing you triggered most recently is the thing you meant.
    for (const [clipId, active] of this.#active) {
      const seconds = this.#secondsFor(active, frame, rate);

      if (emitEvents) {
        for (const event of crossedEvents(
          active.clip,
          active.lastSeconds,
          seconds,
        )) {
          events.push({ clipId, event });
        }
      }
      active.lastSeconds = seconds;

      mergeInto(merged, sampleTimeline(active.clip, seconds, options));

      // A non-looping clip past its duration stops advancing, but its final
      // frame keeps applying. See #held.
      if (!active.loop && this.#isComplete(active, seconds, options)) {
        completed.push(clipId);
      }
    }

    for (const clipId of completed) {
      const active = this.#active.get(clipId)!;
      this.#active.delete(clipId);
      if (!active.hold) {
        // A compiled transition. Its end values equal what the state already
        // produces, so releasing is correct and holding would pin a duplicate.
        if (this.#transient.delete(clipId)) this.#clips.delete(clipId);
        continue;
      }
      this.#held.set(clipId, {
        clip: active.clip,
        seconds: active.speed >= 0 ? this.#spanFor(active.clip, options) : 0,
      });
    }

    const changed = diffTargets(this.#previous, merged);
    this.#previous = merged;
    this.#sample = merged;

    return { changed, events, completed };
  }

  /**
   * Playback state for one clip, or undefined if it is neither playing nor
   * held. Observability only — nothing here can change what happens.
   */
  clipState(clipId: string): ClipState | undefined {
    const clip = this.#clips.get(clipId);
    if (clip === undefined) return undefined;

    const active = this.#active.get(clipId);
    if (active !== undefined) {
      return {
        clipId,
        playing: true,
        held: false,
        startFrame: active.startFrame,
        speed: active.speed,
        loop: active.loop,
        seconds: active.lastSeconds,
        duration: clip.duration,
      };
    }

    const held = this.#held.get(clipId);
    if (held !== undefined) {
      return {
        clipId,
        playing: false,
        held: true,
        startFrame: 0,
        speed: 0,
        loop: false,
        seconds: held.seconds,
        duration: clip.duration,
      };
    }
    return undefined;
  }

  /** Playback state for every clip that has any. */
  clipStates(): readonly ClipState[] {
    return [...this.#clips.keys()]
      .map((id) => this.clipState(id))
      .filter((state): state is ClipState => state !== undefined);
  }

  /** Nodes any active clip drives. For invalidation after a stop. */
  activeTargets(): readonly string[] {
    const targets = new Set<string>();
    for (const active of this.#active.values()) {
      for (const target of targetsOf(active.clip)) targets.add(target);
    }
    return [...targets];
  }

  /**
   * Seconds into a clip, derived from the clock. Never accumulated.
   *
   * ENGINE_RUNTIME's delta-time prohibition applies here directly: a playhead
   * advanced by per-frame deltas drifts, and the drift is invisible until a
   * show has been running for an hour.
   */
  #secondsFor(active: ActiveClip, frame: number, rate: number): number {
    // The ONE playhead calculation, shared with every other reader of the
    // timeline model. Duplicating it here is how two readers start disagreeing.
    return cursorSeconds(active, frame, rate);
  }

  /**
   * When a timeline is truly finished.
   *
   * NOT `duration`. A staggered track is still moving after the nominal
   * duration — the last instance starts late and takes as long as the track
   * does — so completing at `duration` would freeze the tail of every staggered
   * reveal part-way through.
   */
  #spanFor(timeline: Timeline, options: SampleOptions): number {
    const instancesOf = options.instancesOf;
    if (instancesOf === undefined) return timeline.duration;
    return timelineSpan(timeline, (templateId) => instancesOf(templateId).length);
  }

  #isComplete(
    active: ActiveClip,
    seconds: number,
    options: SampleOptions,
  ): boolean {
    return active.speed >= 0
      ? seconds >= this.#spanFor(active.clip, options)
      : seconds <= 0;
  }
}

function mergeInto(
  target: Map<string, Map<string, unknown>>,
  source: AnimatedValues,
): void {
  for (const [nodeId, paths] of source) {
    let entry = target.get(nodeId);
    if (entry === undefined) {
      entry = new Map();
      target.set(nodeId, entry);
    }
    for (const [path, value] of paths) entry.set(path, value);
  }
}

/** Nodes present in either sample whose values differ. */
function diffTargets(
  previous: AnimatedValues,
  next: AnimatedValues,
): string[] {
  const changed: string[] = [];

  for (const [nodeId, paths] of next) {
    const before = previous.get(nodeId);
    if (before === undefined || before.size !== paths.size) {
      changed.push(nodeId);
      continue;
    }
    for (const [path, value] of paths) {
      if (!Object.is(before.get(path), value)) {
        changed.push(nodeId);
        break;
      }
    }
  }

  // A node the previous frame drove and this one does not must revert to its
  // document value, so it counts as changed.
  for (const nodeId of previous.keys()) {
    if (!next.has(nodeId)) changed.push(nodeId);
  }

  return changed;
}
