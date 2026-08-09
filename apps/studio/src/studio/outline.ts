/**
 * The hierarchy outline — the document flattened for a tree view.
 *
 * Pure, so the panel renders it and computes nothing. Keeping it here is what
 * lets "a filtered tree keeps the ancestors of its matches" be a headless
 * assertion rather than something checked by looking at the screen.
 *
 * Reads the DOCUMENT, not the mirror — deliberately, and opposite to the
 * workbench inspector. An editor edits what was authored: collection instances
 * are output, not content, and a designer cannot move, rename or delete one.
 * Showing them would offer edits the document cannot express.
 */
import { childrenOf, type SceneDocument, type SceneNode } from "@bracketx/engine-scene";

export interface OutlineRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parentId: string | null;
  readonly childCount: number;
  readonly kind: string;
  /** The authored `visible` flag. A document property, so toggling it is an edit. */
  readonly visible: boolean;
  /** True when an ancestor is hidden — the row is greyed but not itself off. */
  readonly hiddenByAncestor: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly locked: boolean;
  /** True when this node has a repeat, so the outline can say so. */
  readonly repeats: boolean;
  /**
   * V-1: the object has no more of itself inside the frame than a snap-back
   * leaves. §03 — "the layer is flagged off frame".
   *
   * DERIVED from bounds by the caller, never stored on the node: an object
   * dragged back into shot must lose the flag without anyone remembering to
   * clear it.
   */
  readonly offFrame: boolean;
}

export interface OutlineOptions {
  readonly expanded: ReadonlySet<string>;
  readonly locked?: ReadonlySet<string>;
  /** Case-insensitive match on name, id, or component type. */
  readonly filter?: string;
  /**
   * Ids the caller has found to be off frame. V-1.
   *
   * Passed IN rather than computed here, because deciding it needs world
   * bounds — which come from the mirror, not the document — and the outline
   * must stay a pure reading of the tree.
   */
  readonly offFrame?: ReadonlySet<string>;
}

/** What kind of thing a node is, for the row's badge. */
export function kindOf(node: SceneNode): string {
  const types = (node.components ?? []).map((component) => component.type);
  if (types.includes("camera")) return "camera";
  if (types.length > 0) return types[0]!;
  return childrenOf(node).length > 0 || node.children !== undefined ? "group" : "node";
}

function matches(node: SceneNode, needle: string): boolean {
  if (needle.length === 0) return true;
  return (
    node.name.toLowerCase().includes(needle) ||
    node.id.toLowerCase().includes(needle) ||
    (node.components ?? []).some((component) =>
      component.type.toLowerCase().includes(needle),
    )
  );
}

/**
 * Flattens the document into visible rows.
 *
 * With a filter, ancestors of every match are kept and force-expanded — a
 * filtered tree that drops parents is a list, and a list loses the one thing a
 * tree is for. Without one, only expanded branches are walked, so a collapsed
 * subtree of any size costs one row.
 */
export function outline(
  document: SceneDocument,
  options: OutlineOptions,
): readonly OutlineRow[] {
  const needle = (options.filter ?? "").trim().toLowerCase();
  const locked = options.locked ?? new Set<string>();

  const keep = needle.length === 0 ? null : new Set<string>();
  if (keep !== null) {
    const path: string[] = [];
    const visit = (node: SceneNode): void => {
      path.push(node.id);
      if (matches(node, needle)) for (const id of path) keep.add(id);
      for (const child of childrenOf(node)) visit(child);
      path.pop();
    };
    visit(document.root);
  }

  const rows: OutlineRow[] = [];
  const walk = (node: SceneNode, depth: number, hidden: boolean, parentId: string | null): void => {
    if (keep !== null && !keep.has(node.id)) return;

    const children = childrenOf(node);
    // A filter force-expands, because a match hidden inside a collapsed branch
    // is a search that found nothing as far as the person is concerned.
    const expanded = keep !== null || options.expanded.has(node.id);

    rows.push({
      id: node.id,
      name: node.name,
      depth,
      parentId,
      childCount: children.length,
      kind: kindOf(node),
      visible: node.visible !== false,
      hiddenByAncestor: hidden,
      expandable: children.length > 0,
      expanded,
      locked: locked.has(node.id),
      repeats: node.repeat !== undefined,
      offFrame: options.offFrame?.has(node.id) === true,
    });

    if (!expanded) return;
    const childHidden = hidden || node.visible === false;
    for (const child of children) walk(child, depth + 1, childHidden, node.id);
  };

  walk(document.root, 0, false, null);
  return rows;
}

/** Ancestor ids of a node, root first. What the tree expands to reveal one. */
export function pathTo(document: SceneDocument, nodeId: string): readonly string[] {
  const path: string[] = [];
  const found: string[] = [];

  const visit = (node: SceneNode): boolean => {
    path.push(node.id);
    if (node.id === nodeId) {
      found.push(...path.slice(0, -1));
      return true;
    }
    for (const child of childrenOf(node)) if (visit(child)) return true;
    path.pop();
    return false;
  };
  visit(document.root);
  return found;
}

/**
 * Where a drop lands: a parent and an index among its children.
 *
 * `position` is which third of the row the pointer is over. Dropping ON a row
 * reparents into it; dropping above or below reorders beside it. Three zones
 * rather than two, because reparenting and reordering are different intentions
 * and a drag that guesses gets one of them wrong half the time.
 */
export function dropTarget(
  document: SceneDocument,
  rows: readonly OutlineRow[],
  targetId: string,
  position: "before" | "after" | "inside",
): { parentId: string; index: number } | null {
  const row = rows.find((entry) => entry.id === targetId);
  if (row === undefined) return null;

  if (position === "inside") {
    return { parentId: targetId, index: row.childCount };
  }
  if (row.parentId === null) {
    // Beside the root is meaningless; treat it as inside.
    return { parentId: targetId, index: position === "before" ? 0 : row.childCount };
  }

  const siblings = rows.filter((entry) => entry.parentId === row.parentId);
  const index = siblings.findIndex((entry) => entry.id === targetId);
  void document;
  return {
    parentId: row.parentId,
    index: position === "before" ? index : index + 1,
  };
}
