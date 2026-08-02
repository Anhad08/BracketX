/**
 * Session recorder.
 *
 * Records what was sent and what the engine became, then replays it and checks
 * the engine becomes the same thing.
 *
 * ============================================================================
 * A RECORDING IS ONLY USEFUL IF IT CAN DISAGREE
 * ============================================================================
 * Storing commands alone would produce a replay that always "passes", because
 * replaying the same commands through the same code trivially yields the same
 * result. The value is in the CHECKPOINTS: the session hash at recorded frames.
 * If a replay reaches a different hash, something non-deterministic entered the
 * engine — which is precisely the bug class hardest to find any other way.
 *
 * That is why this is a debugging tool and not a macro recorder.
 */
import type { LiveCommand, LiveCommandRecord } from "@bracketx/engine-host";

import type { ShowcaseSession } from "../engine/session";

export interface RecordedCommand {
  readonly sequence: number;
  readonly frame: number;
  readonly source: string;
  readonly command: LiveCommand;
}

export interface Checkpoint {
  readonly frame: number;
  /**
   * The log's next sequence number at capture. The ORDERING watermark.
   *
   * ========================================================================
   * WHY A FRAME NUMBER IS NOT ENOUGH — a bug this tool had, found in a browser
   * ========================================================================
   * Several commands can arrive while the clock reads frame F, and a checkpoint
   * can be taken before them, between them, or after them. A checkpoint that
   * records only `frame: F` therefore describes one of several different
   * states, and replay had to guess which — it assumed "before any of frame F's
   * commands" and compared there.
   *
   * When an operator's click landed on the same frame as a checkpoint tick, the
   * guess was wrong and the verifier reported a divergence that had not
   * happened. Intermittently. In the one tool whose entire value is that a red
   * result means something.
   *
   * The sequence number removes the ambiguity: a checkpoint is now a position
   * in the command stream, not just a moment on the clock, and replay compares
   * at exactly that position.
   */
  readonly sequence: number;
  readonly sessionHash: string;
  readonly runtimeHash: string;
  readonly nodeCount: number;
}

export interface Recording {
  readonly sceneId: string;
  readonly commands: readonly RecordedCommand[];
  readonly checkpoints: readonly Checkpoint[];
  /** Frames the recording spans. */
  readonly frames: number;
}

export interface ReplayMismatch {
  readonly frame: number;
  readonly expected: string;
  readonly actual: string;
  readonly kind: "session" | "runtime" | "nodes";
}

export interface ReplayResult {
  readonly matched: boolean;
  readonly checkpointsChecked: number;
  readonly mismatches: readonly ReplayMismatch[];
  readonly commandsReplayed: number;
}

/** How often a checkpoint is taken while recording. */
const CHECKPOINT_EVERY_FRAMES = 30;

export class SessionRecorder {
  #commands: RecordedCommand[] = [];
  #checkpoints: Checkpoint[] = [];
  #recording = false;
  #startSequence = 0;
  #startFrame = 0;
  #lastCheckpointFrame = -Infinity;

  get recording(): boolean {
    return this.#recording;
  }

  get commandCount(): number {
    return this.#commands.length;
  }

  get checkpointCount(): number {
    return this.#checkpoints.length;
  }

  start(session: ShowcaseSession): void {
    this.#commands = [];
    this.#checkpoints = [];
    // Only commands issued from here on belong to the recording; the log
    // already holds everything the scene did on load.
    this.#startSequence = session.host.log.nextSequence;
    this.#startFrame = session.host.runtime.clock.frame;
    this.#lastCheckpointFrame = -Infinity;
    this.#recording = true;
    this.#capture(session);
  }

  /** Called once per frame while recording. Cheap: usually a comparison. */
  tick(session: ShowcaseSession): void {
    if (!this.#recording) return;
    const frame = session.host.runtime.clock.frame;
    if (frame - this.#lastCheckpointFrame < CHECKPOINT_EVERY_FRAMES) return;
    this.#capture(session);
  }

  stop(session: ShowcaseSession): Recording {
    this.#recording = false;
    this.#capture(session);

    const commands: RecordedCommand[] = session.host.log
      .entries()
      .filter(
        (record: LiveCommandRecord) =>
          record.accepted && record.sequence >= this.#startSequence,
      )
      .map((record) => ({
        sequence: record.sequence,
        frame: record.frame,
        source: record.source,
        command: record.command,
      }));

    this.#commands = commands;

    return {
      sceneId: session.scene.id,
      commands,
      checkpoints: [...this.#checkpoints],
      frames: session.host.runtime.clock.frame - this.#startFrame,
    };
  }

  #capture(session: ShowcaseSession): void {
    const frame = session.host.runtime.clock.frame;
    this.#lastCheckpointFrame = frame;
    this.#checkpoints.push({
      frame,
      sequence: session.host.log.nextSequence,
      sessionHash: session.host.sessionHash(),
      runtimeHash: session.host.session().runtimeHash,
      // `mirror.size` rather than materialising every id: a checkpoint tick
      // runs while the show is live, and it must not be O(scene).
      nodeCount: session.host.reconciler.mirror.size,
    });
  }
}

/**
 * Replays a recording into a fresh session and compares checkpoints.
 *
 * The target must be a NEW session on the same scene. Replaying into the
 * session that produced the recording would compare a state against itself and
 * pass unconditionally.
 */
export function replayRecording(
  target: ShowcaseSession,
  recording: Recording,
): ReplayResult {
  if (target.scene.id !== recording.sceneId) {
    return {
      matched: false,
      checkpointsChecked: 0,
      commandsReplayed: 0,
      mismatches: [
        {
          frame: 0,
          kind: "session",
          expected: recording.sceneId,
          actual: target.scene.id,
        },
      ],
    };
  }

  const mismatches: ReplayMismatch[] = [];
  const byFrame = new Map<number, RecordedCommand[]>();
  for (const entry of recording.commands) {
    const existing = byFrame.get(entry.frame);
    if (existing) existing.push(entry);
    else byFrame.set(entry.frame, [entry]);
  }
  for (const list of byFrame.values()) list.sort((a, b) => a.sequence - b.sequence);

  /**
   * Where each checkpoint sits in the command stream.
   *
   * A checkpoint taken after k of the recording's commands must be compared
   * after exactly k have been replayed — not merely on the same frame. This is
   * the fix for the ordering ambiguity described on `Checkpoint.sequence`.
   */
  const positions = new Map<string, Checkpoint[]>();
  for (const checkpoint of recording.checkpoints) {
    const before = recording.commands.filter(
      (entry) => entry.sequence < checkpoint.sequence,
    ).length;
    const key = `${checkpoint.frame}:${before}`;
    const existing = positions.get(key);
    if (existing) existing.push(checkpoint);
    else positions.set(key, [checkpoint]);
  }

  let replayed = 0;
  let checked = 0;
  const lastFrame = Math.max(
    0,
    ...recording.checkpoints.map((checkpoint) => checkpoint.frame),
    ...recording.commands.map((entry) => entry.frame),
  );

  // A checkpoint is compared once. `compare()` is called at several points that
  // can describe the same position — a step that does not advance the clock
  // reaches the same (frame, sequence) twice — and counting a checkpoint twice
  // would inflate `checkpointsChecked` into a number that means nothing.
  const consumed = new Set<Checkpoint>();

  const compare = (): void => {
    const frame = target.host.runtime.clock.frame;
    for (const checkpoint of positions.get(`${frame}:${replayed}`) ?? []) {
      if (consumed.has(checkpoint)) continue;
      consumed.add(checkpoint);
      checked += 1;

      const actualSession = target.host.sessionHash();
      if (actualSession !== checkpoint.sessionHash) {
        mismatches.push({
          frame,
          kind: "session",
          expected: checkpoint.sessionHash,
          actual: actualSession,
        });
      }

      const actualNodes = target.host.reconciler.mirror.size;
      if (actualNodes !== checkpoint.nodeCount) {
        mismatches.push({
          frame,
          kind: "nodes",
          expected: String(checkpoint.nodeCount),
          actual: String(actualNodes),
        });
      }
    }
  };

  // Frame by frame. Within a frame, compare before the frame's commands, after
  // each one, and again after the step — because a live checkpoint could have
  // been taken at any of those points, and the sequence watermark says which.
  //
  // Replaying every command up front and then running the frames would produce
  // the right final state by the wrong route, and would not catch an ordering
  // bug — which is most of what this tool is for.
  compare();
  for (let frame = 0; frame <= lastFrame; frame += 1) {
    for (const entry of byFrame.get(frame) ?? []) {
      target.host.applyLive(entry.command, "replay");
      replayed += 1;
      compare();
    }
    target.step((frame * 1000) / 60);
    compare();
  }

  return {
    matched: mismatches.length === 0,
    checkpointsChecked: checked,
    commandsReplayed: replayed,
    mismatches,
  };
}

/** Serializes a recording. JSON so it can be attached to a bug report. */
export function serializeRecording(recording: Recording): string {
  return JSON.stringify(recording, null, 2);
}

export function parseRecording(json: string): Recording {
  const parsed = JSON.parse(json) as Recording;
  if (typeof parsed.sceneId !== "string" || !Array.isArray(parsed.commands)) {
    throw new Error("not a recording");
  }
  return parsed;
}
