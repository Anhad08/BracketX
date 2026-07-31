/**
 * The runtime clock. ENGINE_RUNTIME §1.
 *
 * THE SINGLE AUTHORITATIVE SOURCE OF ENGINE TIME. No subsystem computes its
 * own time, reads `Date.now`, `performance.now`, or a `requestAnimationFrame`
 * timestamp. Invariant I2.
 *
 * Canonical time is an integer frame number against an exact rational rate.
 * Milliseconds are derived and display-only — see rational.ts for why.
 *
 * ============================================================================
 * THE DELTA-TIME PROHIBITION (ENGINE_RUNTIME §1.6, invariant I1)
 * ============================================================================
 * Nothing here accumulates. Wall-clock playback derives the frame from an
 * *origin* every time:
 *
 *     frame = origin.frame + floor(elapsed x speed x rate)
 *
 * rather than `frame += delta`. Accumulation is the standard way engines break
 * the property that evaluating frame N directly equals playing forward to
 * frame N, and it is unrecoverable once a subsystem depends on it.
 */
import {
  ONE,
  compare,
  divide,
  equals,
  floorToInteger,
  multiply,
  rational,
  toNumber,
  type Rational,
} from "./rational";

export type ClockStatus = "stopped" | "playing" | "paused";

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClockError";
  }
}

export interface ClockSnapshot {
  readonly frame: number;
  readonly rate: Rational;
  readonly speed: Rational;
  readonly status: ClockStatus;
}

/** Where wall-clock playback measures from. Reset on any discontinuity. */
interface Origin {
  readonly frame: number;
  readonly wallMs: number;
}

export interface ClockOptions {
  readonly rate?: Rational;
  readonly startFrame?: number;
}

export class RuntimeClock {
  #frame: number;
  #rate: Rational;
  #speed: Rational = ONE;
  #status: ClockStatus = "stopped";
  #origin: Origin | null = null;

  constructor(options: ClockOptions = {}) {
    this.#rate = options.rate ?? rational(60, 1);
    this.#frame = options.startFrame ?? 0;
    this.#assertRate(this.#rate);
    this.#assertFrame(this.#frame);
  }

  // -- Reading -------------------------------------------------------------

  get frame(): number {
    return this.#frame;
  }

  get rate(): Rational {
    return this.#rate;
  }

  get speed(): Rational {
    return this.#speed;
  }

  get status(): ClockStatus {
    return this.#status;
  }

  /** Exact seconds as a rational: frame x (den/num). Never accumulated. */
  get seconds(): Rational {
    return divide(rational(this.#frame, 1), this.#rate);
  }

  /** Derived, for display and for keyframe lookup only. */
  get milliseconds(): number {
    return (this.#frame * 1000 * this.#rate.den) / this.#rate.num;
  }

  get frameDurationMs(): number {
    return (1000 * this.#rate.den) / this.#rate.num;
  }

  snapshot(): ClockSnapshot {
    return {
      frame: this.#frame,
      rate: this.#rate,
      speed: this.#speed,
      status: this.#status,
    };
  }

  // -- Deterministic stepping ---------------------------------------------

  /**
   * Advance by whole frames. The fixed-timestep path used by offline
   * rendering, tests, and replay — no wall clock is involved, so the result
   * depends only on the call sequence.
   */
  step(frames = 1): void {
    if (!Number.isInteger(frames)) {
      throw new ClockError(`step requires an integer, received ${frames}`);
    }
    this.#setFrame(this.#frame + frames);
  }

  /** Jump to an absolute frame. Discontinuous — resets the playback origin. */
  seek(frame: number): void {
    this.#assertFrame(frame);
    this.#setFrame(frame);
  }

  /**
   * Seek expressed in seconds, rounded to the nearest frame.
   *
   * Rounding rather than truncating so scrubbing to 1.0s at 29.97 lands on
   * frame 30, not 29.
   */
  seekSeconds(seconds: number): void {
    if (!Number.isFinite(seconds)) {
      throw new ClockError(`seekSeconds requires a finite value`);
    }
    this.seek(Math.round((seconds * this.#rate.num) / this.#rate.den));
  }

  // -- Transport -----------------------------------------------------------

  play(wallMs?: number): void {
    this.#status = "playing";
    this.#origin =
      wallMs === undefined ? null : { frame: this.#frame, wallMs };
  }

  pause(): void {
    if (this.#status === "playing") this.#status = "paused";
    // Dropping the origin is what makes resume continue from the current
    // frame rather than jumping forward by the paused duration.
    this.#origin = null;
  }

  resume(wallMs?: number): void {
    if (this.#status !== "paused") {
      throw new ClockError(`cannot resume from "${this.#status}"`);
    }
    this.play(wallMs);
  }

  stop(): void {
    this.#status = "stopped";
    this.#origin = null;
  }

  /** Returns to frame 0, stopped, speed 1. Rate is configuration, not state. */
  reset(): void {
    this.#frame = 0;
    this.#speed = ONE;
    this.#status = "stopped";
    this.#origin = null;
  }

  setSpeed(speed: Rational): void {
    if (speed.num < 0) {
      throw new ClockError("playback speed must not be negative");
    }
    if (equals(speed, this.#speed)) return;
    this.#speed = speed;
    // A speed change is a discontinuity: the existing origin was measured
    // against the old speed and would produce a jump if reused.
    this.#origin = null;
  }

  setRate(rate: Rational): void {
    this.#assertRate(rate);
    this.#rate = rate;
    this.#origin = null;
  }

  // -- Wall-clock playback -------------------------------------------------

  /**
   * Derive the current frame from wall time. Returns frames advanced.
   *
   * Called once per host frame with the platform timestamp. The clock never
   * reads that timestamp itself — invariant I2 — so an offline renderer or a
   * test can drive the same code with synthetic values.
   *
   * Idempotent for a given `wallMs`: calling twice with the same value
   * advances once, because the result is derived from the origin rather than
   * accumulated.
   */
  advanceTo(wallMs: number): number {
    if (!Number.isFinite(wallMs)) {
      throw new ClockError("advanceTo requires a finite timestamp");
    }
    if (this.#status !== "playing") return 0;

    if (this.#origin === null) {
      this.#origin = { frame: this.#frame, wallMs };
      return 0;
    }

    const elapsedMs = wallMs - this.#origin.wallMs;

    const framesElapsed =
      elapsedMs <= 0
        ? 0
        : floorToInteger(
            multiply(
              multiply(
                rational(Math.round(elapsedMs * 1000), 1_000_000),
                this.#speed,
              ),
              this.#rate,
            ),
          );

    const target = this.#origin.frame + framesElapsed;

    // Show time is monotonic (ENGINE_RUNTIME §1.3). A host may deliver a
    // timestamp older than the previous one — a stale rAF callback, a
    // suspended tab, a clock adjustment. Comparing against the origin alone
    // does not catch it, because such a timestamp is still after the origin.
    // Re-anchor and hold rather than rewind: rewinding on air would replay
    // frames the audience has already seen.
    if (target < this.#frame) {
      this.#origin = { frame: this.#frame, wallMs };
      return 0;
    }

    const advanced = target - this.#frame;
    if (advanced !== 0) this.#frame = target;
    return advanced;
  }

  // -- Timecode ------------------------------------------------------------

  /**
   * SMPTE timecode. Drop-frame for the 1001-denominator rates.
   *
   * Drop-frame skips two frame *numbers* every minute except every tenth, so
   * the label tracks wall time. It is where naive implementations diverge from
   * a broadcast facility, which is why it is implemented here rather than
   * deferred: it proves the rational representation actually works.
   */
  toTimecode(frame = this.#frame): string {
    return framesToTimecode(frame, this.#rate);
  }

  // -- Internals -----------------------------------------------------------

  #setFrame(frame: number): void {
    this.#assertFrame(frame);
    this.#frame = frame;
    // Any explicit frame change invalidates the wall-clock origin; keeping it
    // would make the next advanceTo undo the seek.
    if (this.#origin !== null) this.#origin = null;
  }

  #assertFrame(frame: number): void {
    if (!Number.isInteger(frame)) {
      throw new ClockError(`frame must be an integer, received ${frame}`);
    }
    if (frame < 0) {
      throw new ClockError(`frame must not be negative, received ${frame}`);
    }
    if (!Number.isSafeInteger(frame)) {
      throw new ClockError(`frame ${frame} exceeds safe integer range`);
    }
  }

  #assertRate(rate: Rational): void {
    if (compare(rate, { num: 0, den: 1 }) <= 0) {
      throw new ClockError("frame rate must be positive");
    }
  }
}

/** Nominal integer rate used for timecode labelling: 29.97 labels as 30. */
export function nominalRate(rate: Rational): number {
  return Math.round(toNumber(rate));
}

export function isDropFrame(rate: Rational): boolean {
  // Only the 30-family NTSC rates use drop-frame. 23.976 does not.
  return rate.den === 1001 && (rate.num === 30000 || rate.num === 60000);
}

export function framesToTimecode(frame: number, rate: Rational): string {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new ClockError(`timecode requires a non-negative integer frame`);
  }

  const nominal = nominalRate(rate);
  let counted = frame;

  if (isDropFrame(rate)) {
    // Two frame numbers per minute for 30-family, four for 60-family.
    const dropped = nominal === 60 ? 4 : 2;
    const framesPerMinute = nominal * 60 - dropped;
    const framesPerTenMinutes = framesPerMinute * 10 + dropped * 9;

    const tenMinuteBlocks = Math.floor(frame / framesPerTenMinutes);
    let remainder = frame % framesPerTenMinutes;

    // The first minute of each ten-minute block drops nothing.
    const firstMinute = nominal * 60;
    let minutesInBlock = 0;
    if (remainder >= firstMinute) {
      remainder -= firstMinute;
      minutesInBlock = 1 + Math.floor(remainder / framesPerMinute);
      remainder %= framesPerMinute;
    }

    const totalMinutes = tenMinuteBlocks * 10 + minutesInBlock;
    void remainder;

    // Add back the numbers that were skipped, so the label advances with wall
    // time. Every minute drops except each tenth.
    counted =
      frame + dropped * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  const frames = counted % nominal;
  const totalSeconds = Math.floor(counted / nominal);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, "0");
  const separator = isDropFrame(rate) ? ";" : ":";
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(frames)}`;
}
