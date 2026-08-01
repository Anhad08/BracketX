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
  sampleClip,
  targetsOf,
  type AnimatedValues,
  type AnimationClip,
  type AnimationEvent,
  type SceneDocument,
} from "@bracketx/engine-scene";

export class AnimationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnimationError";
  }
}

export interface PlayOptions {
  /** Frame the clip is anchored to. Defaults to the current frame. */
  readonly startFrame?: number;
  /** Overrides the clip's own `loop`. */
  readonly loop?: boolean;
  /** Playback rate multiplier. Negative runs the clip backwards. */
  readonly speed?: number;
}

interface ActiveClip {
  readonly clip: AnimationClip;
  readonly startFrame: number;
  readonly loop: boolean;
  readonly speed: number;
  /** Seconds sampled last frame, for event crossing. */
  lastSeconds: number;
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
  #clips = new Map<string, AnimationClip>();
  #active = new Map<string, ActiveClip>();
  /**
   * Clips that finished but whose final frame still applies.
   *
   * A non-looping clip that completes must HOLD its last value, not revert. A
   * lower third that slides in and then snaps back off-screen the instant its
   * clip ends is broken, and reverting is exactly what a naive "remove from
   * active" does. Only an explicit stop reverts.
   */
  #held = new Map<string, { clip: AnimationClip; seconds: number }>();
  #previous: AnimatedValues = new Map();
  #sample: AnimatedValues = new Map();

  /** Registers a document's clips. Replaces any previously registered. */
  load(document: SceneDocument): void {
    this.#clips = new Map(
      (document.animations ?? []).map((clip) => [clip.id, clip]),
    );
    this.#active.clear();
    this.#held.clear();
    this.#previous = new Map();
    this.#sample = new Map();
  }

  get clips(): readonly AnimationClip[] {
    return [...this.#clips.values()];
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
      // Seeded so the first frame does not fire every event from zero to now.
      lastSeconds: 0,
    });
  }

  /** Stops and RELEASES the hold, so the clip's nodes revert. */
  stop(clipId: string): boolean {
    const held = this.#held.delete(clipId);
    return this.#active.delete(clipId) || held;
  }

  stopAll(): void {
    this.#active.clear();
    this.#held.clear();
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
      mergeInto(merged, sampleClip(entry.clip, entry.seconds));
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

      mergeInto(merged, sampleClip(active.clip, seconds));

      // A non-looping clip past its duration stops advancing, but its final
      // frame keeps applying. See #held.
      if (!active.loop && this.#isComplete(active, seconds)) {
        completed.push(clipId);
      }
    }

    for (const clipId of completed) {
      const active = this.#active.get(clipId)!;
      this.#held.set(clipId, {
        clip: active.clip,
        seconds: active.speed >= 0 ? active.clip.duration : 0,
      });
      this.#active.delete(clipId);
    }

    const changed = diffTargets(this.#previous, merged);
    this.#previous = merged;
    this.#sample = merged;

    return { changed, events, completed };
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
    const elapsedFrames = (frame - active.startFrame) * active.speed;
    return rate === 0 ? 0 : elapsedFrames / rate;
  }

  #isComplete(active: ActiveClip, seconds: number): boolean {
    return active.speed >= 0
      ? seconds >= active.clip.duration
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
