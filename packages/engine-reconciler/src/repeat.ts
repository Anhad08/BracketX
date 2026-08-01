/**
 * Collection expansion. Project Alpha A2.
 *
 * Turns one authored template into N instances, deterministically.
 *
 * ============================================================================
 * IDENTITY IS THE WHOLE PROBLEM
 * ============================================================================
 * Expanding a list is trivial. Expanding it *again*, after the list changed,
 * without churning everything, is not.
 *
 * A leaderboard reordering must not destroy and rebuild eight instances — that
 * drops their GPU resources, restarts any animation in flight, and costs
 * O(list) where the change was O(1). So every instance carries a stable
 * identity derived from the item, and re-expansion matches on identity, not
 * position.
 *
 * With `key`, identity is the item's own field and survives reordering.
 * Without it, identity is the index, and a reorder is indistinguishable from
 * every item changing — correct, but wasteful, and the reason `key` exists.
 *
 * Instance node ids are derived, never authored: `<templateId>#<identity>`.
 * They are stable across expansions and unique within a document, which is what
 * lets the mirror treat an instance exactly like any other node.
 */
import { childrenOf, type SceneNode } from "@bracketx/engine-scene";

/** Separator between a template id and an instance identity. */
export const INSTANCE_SEPARATOR = "#";

export interface RepeatInstance {
  /** Stable identity: the keyed field, or the index as a string. */
  readonly identity: string;
  /** The item the instance is bound to. */
  readonly item: unknown;
  /** Expanded children, with derived ids. */
  readonly nodes: readonly SceneNode[];
}

/**
 * Reads the collection a repeat is bound to.
 *
 * A missing or non-array value yields zero instances rather than throwing. A
 * data feed that has not arrived yet, or that returned an object where an array
 * was expected, must render an empty list — not take the show down.
 */
export function readCollection(value: unknown, limit?: number): readonly unknown[] {
  if (!Array.isArray(value)) return [];
  if (limit !== undefined && value.length > limit) return value.slice(0, limit);
  return value;
}

/** Identity for one item. Keyed if possible, index otherwise. */
export function identityOf(
  item: unknown,
  index: number,
  key: string | undefined,
): string {
  if (key === undefined) return String(index);
  if (item === null || typeof item !== "object") return String(index);

  const value = (item as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  // A key that resolves to nothing falls back to index rather than colliding.
  // Two instances sharing an identity would give the mirror duplicate ids.
  return String(index);
}

/**
 * Rewrites a subtree's node ids to be unique within an instance.
 *
 * Every descendant is suffixed, not just the root: two instances of a template
 * containing a child would otherwise both claim that child's id, and the mirror
 * enforces uniqueness.
 *
 * Order keys are left untouched. Siblings within an instance keep their
 * authored order, and instances are ordered relative to each other by the
 * container's own child ordering.
 */
function suffixIds(node: SceneNode, suffix: string): SceneNode {
  const children = childrenOf(node);
  const next: SceneNode = {
    ...node,
    id: `${node.id}${INSTANCE_SEPARATOR}${suffix}`,
  };

  if (children.length === 0) {
    // Omit rather than emit an empty array — canonical form depends on it
    // (the `children: []` defect from Phase 2.2).
    if (node.children === undefined) return next;
    const { children: _dropped, ...rest } = next;
    return rest as SceneNode;
  }

  return {
    ...next,
    children: children.map((child) => suffixIds(child, suffix)),
  };
}

/**
 * Expands a repeat container into instances.
 *
 * Pure: takes the container and the resolved collection, returns instances.
 * Nothing here touches the mirror or the backend — the projector decides what
 * to do with the difference.
 */
export function expandRepeat(
  container: SceneNode,
  collection: readonly unknown[],
  key: string | undefined,
): readonly RepeatInstance[] {
  const template = childrenOf(container);
  if (template.length === 0) return [];

  const instances: RepeatInstance[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < collection.length; index += 1) {
    const item = collection[index];
    let identity = identityOf(item, index, key);

    // A duplicate key in the data must not produce duplicate node ids. Falling
    // back to the index keeps the document valid; the alternative is a mirror
    // violation thrown mid-show because a feed repeated a row.
    if (seen.has(identity)) identity = `${identity}~${index}`;
    seen.add(identity);

    instances.push({
      identity,
      item,
      nodes: template.map((child) => suffixIds(child, identity)),
    });
  }

  return instances;
}

/** True when the node repeats. */
export function isRepeatContainer(node: SceneNode): boolean {
  return node.repeat !== undefined && typeof node.repeat.source === "string";
}
