/**
 * The Runtime — the engine kernel.
 *
 * Binds the clock, state, commands, events, scheduler, lifecycle, and services
 * into one execution authority. After this exists, no subsystem may run its
 * own loop, read its own clock, or mutate runtime state directly.
 *
 * ============================================================================
 * THE PIPELINE
 * ============================================================================
 *   Time -> Input -> Commands -> StateUpdate -> VariableResolution ->
 *   Animation -> SceneEvaluation -> Projection -> Reconciliation ->
 *   RenderSubmission -> FrameEnd
 *
 * Stages Time, Commands, StateUpdate, and FrameEnd are owned by the runtime
 * and always present. The rest are SLOTS: later subsystems register into them
 * and the phase enum fixes the order regardless of when they register.
 *
 * A slot with no registered stage simply does not run. It is not a stub —
 * there is no placeholder code to remove later.
 */
import { RuntimeClock, type ClockOptions } from "./clock";
import {
  CommandQueue,
  type Command,
  type CommandQueueOptions,
  type CommandRejection,
} from "./commands";
import {
  ENGINE_EVENTS,
  EventBus,
  SignalBus,
  type EventBusOptions,
} from "./events";
import { Lifecycle, type LifecycleState } from "./lifecycle";
import {
  Phase,
  Scheduler,
  type FrameReport,
  type SchedulerOptions,
  type Stage,
} from "./scheduler";
import { IdAllocator, ServiceRegistry } from "./services";
import {
  createRuntimeState,
  canonicalizeRuntimeState,
  hashRuntimeState,
  type RuntimeState,
} from "./state";

export interface RuntimeOptions {
  readonly clock?: ClockOptions;
  readonly queue?: CommandQueueOptions;
  readonly events?: EventBusOptions;
  readonly scheduler?: SchedulerOptions;
}

export interface TickReport {
  readonly frame: number;
  readonly framesAdvanced: number;
  readonly applied: number;
  readonly rejected: readonly CommandRejection[];
  readonly schedule: FrameReport;
  readonly eventsDelivered: number;
  readonly stateHash: string;
}

export class Runtime {
  readonly clock: RuntimeClock;
  readonly commands: CommandQueue;
  readonly signals: SignalBus;
  readonly events: EventBus;
  readonly scheduler: Scheduler;
  readonly lifecycle: Lifecycle;
  readonly services: ServiceRegistry;
  readonly ids: IdAllocator;

  #state: RuntimeState;
  #tickCount = 0;

  constructor(options: RuntimeOptions = {}) {
    this.clock = new RuntimeClock(options.clock);
    this.commands = new CommandQueue(options.queue);
    this.signals = new SignalBus();
    this.events = new EventBus(options.events);
    this.scheduler = new Scheduler(options.scheduler);
    this.lifecycle = new Lifecycle();
    this.services = new ServiceRegistry();
    this.ids = new IdAllocator();
    this.#state = createRuntimeState(this.clock.snapshot());

    this.#registerOwnedStages();
  }

  get state(): RuntimeState {
    return this.#state;
  }

  get tickCount(): number {
    return this.#tickCount;
  }

  get stateHash(): string {
    return hashRuntimeState(this.#state);
  }

  get canonicalState(): string {
    return canonicalizeRuntimeState(this.#state);
  }

  // -- Public surface ------------------------------------------------------

  /** Queues a command. The only way to mutate runtime state. */
  dispatch(command: Command): number {
    return this.commands.enqueue(command);
  }

  dispatchBatch(commands: readonly Command[]): number {
    return this.commands.enqueueBatch(commands);
  }

  registerStage(stage: Stage): void {
    this.scheduler.register(stage);
  }

  transitionTo(state: LifecycleState, reason?: string): void {
    const transition = this.lifecycle.transition(state, reason);
    this.events.publish({
      type: ENGINE_EVENTS.lifecycleChanged,
      payload: transition,
    });
  }

  /**
   * Advances one frame.
   *
   * `wallMs` is supplied by the host, never read here — invariant I2. Omitting
   * it runs in fixed-timestep mode, which is what offline rendering, replay,
   * and tests use.
   */
  tick(wallMs?: number): TickReport {
    const framesAdvanced =
      wallMs === undefined ? 0 : this.clock.advanceTo(wallMs);

    const schedule = this.scheduler.runFrame(this.clock.frame);
    const report = this.events.drain();
    this.#tickCount += 1;

    // Captured, so the report describes the state at this tick rather than
    // whatever the runtime holds when the caller reads it.
    const tickState = this.#state;

    return {
      frame: this.clock.frame,
      framesAdvanced,
      applied: this.#lastApplied,
      rejected: this.#lastRejected,
      schedule,
      eventsDelivered: report.delivered,
      // Lazy: hashing canonicalises the whole state and its cost grows with
      // variable count. Benchmarking found it running every frame whether or
      // not anyone read it — verification work on the hot path. Deferring it
      // made steady-state ticking 6.7x faster. Only determinism checks and
      // diagnostics ask for it.
      get stateHash(): string {
        return hashRuntimeState(tickState);
      },
    };
  }

  /** Fixed-timestep advance. Deterministic — no wall clock involved. */
  step(frames = 1): TickReport {
    this.clock.step(frames);
    return this.tick();
  }

  /**
   * Full reset: clock, state, queue, events, scheduler, ids.
   *
   * Services and registered stages survive, because they are wiring rather
   * than state. A reset that dropped stages would leave a runtime that can no
   * longer run anything.
   */
  reset(): void {
    this.clock.reset();
    this.#state = createRuntimeState(this.clock.snapshot());
    this.commands.clear();
    this.events.clear();
    this.scheduler.reset();
    this.ids.reset();
    this.#tickCount = 0;
    this.#lastApplied = 0;
    this.#lastRejected = [];
  }

  // -- Runtime-owned stages ------------------------------------------------

  #lastApplied = 0;
  #lastRejected: readonly CommandRejection[] = [];

  #registerOwnedStages(): void {
    // Commands: the single runtime-state mutation point. P0 — an operator
    // action must never be deferred.
    this.scheduler.register({
      id: "runtime.commands",
      phase: Phase.Commands,
      priority: "P0",
      run: () => {
        const result = this.commands.dispatch(this.#state, this.clock);
        this.#state = result.state;
        this.#lastApplied = result.applied.length;
        this.#lastRejected = result.rejected;

        for (const rejection of result.rejected) {
          this.events.publish({
            type: ENGINE_EVENTS.errorRaised,
            payload: rejection,
          });
        }
      },
    });

    // State update: settles the clock snapshot into state after commands may
    // have moved the clock.
    this.scheduler.register({
      id: "runtime.stateUpdate",
      phase: Phase.StateUpdate,
      priority: "P0",
      run: () => {
        const snapshot = this.clock.snapshot();
        if (this.#state.clock !== snapshot) {
          this.#state = { ...this.#state, clock: snapshot, frame: snapshot.frame };
        }
      },
    });

    // Frame end: budget reporting. Event drain happens in tick() after the
    // scheduler returns, so a handler cannot extend the frame it was raised in.
    this.scheduler.register({
      id: "runtime.frameEnd",
      phase: Phase.FrameEnd,
      priority: "P0",
      run: (context) => {
        if (context.remainingMs < 0) {
          this.events.publish({
            type: ENGINE_EVENTS.budgetExceeded,
            payload: { frame: context.frame, overrunMs: -context.remainingMs },
          });
        }
        if (this.scheduler.degraded) {
          this.events.publish({
            type: ENGINE_EVENTS.budgetDegraded,
            payload: { frame: context.frame },
          });
        }
      },
    });
  }
}
