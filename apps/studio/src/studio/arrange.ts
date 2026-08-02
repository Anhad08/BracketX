/**
 * Arrangement — align, distribute, group, order.
 *
 * The gestures a designer performs hundreds of times an hour and never thinks
 * about. Every one is a transaction, so every one is undoable in a single step,
 * and every one is expressed against a node's WORLD bounds rather than its
 * authored transform — aligning two nodes that sit in different parents has to
 * put their edges in the same place on screen, which is not the same as giving
 * them the same local x.
 *
 * ============================================================================
 * WHY THESE TAKE BOUNDS AS AN ARGUMENT
 * ============================================================================
 * Alignment needs to know where things actually are, which is the mirror's
 * business, and it needs to produce document operations, which is the
 * document's. Passing bounds in keeps this module pure and testable without a
 * backend, and keeps the mirror lookup in one place — the same split
 * `sampleTimeline` uses for instance ids.
 */
import {
  childrenOf,
  findNode,
  generateKeyBetween,
  makeSetProp,
  parentOf,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

import { topmost, transaction } from "./editing";
import type { IdFactory } from "./ids";
import type { NodeBounds, Rect } from "./viewport";

export type AlignEdge = "left" | "centerX" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

function edgeOf(rect: Rect, edge: AlignEdge): number {
  switch (edge) {
    case "left":
      return rect.x - rect.width / 2;
    case "right":
      return rect.x + rect.width / 2;
    case "centerX":
      return rect.x;
    case "bottom":
      return rect.y - rect.height / 2;
    case "top":
      return rect.y + rect.height / 2;
    case "middle":
    default:
      return rect.y;
  }
}

const AXIS_OF: Record<AlignEdge, 0 | 1> = {
  left: 0,
  centerX: 0,
  right: 0,
  top: 1,
  middle: 1,
  bottom: 1,
};

/**
 * Aligns nodes to the extreme of the selection.
 *
 * To the selection, not to the frame. A designer who selects three nodes and
 * presses "align left" means "line these up with each other" — aligning them to
 * the canvas edge instead would fling them off the graphic, and is the version
 * of this feature everyone has used once and never again.
 */
export function align(
  document: SceneDocument,
  nodeIds: readonly string[],
  bounds: readonly NodeBounds[],
  edge: AlignEdge,
): Transaction | null {
  const selected = bounds.filter((entry) => nodeIds.includes(entry.nodeId));
  if (selected.length < 2) return null;

  const axis = AXIS_OF[edge];
  const values = selected.map((entry) => edgeOf(entry.rect, edge));
  const target =
    edge === "centerX" || edge === "middle"
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : edge === "left" || edge === "bottom"
        ? Math.min(...values)
        : Math.max(...values);

  const operations: SceneOperation[] = [];
  for (const entry of selected) {
    const delta = target - edgeOf(entry.rect, edge);
    if (Math.abs(delta) < 1e-6) continue;
    const node = findNode(document.root, entry.nodeId);
    if (node === null) continue;
    const position = [...(node.transform?.position ?? [0, 0, 0])];
    position[axis] = round((position[axis] ?? 0) + delta);
    operations.push(makeSetProp(document, entry.nodeId, "transform.position", position));
  }
  return operations.length === 0 ? null : transaction(`Align ${edge}`, operations);
}

/**
 * Spaces nodes evenly between the two extremes.
 *
 * The outermost two do not move. Distributing by moving everything would mean
 * the selection drifts every time the button is pressed, and pressing it twice
 * must be a no-op — which it is, and which is asserted.
 */
export function distribute(
  document: SceneDocument,
  nodeIds: readonly string[],
  bounds: readonly NodeBounds[],
  axis: DistributeAxis,
): Transaction | null {
  const selected = bounds
    .filter((entry) => nodeIds.includes(entry.nodeId))
    .sort((a, b) =>
      axis === "horizontal" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
    );
  if (selected.length < 3) return null;

  const index = axis === "horizontal" ? 0 : 1;
  const first = axis === "horizontal" ? selected[0]!.rect.x : selected[0]!.rect.y;
  const last =
    axis === "horizontal"
      ? selected[selected.length - 1]!.rect.x
      : selected[selected.length - 1]!.rect.y;
  const step = (last - first) / (selected.length - 1);

  const operations: SceneOperation[] = [];
  selected.forEach((entry, position) => {
    if (position === 0 || position === selected.length - 1) return;
    const current = axis === "horizontal" ? entry.rect.x : entry.rect.y;
    const delta = first + step * position - current;
    if (Math.abs(delta) < 1e-6) return;
    const node = findNode(document.root, entry.nodeId);
    if (node === null) return;
    const values = [...(node.transform?.position ?? [0, 0, 0])];
    values[index] = round((values[index] ?? 0) + delta);
    operations.push(makeSetProp(document, entry.nodeId, "transform.position", values));
  });

  return operations.length === 0
    ? null
    : transaction(`Distribute ${axis}`, operations);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Wraps nodes in a new group, in place.
 *
 * The group is inserted where the FIRST selected node was, and the nodes move
 * into it in their existing order. Both matter: a group that appears at the end
 * of the parent's children jumps in front of everything, and a group that
 * reorders its contents silently changes what is drawn on top.
 *
 * Positions are not compensated. The group has an identity transform, so every
 * child keeps its world position — a group that recentred itself and offset its
 * children would be tidier on paper and would move the graphic on screen.
 */
export function group(
  document: SceneDocument,
  nodeIds: readonly string[],
  ids: IdFactory,
): { transaction: Transaction; groupId: string } | null {
  const roots = topmost(document, nodeIds).filter((id) => id !== document.root.id);
  if (roots.length === 0) return null;

  const parent = parentOf(document.root, roots[0]!);
  if (parent === null) return null;
  // Every node must share a parent: grouping across branches would have to
  // choose whose parent wins, and any choice moves somebody's graphic.
  for (const id of roots) {
    if (parentOf(document.root, id)?.id !== parent.id) return null;
  }

  const siblings = childrenOf(parent);
  const ordered = siblings.filter((child) => roots.includes(child.id));
  const firstIndex = siblings.findIndex((child) => child.id === ordered[0]!.id);
  const before = firstIndex === 0 ? null : siblings[firstIndex - 1]!.order;
  const after = siblings[firstIndex]!.order;

  const container: SceneNode = {
    id: ids("node"),
    name: "Group",
    order: generateKeyBetween(before, after),
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };

  const operations: SceneOperation[] = [
    { type: "node.insert", parentId: parent.id, node: container },
  ];
  let previousOrder: string | null = null;
  for (const child of ordered) {
    const order = generateKeyBetween(previousOrder, null);
    previousOrder = order;
    operations.push({
      type: "node.move",
      nodeId: child.id,
      parentId: container.id,
      order,
      previousParentId: parent.id,
      previousOrder: child.order,
    });
  }

  return {
    groupId: container.id,
    transaction: transaction(
      roots.length === 1 ? "Group" : `Group ${roots.length} nodes`,
      operations,
    ),
  };
}

/** Moves a group's children up to its parent and removes it. */
export function ungroup(
  document: SceneDocument,
  nodeId: string,
): Transaction | null {
  const node = findNode(document.root, nodeId);
  const parent = node === null ? null : parentOf(document.root, nodeId);
  if (node === null || parent === null) return null;

  const children = childrenOf(node);
  if (children.length === 0) return null;

  // The children land in the slot the group occupied, between it and whatever
  // came after it. Generating keys with an open upper bound would push them past
  // the group's following siblings and silently reorder the layers.
  const siblings = childrenOf(parent);
  const index = siblings.findIndex((child) => child.id === nodeId);
  const upper = siblings[index + 1]?.order ?? null;

  const operations: SceneOperation[] = [];
  let previousOrder: string | null = node.order;
  for (const child of children) {
    const order = generateKeyBetween(previousOrder, upper);
    previousOrder = order;
    operations.push({
      type: "node.move",
      nodeId: child.id,
      parentId: parent.id,
      order,
      previousParentId: node.id,
      previousOrder: child.order,
    });
  }
  // The removal must capture the group WITHOUT its children.
  //
  // By the time it runs the children have already left, and the inverse of the
  // whole transaction is the inverses in reverse order — so the group is
  // reinserted FIRST, before the children are moved back. Capturing the group
  // as it was authored would reinsert it carrying copies of nodes that still
  // exist at the parent, and the mirror refuses the duplicate: "already exists
  // — duplicate ownership". Found by undoing a group-then-ungroup.
  const { children: _dropped, ...emptied } = node;
  operations.push({
    type: "node.remove",
    nodeId,
    previousParentId: parent.id,
    previousNode: emptied as SceneNode,
  });

  return transaction("Ungroup", operations);
}

// ---------------------------------------------------------------------------
// Layer order
// ---------------------------------------------------------------------------

export type OrderMove = "front" | "back" | "forward" | "backward";

/**
 * Moves a node within its siblings.
 *
 * Draw order is sibling order (SCENE_FORMAT §5), so "bring to front" is a
 * reorder and not a separate z-index concept. That is why a node can only be
 * reordered among its own siblings: front-of-everything across the whole tree
 * would mean reparenting, which moves the node into a different transform.
 */
export function reorder(
  document: SceneDocument,
  nodeId: string,
  move: OrderMove,
): Transaction | null {
  const parent = parentOf(document.root, nodeId);
  if (parent === null) return null;
  const siblings = childrenOf(parent);
  const index = siblings.findIndex((child) => child.id === nodeId);
  if (index < 0 || siblings.length < 2) return null;

  const target =
    move === "front"
      ? siblings.length - 1
      : move === "back"
        ? 0
        : move === "forward"
          ? Math.min(siblings.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (target === index) return null;

  const without = siblings.filter((child) => child.id !== nodeId);
  const before = target === 0 ? null : without[target - 1]!.order;
  const afterNode = without[target];
  const order = generateKeyBetween(before, afterNode?.order ?? null);

  return transaction(`Bring ${move}`, [
    {
      type: "node.move",
      nodeId,
      parentId: parent.id,
      order,
      previousParentId: parent.id,
      previousOrder: siblings[index]!.order,
    },
  ]);
}

/** Six decimals. Sub-micrometre at metre scale, and it kills alignment drift. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
