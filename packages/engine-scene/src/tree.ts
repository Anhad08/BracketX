/**
 * Hierarchy traversal and structural editing.
 *
 * Every function here is pure: nodes are treated as immutable and edits return
 * new trees with structural sharing. Untouched subtrees keep their identity,
 * which lets a consumer skip them by reference comparison — the property the
 * reconciler relies on to avoid walking a tree it already agrees with.
 */
import { compareOrderKeys } from "./order";
import type { SceneNode } from "./types";

/**
 * Attaches a children list, omitting the key entirely when empty.
 *
 * A node with `children: []` and a node with no `children` key are
 * semantically identical (SCENE_FORMAT §6 makes `children` optional with
 * default `[]`), but they serialise differently. Canonical form is used for
 * hashing, deduplication, and diffing (SCENE_FORMAT §12), so two semantically
 * identical documents must produce identical bytes.
 *
 * Without this, inserting a child into a leaf and then undoing left
 * `children: []` behind, and the document no longer canonicalised equal to
 * itself. Caught by the operation round-trip tests.
 */
function withChildren(node: SceneNode, children: SceneNode[]): SceneNode {
  if (children.length > 0) return { ...node, children };
  if (node.children === undefined) return node;
  const { children: _removed, ...rest } = node;
  return rest as SceneNode;
}

/**
 * Shared empty list for leaves.
 *
 * `node.children ?? []` allocated a fresh array for every leaf on every visit.
 * On a 50,000-node wide scene that is 50,000 allocations per traversal, and
 * traversals happen several times per operation (P-001 P1). Leaves dominate
 * every realistic tree, so this is the single most-executed line in the file.
 */
const NO_CHILDREN: readonly SceneNode[] = Object.freeze([]);

/** Children in order. Sorted defensively — SCENE_FORMAT §6.2. */
export function childrenOf(node: SceneNode): readonly SceneNode[] {
  const children = node.children ?? NO_CHILDREN;
  for (let i = 1; i < children.length; i += 1) {
    if (compareOrderKeys(children[i - 1]!.order, children[i]!.order) > 0) {
      return [...children].sort((a, b) => compareOrderKeys(a.order, b.order));
    }
  }
  return children;
}

/** Depth-first, parents before children, children in order. */
export function* walk(root: SceneNode): Generator<SceneNode> {
  yield root;
  for (const child of childrenOf(root)) yield* walk(child);
}

export function findNode(root: SceneNode, id: string): SceneNode | null {
  if (root.id === id) return root;
  for (const child of childrenOf(root)) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Ancestors from the root down to the direct parent.
 *
 * Accumulates into one array. The previous form built `[root, ...sub]` at every
 * level, which copied the whole path once per level — O(depth²) allocation for
 * an O(depth) result, and the reason a deep scene spent its entire profile
 * here (P-001 P1).
 */
export function pathToNode(root: SceneNode, id: string): SceneNode[] | null {
  const path: SceneNode[] = [];

  const search = (node: SceneNode): boolean => {
    if (node.id === id) return true;
    path.push(node);
    for (const child of childrenOf(node)) {
      if (search(child)) return true;
    }
    path.pop();
    return false;
  };

  return search(root) ? path : null;
}

export function parentOf(root: SceneNode, id: string): SceneNode | null {
  const path = pathToNode(root, id);
  return path && path.length > 0 ? path[path.length - 1]! : null;
}

/**
 * Replaces a node, returning a new root. Nodes off the path are shared.
 * `replacer` returning null removes the node.
 *
 * Ids are unique (validate.ts enforces it), so the first subtree that reports a
 * change contains the target and no sibling can also contain it. That permits
 * two things the previous form did not do: stop descending once the node is
 * found, and allocate a children array only on the ancestor path.
 *
 * The previous form recursed into every subtree even after finding the target
 * and built a `next` array at every node it visited. On a 50,000-node wide
 * scene a single setProp rebuilt 2 nodes — structural sharing was correct —
 * while allocating 1.29 MB of arrays to do it (P-001 P1).
 */
export function replaceNode(
  root: SceneNode,
  id: string,
  replacer: (node: SceneNode) => SceneNode | null,
): SceneNode | null {
  if (root.id === id) return replacer(root);

  const children = childrenOf(root);

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    const replaced = replaceNode(child, id, replacer);
    // Unchanged means the target is not in this subtree — or the replacer
    // returned the same node, which is equally a no-op. Keep looking.
    if (replaced === child) continue;

    // Found. Copy this level once, sharing every sibling by reference.
    const next: SceneNode[] = [];
    for (let j = 0; j < i; j += 1) next.push(children[j]!);
    if (replaced !== null) next.push(replaced);
    for (let j = i + 1; j < children.length; j += 1) next.push(children[j]!);

    return withChildren(root, next);
  }

  return root;
}

/**
 * `parent` with `child` added, siblings kept in order-key order.
 *
 * Exported so an operation can combine "find the parent", "validate against
 * its existing children", and "insert" into a single traversal instead of
 * three (P-001 P5).
 */
export function withChildInserted(
  parent: SceneNode,
  child: SceneNode,
): SceneNode {
  const existing = childrenOf(parent);

  // Siblings are already sorted, so splicing at the insertion point beats
  // appending and re-sorting: O(width) instead of O(width log width).
  let index = existing.length;
  for (let i = 0; i < existing.length; i += 1) {
    if (compareOrderKeys(existing[i]!.order, child.order) > 0) {
      index = i;
      break;
    }
  }

  const children: SceneNode[] = [];
  for (let i = 0; i < index; i += 1) children.push(existing[i]!);
  children.push(child);
  for (let i = index; i < existing.length; i += 1) children.push(existing[i]!);

  return withChildren(parent, children);
}

/** Inserts under `parentId`, keeping `children` sorted by order key. */
export function insertChild(
  root: SceneNode,
  parentId: string,
  child: SceneNode,
): SceneNode {
  const result = replaceNode(root, parentId, (parent) =>
    withChildInserted(parent, child),
  );
  if (result === null) {
    throw new Error(`insertChild removed the root while inserting ${child.id}`);
  }
  return result;
}

export function removeNode(root: SceneNode, id: string): SceneNode {
  if (root.id === id) {
    throw new Error("the root node cannot be removed");
  }
  const result = replaceNode(root, id, () => null);
  if (result === null) {
    throw new Error(`removeNode removed the root while removing ${id}`);
  }
  return result;
}

export function countNodes(root: SceneNode): number {
  return childrenOf(root).reduce((total, child) => total + countNodes(child), 1);
}

/** True when `ancestorId` is `nodeId` or one of its ancestors. */
export function isAncestorOf(
  root: SceneNode,
  ancestorId: string,
  nodeId: string,
): boolean {
  if (ancestorId === nodeId) return true;
  const ancestor = findNode(root, ancestorId);
  return ancestor !== null && findNode(ancestor, nodeId) !== null;
}
