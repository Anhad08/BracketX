/**
 * A document index, built once per document version.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * V2's inspector answered "what is the authored shape of this node" by walking
 * the document recursively — once per selected node, and once more to build a
 * full id map on every 10Hz sample. On a 35-node scene that was free. On the
 * hundred-thousand-node scenes the workbench is required to stay usable in, it
 * is two full traversals per sample, which makes the tool the dominant cost in
 * the process it is measuring.
 *
 * So the traversal happens once and is cached against the document OBJECT. The
 * engine's documents are immutable — `apply()` returns a new one — so object
 * identity is an exact version stamp. No invalidation logic, no staleness: a
 * changed document is a different key, and the old index is collected.
 *
 * The cost moves from O(n) per sample to O(n) per document CHANGE. Edits are
 * rare relative to samples, which is the trade this is making explicitly.
 */
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";

export interface IndexedNode {
  readonly node: SceneNode;
  readonly parentId: string | null;
  readonly depth: number;
}

/**
 * Splits a mirror id into its authored template and its instance identity.
 *
 * Collection instances are named `<templateId>#<identity>` (ENGINE_RUNTIME's
 * keyed identity rule). The workbench must never re-derive that rule from
 * scratch anywhere else — one copy, here, so a naming change breaks one file.
 */
export function splitInstanceId(mirrorId: string): {
  templateId: string;
  identity: string | null;
} {
  const hash = mirrorId.lastIndexOf("#");
  if (hash <= 0) return { templateId: mirrorId, identity: null };
  return { templateId: mirrorId.slice(0, hash), identity: mirrorId.slice(hash + 1) };
}

export class SceneIndex {
  readonly document: SceneDocument;
  readonly #byId = new Map<string, IndexedNode>();

  constructor(document: SceneDocument) {
    this.document = document;

    // Iterative, not recursive. R-001 logged the engine's own traversal-depth
    // ceiling; a debugging tool that stack-overflows on the document it is
    // meant to explain is worse than useless, because it fails exactly when
    // the scene is unusual.
    const stack: { node: SceneNode; parentId: string | null; depth: number }[] = [
      { node: document.root, parentId: null, depth: 0 },
    ];
    while (stack.length > 0) {
      const { node, parentId, depth } = stack.pop()!;
      this.#byId.set(node.id, { node, parentId, depth });
      for (const child of node.children ?? []) {
        stack.push({ node: child, parentId: node.id, depth: depth + 1 });
      }
    }
  }

  get size(): number {
    return this.#byId.size;
  }

  get(id: string): IndexedNode | undefined {
    return this.#byId.get(id);
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /**
   * The authored node behind a mirror id.
   *
   * A collection instance has no authored node of its own; its shape is the
   * template's. Resolving that here is what lets every tool treat instances and
   * authored nodes uniformly instead of each one re-implementing the rule.
   */
  sourceFor(mirrorId: string): SceneNode | null {
    const direct = this.#byId.get(mirrorId);
    if (direct !== undefined) return direct.node;
    const { templateId } = splitInstanceId(mirrorId);
    return this.#byId.get(templateId)?.node ?? null;
  }

  /** True when this mirror id names a repeat instance of an authored template. */
  isInstance(mirrorId: string): boolean {
    if (this.#byId.has(mirrorId)) return false;
    const { templateId, identity } = splitInstanceId(mirrorId);
    return identity !== null && this.#byId.has(templateId);
  }

  /** Authored ancestors, root first. Empty for an id the document does not hold. */
  ancestorsOf(id: string): readonly SceneNode[] {
    const out: SceneNode[] = [];
    let cursor = this.#byId.get(id)?.parentId ?? null;
    while (cursor !== null) {
      const entry = this.#byId.get(cursor);
      if (entry === undefined) break;
      out.unshift(entry.node);
      cursor = entry.parentId;
    }
    return out;
  }

  /** Every authored node, in document order. */
  nodes(): Iterable<IndexedNode> {
    return this.#byId.values();
  }
}

const cache = new WeakMap<SceneDocument, SceneIndex>();

/** The index for a document, built on first use and reused thereafter. */
export function sceneIndex(document: SceneDocument): SceneIndex {
  const existing = cache.get(document);
  if (existing !== undefined) return existing;
  const built = new SceneIndex(document);
  cache.set(document, built);
  return built;
}
