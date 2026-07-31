/**
 * Runtime lifecycle. ENGINE_RUNTIME.
 *
 *   Boot -> Loading -> Ready -> Playing <-> Paused -> Stopped -> Shutdown
 *                        |         |          |         |
 *                        +---------+----------+---------+--> Failed
 *
 * Illegal transitions throw. This is the one place in the runtime where
 * throwing is right: a transition to an impossible state is a programming
 * error, not a recoverable condition, and continuing from it would put the
 * engine in a state no subsystem is written to handle.
 *
 * `Failed` is terminal except for an explicit reset to Boot, and a scene may
 * only reach `Playing` from `Ready` — ENGINE_RECONCILIATION §1.7 requires
 * every asset resolved and every glyph pre-warmed before air.
 */

export type LifecycleState =
  | "boot"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "stopped"
  | "failed"
  | "shutdown";

const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> =
  {
    boot: ["loading", "failed", "shutdown"],
    loading: ["ready", "failed", "shutdown"],
    // Loading again covers a scene change from a settled state.
    ready: ["playing", "loading", "stopped", "failed", "shutdown"],
    playing: ["paused", "stopped", "failed", "shutdown"],
    paused: ["playing", "stopped", "failed", "shutdown"],
    stopped: ["ready", "loading", "failed", "shutdown"],
    // Terminal but recoverable only by an explicit restart.
    failed: ["boot", "shutdown"],
    shutdown: [],
  };

export class LifecycleError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(
      `illegal lifecycle transition "${from}" -> "${to}". Legal from "${from}": ` +
        `${TRANSITIONS[from].join(", ") || "(none — terminal)"}`,
    );
    this.name = "LifecycleError";
  }
}

export interface LifecycleTransition {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly reason?: string;
}

export class Lifecycle {
  #state: LifecycleState = "boot";
  #history: LifecycleTransition[] = [];
  #failure: unknown = null;

  get state(): LifecycleState {
    return this.#state;
  }

  get failure(): unknown {
    return this.#failure;
  }

  get history(): readonly LifecycleTransition[] {
    return this.#history;
  }

  canTransition(to: LifecycleState): boolean {
    return TRANSITIONS[this.#state].includes(to);
  }

  transition(to: LifecycleState, reason?: string): LifecycleTransition {
    if (!this.canTransition(to)) {
      throw new LifecycleError(this.#state, to);
    }
    const transition = { from: this.#state, to, reason };
    this.#state = to;
    this.#history.push(transition);
    if (to !== "failed") this.#failure = null;
    return transition;
  }

  fail(error: unknown, reason?: string): LifecycleTransition {
    const transition = this.transition("failed", reason);
    this.#failure = error;
    return transition;
  }

  /** True only in `playing`. Live output must never render from another state. */
  get isLive(): boolean {
    return this.#state === "playing";
  }

  /** States in which a scene is fully resolved and safe to render. */
  get isRenderable(): boolean {
    return (
      this.#state === "ready" ||
      this.#state === "playing" ||
      this.#state === "paused"
    );
  }
}
