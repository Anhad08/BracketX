/**
 * The event system. ENGINE_RUNTIME §3.
 *
 * ============================================================================
 * TWO CHANNELS
 * ============================================================================
 * Signals  synchronous, inside the frame, engine subsystems only, closed set,
 *          deterministic order. May stall a frame — which is why only engine
 *          code may subscribe.
 *
 * Events   queued during the frame, delivered after it, open to applications,
 *          plugins, AI, the editor, and the control surface.
 *
 * ============================================================================
 * THE GUARANTEE, STATED HONESTLY
 * ============================================================================
 * ARCHITECTURE_VERIFICATION D4 found the original claim — "a handler can never
 * stall a frame" — to be false. JavaScript has no preemption: a bounded time
 * slice limits how many handlers *start*, never how long one *runs*.
 *
 * What is actually guaranteed:
 *   A handler cannot extend the frame during which its event was raised.
 *   A slow handler WILL delay subsequent frames.
 *
 * Genuine isolation needs Workers, which cannot touch the DOM — acceptable for
 * data sources, not for editor panels. That is a Phase 13 concern.
 *
 * ============================================================================
 * DETERMINISM
 * ============================================================================
 * Handlers run in (priority, registration order). Registration order is a
 * monotonic counter, so two runs that subscribe identically dispatch
 * identically. Recursive dispatch is refused rather than reordered: a handler
 * raising an event queues it for the next drain.
 */

export type EventPriority = number;

/** Runs first. For engine bookkeeping that later handlers depend on. */
export const PRIORITY_HIGH = 0;
export const PRIORITY_NORMAL = 100;
/** Runs last. For observers that must see the settled result. */
export const PRIORITY_LOW = 200;

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventError";
  }
}

export interface EngineEvent {
  readonly type: string;
  readonly payload?: unknown;
}

export type EventHandler<E extends EngineEvent = EngineEvent> = (
  event: E,
) => void;

interface Subscription {
  readonly id: number;
  readonly type: string;
  readonly priority: EventPriority;
  readonly order: number;
  readonly handler: EventHandler;
}

export interface EventDispatchReport {
  readonly delivered: number;
  readonly deferred: number;
  readonly errors: readonly { readonly type: string; readonly error: unknown }[];
}

/**
 * Signals: synchronous, engine-internal.
 *
 * Kept as a separate class rather than a flag on one bus so that the "engine
 * only" rule is a type boundary rather than a convention — application code
 * that never receives a SignalBus cannot subscribe to one.
 */
export class SignalBus {
  #subscriptions = new Map<string, Subscription[]>();
  #nextId = 0;
  #order = 0;
  #dispatching = false;

  subscribe(
    type: string,
    handler: EventHandler,
    priority: EventPriority = PRIORITY_NORMAL,
  ): number {
    const id = this.#nextId++;
    const list = this.#subscriptions.get(type) ?? [];
    list.push({ id, type, priority, order: this.#order++, handler });
    // Sorted on insert so dispatch is a plain iteration — no sort cost inside
    // the frame, and order is explicit rather than incidental.
    list.sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.#subscriptions.set(type, list);
    return id;
  }

  unsubscribe(id: number): boolean {
    for (const [type, list] of this.#subscriptions) {
      const index = list.findIndex((s) => s.id === id);
      if (index !== -1) {
        list.splice(index, 1);
        if (list.length === 0) this.#subscriptions.delete(type);
        return true;
      }
    }
    return false;
  }

  /**
   * Delivers synchronously, in priority then registration order.
   *
   * Recursion is refused, not queued: a signal raised from inside a signal
   * handler would make ordering depend on handler internals, which is exactly
   * the "no hidden ordering" property this system exists to provide.
   */
  emit(event: EngineEvent): void {
    if (this.#dispatching) {
      throw new EventError(
        `recursive signal dispatch: "${event.type}" was emitted from inside a ` +
          `signal handler. Signals are synchronous and ordered; use the ` +
          `deferred event channel instead.`,
      );
    }

    const list = this.#subscriptions.get(event.type);
    if (!list || list.length === 0) return;

    this.#dispatching = true;
    try {
      // Snapshot: a handler unsubscribing during dispatch must not change
      // which handlers this emission delivers to.
      for (const subscription of [...list]) subscription.handler(event);
    } finally {
      this.#dispatching = false;
    }
  }

  handlerCount(type: string): number {
    return this.#subscriptions.get(type)?.length ?? 0;
  }

  clear(): void {
    this.#subscriptions.clear();
  }
}

export interface EventBusOptions {
  /** Bounded so a runaway producer cannot grow the queue without limit. */
  readonly capacity?: number;
  /** Handlers started per drain. Not a time bound — see the header. */
  readonly maxPerDrain?: number;
}

/**
 * Events: queued during the frame, delivered after it.
 *
 * Open to any subscriber. This is the only channel applications and plugins
 * may use.
 */
export class EventBus {
  #subscriptions = new Map<string, Subscription[]>();
  #queue: EngineEvent[] = [];
  #coalesced = new Map<string, number>();
  #nextId = 0;
  #order = 0;
  #capacity: number;
  #maxPerDrain: number;
  #draining = false;
  #dropped = 0;

  constructor(options: EventBusOptions = {}) {
    this.#capacity = options.capacity ?? 8192;
    this.#maxPerDrain = options.maxPerDrain ?? 1024;
  }

  get pendingCount(): number {
    return this.#queue.length;
  }

  get droppedCount(): number {
    return this.#dropped;
  }

  subscribe(
    type: string,
    handler: EventHandler,
    priority: EventPriority = PRIORITY_NORMAL,
  ): number {
    const id = this.#nextId++;
    const list = this.#subscriptions.get(type) ?? [];
    list.push({ id, type, priority, order: this.#order++, handler });
    list.sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.#subscriptions.set(type, list);
    return id;
  }

  unsubscribe(id: number): boolean {
    for (const [type, list] of this.#subscriptions) {
      const index = list.findIndex((s) => s.id === id);
      if (index !== -1) {
        list.splice(index, 1);
        if (list.length === 0) this.#subscriptions.delete(type);
        return true;
      }
    }
    return false;
  }

  /** Queues for delivery after the current frame. Never delivers inline. */
  publish(event: EngineEvent): void {
    if (this.#queue.length >= this.#capacity) {
      // Reported, never silent. A dropped error is a debugging session.
      this.#dropped += 1;
      return;
    }
    this.#queue.push(event);
  }

  /**
   * Queues with last-value-wins for a key.
   *
   * ENGINE_RUNTIME §3.3: a data feed writing a variable at 60Hz produces
   * events faster than anything wants to consume. Twelve `variable.changed`
   * events for one key become one carrying the final value.
   */
  publishCoalesced(key: string, event: EngineEvent): void {
    const existing = this.#coalesced.get(key);
    if (existing !== undefined && existing < this.#queue.length) {
      this.#queue[existing] = event;
      return;
    }
    if (this.#queue.length >= this.#capacity) {
      this.#dropped += 1;
      return;
    }
    this.#coalesced.set(key, this.#queue.length);
    this.#queue.push(event);
  }

  /**
   * Delivers queued events. Called after the frame, never inside it.
   *
   * Events published by a handler land in the next drain, so a handler cannot
   * extend the current one into an unbounded loop.
   */
  drain(): EventDispatchReport {
    if (this.#draining) {
      throw new EventError("recursive drain: drain() was called from a handler");
    }

    const batch = this.#queue.splice(0, this.#maxPerDrain);
    this.#coalesced.clear();
    const errors: { type: string; error: unknown }[] = [];

    this.#draining = true;
    try {
      for (const event of batch) {
        const list = this.#subscriptions.get(event.type);
        if (!list) continue;
        for (const subscription of [...list]) {
          try {
            subscription.handler(event);
          } catch (error) {
            // One bad subscriber must not stop delivery to the others, and
            // must not take down the frame loop.
            errors.push({ type: event.type, error });
          }
        }
      }
    } finally {
      this.#draining = false;
    }

    return {
      delivered: batch.length,
      deferred: this.#queue.length,
      errors,
    };
  }

  handlerCount(type: string): number {
    return this.#subscriptions.get(type)?.length ?? 0;
  }

  clear(): void {
    this.#subscriptions.clear();
    this.#queue = [];
    this.#coalesced.clear();
    this.#dropped = 0;
  }
}

/** The catalogue from ENGINE_RUNTIME §3.5. Typed, because plugins will read it. */
export const ENGINE_EVENTS = {
  documentChanged: "document.changed",
  variableChanged: "variable.changed",
  stateEntered: "state.entered",
  stateExited: "state.exited",
  frameRendered: "output.frameRendered",
  resourceLoaded: "resource.loaded",
  resourceEvicted: "resource.evicted",
  budgetExceeded: "budget.exceeded",
  budgetDegraded: "budget.degraded",
  errorRaised: "error.raised",
  lifecycleChanged: "lifecycle.changed",
} as const;

export type EngineEventType =
  (typeof ENGINE_EVENTS)[keyof typeof ENGINE_EVENTS];
