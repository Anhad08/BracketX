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

/** Children in order. Sorted defensively — SCENE_FORMAT §6.2. */
export function childrenOf(node: SceneNode): readonly SceneNode[] {
  const children = node.children ?? [];
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

/** Ancestors from the direct parent up to the root. */
export function pathToNode(root: SceneNode, id: string): SceneNode[] | null {
  if (root.id === id) return [];
  for (const child of childrenOf(root)) {
    const sub = pathToNode(child, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

export function parentOf(root: SceneNode, id: string): SceneNode | null {
  const path = pathToNode(root, id);
  return path && path.length > 0 ? path[path.length - 1]! : null;
}

/**
 * Replaces a node, returning a new root. Nodes off the path are shared.
 * `replacer` returning null removes the node.
 */
export function replaceNode(
  root: SceneNode,
  id: string,
  replacer: (node: SceneNode) => SceneNode | null,
): SceneNode | null {
  if (root.id === id) return replacer(root);

  const children = childrenOf(root);
  let changed = false;
  const next: SceneNode[] = [];

  for (const child of children) {
    const replaced = replaceNode(child, id, replacer);
    if (replaced !== child) changed = true;
    if (replaced !== null) next.push(replaced);
  }

  if (!changed) return root;
  return withChildren(root, next);
}

/** Inserts under `parentId`, keeping `children` sorted by order key. */
export function insertChild(
  root: SceneNode,
  parentId: string,
  child: SceneNode,
): SceneNode {
  const result = replaceNode(root, parentId, (parent) => {
    const children = [...childrenOf(parent), child].sort((a, b) =>
      compareOrderKeys(a.order, b.order),
    );
    return withChildren(parent, children);
  });
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
