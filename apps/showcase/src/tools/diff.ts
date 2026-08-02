/**
 * Differences between two captures.
 *
 * ============================================================================
 * WHY THE WORKBENCH NEEDS ITS OWN DIFF
 * ============================================================================
 * `sessionHash()` answers "are these two states the same" perfectly and
 * usefully — it is what makes replay verification meaningful. It is also
 * completely unhelpful when the answer is no, because two 64-character strings
 * that differ tell you nothing about WHERE.
 *
 * So: the hash decides, and this explains. The hash stays the authority; if
 * this diff finds no differences while the hashes disagree, that is a bug in
 * THIS file, and the test suite asserts exactly that relationship rather than
 * letting the pretty output become the thing people trust.
 *
 * Two shapes are diffed:
 *   - `SessionSnapshot` — two moments, or two branches, of one production
 *   - `Recording` — two captures of the same scenario, which is how you find
 *     out that the fifth run diverges at frame 240
 */
import type { SessionSnapshot } from "@bracketx/engine-host";

import type { Recording } from "./recorder";

export type ChangeKind = "added" | "removed" | "changed";

export interface Difference {
  /** Dotted path into the snapshot, e.g. `variables.entries[3].score`. */
  readonly path: string;
  readonly kind: ChangeKind;
  readonly before: unknown;
  readonly after: unknown;
}

export interface SnapshotDiff {
  readonly identical: boolean;
  readonly differences: readonly Difference[];
  /** True when the walk hit its cap. A partial diff must never look complete. */
  readonly truncated: boolean;
}

const MAX_DIFFERENCES = 200;
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural comparison, bounded in both breadth and depth.
 *
 * Bounded because a production variable can hold a three-thousand-row
 * collection and an unbounded diff of two of those produces a report nobody
 * reads, computed at a cost nobody wanted. Arrays that differ only in length
 * report the length rather than every element.
 */
function walk(
  path: string,
  before: unknown,
  after: unknown,
  out: Difference[],
  depth: number,
): void {
  if (out.length >= MAX_DIFFERENCES) return;
  if (Object.is(before, after)) return;

  if (depth >= MAX_DEPTH) {
    out.push({ path, kind: "changed", before, after });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      out.push({
        path: `${path}.length`,
        kind: "changed",
        before: before.length,
        after: after.length,
      });
    }
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) {
      walk(`${path}[${index}]`, before[index], after[index], out, depth + 1);
      if (out.length >= MAX_DIFFERENCES) return;
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const hasBefore = key in before;
      const hasAfter = key in after;
      const child = path.length === 0 ? key : `${path}.${key}`;
      if (!hasBefore) {
        out.push({ path: child, kind: "added", before: undefined, after: after[key] });
      } else if (!hasAfter) {
        out.push({ path: child, kind: "removed", before: before[key], after: undefined });
      } else {
        walk(child, before[key], after[key], out, depth + 1);
      }
      if (out.length >= MAX_DIFFERENCES) return;
    }
    return;
  }

  out.push({ path, kind: "changed", before, after });
}

/**
 * INVOKED. Everything that differs between two session snapshots.
 *
 * `runtimeHash` and `commandsApplied` are deliberately included rather than
 * skipped: when two states differ only in their hash, the diff is wrong and the
 * reader should see that immediately instead of being told "identical".
 */
export function diffSnapshots(
  before: SessionSnapshot,
  after: SessionSnapshot,
): SnapshotDiff {
  const differences: Difference[] = [];
  walk("", before as unknown, after as unknown, differences, 0);
  return {
    identical: differences.length === 0,
    differences,
    truncated: differences.length >= MAX_DIFFERENCES,
  };
}

export interface RecordingDiff {
  readonly sameScene: boolean;
  /** The first frame at which the two recordings disagree. Null when they agree. */
  readonly divergedAtFrame: number | null;
  readonly checkpointsCompared: number;
  readonly commandDifferences: readonly Difference[];
  readonly checkpointDifferences: readonly {
    readonly frame: number;
    readonly field: "sessionHash" | "runtimeHash" | "nodeCount";
    readonly before: string;
    readonly after: string;
  }[];
}

/**
 * INVOKED. Compares two recordings of the same scenario.
 *
 * The question this answers is the one that matters after an intermittent bug
 * report: "run it twice, do they agree, and if not, from which frame". The
 * first disagreeing checkpoint is reported explicitly, because everything after
 * a divergence is consequence rather than cause.
 */
export function diffRecordings(before: Recording, after: Recording): RecordingDiff {
  if (before.sceneId !== after.sceneId) {
    return {
      sameScene: false,
      divergedAtFrame: null,
      checkpointsCompared: 0,
      commandDifferences: [
        { path: "sceneId", kind: "changed", before: before.sceneId, after: after.sceneId },
      ],
      checkpointDifferences: [],
    };
  }

  const commandDifferences: Difference[] = [];
  walk(
    "commands",
    before.commands.map((entry) => ({ frame: entry.frame, source: entry.source, command: entry.command })),
    after.commands.map((entry) => ({ frame: entry.frame, source: entry.source, command: entry.command })),
    commandDifferences,
    1,
  );

  // Keyed by frame AND sequence: several checkpoints can share a frame, and
  // pairing them by frame alone would compare a before-command state against
  // an after-command one and call it a divergence.
  const afterByFrame = new Map(
    after.checkpoints.map((entry) => [`${entry.frame}:${entry.sequence}`, entry]),
  );
  const checkpointDifferences: {
    frame: number;
    field: "sessionHash" | "runtimeHash" | "nodeCount";
    before: string;
    after: string;
  }[] = [];
  let compared = 0;
  let diverged: number | null = null;

  for (const checkpoint of before.checkpoints) {
    const other = afterByFrame.get(`${checkpoint.frame}:${checkpoint.sequence}`);
    if (other === undefined) continue;
    compared += 1;

    const fields = [
      ["sessionHash", checkpoint.sessionHash, other.sessionHash],
      ["runtimeHash", checkpoint.runtimeHash, other.runtimeHash],
      ["nodeCount", String(checkpoint.nodeCount), String(other.nodeCount)],
    ] as const;

    for (const [field, left, right] of fields) {
      if (left === right) continue;
      checkpointDifferences.push({ frame: checkpoint.frame, field, before: left, after: right });
      if (diverged === null || checkpoint.frame < diverged) diverged = checkpoint.frame;
    }
  }

  return {
    sameScene: true,
    divergedAtFrame: diverged,
    checkpointsCompared: compared,
    commandDifferences,
    checkpointDifferences,
  };
}

/** A one-line summary for a diff row. Values are previewed, never dumped. */
export function describeDifference(difference: Difference): string {
  const preview = (value: unknown): string => {
    if (value === undefined) return "—";
    if (Array.isArray(value)) return `array(${value.length})`;
    if (typeof value === "object" && value !== null) return "{…}";
    const text = String(value);
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  };
  return `${difference.path}: ${preview(difference.before)} → ${preview(difference.after)}`;
}
