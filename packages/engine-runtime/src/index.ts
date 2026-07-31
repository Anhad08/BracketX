/**
 * @bracketx/engine-runtime — Engine Core layer.
 *
 * The frame loop and its state: runtime clock, scheduler, command system,
 * event system, and the two state stores. Specified by ENGINE_RUNTIME.md.
 *
 * Holds both state domains established by ENGINE_RECONCILIATION.md §3.2 and
 * the RFC-002 §4.3 correction:
 *   - Document state, mutated only by operations (undoable, persisted)
 *   - Runtime state, mutated only by commands (not undoable, not persisted)
 *
 * Knows nothing about rendering.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-runtime",
  layer: "engine-core",
} as const;

export {
  FRAME_RATES,
  RationalError,
  ZERO,
  ONE,
  add,
  compare,
  divide,
  equals,
  floorToInteger,
  isZero,
  multiply,
  rational,
  subtract,
  toNumber,
  toString as rationalToString,
  type FrameRateName,
  type Rational,
} from "./rational";

export {
  ClockError,
  RuntimeClock,
  framesToTimecode,
  isDropFrame,
  nominalRate,
  type ClockOptions,
  type ClockSnapshot,
  type ClockStatus,
} from "./clock";
