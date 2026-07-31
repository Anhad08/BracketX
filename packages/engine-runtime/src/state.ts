/**
 * Runtime state. ENGINE_RUNTIME / RFC-002 §4.3 as corrected.
 *
 * ============================================================================
 * THE DOMAIN SPLIT
 * ============================================================================
 * Document state  structure, defaults, bindings, animation tracks, metadata
 *                 mutated by OPERATIONS, undoable, persisted
 *                 lives in @bracketx/engine-scene
 *
 * Runtime state   current variable values, active scene, playhead, selection,
 *                 live overrides, transient evaluation data
 *                 mutated by COMMANDS, NOT undoable, NEVER persisted
 *                 lives here
 *
 * ARCHITECTURE_VERIFICATION D3 proved that conflating these is either false or
 * catastrophic: a data feed writing a variable at 60Hz would generate ~1.7M
 * undo entries across an 8-hour show, and Ctrl-Z would rewind the score.
 *
 * There is no serialisation function in this module, deliberately. Runtime
 * state has no on-disk form.
 */
import { canonicalString, hashString } from "./hash";
import type { ClockSnapshot } from "./clock";

/** Values a variable may hold at runtime. Mirrors SCENE_FORMAT §9 types. */
export type RuntimeValue =
  | string
  | number
  | boolean
  | null
  | readonly number[];

export type PlaybackStatus = "stopped" | "playing" | "paused";

export interface RuntimeState {
  /** The frame this state was computed for. The clock remains authoritative. */
  readonly frame: number;
  readonly clock: ClockSnapshot;
  readonly activeSceneId: string | null;
  /** Current values, keyed by the variable's author-facing `key`. */
  readonly variables: ReadonlyMap<string, RuntimeValue>;
  /** Operator overrides. Take precedence over `variables` on resolve. */
  readonly overrides: ReadonlyMap<string, RuntimeValue>;
  /** Editor selection. Node ids, order-insensitive but stored sorted. */
  readonly selection: readonly string[];
  /** Scratch for subsystems. Never resolved into a scene. */
  readonly transient: ReadonlyMap<string, RuntimeValue>;
}

export function createRuntimeState(clock: ClockSnapshot): RuntimeState {
  return {
    frame: clock.frame,
    clock,
    activeSceneId: null,
    variables: new Map(),
    overrides: new Map(),
    selection: [],
    transient: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Transitions — pure, and the only way state changes shape
// ---------------------------------------------------------------------------

function withMapEntry<V>(
  source: ReadonlyMap<string, V>,
  key: string,
  value: V,
): ReadonlyMap<string, V> {
  const existing = source.get(key);
  if (source.has(key) && existing === value) return source;
  const next = new Map(source);
  next.set(key, value);
  return next;
}

function withoutMapEntry<V>(
  source: ReadonlyMap<string, V>,
  key: string,
): ReadonlyMap<string, V> {
  if (!source.has(key)) return source;
  const next = new Map(source);
  next.delete(key);
  return next;
}

export const RuntimeStateOps = {
  withClock(state: RuntimeState, clock: ClockSnapshot): RuntimeState {
    if (state.clock === clock && state.frame === clock.frame) return state;
    return { ...state, clock, frame: clock.frame };
  },

  withActiveScene(state: RuntimeState, sceneId: string | null): RuntimeState {
    if (state.activeSceneId === sceneId) return state;
    // Switching scenes clears everything scoped to the old one. Leaving stale
    // variables behind would let a value from one scene resolve into another.
    return {
      ...state,
      activeSceneId: sceneId,
      variables: new Map(),
      overrides: new Map(),
      selection: [],
      transient: new Map(),
    };
  },

  withVariable(
    state: RuntimeState,
    key: string,
    value: RuntimeValue,
  ): RuntimeState {
    const variables = withMapEntry(state.variables, key, value);
    return variables === state.variables ? state : { ...state, variables };
  },

  withoutVariable(state: RuntimeState, key: string): RuntimeState {
    const variables = withoutMapEntry(state.variables, key);
    return variables === state.variables ? state : { ...state, variables };
  },

  withOverride(
    state: RuntimeState,
    key: string,
    value: RuntimeValue,
  ): RuntimeState {
    const overrides = withMapEntry(state.overrides, key, value);
    return overrides === state.overrides ? state : { ...state, overrides };
  },

  withoutOverride(state: RuntimeState, key: string): RuntimeState {
    const overrides = withoutMapEntry(state.overrides, key);
    return overrides === state.overrides ? state : { ...state, overrides };
  },

  withSelection(
    state: RuntimeState,
    nodeIds: readonly string[],
  ): RuntimeState {
    // Sorted and de-duplicated so selection order cannot affect the state
    // hash — two clients selecting the same nodes must agree.
    const sorted = [...new Set(nodeIds)].sort();
    if (
      sorted.length === state.selection.length &&
      sorted.every((id, index) => id === state.selection[index])
    ) {
      return state;
    }
    return { ...state, selection: sorted };
  },

  withTransient(
    state: RuntimeState,
    key: string,
    value: RuntimeValue,
  ): RuntimeState {
    const transient = withMapEntry(state.transient, key, value);
    return transient === state.transient ? state : { ...state, transient };
  },

  withoutTransient(state: RuntimeState, key: string): RuntimeState {
    const transient = withoutMapEntry(state.transient, key);
    return transient === state.transient ? state : { ...state, transient };
  },

  /** Clears everything except the clock snapshot, which the clock owns. */
  cleared(state: RuntimeState): RuntimeState {
    return createRuntimeState(state.clock);
  },
} as const;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * The effective value of a variable: override, then runtime value, then the
 * caller's fallback (which is the document default).
 *
 * Overrides win so an operator can take manual control of a data-driven value
 * mid-show without editing the document.
 */
export function resolveVariable(
  state: RuntimeState,
  key: string,
  fallback: RuntimeValue = null,
): RuntimeValue {
  if (state.overrides.has(key)) return state.overrides.get(key)!;
  if (state.variables.has(key)) return state.variables.get(key)!;
  return fallback;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Exact, order-independent. The authority for equality assertions. */
export function canonicalizeRuntimeState(state: RuntimeState): string {
  return canonicalString(state);
}

/** Convenience digest. Not collision-free — compare canonical strings when exactness matters. */
export function hashRuntimeState(state: RuntimeState): string {
  return hashString(canonicalizeRuntimeState(state));
}

export function runtimeStatesEqual(a: RuntimeState, b: RuntimeState): boolean {
  return canonicalizeRuntimeState(a) === canonicalizeRuntimeState(b);
}
