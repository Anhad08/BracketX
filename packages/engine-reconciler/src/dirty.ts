/**
 * Dirty tracking. Phase 2.4d.
 *
 * The mechanism that makes reconciliation incremental. Each channel is
 * separate because they propagate differently, and conflating them would
 * invalidate work that did not change:
 *
 *   transform   propagates to descendants (world matrices compose)
 *   visibility  propagates to descendants (effective visibility composes)
 *   hierarchy   affects the node and its new/old parents
 *   material    affects exactly one node — never descendants
 *   camera      affects exactly one node
 *
 * A material change must not dirty transforms. That is the whole point of
 * separate channels, and it is asserted by test.
 */

export type DirtyChannel =
  | "transform"
  | "hierarchy"
  | "material"
  | "visibility"
  | "camera";

export const DIRTY_CHANNELS: readonly DirtyChannel[] = [
  "transform",
  "hierarchy",
  "material",
  "visibility",
  "camera",
];

export interface DirtyStats {
  readonly transform: number;
  readonly hierarchy: number;
  readonly material: number;
  readonly visibility: number;
  readonly camera: number;
  readonly total: number;
  /** Deepest chain walked while propagating this batch. */
  readonly maxPropagationDepth: number;
  /** Nodes visited during propagation, including those already dirty. */
  readonly propagationVisits: number;
}

export class DirtySet {
  #channels = new Map<DirtyChannel, Set<string>>();
  #maxDepth = 0;
  #visits = 0;

  constructor() {
    for (const channel of DIRTY_CHANNELS) {
      this.#channels.set(channel, new Set());
    }
  }

  mark(channel: DirtyChannel, nodeId: string): void {
    this.#channels.get(channel)!.add(nodeId);
  }

  /**
   * Marks a node and its descendants.
   *
   * `childrenOf` is supplied rather than the graph itself so this module stays
   * a pure data structure — it cannot reach the backend even by accident.
   *
   * Already-dirty subtrees are skipped: if a node is marked, its descendants
   * were marked with it, so re-walking is pure waste. This is what keeps a
   * batch of sibling transform edits from being quadratic.
   */
  markSubtree(
    channel: DirtyChannel,
    nodeId: string,
    childrenOf: (id: string) => readonly string[],
  ): void {
    const set = this.#channels.get(channel)!;
    const stack: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }];

    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;
      this.#visits += 1;
      if (depth > this.#maxDepth) this.#maxDepth = depth;

      if (set.has(id) && depth > 0) continue;
      set.add(id);

      for (const childId of childrenOf(id)) {
        stack.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  has(channel: DirtyChannel, nodeId: string): boolean {
    return this.#channels.get(channel)!.has(nodeId);
  }

  get(channel: DirtyChannel): ReadonlySet<string> {
    return this.#channels.get(channel)!;
  }

  get isEmpty(): boolean {
    for (const set of this.#channels.values()) {
      if (set.size > 0) return false;
    }
    return true;
  }

  /** Every dirty node across all channels. */
  union(): Set<string> {
    const all = new Set<string>();
    for (const set of this.#channels.values()) {
      for (const id of set) all.add(id);
    }
    return all;
  }

  /** Drops a node from every channel. Used when it is destroyed mid-batch. */
  forget(nodeId: string): void {
    for (const set of this.#channels.values()) set.delete(nodeId);
  }

  stats(): DirtyStats {
    const counts = Object.fromEntries(
      DIRTY_CHANNELS.map((c) => [c, this.#channels.get(c)!.size]),
    ) as Record<DirtyChannel, number>;

    return {
      ...counts,
      total: this.union().size,
      maxPropagationDepth: this.#maxDepth,
      propagationVisits: this.#visits,
    };
  }

  clear(): void {
    for (const set of this.#channels.values()) set.clear();
    this.#maxDepth = 0;
    this.#visits = 0;
  }
}
