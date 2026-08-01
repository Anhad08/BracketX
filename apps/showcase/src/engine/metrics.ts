/**
 * Rolling frame metrics.
 *
 * A performance overlay showing the LAST frame is nearly useless — frame times
 * are noisy, and the number the eye lands on is whichever one happened to
 * render. What matters on air is the distribution: the typical frame, and the
 * worst one in recent memory, because the worst one is the dropped frame.
 *
 * So this keeps a fixed-size ring and reports mean, p95, and max over it. Fixed
 * size because a metrics buffer that grows is a leak in a process meant to run
 * for the length of a show.
 */
import type { FrameTimings, ProjectionReport } from "@bracketx/engine-host";

/** ~4 seconds at 60fps. Long enough to be stable, short enough to react. */
const WINDOW = 240;

export interface Stat {
  readonly last: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
}

export interface Metrics {
  readonly samples: number;
  /** Frames per second, derived from mean total frame time. */
  readonly fps: number;
  /** Share of a 60fps frame the engine consumed, 0..1+. */
  readonly budget: number;

  readonly total: Stat;
  readonly runtime: Stat;
  readonly animation: Stat;
  readonly render: Stat;

  /** Backend writes per frame — the measure of "did we touch only changes". */
  readonly backendWrites: Stat;
  readonly dirtyNodes: Stat;
}

const FRAME_BUDGET_MS = 1000 / 60;

const EMPTY_STAT: Stat = { last: 0, mean: 0, p95: 0, max: 0 };

/** A fixed-capacity ring of numbers with cheap statistics. */
class Ring {
  #values: Float64Array;
  #index = 0;
  #count = 0;
  #sum = 0;

  constructor(capacity: number) {
    this.#values = new Float64Array(capacity);
  }

  push(value: number): void {
    // Subtract the value being overwritten rather than re-summing: an overlay
    // updating 60 times a second over a 240-sample window would otherwise do
    // 14,400 additions a second to display one number.
    if (this.#count === this.#values.length) {
      this.#sum -= this.#values[this.#index]!;
    } else {
      this.#count += 1;
    }
    this.#values[this.#index] = value;
    this.#sum += value;
    this.#index = (this.#index + 1) % this.#values.length;
  }

  stat(): Stat {
    if (this.#count === 0) return EMPTY_STAT;

    const used = this.#values.subarray(0, this.#count);
    let max = -Infinity;
    for (const value of used) if (value > max) max = value;

    // Sorting a 240-element array per read is ~microseconds and happens once
    // per overlay update, not once per frame.
    const sorted = Float64Array.from(used).sort();
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;

    const lastIndex =
      (this.#index - 1 + this.#values.length) % this.#values.length;

    return {
      last: this.#values[lastIndex]!,
      mean: this.#sum / this.#count,
      p95,
      max,
    };
  }

  get count(): number {
    return this.#count;
  }

  clear(): void {
    this.#values.fill(0);
    this.#index = 0;
    this.#count = 0;
    this.#sum = 0;
  }
}

export class MetricsRecorder {
  #total = new Ring(WINDOW);
  #runtime = new Ring(WINDOW);
  #animation = new Ring(WINDOW);
  #render = new Ring(WINDOW);
  #writes = new Ring(WINDOW);
  #dirty = new Ring(WINDOW);

  record(timings: FrameTimings, report: ProjectionReport | null): void {
    this.#total.push(timings.total);
    this.#runtime.push(timings.runtime);
    this.#animation.push(timings.animation);
    this.#render.push(timings.render);

    this.#writes.push(report?.backendWrites ?? 0);
    this.#dirty.push(
      report
        ? report.dirty.transform +
            report.dirty.material +
            report.dirty.hierarchy +
            report.dirty.visibility +
            report.dirty.camera
        : 0,
    );
  }

  snapshot(): Metrics {
    const total = this.#total.stat();
    return {
      samples: this.#total.count,
      fps: total.mean > 0 ? 1000 / total.mean : 0,
      budget: total.mean / FRAME_BUDGET_MS,
      total,
      runtime: this.#runtime.stat(),
      animation: this.#animation.stat(),
      render: this.#render.stat(),
      backendWrites: this.#writes.stat(),
      dirtyNodes: this.#dirty.stat(),
    };
  }

  clear(): void {
    this.#total.clear();
    this.#runtime.clear();
    this.#animation.clear();
    this.#render.clear();
    this.#writes.clear();
    this.#dirty.clear();
  }
}
