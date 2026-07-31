/**
 * The projection engine. Phase 2.4a, ENGINE_RECONCILIATION §1.2.
 *
 * ============================================================================
 * PROJECTION, NOT DIFFING
 * ============================================================================
 * There is no tree comparison in this file. There is no `diff`, no keying
 * heuristic, no reorder detection, and no walk of an unchanged subtree.
 *
 * Operations already carry what changed (RFC-002 §4.3 makes them the only
 * mutation path), so the reconciler switches on the operation and touches
 * exactly the affected nodes. The whole subsystem collapses from a diffing
 * engine into a switch statement plus descendant propagation where the maths
 * genuinely requires it.
 *
 * The only traversals that exist:
 *   - a NEW subtree on insert, which by definition has nothing to compare to
 *   - descendants on a transform or visibility change, because world matrices
 *     and effective visibility compose down the tree
 *   - a destroyed subtree, depth-first, so no backend object is orphaned
 *
 * Each is proportional to what actually changed, never to scene size.
 */
import {
  childrenOf,
  setAtPath,

  multiply,
  walk,
  type Mat4,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

import { DependencyIndex, DependencyRecorder } from "./dependencies";
import { DirtySet, type DirtyStats } from "./dirty";
import { MirrorGraph, MirrorViolation } from "./mirror";
import { channelForPath, localMatrixOf, resolveProps, type VariableSource } from "./resolve";
import type { CameraDescriptor, MirrorBackend } from "./mirror-backend";

export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionError";
  }
}

export interface ProjectionReport {
  readonly operations: number;
  readonly nodesCreated: number;
  readonly nodesDestroyed: number;
  readonly nodesReparented: number;
  readonly dirty: DirtyStats;
  /** Backend writes issued. The measure of "did we touch only what changed". */
  readonly backendWrites: number;
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export class Projector {
  #dependencies = new DependencyIndex();
  #cameras = new Map<string, CameraDescriptor>();
  /**
   * id -> current document node.
   *
   * Exists because `findNode` is O(scene): benchmarking showed a single leaf
   * edit costing 94us in a 1k scene but 73.5ms in a 50k one — O(scene size),
   * not O(change), which violates 2.4a's requirement that projection never
   * traverse outside affected paths. The dirty count was correct throughout;
   * only the benchmark exposed it.
   *
   * Maintained incrementally: build and insert populate it while already
   * walking, remove deletes what it already enumerated, and a property change
   * refreshes only the root-to-node chain (§refreshChain) — because
   * engine-scene's immutable update replaces exactly those nodes and leaves
   * every other object identical.
   */
  #index = new Map<string, SceneNode>();

  constructor(
    private readonly mirror: MirrorGraph,
    private readonly backend: MirrorBackend,
  ) {}

  get dependencies(): DependencyIndex {
    return this.#dependencies;
  }

  // -------------------------------------------------------------------------
  // build — the ops-free path
  // -------------------------------------------------------------------------

  /**
   * Constructs the mirror from a document.
   *
   * Used on scene load and as the recovery path. NOT a production update path:
   * a full rebuild cannot fit in a frame for a large scene
   * (ENGINE_RECONCILIATION §1.3), which is why `project` exists.
   */
  build(
    document: SceneDocument,
    variables: VariableSource,
  ): ProjectionReport {
    const dirty = new DirtySet();
    const before = this.#writeCount();
    let created = 0;

    const visit = (node: SceneNode, parentId: string | null) => {
      this.mirror.create(node.id, parentId, node.order);
      this.#index.set(node.id, node);
      created += 1;
      this.#applyNodeState(node, variables);
      for (const child of childrenOf(node)) visit(child, node.id);
    };

    visit(document.root, null);
    this.#recomputeWorld(document.root.id, IDENTITY, true, dirty);

    return {
      operations: 0,
      nodesCreated: created,
      nodesDestroyed: 0,
      nodesReparented: 0,
      dirty: dirty.stats(),
      backendWrites: this.#writeCount() - before,
    };
  }

  // -------------------------------------------------------------------------
  // project — the incremental path
  // -------------------------------------------------------------------------

  /**
   * Projects a transaction.
   *
   * `document` must already have the transaction applied
   * (ENGINE_RECONCILIATION §1.5) — projecting per-operation would produce
   * intermediate mirror states that never correspond to a valid document.
   */
  project(
    transaction: Transaction,
    document: SceneDocument,
    variables: VariableSource,
  ): ProjectionReport {
    const dirty = new DirtySet();
    const before = this.#writeCount();
    let created = 0;
    let destroyed = 0;
    let reparented = 0;

    // Nodes whose OWN authored values changed, as opposed to nodes merely
    // needing recomputation because an ancestor changed. Only these are
    // re-read from the document; propagated descendants keep their locals.
    const localRefresh = new Set<string>();

    for (const operation of transaction.operations) {
      const result = this.#projectOperation(
        operation,
        document,
        variables,
        dirty,
        localRefresh,
      );
      created += result.created;
      destroyed += result.destroyed;
      reparented += result.reparented;
    }

    this.#flush(document, variables, dirty, localRefresh);

    return {
      operations: transaction.operations.length,
      nodesCreated: created,
      nodesDestroyed: destroyed,
      nodesReparented: reparented,
      dirty: dirty.stats(),
      backendWrites: this.#writeCount() - before,
    };
  }

  /**
   * Re-resolves only the nodes that read the given variables. Phase 2.4e.
   *
   * A score update must not touch a scene's other 500 nodes.
   */
  invalidateVariables(
    variableKeys: Iterable<string>,
    document: SceneDocument,
    variables: VariableSource,
  ): ProjectionReport {
    const dirty = new DirtySet();
    const before = this.#writeCount();

    for (const nodeId of this.#dependencies.dependentsOfAny(variableKeys)) {
      if (!this.mirror.has(nodeId)) continue;
      if (!this.#index.has(nodeId)) continue;
      // A binding feeds a component property, which is material-channel: it
      // must not invalidate transforms.
      dirty.mark("material", nodeId);
    }

    this.#flush(document, variables, dirty);

    return {
      operations: 0,
      nodesCreated: 0,
      nodesDestroyed: 0,
      nodesReparented: 0,
      dirty: dirty.stats(),
      backendWrites: this.#writeCount() - before,
    };
  }

  teardown(): void {
    this.mirror.teardown();
    this.#dependencies.clear();
    this.#cameras.clear();
    this.#index.clear();
  }

  // -------------------------------------------------------------------------
  // Per-operation projection
  // -------------------------------------------------------------------------

  #projectOperation(
    operation: SceneOperation,
    document: SceneDocument,
    variables: VariableSource,
    dirty: DirtySet,
    localRefresh: Set<string>,
  ): { created: number; destroyed: number; reparented: number } {
    switch (operation.type) {
      case "node.insert": {
        let created = 0;
        // A new subtree has nothing to compare against, so walking it is
        // proportional to what was added, not to scene size.
        const visit = (node: SceneNode, parentId: string) => {
          this.mirror.create(node.id, parentId, node.order);
          this.#index.set(node.id, node);
          created += 1;
          this.#applyNodeState(node, variables);
          for (const child of childrenOf(node)) visit(child, node.id);
        };
        visit(operation.node, operation.parentId);

        dirty.markSubtree("transform", operation.node.id, (id) =>
          this.mirror.has(id) ? this.mirror.childrenOf(id) : [],
        );
        dirty.mark("hierarchy", operation.parentId);
        return { created, destroyed: 0, reparented: 0 };
      }

      case "node.remove": {
        const removed = this.mirror.destroySubtree(operation.nodeId);
        for (const id of removed) {
          this.#dependencies.clearNode(id);
          this.#cameras.delete(id);
          this.#index.delete(id);
          dirty.forget(id);
        }

        dirty.mark("hierarchy", operation.previousParentId);
        return { created: 0, destroyed: removed.length, reparented: 0 };
      }

      case "node.move": {
        this.mirror.reparent(
          operation.nodeId,
          operation.parentId,
          operation.order,
        );
        // World matrices depend on the ancestor chain, so a move invalidates
        // the moved subtree's transforms — but nothing outside it.
        dirty.markSubtree("transform", operation.nodeId, (id) =>
          this.mirror.has(id) ? this.mirror.childrenOf(id) : [],
        );
        dirty.markSubtree("visibility", operation.nodeId, (id) =>
          this.mirror.has(id) ? this.mirror.childrenOf(id) : [],
        );
        dirty.mark("hierarchy", operation.parentId);
        dirty.mark("hierarchy", operation.previousParentId);
        return { created: 0, destroyed: 0, reparented: 1 };
      }

      case "node.setProp":
      case "binding.set":
      case "binding.clear": {
        const nodeId = operation.nodeId;
        if (!this.mirror.has(nodeId)) {
          throw new ProjectionError(
            `setProp on "${nodeId}", which is not in the mirror`,
          );
        }
        const path = operation.path;
        const channel = channelForPath(path);

        // Apply the same edit to the cached node using engine-scene's own
        // setAtPath, so the index cannot drift from the document and the
        // update is O(path) rather than O(siblings).
        const cached = this.#index.get(nodeId);
        if (cached) {
          const next =
            operation.type === "binding.set"
              ? setAtPath(cached, path, { $var: operation.variableKey })
              : setAtPath(cached, path, operation.value);
          this.#index.set(nodeId, next);
        }

        if (channel === "transform") {
          // The origin's own local matrix changed and must be re-read.
          // Descendants only need their world recomposed.
          localRefresh.add(nodeId);
          dirty.markSubtree("transform", nodeId, (id) =>
            this.mirror.has(id) ? this.mirror.childrenOf(id) : [],
          );
        } else if (channel === "visibility") {
          localRefresh.add(nodeId);
          dirty.markSubtree("visibility", nodeId, (id) =>
            this.mirror.has(id) ? this.mirror.childrenOf(id) : [],
          );
        } else if (channel === "runtime") {
          dirty.mark("material", nodeId);
        } else {
          // Material and camera changes affect exactly one node. This is the
          // assertion that a colour change never invalidates a transform.
          dirty.mark(channel === "camera" ? "camera" : "material", nodeId);
        }
        return { created: 0, destroyed: 0, reparented: 0 };
      }

      case "variable.define":
      case "variable.remove":
      case "variable.setDefault": {
        // Defaults feed resolution, so dependents re-resolve. Structure is
        // untouched.
        const key =
          operation.type === "variable.define"
            ? operation.variable.key
            : operation.type === "variable.remove"
              ? operation.previousVariable.key
              : this.#variableKeyById(document, operation.variableId);
        if (key) {
          for (const nodeId of this.#dependencies.dependents(key)) {
            if (this.mirror.has(nodeId)) dirty.mark("material", nodeId);
          }
        }
        return { created: 0, destroyed: 0, reparented: 0 };
      }

      case "doc.setMeta":
        // Metadata does not project. Canvas changes are an output concern.
        return { created: 0, destroyed: 0, reparented: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Flush — turn dirty state into backend writes
  // -------------------------------------------------------------------------

  #flush(
    document: SceneDocument,
    variables: VariableSource,
    dirty: DirtySet,
    localRefresh: Set<string> = new Set(),
  ): void {
    // Re-read authored values for nodes whose own properties changed, before
    // anything is recomputed from them. Without this, world matrices are
    // composed from a stale local and propagation is correct but its input is
    // not — found by the consistency verifier, which re-derives independently
    // rather than trusting what projection recorded.
    for (const nodeId of localRefresh) {
      if (!this.mirror.has(nodeId)) continue;
      const node = this.#lookup(nodeId);
      if (node) this.#applyNodeState(node, variables);
    }

    // Transforms first: world matrices are recomputed from the highest dirty
    // ancestor down, so a parent and child both dirtying costs one pass.
    for (const nodeId of this.#topmost(dirty.get("transform"))) {
      if (!this.mirror.has(nodeId)) continue;
      const parentId = this.mirror.get(nodeId)!.parentId;
      const parentWorld =
        parentId === null
          ? IDENTITY
          : (this.mirror.get(parentId)?.worldMatrix ?? IDENTITY);
      const parentVisible =
        parentId === null
          ? true
          : (this.mirror.get(parentId)?.effectiveVisible ?? true);
      this.#recomputeWorld(nodeId, parentWorld, parentVisible, dirty);
    }

    for (const nodeId of this.#topmost(dirty.get("visibility"))) {
      if (!this.mirror.has(nodeId)) continue;
      if (dirty.has("transform", nodeId)) continue; // already handled above
      const parentId = this.mirror.get(nodeId)!.parentId;
      const parentVisible =
        parentId === null
          ? true
          : (this.mirror.get(parentId)?.effectiveVisible ?? true);
      this.#recomputeVisibility(nodeId, parentVisible);
    }

    for (const nodeId of dirty.get("material")) {
      if (!this.mirror.has(nodeId)) continue;
      const node = this.#lookup(nodeId);
      if (node) this.#applyNodeState(node, variables);
    }

    for (const nodeId of dirty.get("camera")) {
      if (!this.mirror.has(nodeId)) continue;
      const node = this.#lookup(nodeId);
      if (node) this.#applyCamera(node);
    }
  }

  /**
   * Removes nodes whose ancestor is also in the set.
   *
   * Recomputing from a node whose parent is about to be recomputed would do
   * the subtree twice. Keeping only the topmost makes propagation linear in
   * the affected region.
   */
  #topmost(nodeIds: ReadonlySet<string>): string[] {
    const out: string[] = [];
    for (const nodeId of nodeIds) {
      let ancestorDirty = false;
      for (const ancestorId of this.mirror.ancestorsOf(nodeId)) {
        if (nodeIds.has(ancestorId)) {
          ancestorDirty = true;
          break;
        }
      }
      if (!ancestorDirty) out.push(nodeId);
    }
    // Sorted so a batch produces the same write order every run.
    return out.sort();
  }

  #recomputeWorld(
    nodeId: string,
    parentWorld: Mat4,
    parentVisible: boolean,
    dirty: DirtySet,
  ): void {
    const node = this.mirror.get(nodeId);
    if (!node) return;

    const world = multiply(parentWorld, node.localMatrix);
    node.worldMatrix = world;
    this.backend.setWorldMatrix(node.handle, world);

    const effective = parentVisible && node.visible;
    if (effective !== node.effectiveVisible) {
      node.effectiveVisible = effective;
      this.backend.setVisible(node.handle, effective);
    }

    for (const childId of node.childIds) {
      this.#recomputeWorld(childId, world, effective, dirty);
    }
  }

  #recomputeVisibility(nodeId: string, parentVisible: boolean): void {
    const node = this.mirror.get(nodeId);
    if (!node) return;

    const effective = parentVisible && node.visible;
    if (effective !== node.effectiveVisible) {
      node.effectiveVisible = effective;
      this.backend.setVisible(node.handle, effective);
    }
    for (const childId of node.childIds) {
      this.#recomputeVisibility(childId, effective);
    }
  }

  // -------------------------------------------------------------------------
  // Node state
  // -------------------------------------------------------------------------

  #applyNodeState(node: SceneNode, variables: VariableSource): void {
    const mirror = this.mirror.require(node.id, "applyNodeState");
    const recorder = new DependencyRecorder();

    mirror.localMatrix = localMatrixOf(node.transform);
    mirror.visible = node.visible ?? true;

    const runtime = node.runtime;
    const layers = runtime?.layers ? runtime.layers.length : 1;
    if (layers !== mirror.layers) {
      mirror.layers = layers;
      this.backend.setLayers(mirror.handle, layers);
    }
    const renderOrder = runtime?.renderOrder ?? 0;
    if (renderOrder !== mirror.renderOrder) {
      mirror.renderOrder = renderOrder;
      this.backend.setRenderOrder(mirror.handle, renderOrder);
    }

    // Resolve every component's props so bindings are recorded, even for
    // component types this phase does not yet attach.
    for (const component of node.components ?? []) {
      resolveProps(component.props, variables, recorder);
      if (component.type === "camera") this.#applyCamera(node);
    }

    this.#dependencies.set(node.id, recorder.take());
  }

  #applyCamera(node: SceneNode): void {
    const component = node.components?.find((c) => c.type === "camera");
    if (!component) return;

    const props = component.props as {
      projection?: string;
      focalLength?: number;
      sensorWidth?: number;
      orthographicSize?: number;
      near?: number;
      far?: number;
    };

    const descriptor: CameraDescriptor =
      props.projection === "orthographic"
        ? {
            kind: "orthographic",
            size: props.orthographicSize ?? 5,
            near: props.near ?? 0.1,
            far: props.far ?? 1000,
          }
        : {
            kind: "perspective",
            focalLengthMm: props.focalLength ?? 35,
            sensorWidthMm: props.sensorWidth ?? 36,
            near: props.near ?? 0.1,
            far: props.far ?? 1000,
          };

    const mirror = this.mirror.require(node.id, "applyCamera");
    const existing = this.#cameras.get(node.id);

    if (existing === undefined) {
      const handle = this.backend.createCamera(descriptor);
      this.#cameras.set(node.id, descriptor);
      this.mirror.setAttachment(node.id, { kind: "camera", camera: handle });
    } else if (mirror.attachment.kind === "camera") {
      // Update in place rather than recreate, so the handle stays stable.
      this.backend.updateCamera(mirror.attachment.camera, descriptor);
      this.#cameras.set(node.id, descriptor);
    }
  }

  #variableKeyById(
    document: SceneDocument,
    variableId: string,
  ): string | undefined {
    return document.variables.find((v) => v.id === variableId)?.key;
  }

  #lookup(nodeId: string): SceneNode | undefined {
    return this.#index.get(nodeId);
  }

  /*
   * There is deliberately no chain-refresh here.
   *
   * An earlier version re-derived the index by descending root-to-node after
   * every edit. It was still O(width), because finding a child by id scans the
   * sibling array — 50,000 entries for a wide scene. Isolated measurement put
   * projection at 21.5ms in a 50k scene, which is O(scene) and violates 2.4a.
   *
   * The descent turned out to be unnecessary: only the directly changed node
   * is ever re-applied, never its ancestors, so reproducing the document's own
   * edit on the cached node is both sufficient and O(path).
   */

  #writeCount(): number {
    const backend = this.backend as { writeCount?: number };
    return backend.writeCount ?? 0;
  }
}

/** Every node id in a document, for consistency checks. */
export function documentNodeIds(document: SceneDocument): Set<string> {
  const ids = new Set<string>();
  for (const node of walk(document.root)) ids.add(node.id);
  return ids;
}

export { MirrorViolation };
