/**
 * Frame history — the record the performance tools reason over.
 *
 * ============================================================================
 * WHY A SECOND BUFFER
 * ============================================================================
 * `MetricsRecorder` keeps a 240-sample window and reports mean/p95/max. That is
 * the right thing for an always-on overlay: fixed cost, fixed memory, answers
 * "is it fine right now".
 *
 * It cannot answer the questions an engineer actually arrives with:
 *
 *   "It got slower — when, and by how much?"
 *   "Something spiked. Which frame, and what was in it?"
 *   "Is this branch slower than main?"
 *
 * Those need per-frame samples retained over a longer window, a baseline to
 * compare against, and outlier detection. So this keeps the samples themselves
 * rather than a rolling summary, and every derived number here is computed from
 * them on demand rather than accumulated — an accumulator that drifts is a
 * performance tool that lies, and this one has to be believed.
 */
import type { FrameTimings, ProjectionReport } from "@bracketx/engine-host";

/** ~30 seconds at 60fps. Long enough to hold a regression, bounded so it cannot leak. */
export const HISTORY_CAPACITY = 1800;

export const FRAME_BUDGET_MS = 1000 / 60;

export interface FrameSample {
  readonly frame: number;
  readonly total: number;
  readonly runtime: number;
  readonly animation: number;
  readonly render: number;
  readonly backendWrites: number;
  readonly dirtyNodes: number;
  readonly nodesCreated: number;
  readonly nodesDestroyed: number;
}

/** The numeric fields of a sample that can be summarised. */
export type SampleField =
  | "total"
  | "runtime"
  | "animation"
  | "render"
  | "backendWrites"
  | "dirtyNodes";

export const SAMPLE_FIELDS: readonly SampleField[] = [
  "total",
  "runtime",
  "animation",
  "render",
  "backendWrites",
  "dirtyNodes",
];

export interface Distribution {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export const EMPTY_DISTRIBUTION: Distribution = {
  count: 0,
  min: 0,
  max: 0,
  mean: 0,
  p50: 0,
  p90: 0,
  p95: 0,
  p99: 0,
};

/**
 * Nearest-rank percentile.
 *
 * Not interpolated. An interpolated p99 over 200 samples invents a frame that
 * never happened; nearest-rank always names a frame that did, which is the one
 * an engineer is about to go and look at.
 */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return EMPTY_DISTRIBUTION;
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const value of values) sum += value;
  return {
    count: values.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / values.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

export interface Spike {
  readonly frame: number;
  readonly value: number;
  /** How many times the median this sample was. */
  readonly ratio: number;
  /** The field that contributed most of the excess over the median. */
  readonly dominant: SampleField;
}

/**
 * Median absolute deviation.
 *
 * Standard deviation is the obvious choice and the wrong one: frame times are
 * exactly the distribution where a handful of enormous outliers inflate σ until
 * they no longer look like outliers. MAD is unmoved by them, so a spike stays a
 * spike no matter how many spikes there are.
 */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return percentile(deviations, 0.5);
}

export interface SpikeOptions {
  /** Multiples of MAD above the median before a sample is a spike. */
  readonly sigma?: number;
  /** Ignore samples below this absolute value. Noise at 0.001ms is not a spike. */
  readonly floorMs?: number;
}

/**
 * Robust outlier detection over the total frame time.
 *
 * Two guards, both learned the hard way from metrics tools that cry wolf:
 *
 *  - A floor on MAD. A perfectly steady scene has MAD 0, which makes any
 *    deviation infinitely many sigmas and turns rounding noise into an alert.
 *  - An absolute floor. A 0.004ms frame among 0.001ms frames is a 4x outlier
 *    and completely irrelevant; nobody is debugging four microseconds.
 */
export function findSpikes(
  samples: readonly FrameSample[],
  options: SpikeOptions = {},
): readonly Spike[] {
  if (samples.length < 8) return [];
  const sigma = options.sigma ?? 6;
  const floorMs = options.floorMs ?? 0.25;

  const totals = samples.map((sample) => sample.total);
  const median = percentile([...totals].sort((a, b) => a - b), 0.5);
  const mad = Math.max(medianAbsoluteDeviation(totals), median * 0.05, 1e-6);
  const threshold = Math.max(median + sigma * mad, floorMs);

  const out: Spike[] = [];
  for (const sample of samples) {
    if (sample.total <= threshold) continue;
    // Name the phase responsible rather than making the reader eyeball three
    // bars. "Spike at frame 812 — render" is one step from a fix; "spike at
    // frame 812" is the start of an investigation.
    const parts: readonly [SampleField, number][] = [
      ["runtime", sample.runtime],
      ["animation", sample.animation],
      ["render", sample.render],
    ];
    let dominant: SampleField = "total";
    let best = -Infinity;
    for (const [field, value] of parts) {
      if (value > best) {
        best = value;
        dominant = field;
      }
    }
    out.push({
      frame: sample.frame,
      value: sample.total,
      ratio: median > 0 ? sample.total / median : Infinity,
      dominant,
    });
  }
  return out;
}

export interface Baseline {
  readonly label: string;
  readonly capturedAtFrame: number;
  readonly sampleCount: number;
  readonly stats: Readonly<Record<SampleField, Distribution>>;
}

export interface Regression {
  readonly field: SampleField;
  readonly baseline: number;
  readonly current: number;
  /** Signed fraction: +0.18 means 18% slower than the baseline. */
  readonly delta: number;
  readonly verdict: "slower" | "faster" | "unchanged";
}

/** Below this, a difference is noise dressed as a finding. */
const MATERIAL_DELTA = 0.1;

/**
 * Compares two captures on p95, not mean.
 *
 * The mean hides the frames that drop. p95 is the frame an engineer will
 * actually be shown a video of, so it is the number a regression should be
 * declared on.
 */
export function compareToBaseline(
  baseline: Baseline,
  current: Readonly<Record<SampleField, Distribution>>,
  minimumAbsolute = 0.02,
): readonly Regression[] {
  const out: Regression[] = [];
  for (const field of SAMPLE_FIELDS) {
    const before = baseline.stats[field].p95;
    const after = current[field].p95;
    if (before === 0 && after === 0) continue;

    // Both tiny: the ratio is arithmetically huge and materially meaningless.
    // Timing fields only — counts have no millisecond floor to fall under.
    const isTiming = field !== "backendWrites" && field !== "dirtyNodes";
    if (isTiming && before < minimumAbsolute && after < minimumAbsolute) continue;

    const delta = before === 0 ? Infinity : (after - before) / before;
    out.push({
      field,
      baseline: before,
      current: after,
      delta,
      verdict:
        Math.abs(delta) < MATERIAL_DELTA
          ? "unchanged"
          : delta > 0
            ? "slower"
            : "faster",
    });
  }
  return out;
}

/**
 * A bounded ring of frame samples.
 *
 * Bounded because a workbench left open for a rehearsal day would otherwise
 * accumulate several million objects; the engine is meant to run for the length
 * of a show and so is the tool watching it.
 */
export class FrameHistory {
  #samples: FrameSample[] = [];
  #start = 0;
  readonly capacity: number;

  constructor(capacity: number = HISTORY_CAPACITY) {
    this.capacity = capacity;
  }

  record(frame: number, timings: FrameTimings, report: ProjectionReport | null): void {
    this.push({
      frame,
      total: timings.total,
      runtime: timings.runtime,
      animation: timings.animation,
      render: timings.render,
      backendWrites: report?.backendWrites ?? 0,
      dirtyNodes: report
        ? report.dirty.transform +
          report.dirty.material +
          report.dirty.hierarchy +
          report.dirty.visibility +
          report.dirty.camera
        : 0,
      nodesCreated: report?.nodesCreated ?? 0,
      nodesDestroyed: report?.nodesDestroyed ?? 0,
    });
  }

  push(sample: FrameSample): void {
    if (this.#samples.length < this.capacity) {
      this.#samples.push(sample);
      return;
    }
    this.#samples[this.#start] = sample;
    this.#start = (this.#start + 1) % this.capacity;
  }

  get size(): number {
    return this.#samples.length;
  }

  /**
   * Oldest first. Materialised only when a tool is open.
   *
   * Always a COPY, even before the ring wraps. Returning the live array while
   * `#start` was still zero handed callers a buffer that kept growing under
   * them: a benchmark that captured 30 samples was silently measuring 1,800 by
   * the time it ran, and a panel that held a window would have drifted the same
   * way. Found by a benchmark that made no sense — two windows of very
   * different sizes reporting identical cost.
   */
  samples(): readonly FrameSample[] {
    if (this.#start === 0) return this.#samples.slice();
    return [...this.#samples.slice(this.#start), ...this.#samples.slice(0, this.#start)];
  }

  /**
   * The last `count` samples, oldest first.
   *
   * Reads the ring directly rather than materialising the whole history and
   * slicing it. The findings panel asks for 300 of a retained 1,800 ten times a
   * second; copying 1,800 to return 300 is six times the work for the same
   * answer, and this is the sampled path.
   */
  recent(count: number): readonly FrameSample[] {
    const size = this.#samples.length;
    const take = Math.min(count, size);
    const out: FrameSample[] = new Array(take);
    // The newest sample sits just before #start once the ring has wrapped.
    const newest = size < this.capacity ? size - 1 : (this.#start - 1 + size) % size;
    for (let offset = 0; offset < take; offset += 1) {
      out[take - 1 - offset] = this.#samples[(newest - offset + size) % size]!;
    }
    return out;
  }

  stats(
    samples: readonly FrameSample[] = this.samples(),
  ): Readonly<Record<SampleField, Distribution>> {
    const out = {} as Record<SampleField, Distribution>;
    for (const field of SAMPLE_FIELDS) {
      out[field] = distribution(samples.map((sample) => sample[field]));
    }
    return out;
  }

  captureBaseline(label: string): Baseline | null {
    const samples = this.samples();
    if (samples.length === 0) return null;
    return {
      label,
      capturedAtFrame: samples[samples.length - 1]!.frame,
      sampleCount: samples.length,
      stats: this.stats(samples),
    };
  }

  clear(): void {
    this.#samples = [];
    this.#start = 0;
  }
}

/**
 * Downsamples to at most `width` buckets, keeping the WORST sample in each.
 *
 * Averaging into buckets is the default and it is wrong here: it smooths away
 * the single 40ms frame that is the entire reason someone opened the graph. A
 * performance chart that hides spikes is decoration.
 */
export function bucketMax(
  samples: readonly FrameSample[],
  field: SampleField,
  width: number,
): readonly { frame: number; value: number }[] {
  if (samples.length === 0 || width <= 0) return [];
  if (samples.length <= width) {
    return samples.map((sample) => ({ frame: sample.frame, value: sample[field] }));
  }

  const per = samples.length / width;
  const out: { frame: number; value: number }[] = [];
  for (let bucket = 0; bucket < width; bucket += 1) {
    const from = Math.floor(bucket * per);
    const to = Math.min(samples.length, Math.floor((bucket + 1) * per));
    let best = samples[from]!;
    for (let index = from + 1; index < to; index += 1) {
      if (samples[index]![field] > best[field]) best = samples[index]!;
    }
    out.push({ frame: best.frame, value: best[field] });
  }
  return out;
}

/** Trailing moving average. Used to show trend under a noisy series. */
export function movingAverage(
  values: readonly number[],
  window: number,
): readonly number[] {
  if (window <= 1) return values;
  const out: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]!;
    if (index >= window) sum -= values[index - window]!;
    out.push(sum / Math.min(index + 1, window));
  }
  return out;
}
