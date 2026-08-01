/**
 * Live Control. Phase 7.
 *
 * ============================================================================
 * EVERY INPUT IS THE SAME KIND OF INPUT
 * ============================================================================
 * An operator pressing a key, a data feed delivering a score, an automation
 * firing a cue, and an AI proposing a change are not four subsystems. They are
 * four SOURCES, and each produces the same thing:
 *
 *     source -> LiveCommand -> log -> runtime -> evaluation -> render
 *
 * Nothing bypasses that. The engine has no back door for "just this one urgent
 * update", because the moment one exists, replay stops reproducing reality and
 * every determinism guarantee built over the last five phases becomes a claim
 * rather than a fact.
 *
 * ============================================================================
 * WHY THIS LAYER EXISTS RATHER THAN MORE RUNTIME COMMANDS
 * ============================================================================
 * The runtime's command system already has sequencing, batching, cancellation,
 * and rejection reporting. What it deliberately does NOT have is knowledge of
 * scenes, outputs, clips, or collections — and it must not gain any, or
 * engine-runtime stops being replaceable independently of the host.
 *
 * So Live Control is a translation layer, not a second queue. It keeps ONE
 * ordered log; applying a command either dispatches to the runtime (variables,
 * clock) or mutates host-owned state (outputs, active clips). Host-owned state
 * stays deterministic because the log is the only thing that mutates it.
 */
import type { RuntimeValue } from "@bracketx/engine-runtime";

import type { OutputDescriptor } from "./output";
import type { PlayOptions } from "./animator";

export class LiveCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveCommandError";
  }
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where in a collection an insert goes.
 *
 * `"end"` rather than a magic index, because an operator adding a row means
 * "after the current last one", and computing that index at author time races
 * with anything else appending.
 */
export type InsertAt = number | "end";

export type LiveCommand =
  // -- Values --------------------------------------------------------------
  | { readonly type: "variable.set"; readonly key: string; readonly value: RuntimeValue }
  | { readonly type: "variable.clear"; readonly key: string }
  /**
   * Named separately from `variable.set` even though it does the same thing.
   * The distinction is INTENT, and intent is what a replay log is read for: an
   * operator scrubbing a value and a template being reconfigured look identical
   * in the state and completely different in the story.
   */
  | { readonly type: "template.setParameter"; readonly key: string; readonly value: RuntimeValue }

  // -- Collections ---------------------------------------------------------
  | {
      readonly type: "collection.insert";
      readonly key: string;
      readonly at: InsertAt;
      readonly items: readonly RuntimeValue[];
    }
  | {
      readonly type: "collection.remove";
      readonly key: string;
      /** Identities when `keyField` is given, otherwise indices as strings. */
      readonly ids: readonly string[];
      readonly keyField?: string;
    }
  | {
      readonly type: "collection.reorder";
      readonly key: string;
      /** The new order, by identity. Items omitted keep their relative order. */
      readonly ids: readonly string[];
      readonly keyField?: string;
    }
  | {
      readonly type: "collection.replace";
      readonly key: string;
      readonly items: readonly RuntimeValue[];
    }
  | {
      readonly type: "collection.patch";
      readonly key: string;
      readonly id: string;
      readonly keyField?: string;
      readonly patch: Readonly<Record<string, RuntimeValue>>;
    }

  // -- States --------------------------------------------------------------
  | { readonly type: "state.set"; readonly states: readonly string[] }
  | { readonly type: "state.add"; readonly state: string }
  | { readonly type: "state.remove"; readonly state: string }

  // -- Outputs -------------------------------------------------------------
  | { readonly type: "output.bind"; readonly output: OutputDescriptor }
  | { readonly type: "output.unbind"; readonly id: string }
  | {
      readonly type: "output.resize";
      readonly id: string;
      readonly width: number;
      readonly height: number;
    }

  // -- Playback ------------------------------------------------------------
  | { readonly type: "playback.play" }
  | { readonly type: "playback.pause" }
  | { readonly type: "playback.stop" }
  | { readonly type: "playback.seek"; readonly frame: number }

  // -- Animation -----------------------------------------------------------
  | {
      readonly type: "clip.play";
      readonly clipId: string;
      readonly options?: PlayOptions;
    }
  | { readonly type: "clip.stop"; readonly clipId: string }

  // -- Scene ---------------------------------------------------------------
  | { readonly type: "scene.activate"; readonly sceneId: string }
  | { readonly type: "scene.deactivate" };

export type LiveCommandType = LiveCommand["type"];

/**
 * One entry in the log.
 *
 * `timestamp` is recorded but never READ during apply. Replay uses sequence
 * order only — an engine that behaved differently because a command arrived at
 * a different wall time would not be replayable, and wall time is the one input
 * a replay cannot reproduce.
 */
export interface LiveCommandRecord {
  readonly sequence: number;
  readonly timestamp: number;
  readonly command: LiveCommand;
  readonly accepted: boolean;
  /** Present when rejected. Never silent. */
  readonly reason?: string;
  /** Frame the command was applied on. */
  readonly frame: number;
}

export interface LiveResult {
  readonly accepted: boolean;
  readonly sequence: number;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Rejects a command that cannot apply.
 *
 * Returns a reason string rather than throwing: a bad command from a data feed
 * must be recorded and reported, not allowed to unwind the frame that a dozen
 * good commands were applied in.
 */
export function validateLiveCommand(command: LiveCommand): string | null {
  switch (command.type) {
    case "variable.set":
    case "template.setParameter":
      return command.key.length === 0 ? "key must not be empty" : null;

    case "variable.clear":
      return command.key.length === 0 ? "key must not be empty" : null;

    case "collection.insert":
      if (command.key.length === 0) return "key must not be empty";
      if (command.at !== "end" && !Number.isInteger(command.at)) {
        return `insert index must be an integer or "end"`;
      }
      if (command.at !== "end" && command.at < 0) {
        return "insert index must not be negative";
      }
      return command.items.length === 0 ? "insert requires at least one item" : null;

    case "collection.remove":
    case "collection.reorder":
      if (command.key.length === 0) return "key must not be empty";
      return command.ids.length === 0 ? "ids must not be empty" : null;

    case "collection.replace":
      return command.key.length === 0 ? "key must not be empty" : null;

    case "collection.patch":
      if (command.key.length === 0) return "key must not be empty";
      if (command.id.length === 0) return "id must not be empty";
      return Object.keys(command.patch).length === 0
        ? "patch must change at least one field"
        : null;

    case "state.add":
    case "state.remove":
      return command.state.length === 0 ? "state must not be empty" : null;

    case "state.set":
      return command.states.some((state) => state.length === 0)
        ? "state names must not be empty"
        : null;

    case "output.bind":
      return command.output.id.length === 0 ? "output id must not be empty" : null;

    case "output.unbind":
      return command.id.length === 0 ? "output id must not be empty" : null;

    case "output.resize":
      if (command.id.length === 0) return "output id must not be empty";
      return command.width > 0 && command.height > 0
        ? null
        : "output size must be positive";

    case "playback.seek":
      return Number.isInteger(command.frame) && command.frame >= 0
        ? null
        : "seek frame must be a non-negative integer";

    case "clip.play":
    case "clip.stop":
      return command.clipId.length === 0 ? "clipId must not be empty" : null;

    case "scene.activate":
      return command.sceneId.length === 0 ? "sceneId must not be empty" : null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Collection algebra
// ---------------------------------------------------------------------------

/** Identity of one item, by key field or by index. */
export function itemIdentity(
  item: unknown,
  index: number,
  keyField: string | undefined,
): string {
  if (keyField === undefined) return String(index);
  if (item === null || typeof item !== "object") return String(index);
  const value = (item as Record<string, unknown>)[keyField];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(index);
}

/** Reads a collection, treating anything else as empty. */
export function asCollection(value: unknown): readonly RuntimeValue[] {
  return Array.isArray(value) ? (value as readonly RuntimeValue[]) : [];
}

/**
 * Applies a collection command, returning the new array.
 *
 * Pure. Every operation preserves the identity of items it does not touch, by
 * returning the SAME item objects — which is what lets the reconciler's keyed
 * diff recognise survivors and keep their handles, GPU resources, and
 * in-flight animation (Project Alpha A2).
 *
 * Rebuilding items here, even with identical values, would defeat that entirely
 * and no test of the collection's CONTENTS would notice.
 */
export function applyCollectionCommand(
  current: readonly RuntimeValue[],
  command: Extract<LiveCommand, { type: `collection.${string}` }>,
): readonly RuntimeValue[] {
  switch (command.type) {
    case "collection.insert": {
      const at =
        command.at === "end"
          ? current.length
          : Math.min(command.at, current.length);
      return [...current.slice(0, at), ...command.items, ...current.slice(at)];
    }

    case "collection.remove": {
      const doomed = new Set(command.ids);
      return current.filter(
        (item, index) => !doomed.has(itemIdentity(item, index, command.keyField)),
      );
    }

    case "collection.reorder": {
      const byIdentity = new Map<string, RuntimeValue>();
      current.forEach((item, index) => {
        byIdentity.set(itemIdentity(item, index, command.keyField), item);
      });

      const ordered: RuntimeValue[] = [];
      const placed = new Set<string>();
      for (const id of command.ids) {
        const item = byIdentity.get(id);
        if (item === undefined) continue;
        ordered.push(item);
        placed.add(id);
      }
      // Items the command did not name keep their relative order, appended.
      // A partial reorder is the common operator action — "move this to the
      // top" — and dropping the rest would be catastrophic.
      current.forEach((item, index) => {
        const id = itemIdentity(item, index, command.keyField);
        if (!placed.has(id)) ordered.push(item);
      });
      return ordered;
    }

    case "collection.replace":
      return [...command.items];

    case "collection.patch": {
      let found = false;
      const next = current.map((item, index) => {
        if (itemIdentity(item, index, command.keyField) !== command.id) {
          return item;
        }
        found = true;
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }
        return { ...(item as Record<string, RuntimeValue>), ...command.patch };
      });
      // An unmatched patch returns the ORIGINAL array by reference, so the
      // caller can tell nothing happened and skip the projection entirely.
      return found ? next : current;
    }

    default:
      return current;
  }
}

/** True for the collection commands, for narrowing. */
export function isCollectionCommand(
  command: LiveCommand,
): command is Extract<LiveCommand, { type: `collection.${string}` }> {
  return command.type.startsWith("collection.");
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export interface LiveLogOptions {
  /**
   * Entries kept. Older ones are dropped.
   *
   * A show running for eight hours at sixty commands a second is 1.7 million
   * entries; keeping them all would be a leak with a respectable name. Replay
   * from a snapshot needs only the entries since that snapshot.
   */
  readonly capacity?: number;
}

const DEFAULT_CAPACITY = 10_000;

export class LiveCommandLog {
  #records: LiveCommandRecord[] = [];
  #sequence = 0;
  #capacity: number;
  #accepted = 0;
  #rejected = 0;

  constructor(options: LiveLogOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  get size(): number {
    return this.#records.length;
  }

  get nextSequence(): number {
    return this.#sequence;
  }

  get accepted(): number {
    return this.#accepted;
  }

  get rejected(): number {
    return this.#rejected;
  }

  record(
    command: LiveCommand,
    frame: number,
    timestamp: number,
    reason: string | null,
  ): LiveCommandRecord {
    const entry: LiveCommandRecord = {
      sequence: this.#sequence++,
      timestamp,
      command,
      frame,
      accepted: reason === null,
      ...(reason === null ? {} : { reason }),
    };

    if (entry.accepted) this.#accepted += 1;
    else this.#rejected += 1;

    this.#records.push(entry);
    if (this.#records.length > this.#capacity) {
      this.#records.splice(0, this.#records.length - this.#capacity);
    }
    return entry;
  }

  /** Every retained entry, oldest first. */
  entries(): readonly LiveCommandRecord[] {
    return this.#records;
  }

  /** Accepted entries only — what a replay needs. */
  replayable(): readonly LiveCommand[] {
    return this.#records
      .filter((record) => record.accepted)
      .map((record) => record.command);
  }

  /** Most recent entries, newest first. For an operator-facing log view. */
  recent(count: number): readonly LiveCommandRecord[] {
    return this.#records.slice(-count).reverse();
  }

  clear(): void {
    this.#records = [];
    this.#accepted = 0;
    this.#rejected = 0;
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Everything needed to reconstruct a running production.
 *
 * Deterministic and comparable: two sessions that reached the same place by
 * different routes produce identical snapshots, which is what makes a replay
 * test an equality assertion rather than an eyeball.
 */
export interface SessionSnapshot {
  readonly sceneId: string | null;
  readonly frame: number;
  readonly playing: boolean;
  readonly states: readonly string[];
  readonly variables: Readonly<Record<string, RuntimeValue>>;
  readonly outputs: readonly {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly cadence: number;
  }[];
  readonly activeClips: readonly string[];
  readonly heldClips: readonly string[];
  /** Runtime state hash. Equal hashes mean equal runtime state. */
  readonly runtimeHash: string;
  readonly commandsApplied: number;
}

/**
 * Canonical string for a snapshot. Equal strings mean equal sessions.
 *
 * Keys are emitted in a fixed order rather than whatever the object literal
 * happened to use, because JSON.stringify preserves insertion order and two
 * snapshots built by different code paths would otherwise differ as strings
 * while being equal as sessions.
 */
export function canonicalSession(snapshot: SessionSnapshot): string {
  const variables = Object.keys(snapshot.variables)
    .sort()
    .map((key) => [key, snapshot.variables[key]]);

  return JSON.stringify([
    snapshot.sceneId,
    snapshot.frame,
    snapshot.playing,
    [...snapshot.states].sort(),
    variables,
    snapshot.outputs.map((output) => [
      output.id,
      output.width,
      output.height,
      output.cadence,
    ]),
    [...snapshot.activeClips].sort(),
    [...snapshot.heldClips].sort(),
    snapshot.runtimeHash,
  ]);
}
