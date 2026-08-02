/**
 * The mirror graph. ENGINE_RECONCILIATION §2.2.
 *
 * Backend-neutral by construction: a mirror node holds resolved values and
 * opaque handles, never a document node, never a backend object, never a
 * scene-graph reference. Swapping the backend replaces the handles and touches
 * nothing here.
 *
 * ============================================================================
 * OWNERSHIP (ENGINE_RECONCILIATION §2.1, §3.1)
 * ============================================================================
 * The mirror owns LIFETIME: it decides when a backend object is created and
 * destroyed. The backend owns the INSTANCE. Every mirror node therefore has
 * exactly one creator (`create`), one owner (this graph), and one destroy path
 * (`destroySubtree`).
 *
 * Assertions here are deliberate: an ownership violation that reaches a real
 * GPU backend appears as a leak or a crash days later. Caught in the mirror, it
 * is a stack trace at the call site.
 */
import type { Mat4 } from "@bracketx/engine-scene";

import type {
  CameraHandle,
  LightHandle,
  GeometryHandle,
  MaterialHandle,
  MirrorBackend,
  NodeHandle,
} from "./mirror-backend";

export class MirrorViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MirrorViolation";
  }
}

export type MirrorAttachment =
  | { readonly kind: "none" }
  | {
      readonly kind: "mesh";
      readonly geometry: GeometryHandle;
      readonly material: MaterialHandle;
    }
  | { readonly kind: "camera"; readonly camera: CameraHandle }
  | { readonly kind: "light"; readonly light: LightHandle };

/**
 * One mirrored node.
 *
 * `nodeId` is the only link back to the document, and it is a string — not a
 * reference. The mirror cannot reach into the scene graph even by accident.
 */
export interface MirrorNode {
  readonly nodeId: string;
  readonly handle: NodeHandle;
  parentId: string | null;
  /** Ordered by the document's fractional index. */
  childIds: string[];
  order: string;
  localMatrix: Mat4;
  worldMatrix: Mat4;
  /** As authored. Effective visibility also depends on ancestors. */
  visible: boolean;
  /** Cached ancestor-inclusive visibility, so a query needs no walk. */
  effectiveVisible: boolean;
  layers: number;
  renderOrder: number;
  attachment: MirrorAttachment;
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface MirrorStats {
  readonly nodeCount: number;
  readonly created: number;
  readonly destroyed: number;
  readonly rootId: string | null;
}

export class MirrorGraph {
  #nodes = new Map<string, MirrorNode>();
  #rootId: string | null = null;
  #created = 0;
  #destroyed = 0;
  /** Every id ever created, so a resurrection attempt is detectable. */
  #everCreated = new Set<string>();

  constructor(private readonly backend: MirrorBackend) {}

  get rootId(): string | null {
    return this.#rootId;
  }

  get size(): number {
    return this.#nodes.size;
  }

  has(nodeId: string): boolean {
    return this.#nodes.has(nodeId);
  }

  get(nodeId: string): MirrorNode | undefined {
    return this.#nodes.get(nodeId);
  }

  require(nodeId: string, operation: string): MirrorNode {
    const node = this.#nodes.get(nodeId);
    if (!node) {
      throw new MirrorViolation(
        this.#everCreated.has(nodeId)
          ? `${operation}: node "${nodeId}" was destroyed — use after destroy`
          : `${operation}: node "${nodeId}" is not in the mirror`,
      );
    }
    return node;
  }

  nodeIds(): IterableIterator<string> {
    return this.#nodes.keys();
  }

  /**
   * Creates a mirror node and its backend object.
   *
   * The single creator. Nothing else may call `backend.createNode`, which is
   * what makes "exactly one creator" checkable rather than aspirational.
   */
  create(
    nodeId: string,
    parentId: string | null,
    order: string,
  ): MirrorNode {
    if (this.#nodes.has(nodeId)) {
      throw new MirrorViolation(
        `create("${nodeId}"): already exists — duplicate ownership`,
      );
    }

    const handle = this.backend.createNode();
    const node: MirrorNode = {
      nodeId,
      handle,
      parentId,
      childIds: [],
      order,
      localMatrix: IDENTITY,
      worldMatrix: IDENTITY,
      visible: true,
      effectiveVisible: true,
      layers: 1,
      renderOrder: 0,
      attachment: { kind: "none" },
    };

    this.#nodes.set(nodeId, node);
    this.#everCreated.add(nodeId);
    this.#created += 1;

    if (parentId === null) {
      if (this.#rootId !== null) {
        throw new MirrorViolation(
          `create("${nodeId}"): a second root is not permitted ` +
            `(existing root "${this.#rootId}")`,
        );
      }
      this.#rootId = nodeId;
    } else {
      const parent = this.require(parentId, `create("${nodeId}")`);
      this.#insertChildOrdered(parent, nodeId, order);
      this.backend.setParent(handle, parent.handle);
    }

    return node;
  }

  /**
   * Destroys a subtree, children first.
   *
   * Depth-first is required, not stylistic: destroying a parent while it still
   * has children would orphan backend objects, and the mock backend rejects
   * it. Returns the ids removed, so the caller can clear its own indexes.
   */
  destroySubtree(nodeId: string): string[] {
    const node = this.require(nodeId, "destroySubtree");
    const removed: string[] = [];

    const visit = (current: MirrorNode) => {
      // Copy: the recursive call mutates childIds via detach.
      for (const childId of [...current.childIds]) {
        const child = this.#nodes.get(childId);
        if (child) visit(child);
      }
      this.#releaseAttachment(current);
      this.backend.destroyNode(current.handle);
      this.#nodes.delete(current.nodeId);
      this.#destroyed += 1;
      removed.push(current.nodeId);
    };

    visit(node);

    // Unlink after the subtree is gone, so the parent's child list is only
    // touched once rather than per descendant.
    if (node.parentId !== null) {
      const parent = this.#nodes.get(node.parentId);
      if (parent) {
        const index = parent.childIds.indexOf(nodeId);
        if (index !== -1) parent.childIds.splice(index, 1);
      }
    } else if (this.#rootId === nodeId) {
      this.#rootId = null;
    }

    return removed;
  }

  /** Reparents and/or reorders. Preserves the handle — never destroy-recreate. */
  reparent(nodeId: string, newParentId: string, order: string): void {
    const node = this.require(nodeId, "reparent");
    const newParent = this.require(newParentId, "reparent(parent)");

    if (this.#isAncestorOf(nodeId, newParentId)) {
      throw new MirrorViolation(
        `reparent("${nodeId}" under "${newParentId}"): would create a cycle`,
      );
    }

    if (node.parentId !== null) {
      const oldParent = this.#nodes.get(node.parentId);
      if (oldParent) {
        const index = oldParent.childIds.indexOf(nodeId);
        if (index !== -1) oldParent.childIds.splice(index, 1);
      }
    }

    node.parentId = newParentId;
    node.order = order;
    this.#insertChildOrdered(newParent, nodeId, order);

    // ENGINE_RECONCILIATION §1.4: reparent the existing object. Destroying and
    // recreating would drop GPU resources and restart in-flight state.
    this.backend.setParent(node.handle, newParent.handle);
  }

  setAttachment(nodeId: string, attachment: MirrorAttachment): void {
    const node = this.require(nodeId, "setAttachment");
    this.#releaseAttachment(node);
    node.attachment = attachment;

    switch (attachment.kind) {
      case "mesh":
        this.backend.attachMesh(
          node.handle,
          attachment.geometry,
          attachment.material,
        );
        break;
      case "camera":
        this.backend.attachCamera(node.handle, attachment.camera);
        break;
      case "none":
        this.backend.detach(node.handle);
        break;
    }
  }

  /** Children in document order. */
  childrenOf(nodeId: string): readonly string[] {
    return this.require(nodeId, "childrenOf").childIds;
  }

  ancestorsOf(nodeId: string): string[] {
    const out: string[] = [];
    let current = this.#nodes.get(nodeId)?.parentId ?? null;
    while (current !== null) {
      out.push(current);
      current = this.#nodes.get(current)?.parentId ?? null;
    }
    return out;
  }

  /** Removes everything. Depth-first via destroySubtree. */
  teardown(): void {
    if (this.#rootId !== null) this.destroySubtree(this.#rootId);
    // Any node left is an orphan, which is itself a violation — but tearing
    // down must still leave nothing behind, so they are removed and reported.
    if (this.#nodes.size > 0) {
      const orphans = [...this.#nodes.keys()];
      for (const id of orphans) {
        const node = this.#nodes.get(id)!;
        this.#releaseAttachment(node);
        this.backend.destroyNode(node.handle);
        this.#nodes.delete(id);
        this.#destroyed += 1;
      }
      throw new MirrorViolation(
        `teardown found ${orphans.length} orphaned node(s): ${orphans.join(", ")}`,
      );
    }
    this.#rootId = null;
  }

  stats(): MirrorStats {
    return {
      nodeCount: this.#nodes.size,
      created: this.#created,
      destroyed: this.#destroyed,
      rootId: this.#rootId,
    };
  }

  // -- Internals -----------------------------------------------------------

  #insertChildOrdered(parent: MirrorNode, childId: string, order: string): void {
    // Binary search rather than push-then-sort: a wide parent would otherwise
    // cost O(n log n) on every insert.
    let low = 0;
    let high = parent.childIds.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midOrder = this.#nodes.get(parent.childIds[mid]!)?.order ?? "";
      if (midOrder < order) low = mid + 1;
      else high = mid;
    }
    parent.childIds.splice(low, 0, childId);
  }

  #isAncestorOf(ancestorId: string, nodeId: string): boolean {
    if (ancestorId === nodeId) return true;
    let current = this.#nodes.get(nodeId)?.parentId ?? null;
    while (current !== null) {
      if (current === ancestorId) return true;
      current = this.#nodes.get(current)?.parentId ?? null;
    }
    return false;
  }

  /**
   * Releases backend resources an attachment held.
   *
   * Geometry, materials, and cameras are content-addressed and owned by the
   * resource manager (ENGINE_RECONCILIATION §2.1), so the mirror detaches
   * rather than destroying them. Only nodes are the mirror's to destroy.
   */
  #releaseAttachment(node: MirrorNode): void {
    if (node.attachment.kind !== "none") {
      node.attachment = { kind: "none" };
    }
  }
}
