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
 *
 * Contents arrive in Phase 2.3. Phase 2.1 delivers the boundary only.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-runtime",
  layer: "engine-core",
} as const;
