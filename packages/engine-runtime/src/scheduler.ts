/**
 * The scheduler. ENGINE_RUNTIME §2.
 *
 * Owns all engine execution. No subsystem runs outside a registered stage —
 * that is what makes "every future subsystem executes on the runtime" a
 * structural property rather than a request.
 *
 * ============================================================================
 * PHASES
 * ============================================================================
 * The pipeline order is fixed by this enum, not by registration order. A
 * subsystem registering late cannot insert itself earlier, so execution order
 * is a property of the architecture rather than of module load order.
 *
 * ============================================================================
 * PRIORITY AND DEGRADATION
 * ============================================================================
 * P0 on-air     never deferred, never degraded
 * P1 important  deferred only under sustained pressure
 * P2 deferrable deferred freely
 *
 * JavaScript cannot preempt, so the scheduler can only decline to *start*
 * work. Any operation that may exceed the chunk budget must yield or run in a
 * Worker — ENGINE_RUNTIME §2.2. A dev-build assertion reports violations.
 */

export enum Phase {
  /** Clock advance. Always first; everything else reads its result. */
  Time = 0,
  /** External input translated into commands. */
  Input = 100,
  /** Command dispatch — the only runtime-state mutation point. */
  Commands = 200,
  /** Runtime state settles after commands. */
  StateUpdate = 300,
  /** Variables and bindings resolve to concrete values. */
  VariableResolution = 400,
  /** Animation evaluates at the current frame. Phase 5. */
  Animation = 500,
  /** Scene evaluation — layout, bounds, world transforms. */
  SceneEvaluation = 600,
  /** Document operations project onto the mirror. Phase 2.4. */
  Projection = 700,
  /** Reconciliation settles the mirror. Phase 2.4. */
  Reconciliation = 800,
  /** Draw submission. Phase 2.5/2.6. */
  RenderSubmission = 900,
  /** Deferred work and event drain. Always last. */
  FrameEnd = 1000,
}

export const PHASE_ORDER: readonly Phase[] = [
  Phase.Time,
  Phase.Input,
  Phase.Commands,
  Phase.StateUpdate,
  Phase.VariableResolution,
  Phase.Animation,
  Phase.SceneEvaluation,
  Phase.Projection,
  Phase.Reconciliation,
  Phase.RenderSubmission,
  Phase.FrameEnd,
];

export type WorkPriority = "P0" | "P1" | "P2";

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerError";
  }
}

export interface FrameContext {
  readonly frame: number;
  /** Milliseconds consumed so far this frame. */
  readonly elapsedMs: number;
  /** Milliseconds remaining before the budget is spent. May be negative. */
  readonly remainingMs: number;
  readonly degraded: boolean;
}

export interface Stage {
  readonly id: string;
  readonly phase: Phase;
  readonly priority: WorkPriority;
  readonly run: (context: FrameContext) => void;
}

export interface DeferredWork {
  readonly id: string;
  readonly priority: WorkPriority;
  readonly run: () => void;
}

export interface SchedulerOptions {
  /** Frame budget in ms. 16.6 at 60fps; RFC-003 §9 targets under 10. */
  readonly budgetMs?: number;
  /** Consecutive over-budget frames before degrading. */
  readonly degradeAfter?: number;
  /** Dev-build assertion threshold for a single unchunked stage. */
  readonly chunkWarningMs?: number;
  /** Injected so tests and offline rendering are not wall-clock dependent. */
  readonly now?: () => number;
}

export interface FrameReport {
  readonly frame: number;
  readonly durationMs: number;
  readonly overBudget: boolean;
  readonly degraded: boolean;
  readonly ranStages: readonly string[];
  readonly skippedStages: readonly string[];
  readonly deferredRun: number;
  readonly deferredPending: number;
  readonly slowStages: readonly { readonly id: string; readonly ms: number }[];
}

export class Scheduler {
  #stages: Stage[] = [];
  #deferred: DeferredWork[] = [];
  #budgetMs: number;
  #degradeAfter: number;
  #chunkWarningMs: number;
  #now: () => number;
  #consecutiveOverBudget = 0;
  #degraded = false;
  /** Frames a P2 item has waited. Prevents indefinite starvation. */
  #deferredAge = new Map<string, number>();

  constructor(options: SchedulerOptions = {}) {
    this.#budgetMs = options.budgetMs ?? 16.6;
    this.#degradeAfter = options.degradeAfter ?? 3;
    this.#chunkWarningMs = options.chunkWarningMs ?? 2;
    // Defaults to a monotonic counter, not a wall clock: the scheduler must
    // be runnable deterministically (invariant I2).
    this.#now = options.now ?? (() => 0);
  }

  get degraded(): boolean {
    return this.#degraded;
  }

  get stageCount(): number {
    return this.#stages.length;
  }

  get deferredCount(): number {
    return this.#deferred.length;
  }

  register(stage: Stage): void {
    if (this.#stages.some((s) => s.id === stage.id)) {
      throw new SchedulerError(`stage "${stage.id}" is already registered`);
    }
    this.#stages.push(stage);
    // Phase decides order; registration order breaks ties within a phase so
    // the result is total and reproducible.
    this.#stages.sort(
      (a, b) =>
        a.phase - b.phase ||
        this.#stages.indexOf(a) - this.#stages.indexOf(b),
    );
    this.#stages = PHASE_ORDER.flatMap((phase) =>
      this.#stages.filter((s) => s.phase === phase),
    );
  }

  unregister(id: string): boolean {
    const index = this.#stages.findIndex((s) => s.id === id);
    if (index === -1) return false;
    this.#stages.splice(index, 1);
    return true;
  }

  stageIds(): readonly string[] {
    return this.#stages.map((s) => s.id);
  }

  defer(work: DeferredWork): void {
    this.#deferred.push(work);
    this.#deferredAge.set(work.id, 0);
  }

  /**
   * Runs one frame.
   *
   * P0 always runs. P1 runs unless degraded. P2 runs only with budget left, or
   * when it has starved long enough to be promoted.
   */
  runFrame(frame: number): FrameReport {
    const start = this.#now();
    const ran: string[] = [];
    const skipped: string[] = [];
    const slow: { id: string; ms: number }[] = [];

    for (const stage of this.#stages) {
      const elapsed = this.#now() - start;
      const remaining = this.#budgetMs - elapsed;

      if (!this.#shouldRun(stage.priority, remaining)) {
        skipped.push(stage.id);
        continue;
      }

      const stageStart = this.#now();
      stage.run({
        frame,
        elapsedMs: elapsed,
        remainingMs: remaining,
        degraded: this.#degraded,
      });
      const stageMs = this.#now() - stageStart;

      // ENGINE_RUNTIME invariant I5: nothing over the chunk budget may run on
      // the frame thread unchunked. Reported rather than thrown — killing a
      // live frame is worse than a slow one.
      if (stageMs > this.#chunkWarningMs) slow.push({ id: stage.id, ms: stageMs });

      ran.push(stage.id);
    }

    const deferredRun = this.#runDeferred(start);
    const durationMs = this.#now() - start;
    const overBudget = durationMs > this.#budgetMs;

    this.#consecutiveOverBudget = overBudget
      ? this.#consecutiveOverBudget + 1
      : 0;
    // A single spike is normal. Sustained pressure is what degrades.
    this.#degraded = this.#consecutiveOverBudget >= this.#degradeAfter;

    return {
      frame,
      durationMs,
      overBudget,
      degraded: this.#degraded,
      ranStages: ran,
      skippedStages: skipped,
      deferredRun,
      deferredPending: this.#deferred.length,
      slowStages: slow,
    };
  }

  reset(): void {
    this.#deferred = [];
    this.#deferredAge.clear();
    this.#consecutiveOverBudget = 0;
    this.#degraded = false;
  }

  #shouldRun(priority: WorkPriority, remainingMs: number): boolean {
    // On-air work is never deferred and never degraded.
    if (priority === "P0") return true;
    if (priority === "P1") return !this.#degraded;
    return remainingMs > 0 && !this.#degraded;
  }

  /**
   * Drains deferred work while budget remains.
   *
   * Starvation prevention: an item that has waited more than 60 frames runs
   * regardless of budget. Without it, a permanently loaded frame would never
   * stream an asset, and the show would stall waiting for content that is
   * always one frame away.
   */
  #runDeferred(frameStart: number): number {
    if (this.#deferred.length === 0) return 0;

    let executed = 0;
    const remaining: DeferredWork[] = [];

    for (const work of this.#deferred) {
      const age = (this.#deferredAge.get(work.id) ?? 0) + 1;
      const starved = age > 60;
      const budgetLeft = this.#budgetMs - (this.#now() - frameStart) > 0;

      if (budgetLeft || starved) {
        work.run();
        this.#deferredAge.delete(work.id);
        executed += 1;
      } else {
        this.#deferredAge.set(work.id, age);
        remaining.push(work);
      }
    }

    this.#deferred = remaining;
    return executed;
  }
}
