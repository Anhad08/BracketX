/**
 * The command system. ENGINE_RUNTIME / RFC-002 §4.3 as corrected.
 *
 * Commands are the ONLY legal way to mutate runtime state, exactly as
 * operations are the only way to mutate the document. The symmetry is
 * deliberate; the asymmetry matters:
 *
 *   operations  invertible, undoable, persisted
 *   commands    NOT invertible, NOT undoable, NOT persisted
 *
 * A command that could be undone would put an operator's score correction on
 * the undo stack, which is exactly the failure ARCHITECTURE_VERIFICATION D3
 * identified.
 *
 * Determinism: replaying an identical command sequence against an identical
 * starting state must produce an identical ending state. Nothing here reads a
 * clock, generates randomness, or depends on iteration order.
 */
import { RuntimeClock } from "./clock";
import { RuntimeStateOps, type RuntimeState, type RuntimeValue } from "./state";
import type { Rational } from "./rational";

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

export type Command =
  | { readonly type: "clock.play" }
  | { readonly type: "clock.pause" }
  | { readonly type: "clock.resume" }
  | { readonly type: "clock.stop" }
  | { readonly type: "clock.reset" }
  | { readonly type: "clock.seek"; readonly frame: number }
  | { readonly type: "clock.step"; readonly frames: number }
  | { readonly type: "clock.setSpeed"; readonly speed: Rational }
  | { readonly type: "scene.setActive"; readonly sceneId: string | null }
  | {
      readonly type: "variable.set";
      readonly key: string;
      readonly value: RuntimeValue;
    }
  | { readonly type: "variable.clear"; readonly key: string }
  | {
      readonly type: "override.set";
      readonly key: string;
      readonly value: RuntimeValue;
    }
  | { readonly type: "override.clear"; readonly key: string }
  | { readonly type: "selection.set"; readonly nodeIds: readonly string[] }
  | {
      readonly type: "transient.set";
      readonly key: string;
      readonly value: RuntimeValue;
    }
  | { readonly type: "transient.clear"; readonly key: string }
  | { readonly type: "runtime.reset" };

export type CommandType = Command["type"];

/** A command with its queue identity. Sequence numbers give total order. */
export interface QueuedCommand {
  readonly sequence: number;
  readonly command: Command;
  /** Commands sharing a batch apply atomically. */
  readonly batch: number | null;
}

export type CommandRejection = {
  readonly sequence: number;
  readonly command: Command;
  readonly reason: string;
};

export interface DispatchResult {
  readonly state: RuntimeState;
  readonly applied: readonly QueuedCommand[];
  readonly rejected: readonly CommandRejection[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Rejections are returned, never thrown. An invalid command during a live show
 * must not take down the frame — it is reported and skipped.
 */
export function validateCommand(
  command: Command,
  state: RuntimeState,
): string | null {
  switch (command.type) {
    case "clock.seek":
      if (!Number.isInteger(command.frame)) return "frame must be an integer";
      if (command.frame < 0) return "frame must not be negative";
      return null;

    case "clock.step":
      if (!Number.isInteger(command.frames)) return "frames must be an integer";
      return null;

    case "clock.setSpeed":
      if (command.speed.num < 0) return "speed must not be negative";
      if (command.speed.den === 0) return "speed denominator must not be zero";
      return null;

    case "clock.resume":
      if (state.clock.status !== "paused") {
        return `cannot resume from "${state.clock.status}"`;
      }
      return null;

    case "variable.set":
    case "override.set":
    case "transient.set":
      if (command.key.length === 0) return "key must not be empty";
      if (!isRuntimeValue(command.value)) return "value is not a runtime value";
      return null;

    case "variable.clear":
    case "override.clear":
    case "transient.clear":
      if (command.key.length === 0) return "key must not be empty";
      return null;

    case "selection.set":
      if (command.nodeIds.some((id) => typeof id !== "string")) {
        return "selection must contain only strings";
      }
      return null;

    default:
      return null;
  }
}

/**
 * Depth cap for structured values.
 *
 * A malformed or hostile feed must not be able to make validation, hashing, or
 * canonicalization recurse without bound. Production data is flat; 16 levels is
 * far past anything real and far short of a stack overflow.
 */
const MAX_VALUE_DEPTH = 16;

function isRuntimeValue(value: unknown, depth = 0): value is RuntimeValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  // Non-finite numbers are rejected: NaN breaks equality and Infinity does not
  // survive JSON, so neither can be part of deterministic state.
  if (kind === "number") return Number.isFinite(value as number);
  if (depth >= MAX_VALUE_DEPTH) return false;

  if (Array.isArray(value)) {
    return value.every((item) => isRuntimeValue(item, depth + 1));
  }
  if (kind === "object") {
    // Plain objects only. A class instance, Map, Date, or anything with a
    // prototype carries identity that canonicalization would silently drop.
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every((item) =>
      isRuntimeValue(item, depth + 1),
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Applies one command. Pure with respect to state; the clock is mutated
 * because it is the one authoritative time source and cannot be copied per
 * command without losing that authority.
 */
export function applyCommand(
  state: RuntimeState,
  command: Command,
  clock: RuntimeClock,
): RuntimeState {
  switch (command.type) {
    case "clock.play":
      clock.play();
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.pause":
      clock.pause();
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.resume":
      clock.resume();
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.stop":
      clock.stop();
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.reset":
      clock.reset();
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.seek":
      clock.seek(command.frame);
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.step":
      clock.step(command.frames);
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "clock.setSpeed":
      clock.setSpeed(command.speed);
      return RuntimeStateOps.withClock(state, clock.snapshot());

    case "scene.setActive":
      return RuntimeStateOps.withActiveScene(state, command.sceneId);

    case "variable.set":
      return RuntimeStateOps.withVariable(state, command.key, command.value);

    case "variable.clear":
      return RuntimeStateOps.withoutVariable(state, command.key);

    case "override.set":
      return RuntimeStateOps.withOverride(state, command.key, command.value);

    case "override.clear":
      return RuntimeStateOps.withoutOverride(state, command.key);

    case "selection.set":
      return RuntimeStateOps.withSelection(state, command.nodeIds);

    case "transient.set":
      return RuntimeStateOps.withTransient(state, command.key, command.value);

    case "transient.clear":
      return RuntimeStateOps.withoutTransient(state, command.key);

    case "runtime.reset":
      clock.reset();
      return RuntimeStateOps.cleared(
        RuntimeStateOps.withClock(state, clock.snapshot()),
      );
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface CommandQueueOptions {
  /** Bounded so a runaway producer cannot exhaust memory. */
  readonly capacity?: number;
  /** Retained dispatched commands, for replay and inspection. Runtime only. */
  readonly historyLimit?: number;
}

export class CommandQueueOverflowError extends Error {
  constructor(capacity: number) {
    super(`command queue is full (capacity ${capacity})`);
    this.name = "CommandQueueOverflowError";
  }
}

export class CommandQueue {
  #pending: QueuedCommand[] = [];
  #cancelled = new Set<number>();
  #history: QueuedCommand[] = [];
  #nextSequence = 0;
  #nextBatch = 0;
  #capacity: number;
  #historyLimit: number;

  constructor(options: CommandQueueOptions = {}) {
    this.#capacity = options.capacity ?? 4096;
    this.#historyLimit = options.historyLimit ?? 8192;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  get nextSequence(): number {
    return this.#nextSequence;
  }

  /** Dispatched commands, oldest first. Bounded; not an undo log. */
  get history(): readonly QueuedCommand[] {
    return this.#history;
  }

  enqueue(command: Command): number {
    return this.#push(command, null);
  }

  /**
   * Enqueues commands that must apply atomically: if any is rejected, none in
   * the batch applies. Used where a partial application would be incoherent —
   * setting a scene and its initial variables, for instance.
   */
  enqueueBatch(commands: readonly Command[]): number {
    const batch = this.#nextBatch++;
    for (const command of commands) this.#push(command, batch);
    return batch;
  }

  /** Removes a queued command before dispatch. Returns whether it was found. */
  cancel(sequence: number): boolean {
    const index = this.#pending.findIndex((q) => q.sequence === sequence);
    if (index === -1) return false;
    this.#cancelled.add(sequence);
    this.#pending.splice(index, 1);
    return true;
  }

  cancelBatch(batch: number): number {
    const matching = this.#pending.filter((q) => q.batch === batch);
    for (const queued of matching) this.cancel(queued.sequence);
    return matching.length;
  }

  wasCancelled(sequence: number): boolean {
    return this.#cancelled.has(sequence);
  }

  clear(): void {
    this.#pending = [];
  }

  /**
   * Drains the queue in sequence order, applying each command.
   *
   * Ordering is total and explicit: sequence numbers are assigned at enqueue
   * and never reordered, so two runs that enqueue the same commands dispatch
   * them identically.
   */
  dispatch(state: RuntimeState, clock: RuntimeClock): DispatchResult {
    const pending = this.#pending;
    this.#pending = [];

    const applied: QueuedCommand[] = [];
    const rejected: CommandRejection[] = [];

    // Validate whole batches first: a batch is all-or-nothing, so a later
    // member failing must prevent an earlier member from having applied.
    const failedBatches = new Set<number>();
    let probe = state;
    for (const queued of pending) {
      const reason = validateCommand(queued.command, probe);
      if (reason !== null && queued.batch !== null) {
        failedBatches.add(queued.batch);
      }
      if (reason === null) {
        // Advance the probe so intra-batch dependencies validate correctly
        // (pause then resume, for instance).
        probe = applyCommand(probe, queued.command, cloneClockFor(probe, clock));
      }
    }

    let next = state;
    for (const queued of pending) {
      if (queued.batch !== null && failedBatches.has(queued.batch)) {
        rejected.push({
          sequence: queued.sequence,
          command: queued.command,
          reason: `batch ${queued.batch} contained an invalid command`,
        });
        continue;
      }

      const reason = validateCommand(queued.command, next);
      if (reason !== null) {
        rejected.push({ sequence: queued.sequence, command: queued.command, reason });
        continue;
      }

      next = applyCommand(next, queued.command, clock);
      applied.push(queued);
      this.#remember(queued);
    }

    return { state: next, applied, rejected };
  }

  #push(command: Command, batch: number | null): number {
    if (this.#pending.length >= this.#capacity) {
      throw new CommandQueueOverflowError(this.#capacity);
    }
    const sequence = this.#nextSequence++;
    this.#pending.push({ sequence, command, batch });
    return sequence;
  }

  #remember(queued: QueuedCommand): void {
    this.#history.push(queued);
    if (this.#history.length > this.#historyLimit) {
      this.#history.splice(0, this.#history.length - this.#historyLimit);
    }
  }
}

/**
 * A throwaway clock for batch pre-validation.
 *
 * Validation must not disturb the real clock, but `applyCommand` needs one.
 * The probe's frame is discarded; only validation outcomes are kept.
 */
function cloneClockFor(state: RuntimeState, source: RuntimeClock): RuntimeClock {
  const clone = new RuntimeClock({
    rate: source.rate,
    startFrame: state.frame,
  });
  if (state.clock.status === "playing") clone.play();
  else if (state.clock.status === "paused") {
    clone.play();
    clone.pause();
  }
  clone.setSpeed(state.clock.speed);
  return clone;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Applies a recorded command sequence to a fresh state.
 *
 * The determinism property the runtime is built to guarantee: identical
 * commands from an identical start produce an identical end state, with no
 * dependence on wall time, iteration order, or randomness.
 */
export function replayCommands(
  initialState: RuntimeState,
  commands: readonly Command[],
  clock: RuntimeClock,
): RuntimeState {
  let state = initialState;
  for (const command of commands) {
    if (validateCommand(command, state) !== null) continue;
    state = applyCommand(state, command, clock);
  }
  return state;
}
