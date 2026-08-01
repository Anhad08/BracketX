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
  applyStates,
  childrenOf,
  isLayoutContainer,
  layoutChildren,
  setAtPath,
  anchorPlacement,
  sizeOf,
  toInsets,
  type Placement,

  multiply,
  walk,
  type Mat4,
  type SceneDocument,
  type SceneNode,
  type AnimatedValues,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

import { DependencyIndex, DependencyRecorder } from "./dependencies";
import { DirtySet, type DirtyStats } from "./dirty";
import { MirrorGraph, MirrorViolation } from "./mirror";
import { channelForPath, localMatrixOf, resolveProps, type VariableSource } from "./resolve";
import { quadDescriptor, rgbaFromHex } from "./primitives";
import { ScopedVariables, dependencyKeyOf, readScoped } from "./scope";
import {
  expandRepeat,
  isRepeatContainer,
  readCollection,
  type RepeatInstance,
} from "./repeat";
import type {
  CameraDescriptor,
  GeometryHandle,
  MaterialDescriptor,
  MaterialHandle,
  MirrorBackend,
} from "./mirror-backend";

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

/**
 * Shallow equality over an item's own values.
 *
 * Reference equality alone is not enough: a polling data source typically
 * rebuilds its array every tick, so every item is a fresh object even when
 * nothing changed. Comparing own enumerable values catches that, and is cheap
 * because production data rows are flat and small.
 *
 * Nested objects fall back to reference equality, which is conservative: a
 * changed nested value with an unchanged reference is impossible for immutable
 * data, and for mutable data the caller has already broken determinism.
 */
function sameItem(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;

  for (const key of keys) {
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

export class Projector {
  #dependencies = new DependencyIndex();
  #cameras = new Map<string, CameraDescriptor>();
  /**
   * Rect state per node: the props last applied, and the resource handles this
   * projector OWNS for them.
   *
   * The handles are held rather than released after attaching because
   * MirrorBackend C2 puts lifetime on the caller — the backend frees on
   * destroy*, not when an attachment goes away. Releasing early happened to
   * work against ThreeMirrorBackend, whose reference counting is more
   * permissive than C2 requires, and MockMirrorBackend rejected it. One
   * destroy per create, at the moment the projector stops needing it.
   */
  /**
   * Container id -> the identities currently instantiated, in order.
   *
   * Held so re-expansion can diff against what exists rather than rebuilding.
   * A leaderboard reordering must move handles, not destroy and recreate them.
   */
  #repeats = new Map<string, string[]>();
  /**
   * Container id -> identity -> the item last resolved for it.
   *
   * Held so a survivor whose item did not actually change can be skipped.
   * Without it, re-expansion re-resolves every instance and costs O(collection)
   * on every update — measured at 0.76ms for 256 rows when one row changed,
   * which is the O(scene) defect from Phase 2.4 wearing a different hat.
   */
  #repeatItems = new Map<string, Map<string, unknown>>();

  /**
   * Placements a layout container decided for its children.
   *
   * Computed when the container is applied and read when each child is. Build
   * and projection both visit parents before children, so the entry is always
   * present by the time it is needed — the ordering is a property of the
   * traversal, not a coincidence, and #flush preserves it.
   */
  #placements = new Map<string, Placement>();

  /**
   * States currently active, in precedence order. Later wins.
   *
   * The engine assigns no meaning to any name. `enter`/`visible`/`exit` and
   * `normal`/`warning`/`error` are equally opaque; templates declare what they
   * mean (Project Alpha A8).
   */
  #activeStates: readonly string[] = [];

  /**
   * Values animation sampled this frame, by node then by path.
   *
   * The projector STORES nothing about time and computes no curve — the caller
   * hands it a sample and it applies it. Animation describes how state changes;
   * it does not own state.
   */
  #animated: AnimatedValues = new Map();

  #rects = new Map<
    string,
    {
      width: number;
      height: number;
      fill: string;
      geometry: GeometryHandle;
      material: MaterialHandle;
    }
  >();
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

  get activeStates(): readonly string[] {
    return this.#activeStates;
  }

  /** Replaces the active state set. The caller re-projects. */
  setActiveStates(states: readonly string[]): void {
    this.#activeStates = [...states];
  }

  /** Installs this frame's animation sample. The caller invalidates. */
  setAnimatedValues(values: AnimatedValues): void {
    this.#animated = values;
  }

  /**
   * Re-applies exactly the given nodes.
   *
   * The animation path. Costs O(animated nodes), never O(scene) — a lower
   * third animating in must not re-resolve a 500-node package around it.
   */
  invalidateNodes(
    nodeIds: Iterable<string>,
    document: SceneDocument,
    variables: VariableSource,
  ): ProjectionReport {
    const dirty = new DirtySet();
    const before = this.#writeCount();

    for (const nodeId of nodeIds) {
      if (!this.mirror.has(nodeId)) continue;
      const node = this.#index.get(nodeId);
      if (node === undefined) continue;
      this.#applyNodeState(node, variables);
      // A track may drive a transform, a colour, or both, and the projector
      // cannot tell from here which. Marking transform is the safe superset;
      // material follows from re-resolving the components.
      // The dirty stats already report how many nodes this touched, so there
      // is no separate counter to keep in step with them.
      dirty.mark("transform", nodeId);
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

    const visit = (
      node: SceneNode,
      parentId: string | null,
      scope: VariableSource,
    ) => {
      this.mirror.create(node.id, parentId, node.order);
      this.#index.set(node.id, node);
      created += 1;
      this.#applyNodeState(node, scope);

      if (isRepeatContainer(node)) {
        // The container's children are the TEMPLATE and never render. Only the
        // expanded instances do — and if the container also lays out, it lays
        // out those instances, which is why layout runs here rather than in
        // applyNodeState.
        const instances = this.#expansionOf(node, scope);
        if (isLayoutContainer(node)) {
          this.#computeLayout(
            node,
            instances.flatMap((instance) => instance.nodes),
          );
        }
        for (const instance of instances) {
          const inner = new ScopedVariables(scope, node.repeat!.as, instance.item);
          for (const child of instance.nodes) visit(child, node.id, inner);
        }
        return;
      }

      for (const child of childrenOf(node)) visit(child, node.id, scope);
    };

    visit(document.root, null, variables);
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

    const changed = new Set(variableKeys);

    // Containers first: a collection change adds or removes nodes, and doing
    // that after marking dirty would mark nodes that are about to be destroyed.
    let created = 0;
    let destroyed = 0;
    for (const [containerId] of this.#repeats) {
      const container = this.#index.get(containerId);
      if (container === undefined || !isRepeatContainer(container)) continue;
      if (!changed.has(dependencyKeyOf(container.repeat!.source))) continue;

      const result = this.#reexpand(container, variables, dirty);
      created += result.created;
      destroyed += result.destroyed;
    }

    for (const nodeId of this.#dependencies.dependentsOfAny(changed)) {
      if (!this.mirror.has(nodeId)) continue;
      if (!this.#index.has(nodeId)) continue;
      // A binding feeds a component property, which is material-channel: it
      // must not invalidate transforms.
      dirty.mark("material", nodeId);
    }

    this.#flush(document, variables, dirty);

    return {
      operations: 0,
      nodesCreated: created,
      nodesDestroyed: destroyed,
      nodesReparented: 0,
      dirty: dirty.stats(),
      backendWrites: this.#writeCount() - before,
    };
  }

  teardown(): void {
    this.mirror.teardown();
    this.#dependencies.clear();
    this.#cameras.clear();
    this.#repeats.clear();
    this.#repeatItems.clear();
    this.#placements.clear();
    for (const id of [...this.#rects.keys()]) this.#releaseRect(id);
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
          this.#repeats.delete(id);
          this.#repeatItems.delete(id);
          this.#releaseRect(id);
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

    // States patch the node before anything reads it. Returns the SAME object
    // by reference when nothing applies, so the common path costs a lookup.
    //
    // Animation is applied ON TOP of states: a state says what a thing is, and
    // animation says where it is on the way there. Reversing the order would
    // let a state override the frame animation just produced, which reads as a
    // graphic snapping back mid-move.
    const resolved = this.#withAnimation(applyStates(node, this.#activeStates));

    // A laid-out or anchored child takes its position from its container
    // rather than from its own transform. Rotation and scale still come from
    // the node, so a template can spin something the layout placed.
    //
    // Layout wins over anchor: a child of a layout container is positioned by
    // the run it belongs to, and honouring both would place it twice.
    const placement =
      this.#placements.get(resolved.id) ?? this.#anchorPlacementFor(resolved);
    mirror.localMatrix =
      placement === undefined
        ? localMatrixOf(resolved.transform)
        : localMatrixOf({
            position: [
              placement.x,
              placement.y,
              resolved.transform?.position?.[2] ?? 0,
            ],
            rotation: resolved.transform?.rotation ?? [0, 0, 0],
            scale: resolved.transform?.scale ?? [1, 1, 1],
          });

    mirror.visible = resolved.visible ?? true;

    // A repeat container lays out its INSTANCES, not its template, so its
    // layout runs after expansion rather than here.
    if (isLayoutContainer(resolved) && !isRepeatContainer(resolved)) {
      this.#computeLayout(resolved, childrenOf(resolved));
    }

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
    // component types this phase does not yet attach. Attaching consumes the
    // RESOLVED values, so a variable-bound width or fill drives the mesh.
    for (const component of resolved.components ?? []) {
      const props = resolveProps(component.props, variables, recorder);
      if (component.type === "camera") this.#applyCamera(resolved);
      else if (component.type === "rect") this.#applyRect(resolved, props);
    }

    this.#dependencies.set(node.id, recorder.take());
  }

  /**
   * Attaches a mesh for a `rect` component. SCENE_FORMAT §7.
   *
   * A rect is the first component that produces pixels, and it is deliberately
   * the first one wired: it needs no external asset, so a scene that renders
   * one is a scene the engine can draw entirely from its own format. A
   * lower-third background is exactly this.
   *
   * Dimensions are baked into the quad rather than applied as a mesh scale.
   * A scale would have needed a new MirrorBackend method, and the boundary is
   * frozen (ADR-013) — extending it for author convenience is exactly the kind
   * of change the freeze exists to prevent. Baking costs nothing here: the
   * resource manager is content-addressed, so every rect sharing a size shares
   * one geometry, and a node that wants to scale already has a transform.
   */
  /**
   * Expands a container and records the identities it produced.
   *
   * The record is what makes re-expansion a diff instead of a rebuild.
   */
  #expansionOf(
    container: SceneNode,
    scope: VariableSource,
  ): readonly RepeatInstance[] {
    const repeat = container.repeat!;
    const collection = readCollection(
      readScoped(scope, repeat.source),
      repeat.limit,
    );
    const instances = expandRepeat(container, collection, repeat.key);
    this.#repeats.set(
      container.id,
      instances.map((instance) => instance.identity),
    );
    return instances;
  }

  /**
   * Re-expands a container after its collection changed.
   *
   * Diffs by identity: instances that survive keep their handles, their GPU
   * resources, and any animation in flight. Only genuine additions and removals
   * touch the mirror.
   *
   * Returns what changed, so the caller can report it and mark dirty.
   */
  #reexpand(
    container: SceneNode,
    scope: VariableSource,
    dirty: DirtySet,
  ): { created: number; destroyed: number } {
    const repeat = container.repeat!;
    const previous = this.#repeats.get(container.id) ?? [];
    const instances = this.#expansionOf(container, scope);

    const nextIdentities = new Set(instances.map((i) => i.identity));
    let created = 0;
    let destroyed = 0;

    // Removals first, so an identity reused at a different position does not
    // collide with its own predecessor.
    for (const identity of previous) {
      if (nextIdentities.has(identity)) continue;
      for (const child of childrenOf(container)) {
        const instanceRootId = `${child.id}#${identity}`;
        if (!this.mirror.has(instanceRootId)) continue;
        for (const id of this.mirror.destroySubtree(instanceRootId)) {
          this.#dependencies.clearNode(id);
          this.#cameras.delete(id);
          this.#repeats.delete(id);
          this.#repeatItems.delete(id);
          this.#releaseRect(id);
          this.#index.delete(id);
          dirty.forget(id);
        }
        destroyed += 1;
      }
    }

    const surviving = new Set(previous);
    const lastItems = this.#repeatItems.get(container.id) ?? new Map();
    const nextItems = new Map<string, unknown>();

    // The run changed, so every placement in it did. Recompute before any
    // instance is applied, since applying reads the placement.
    if (isLayoutContainer(container)) {
      this.#computeLayout(
        container,
        instances.flatMap((instance) => instance.nodes),
      );
    }

    for (const instance of instances) {
      nextItems.set(instance.identity, instance.item);
      const inner = new ScopedVariables(scope, repeat.as, instance.item);

      for (const node of instance.nodes) {
        if (surviving.has(instance.identity) && this.mirror.has(node.id)) {
          // Survivor. Re-resolve ONLY if the item's contents actually changed —
          // its identity surviving says nothing about its values, and a data
          // source that rebuilds its array every poll hands us new objects
          // holding identical values.
          //
          // Without this check, one row changing in a 256-row list re-resolves
          // all 256, which is O(collection) on every update.
          if (!sameItem(lastItems.get(instance.identity), instance.item)) {
            this.#refreshInstance(node, inner, dirty);
          }
          continue;
        }

        const visit = (child: SceneNode, parentId: string) => {
          this.mirror.create(child.id, parentId, child.order);
          this.#index.set(child.id, child);
          this.#applyNodeState(child, inner);
          for (const grandchild of childrenOf(child)) visit(grandchild, child.id);
        };
        visit(node, container.id);
        created += 1;
        dirty.mark("transform", node.id);
      }
    }

    this.#repeatItems.set(container.id, nextItems);
    if (created > 0 || destroyed > 0) dirty.mark("hierarchy", container.id);
    return { created, destroyed };
  }

  /** Re-resolves a surviving instance subtree against its new item value. */
  #refreshInstance(
    node: SceneNode,
    scope: VariableSource,
    dirty: DirtySet,
  ): void {
    this.#index.set(node.id, node);
    this.#applyNodeState(node, scope);
    dirty.mark("material", node.id);
    for (const child of childrenOf(node)) {
      this.#refreshInstance(child, scope, dirty);
    }
  }

  #applyRect(node: SceneNode, props: Record<string, unknown>): void {
    const width = typeof props.width === "number" ? props.width : 1;
    const height = typeof props.height === "number" ? props.height : 1;
    const fill = typeof props.fill === "string" ? props.fill : "#FFFFFF";

    const material: MaterialDescriptor = {
      kind: "unlit",
      color: rgbaFromHex(fill),
      // Broadcast graphics composite over live video, so alpha is the norm.
      transparent: true,
      doubleSided: true,
    };

    const previous = this.#rects.get(node.id);
    if (
      previous !== undefined &&
      previous.width === width &&
      previous.height === height &&
      previous.fill === fill
    ) {
      return;
    }

    if (previous !== undefined) {
      const sizeChanged =
        previous.width !== width || previous.height !== height;

      if (!sizeChanged) {
        // Colour only. Update in place so the handle stays stable — recreating
        // would free and reallocate a GPU resource to change a colour.
        this.backend.updateMaterial(previous.material, material);
        this.#rects.set(node.id, { ...previous, fill });
        return;
      }
      // The quad's dimensions are baked in, so a resize needs new geometry.
      this.#releaseRect(node.id);
    }

    const geometry = this.backend.createGeometry(quadDescriptor(width, height));
    if (!geometry.ok) {
      // Refusing over budget is the documented behaviour (ENGINE_RUNTIME §4.4).
      // The node survives unattached rather than the show stopping.
      return;
    }
    const materialHandle = this.backend.createMaterial(material);
    if (!materialHandle.ok) {
      this.backend.destroyGeometry(geometry.value);
      return;
    }

    this.mirror.setAttachment(node.id, {
      kind: "mesh",
      geometry: geometry.value,
      material: materialHandle.value,
    });

    this.#rects.set(node.id, {
      width,
      height,
      fill,
      geometry: geometry.value,
      material: materialHandle.value,
    });
  }

  /**
   * Frees the resources a rect owned. Safe to call for a node without one.
   *
   * Every create* in #applyRect is matched here exactly once, which is what
   * MirrorBackend C2 requires of a caller.
   */
  #releaseRect(nodeId: string): void {
    const rect = this.#rects.get(nodeId);
    if (rect === undefined) return;
    this.#rects.delete(nodeId);
    this.backend.destroyGeometry(rect.geometry);
    this.backend.destroyMaterial(rect.material);
  }

  /**
   * Runs a container's layout and records where each child goes.
   *
   * The container's box comes from its own declared size. Children do not
   * influence it: two-way sizing needs iteration, iteration needs a convergence
   * rule, and a convergence rule is another thing to get wrong on air.
   */
  /**
   * Places an anchored node inside its parent's box.
   *
   * Only applies when the parent declares a size and does NOT lay its children
   * out — a layout container has already decided where this node goes.
   *
   * The parent is read from the index rather than the document, because the
   * index is what projection maintains incrementally and re-reading the
   * document here would reintroduce the O(scene) lookup that P-001 removed.
   */
  #anchorPlacementFor(node: SceneNode): Placement | undefined {
    if (node.anchor === undefined) return undefined;

    const mirror = this.mirror.get(node.id);
    if (mirror?.parentId == null) return undefined;

    const parent = this.#index.get(mirror.parentId);
    if (parent === undefined || parent.size === undefined) return undefined;
    if (isLayoutContainer(parent)) return undefined;

    return anchorPlacement(
      node,
      { x: 0, y: 0, width: parent.size.width, height: parent.size.height },
      node.anchor,
      toInsets(parent.layout?.safeArea),
    );
  }

  /**
   * Applies this frame's sampled values to a node.
   *
   * Returns the node BY REFERENCE when nothing animates it, so an unanimated
   * scene pays one map lookup per node and no allocation.
   */
  #withAnimation(node: SceneNode): SceneNode {
    const paths = this.#animated.get(node.id);
    if (paths === undefined || paths.size === 0) return node;

    let result: SceneNode = node;
    for (const [path, value] of paths) {
      try {
        result = setAtPath(result, path, value);
      } catch {
        // A track pointing at a path this node does not have is an authoring
        // error, not a reason to stop the show. The rest of the frame renders.
      }
    }
    return result;
  }

  #computeLayout(container: SceneNode, children: readonly SceneNode[]): void {
    const size = sizeOf(container);
    const placements = layoutChildren(
      { ...container, children: [...children] },
      { x: 0, y: 0, width: size.width, height: size.height },
      container.layout!,
    );
    for (const placement of placements) {
      this.#placements.set(placement.nodeId, placement);
    }
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
