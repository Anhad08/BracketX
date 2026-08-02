/**
 * The stress laboratory.
 *
 * ============================================================================
 * A DASHBOARD SHOWS. A LABORATORY ANSWERS.
 * ============================================================================
 * V2's stress dashboard had buttons that made the scene bigger and an overlay
 * that showed the frame cost. To answer "where does this stop fitting in a
 * frame" an engineer clicked, squinted, wrote a number down, clicked again —
 * and got a result that depended on what else the machine was doing between
 * clicks.
 *
 * A sweep does the same thing in one call, on a paused clock, at fixed wall
 * times, and produces a table. That makes it repeatable, comparable across
 * branches, and — because it is a pure function of a session and a list of
 * sizes — testable without a browser.
 *
 * The axes split in two, and the split is not arbitrary:
 *
 *   RUNTIME axes (collection size, clips, outputs, command rate, speed,
 *     direction) are expressible as commands, so the laboratory drives them
 *     through the same command path everything else uses.
 *
 *   DOCUMENT axes (node count, hierarchy depth) are scene SHAPE. No command can
 *     change them, and inventing one would mean a command that edits the
 *     document — precisely the RFC-002 §4.3 boundary the engine is built on. So
 *     those go through a rebuild with parameters instead.
 */
import type { LiveCommand } from "@bracketx/engine-host";

import type { SceneParameters } from "../registry";
import type { ShowcaseSession } from "../engine/session";
import {
  FRAME_BUDGET_MS,
  FrameHistory,
  type Distribution,
  type SampleField,
} from "../engine/history";

export interface StressConfig {
  readonly id: string;
  readonly label: string;
  /** Build parameters. Applying these reloads the document. */
  readonly parameters: SceneParameters;
  /** Rows pushed into the driven collection. */
  readonly collectionSize: number;
  /** Clips started. Capped by what the scene declares. */
  readonly clips: number;
  /** Total bound outputs, including the default. */
  readonly outputs: number;
  /** Patches per second pushed at the collection. */
  readonly commandRate: number;
  /** Signed: negative plays backwards. Zero pauses. */
  readonly playbackSpeed: number;
}

export const DEFAULT_STRESS: StressConfig = {
  id: "default",
  label: "Default",
  parameters: {},
  collectionSize: 50,
  clips: 0,
  outputs: 1,
  commandRate: 0,
  playbackSpeed: 1,
};

/**
 * Named starting points.
 *
 * Presets exist so a bug report can say "reproduced on `feed-storm`" instead of
 * describing six slider positions, and so the interesting configurations are
 * discoverable rather than folklore.
 */
export const STRESS_PRESETS: readonly StressConfig[] = [
  { ...DEFAULT_STRESS, id: "idle", label: "Idle", collectionSize: 10 },
  {
    ...DEFAULT_STRESS,
    id: "broadcast",
    label: "Broadcast",
    collectionSize: 50,
    clips: 2,
    outputs: 2,
    commandRate: 10,
  },
  {
    ...DEFAULT_STRESS,
    id: "leaderboard",
    label: "Big leaderboard",
    collectionSize: 1000,
    clips: 0,
    outputs: 1,
    commandRate: 5,
  },
  {
    ...DEFAULT_STRESS,
    id: "feed-storm",
    label: "Feed storm",
    collectionSize: 500,
    clips: 4,
    outputs: 2,
    commandRate: 120,
  },
  {
    ...DEFAULT_STRESS,
    id: "everything",
    label: "Everything at once",
    collectionSize: 3000,
    clips: 8,
    outputs: 4,
    commandRate: 60,
  },
  {
    ...DEFAULT_STRESS,
    id: "reverse",
    label: "Reverse playback",
    collectionSize: 200,
    clips: 4,
    outputs: 1,
    commandRate: 0,
    playbackSpeed: -1,
  },
];

/**
 * Deterministic rows.
 *
 * No `Math.random`. A stress run whose input is random cannot be compared to
 * the run before it, which defeats the entire purpose of measuring twice.
 */
export function stressRows(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    name: `Row ${index}`,
    score: (count - index) * 3,
    // A cheap hash, so colours vary but repeat exactly.
    color: `#${(((index * 2654435761) >>> 8) & 0xffffff).toString(16).padStart(6, "0")}`,
  }));
}

/**
 * The commands that put a session into a configuration.
 *
 * Pure, so the whole configuration is inspectable and testable before anything
 * is applied. Everything the laboratory does at runtime goes through this list
 * and therefore through the command log — a stress run is as replayable as a
 * show.
 */
export function configCommands(
  config: StressConfig,
  options: {
    readonly collectionKey: string;
    readonly clipIds: readonly string[];
    readonly outputPrefix?: string;
    readonly maxOutputs?: number;
  },
): readonly LiveCommand[] {
  const out: LiveCommand[] = [];
  const prefix = options.outputPrefix ?? "stress";
  const maxOutputs = options.maxOutputs ?? 8;

  out.push({
    type: "collection.replace",
    key: options.collectionKey,
    items: stressRows(config.collectionSize),
  } as LiveCommand);

  for (let index = 0; index < options.clipIds.length; index += 1) {
    const clipId = options.clipIds[index]!;
    out.push(
      index < config.clips
        ? ({ type: "clip.play", clipId } as LiveCommand)
        : ({ type: "clip.stop", clipId } as LiveCommand),
    );
  }

  // Unbind first, then bind up to the requested count. Unconditional unbinds
  // keep the command list a function of the target state alone, so applying
  // the same config twice is a no-op rather than an accumulation.
  for (let index = 1; index < maxOutputs; index += 1) {
    out.push({ type: "output.unbind", id: `${prefix}${index}` } as LiveCommand);
  }
  for (let index = 1; index < config.outputs; index += 1) {
    out.push({
      type: "output.bind",
      output: { id: `${prefix}${index}`, width: 960, height: 540, cadence: index + 1 },
    } as LiveCommand);
  }

  if (config.playbackSpeed === 0) {
    out.push({ type: "playback.pause" } as LiveCommand);
  } else {
    out.push({ type: "playback.play" } as LiveCommand);
  }

  return out;
}

export interface SweepPoint {
  readonly label: string;
  readonly collectionSize: number;
  readonly nodeCount: number;
  readonly frames: number;
  readonly stats: Readonly<Record<SampleField, Distribution>>;
  /** p95 frame cost as a share of the 60fps budget. */
  readonly budgetRatio: number;
  readonly fits: boolean;
}

export interface SweepOptions {
  readonly collectionKey: string;
  /** Frames measured per point. Enough for a p95 to mean something. */
  readonly framesPerPoint?: number;
  /** Frames run and discarded before measuring, so a rebuild is not counted. */
  readonly warmupFrames?: number;
}

/**
 * Runs a size sweep and reports where the frame budget breaks.
 *
 * ========================================================================
 * WHY THIS IS DETERMINISTIC AND THE OLD DASHBOARD WAS NOT
 * ========================================================================
 * Frames are stepped by hand at fixed wall times rather than by
 * `requestAnimationFrame`, so a sweep produces the same frame sequence on a
 * loaded machine as on an idle one. The absolute milliseconds still depend on
 * the hardware — nothing can fix that — but the WORK is identical, which is
 * what makes two runs comparable.
 *
 * The warmup matters: the first frames after a collection replace include the
 * mirror rebuild, and folding a one-off rebuild into a steady-state p95 reports
 * a cliff that does not exist.
 */
export function runSweep(
  session: ShowcaseSession,
  sizes: readonly number[],
  options: SweepOptions,
): readonly SweepPoint[] {
  const framesPerPoint = options.framesPerPoint ?? 60;
  const warmup = options.warmupFrames ?? 10;
  const points: SweepPoint[] = [];
  let wall = 0;

  session.stop();
  for (const size of sizes) {
    session.send(
      {
        type: "collection.replace",
        key: options.collectionKey,
        items: stressRows(size),
      } as LiveCommand,
      "sweep",
    );

    for (let index = 0; index < warmup; index += 1) {
      wall += FRAME_BUDGET_MS;
      session.step(wall);
    }

    const history = new FrameHistory(framesPerPoint);
    for (let index = 0; index < framesPerPoint; index += 1) {
      wall += FRAME_BUDGET_MS;
      const result = session.step(wall);
      history.record(result.frame, result.timings, session.host.lastReport);
    }

    const stats = history.stats();
    points.push({
      label: `${size}`,
      collectionSize: size,
      nodeCount: session.host.reconciler.mirror.size,
      frames: framesPerPoint,
      stats,
      budgetRatio: stats.total.p95 / FRAME_BUDGET_MS,
      fits: stats.total.p95 <= FRAME_BUDGET_MS,
    });
  }

  return points;
}

/**
 * The largest swept size that still fits in a frame.
 *
 * Null when nothing fit, which is a real answer and must not be reported as
 * zero — "0 rows fit" and "the smallest size we tried already missed" are
 * different findings.
 */
export function budgetCeiling(points: readonly SweepPoint[]): SweepPoint | null {
  let best: SweepPoint | null = null;
  for (const point of points) {
    if (point.fits && (best === null || point.collectionSize > best.collectionSize)) {
      best = point;
    }
  }
  return best;
}

/** Serialises a saved configuration. JSON so it can go in a bug report. */
export function serializeConfig(config: StressConfig): string {
  return JSON.stringify(config, null, 2);
}

export function parseConfig(json: string): StressConfig {
  const parsed = JSON.parse(json) as Partial<StressConfig>;
  if (typeof parsed.id !== "string" || typeof parsed.collectionSize !== "number") {
    throw new Error("not a stress configuration");
  }
  return { ...DEFAULT_STRESS, ...parsed } as StressConfig;
}
