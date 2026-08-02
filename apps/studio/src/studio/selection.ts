/**
 * Selection.
 *
 * ============================================================================
 * SELECTION BELONGS TO STUDIO. THE ENGINE MUST NEVER LEARN ABOUT IT
 * ============================================================================
 * It is tempting to put a `selected` flag on a node, or a `selection` field on
 * the document, and it would make the inspector trivial. It would also be
 * wrong in three ways at once:
 *
 *   - Selection would become a document edit, so clicking a node would land on
 *     the undo stack and dirty the file.
 *   - Two people editing the same document would fight over each other's
 *     cursors, because the document is what synchronises.
 *   - The render surface would have to know which nodes are selected, and
 *     "what is on air" would depend on what a designer happened to click.
 *
 * So selection lives here, in plain Studio state, and the verification suite
 * asserts that changing it leaves the engine's session hash untouched.
 *
 * Everything below is a pure function over an immutable set. No class, because
 * a class invites a mutable field and this must be safe to hold across a
 * React render.
 */

export interface Selection {
  /** Insertion-ordered. The order matters: `primary` is the last one clicked. */
  readonly ids: readonly string[];
}

export const EMPTY_SELECTION: Selection = { ids: [] };

/**
 * The node the inspector shows and gizmos anchor to.
 *
 * The LAST id, not the first. Shift-clicking a fourth node and then dragging
 * should drag relative to the one just clicked, which is what every editor
 * does and what nobody notices until it is wrong.
 */
export function primaryOf(selection: Selection): string | null {
  return selection.ids.at(-1) ?? null;
}

export function isSelected(selection: Selection, nodeId: string): boolean {
  return selection.ids.includes(nodeId);
}

export function selectOnly(nodeId: string | null): Selection {
  return nodeId === null ? EMPTY_SELECTION : { ids: [nodeId] };
}

export function selectMany(nodeIds: readonly string[]): Selection {
  // Deduplicated, order preserved: a marquee can report the same node twice
  // when it overlaps two of its own bounds.
  return { ids: [...new Set(nodeIds)] };
}

/** Ctrl/Cmd-click. Adds, or removes when already present. */
export function toggle(selection: Selection, nodeId: string): Selection {
  return isSelected(selection, nodeId)
    ? { ids: selection.ids.filter((id) => id !== nodeId) }
    : { ids: [...selection.ids, nodeId] };
}

export function add(selection: Selection, nodeIds: readonly string[]): Selection {
  return selectMany([...selection.ids, ...nodeIds]);
}

/**
 * Drops ids that no longer exist.
 *
 * Called after every transaction. Without it, deleting a node leaves it
 * selected, the inspector reads a node the document does not have, and the
 * next gizmo drag builds an operation against a missing target — which the
 * engine correctly refuses, at which point the editor looks broken.
 */
export function prune(
  selection: Selection,
  exists: (nodeId: string) => boolean,
): Selection {
  const kept = selection.ids.filter(exists);
  return kept.length === selection.ids.length ? selection : { ids: kept };
}

/**
 * Shift-click over a flattened tree: everything between the anchor and the
 * target, inclusive.
 *
 * Takes the flattened order rather than the tree, because "between" is a
 * question about what is on screen. A range over the tree structure would
 * select nodes the user cannot see, which is never what shift-click means.
 */
export function selectRange(
  flattened: readonly string[],
  anchorId: string | null,
  targetId: string,
): Selection {
  if (anchorId === null) return selectOnly(targetId);
  const from = flattened.indexOf(anchorId);
  const to = flattened.indexOf(targetId);
  if (from < 0 || to < 0) return selectOnly(targetId);
  const [low, high] = from <= to ? [from, to] : [to, from];
  // Reversed when travelling upwards, so `primary` stays the node clicked.
  const slice = flattened.slice(low, high + 1);
  return selectMany(from <= to ? slice : [...slice].reverse());
}

/** Keyboard navigation over the same flattened order. */
export function step(
  flattened: readonly string[],
  selection: Selection,
  delta: number,
): Selection {
  if (flattened.length === 0) return EMPTY_SELECTION;
  const current = primaryOf(selection);
  if (current === null) {
    return selectOnly(delta >= 0 ? flattened[0]! : flattened[flattened.length - 1]!);
  }
  const index = flattened.indexOf(current);
  if (index < 0) return selectOnly(flattened[0]!);
  const next = Math.min(flattened.length - 1, Math.max(0, index + delta));
  return selectOnly(flattened[next]!);
}
