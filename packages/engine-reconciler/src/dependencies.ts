/**
 * Dependency tracking. Phase 2.4e.
 *
 * A variable change must invalidate only the nodes that actually read it.
 * Without this index, a single score update would re-resolve every node in the
 * scene — which is exactly the whole-tree work projection exists to avoid.
 *
 * The index is built as a side effect of resolution: whatever the resolver
 * touches while producing a node's values is recorded as that node's
 * dependency set. Nothing has to declare dependencies by hand, so they cannot
 * drift from what the code actually reads.
 */

export interface DependencyStats {
  readonly trackedNodes: number;
  readonly trackedVariables: number;
  readonly edges: number;
}

export class DependencyIndex {
  /** variable key -> node ids that read it */
  #byVariable = new Map<string, Set<string>>();
  /** node id -> variable keys it reads. Needed to unlink on removal. */
  #byNode = new Map<string, Set<string>>();

  /** Replaces a node's dependency set. Called after resolving it. */
  set(nodeId: string, variableKeys: Iterable<string>): void {
    this.clearNode(nodeId);

    const keys = new Set(variableKeys);
    if (keys.size === 0) return;

    this.#byNode.set(nodeId, keys);
    for (const key of keys) {
      let nodes = this.#byVariable.get(key);
      if (!nodes) {
        nodes = new Set();
        this.#byVariable.set(key, nodes);
      }
      nodes.add(nodeId);
    }
  }

  /** Nodes that read `variableKey`. Empty when nothing does. */
  dependents(variableKey: string): ReadonlySet<string> {
    return this.#byVariable.get(variableKey) ?? EMPTY;
  }

  /** Union of dependents across several keys, for a batch of variable changes. */
  dependentsOfAny(variableKeys: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const key of variableKeys) {
      for (const nodeId of this.dependents(key)) out.add(nodeId);
    }
    return out;
  }

  dependenciesOf(nodeId: string): ReadonlySet<string> {
    return this.#byNode.get(nodeId) ?? EMPTY;
  }

  /** Unlinks a node from every variable. Must run when a node is destroyed. */
  clearNode(nodeId: string): void {
    const keys = this.#byNode.get(nodeId);
    if (!keys) return;

    for (const key of keys) {
      const nodes = this.#byVariable.get(key);
      if (!nodes) continue;
      nodes.delete(nodeId);
      // Drop empty buckets, or a long show accumulates keys nothing reads.
      if (nodes.size === 0) this.#byVariable.delete(key);
    }
    this.#byNode.delete(nodeId);
  }

  stats(): DependencyStats {
    let edges = 0;
    for (const nodes of this.#byVariable.values()) edges += nodes.size;
    return {
      trackedNodes: this.#byNode.size,
      trackedVariables: this.#byVariable.size,
      edges,
    };
  }

  clear(): void {
    this.#byVariable.clear();
    this.#byNode.clear();
  }
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Records which variables a resolution touched.
 *
 * Passed into resolution so the dependency set is a by-product of reading
 * rather than a separate declaration that can fall out of sync.
 */
export class DependencyRecorder {
  #touched = new Set<string>();

  record(variableKey: string): void {
    this.#touched.add(variableKey);
  }

  take(): Set<string> {
    const result = this.#touched;
    this.#touched = new Set();
    return result;
  }

  get size(): number {
    return this.#touched.size;
  }
}
