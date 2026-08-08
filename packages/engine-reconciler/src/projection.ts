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

/**
 * Design pixels per world unit when a scene does not declare one.
 *
 * A round number, deliberately: it makes "size 48" mean 0.48 units, which is a
 * ratio an author can hold in their head. Studio declares 108 instead, because
 * that is what its 17.78-unit stage is at 1920 wide — there, a pixel is a pixel.
 */
const DEFAULT_PIXELS_PER_UNIT = 100;

/**
 * Resolves an image's fit inside its node's box.
 *
 * Pure, and separate from projection, because it is the rule a designer argues
 * with — "why is my logo squashed" — and it should be readable and testable
 * without a backend in the room.
 *
 * `contain` is the default everywhere it is referenced: a distorted brand mark
 * is the most visible mistake this component can make, so `stretch` is opt-in.
 */
export function fitImage(
  boxWidth: number,
  boxHeight: number,
  imageWidth: number,
  imageHeight: number,
  mode: string,
): { width: number; height: number; uvs: Float32Array } {
  const full = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  if (mode === "stretch" || boxWidth <= 0 || boxHeight <= 0) {
    return { width: boxWidth, height: boxHeight, uvs: full };
  }

  const boxAspect = boxWidth / boxHeight;
  const imageAspect = imageWidth / imageHeight;

  if (mode === "cover") {
    // The quad fills the box; the UVs crop whichever axis overflows. Cropping
    // is centred, because an off-centre crop of a logo cuts a corner off it.
    let u = 0.5;
    let v = 0.5;
    if (imageAspect > boxAspect) u = boxAspect / imageAspect / 2;
    else v = imageAspect / boxAspect / 2;
    const u0 = 0.5 - u;
    const u1 = 0.5 + u;
    const v0 = 0.5 - v;
    const v1 = 0.5 + v;
    return {
      width: boxWidth,
      height: boxHeight,
      uvs: new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0]),
    };
  }

  // contain: shrink the quad to the image's aspect, inside the box.
  const width = imageAspect > boxAspect ? boxWidth : boxHeight * imageAspect;
  const height = imageAspect > boxAspect ? boxWidth / imageAspect : boxHeight;
  return { width, height, uvs: full };
}

/**
 * Token names whose value changed between two `tokens` arrays.
 *
 * Tolerant of the shapes a `doc.setMeta` can carry — a whole array, or nothing
 * at all when the document had no palette — because an operation that cannot be
 * read must repaint nothing rather than throw during projection.
 */
function changedTokenNames(before: unknown, after: unknown): Set<string> {
  const index = (value: unknown): Map<string, unknown> => {
    if (!Array.isArray(value)) return new Map();
    const out = new Map<string, unknown>();
    for (const entry of value) {
      const token = entry as { name?: unknown; value?: unknown };
      if (typeof token?.name === "string") out.set(token.name, token.value);
    }
    return out;
  };

  const from = index(before);
  const to = index(after);
  const moved = new Set<string>();
  for (const [name, value] of to) {
    if (!from.has(name) || from.get(name) !== value) moved.add(name);
  }
  for (const name of from.keys()) if (!to.has(name)) moved.add(name);
  return moved;
}
import { DirtySet, type DirtyStats } from "./dirty";
import { MirrorGraph, MirrorViolation } from "./mirror";
import { channelForPath, localMatrixOf, resolveProps, type VariableSource } from "./resolve";
import {
  extrudedQuadDescriptor,
  imageQuadDescriptor,
  quadDescriptor,
  rgbaFromHex,
} from "./primitives";
import {
  primitiveDescriptor,
  primitiveKey,
  readPrimitive,
} from "./mesh-primitives";
import {
  isFlatPaint,
  rasterisePaint,
  readPaint,
  type PaintSpec,
  type RasterisedPaint,
} from "./paint";
import { ScopedVariables, dependencyKeyOf, readScoped } from "./scope";
import {
  ExpansionCache,
  expandRepeat,
  isRepeatContainer,
  readCollection,
  type RepeatInstance,
} from "./repeat";
import { NEUTRAL_ENVIRONMENT } from "./mirror-backend";
import type {
  CameraDescriptor,
  EnvironmentDescriptor,
  GeometryHandle,
  MaterialDescriptor,
  LightDescriptor,
  LightHandle,
  MaterialHandle,
  MirrorBackend,
  Rgba,
  TextureHandle,
} from "./mirror-backend";
import type { TextFacts, TextProvider, TextRequest } from "./text-provider";
import type { ImageProvider, ProvidedImage } from "./image-provider";

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

interface TextInstance {
  readonly geometry: GeometryHandle;
  readonly material: MaterialHandle;
  /** The mirror child carrying this batch. No document node corresponds to it. */
  readonly child: string;
  descriptor: MaterialDescriptor;
}

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

/**
 * The environment a document describes.
 *
 * Defensive about every field, because `world.environment` is optional, its
 * members are optional, and a hand-edited document may carry anything at all.
 * A malformed exposure must render the picture unchanged rather than black.
 */
export function environmentDescriptorOf(document: SceneDocument): EnvironmentDescriptor {
  const environment = document.world?.environment;
  const exposure = environment?.exposure;
  const reflections = (environment as { reflections?: unknown } | undefined)?.reflections;
  return {
    exposure:
      typeof exposure === "number" && Number.isFinite(exposure) && exposure > 0
        ? exposure
        : NEUTRAL_ENVIRONMENT.exposure,
    shadows: environment?.shadows === true,
    // ON unless a document says otherwise, which is the one place this file
    // does not simply default to "changes nothing". The alternative default
    // leaves every metallic surface black, and a black Chrome is not a neutral
    // starting point — it is a broken one.
    reflections:
      typeof reflections === "number" && Number.isFinite(reflections) && reflections >= 0
        ? Math.min(2, reflections)
        : 1,
  };
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
   * Expanded node trees, reused across collection changes.
   *
   * An instance's structure depends only on (template, identity); its values
   * come from the scope at apply time. Rebuilding the tree on every change cost
   * 7.19ms to patch one row of a 10,000-row collection.
   */
  #expansions = new ExpansionCache();

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
   * Node id -> the paint order the TREE gives it.
   *
   * Compositing order for flat graphics is a property of the scene tree: a
   * node painted later in a depth-first walk covers one painted earlier, and
   * that walk visits siblings in `order`. Without this, every flat node
   * carried render order 0 and the renderer broke the tie however it liked —
   * so "Bring Forward" moved a row in a panel and changed nothing on screen.
   *
   * Only flat graphics are listed. A mesh is placed in SPACE, and its
   * occlusion is the camera's business; giving it a tree-derived render order
   * would let a row in a panel push an object in front of one that is
   * physically nearer, which is the exact confusion of layer with depth this
   * map exists to avoid. An explicit `runtime.renderOrder` still wins over
   * both — an author who states an order means it.
   */
  #paintOrder = new Map<string, number>();

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

  /**
   * GPU resources a `meshRenderer` owns. Phase 2.
   *
   * Keyed the same way rects are, and released the same way, because
   * MirrorBackend C2 puts lifetime on the caller and a second discipline for a
   * second component type is how a leak gets introduced.
   */
  #meshes = new Map<
    string,
    {
      key: string;
      material: MaterialDescriptor;
      geometry: GeometryHandle;
      materialHandle: MaterialHandle;
    }
  >();

  #lights = new Map<string, { handle: LightHandle; descriptor: LightDescriptor }>();

  /** What the backend was last told the environment is. ADR-013 amendment 3. */
  #environment: EnvironmentDescriptor = NEUTRAL_ENVIRONMENT;

  /**
   * One drawable batch of a text node. Several when it spans atlas pages.
   *
   * The descriptor is kept so a colour change can be applied in place. Without
   * it the only way to recolour is to rebuild the material from scratch, which
   * means knowing the atlas and the pxRange again at a point where neither is
   * to hand.
   */
  /**
   * Per-node text state, including the layout facts the draw reported.
   *
   * ========================================================================
   * WHY THE FACTS LIVE HERE AND NOT ON THE REQUEST
   * ========================================================================
   * `TextProvider.draw` reports `overflowed` and `truncated`, and its own doc
   * comment says they exist so "a pre-flight" can see them — but `TextRequest`
   * carries no node id, so a caller learns THAT something overflowed and never
   * which layer.
   *
   * The association is recorded here rather than by adding an id to the
   * request, because the request is a VALUE describing what to lay out and the
   * projector already knows the node. Threading identity through a value type
   * only to read it back out is indirection with no payer.
   *
   * (The `signature` beside it is a per-node change detector — "has this
   * node's request altered since last frame" — and not a content cache.
   * Content-addressed sharing is real but belongs to engine-text, keyed by
   * `layoutKey`. Two identical nodes each call `draw` and share one layout.)
   */
  #texts = new Map<
    string,
    {
      signature: string;
      colour: string;
      instances: TextInstance[];
      facts: TextFacts;
    }
  >();

  /** Atlas page index -> the texture holding it, and the revision uploaded. */
  #atlasTextures = new Map<number, { handle: TextureHandle; revision: number }>();

  /**
   * Node id -> the collection scope it was expanded in.
   *
   * ========================================================================
   * WHY THIS HAS TO BE REMEMBERED
   * ========================================================================
   * A collection instance resolves its bindings against a SCOPED source: inside
   * a repeat with `as: "player"`, `{ $var: "player.name" }` means the current
   * item, not a document variable. Expansion builds that scope and uses it.
   *
   * `#flush` then re-applies dirty nodes — and had only the document-level
   * source to hand. So any instance node re-applied after its first projection
   * resolved every scoped binding to `undefined`: a bound fill fell back to
   * white, and a bound text became the empty string, which released its meshes
   * and drew nothing.
   *
   * Recording the scope per node is what lets `#flush` re-apply an instance the
   * same way expansion did. Cleared with the node, like every other index here.
   */
  #instanceOf = new Map<string, { containerId: string; identity: string }>();

  /**
   * One texture per IMAGE ASSET, not per node.
   *
   * Shared exactly like an atlas page: five nodes drawing the same sponsor logo
   * upload it once. Released at teardown rather than with any one node, because
   * freeing it with the first node to disappear would blank the rest.
   */
  #imageTextures = new Map<string, { handle: TextureHandle; width: number; height: number }>();

  #images = new Map<
    string,
    {
      assetId: string;
      width: number;
      height: number;
      fit: string;
      tint: string;
      geometry: GeometryHandle;
      material: MaterialHandle;
    }
  >();

  #rects = new Map<
    string,
    {
      width: number;
      height: number;
      /** 0 is the flat quad. Anything else is extruded — see `#applyRect`. */
      depth: number;
      fill: string;
      /** Kept so an appearance change can be compared without rebuilding it. */
      descriptor: MaterialDescriptor;
      geometry: GeometryHandle;
      material: MaterialHandle;
      /**
       * The paint texture this rect holds a reference to, if any.
       *
       * Stored as the key rather than the handle because the key is what the
       * cache is indexed by and what a re-application compares against — the
       * handle is reachable from it, and holding both invites them to disagree.
       */
      paint?: string;
    }
  >();

  /**
   * Rasterised paints, shared and reference-counted.
   *
   * A twelve-row leaderboard whose rows share one paint uploads ONE texture,
   * which is the whole reason this is content-addressed rather than per-node.
   * Reference-counted rather than never freed: a paint edited on the timeline
   * mints a new key every keyframe, and a cache that only grows would hold
   * every intermediate gradient for the length of the show.
   */
  #paintTextures = new Map<
    string,
    { handle: TextureHandle; refs: number }
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
    /**
     * Supplied by the composition root, or absent.
     *
     * Absent is a supported state, not a degraded one: a scene with no text
     * must not pay for HarfBuzz's WASM. A `text` component with no provider
     * attaches nothing and the node survives, which is the same behaviour an
     * asset-backed mesh already has.
     */
    private readonly text?: TextProvider,
    /**
     * Also supplied by the composition root, and also optional.
     *
     * A scene with no images must not carry a decoder, and an `image`
     * component with no provider attaches nothing while the node survives.
     */
    private readonly images?: ImageProvider,
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
    this.#adoptDocument(document);
    // Before the tree, not after. `build` does not go through `#flush`, and a
    // scene whose shadows arrived one projection late would render its first
    // frame — the one somebody is looking at — without them.
    this.#syncEnvironment(document);
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
          for (const child of instance.nodes) {
            this.#rememberScope(child, node.id, instance.identity);
            visit(child, node.id, inner);
          }
        }
        return;
      }

      for (const child of childrenOf(node)) visit(child, node.id, scope);
    };

    visit(document.root, null, variables);
    this.#recomputeWorld(document.root.id, IDENTITY, true, dirty);
    // After the tree exists — paint order is a property of the whole walk, so
    // it cannot be assigned while nodes are still arriving.
    this.#repaintOrder();

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

    // Only when the SHAPE changed. A reorder arrives as a reparent onto the
    // same parent, so this covers "Bring Forward" as well as drag-to-reparent,
    // while a colour or a position never pays for the walk.
    if (created > 0 || destroyed > 0 || reparented > 0) this.#repaintOrder();

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

    // Expanded to include each key's dependency ROOT.
    //
    // A binding to `{ $var: "team.accent" }` records its dependency under
    // `team`, because `dependencyKeyOf` takes the segment before the first dot
    // — a dotted binding is a PATH into a variable. But a live command sets the
    // flat key `team.accent`, and looking that up found nobody: the node
    // resolved correctly on the first build and then never updated again.
    //
    // Every dotted binding was affected, which is the documented idiomatic form
    // (`player.color`, `team.accent`). The lighting tests that exercise it
    // passed VACUOUSLY — they assert that an attachment did not change, which is
    // trivially true when the invalidation never fires. Found by Phase 3B, by a
    // text node bound to `player.name` that would not update live.
    //
    // Over-invalidating by root is the right side to err on: a node bound to
    // `team.name` being re-resolved when `team.accent` changes costs one
    // resolve, and the alternative is a graphic that silently stops updating on
    // air.
    const changed = new Set<string>();
    for (const key of variableKeys) {
      changed.add(key);
      changed.add(dependencyKeyOf(key));
    }

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
    this.#expansions.clear();
    this.#placements.clear();
    for (const id of [...this.#rects.keys()]) this.#releaseRect(id);
    for (const id of [...this.#meshes.keys()]) this.#releaseMesh(id);
    for (const id of [...this.#lights.keys()]) this.#releaseLight(id);
    for (const id of [...this.#texts.keys()]) this.#releaseText(id);
    for (const id of [...this.#images.keys()]) this.#releaseImage(id);
    this.#instanceOf.clear();
    // The atlas textures are released here rather than in `#releaseText`,
    // because a page is shared by every text node drawing from it — freeing it
    // with the first node would blank the rest. It belongs to the projector's
    // lifetime, not to any one node's.
    for (const texture of this.#atlasTextures.values()) {
      this.backend.destroyTexture(texture.handle);
    }
    this.#atlasTextures.clear();
    // Image textures are asset-scoped for the same reason atlas pages are.
    for (const texture of this.#imageTextures.values()) {
      this.backend.destroyTexture(texture.handle);
    }
    this.#imageTextures.clear();
    // Paint textures are already freed by `#releaseRect` above, one reference
    // per rect. This sweep exists for the case a reference was leaked by a
    // failure path — it must not be reachable, and if it ever is, the cache
    // being empty here is the assertion that says so.
    for (const texture of this.#paintTextures.values()) {
      this.backend.destroyTexture(texture.handle);
    }
    this.#paintTextures.clear();
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
          this.#releaseMesh(id);
          this.#releaseLight(id);
          this.#releaseText(id);
          this.#releaseImage(id);
          this.#index.delete(id);
          this.#instanceOf.delete(id);
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

      case "doc.setMeta": {
        // Most metadata does not project — canvas changes are an output
        // concern. `tokens` is the exception: it is the palette, and rewriting
        // it is what installing a theme pack does.
        //
        // Tokens resolve through the SAME `$var` chain as everything else —
        // the host reads a variable first and falls through to the token of
        // that name (Project Alpha A6: one resolver, not two). So a themed
        // property is an ordinary binding, and repainting it is the ordinary
        // dependency walk. All that was missing was this case noticing.
        //
        // Before and after both travel on the operation, so only names whose
        // value actually moved repaint. Applying a palette a graphic already
        // uses costs nothing, which matters because the Marketplace offers a
        // one-click Apply on every pack.
        if (operation.path === "tokens" || operation.path.startsWith("tokens.")) {
          const moved = changedTokenNames(
            operation.previousValue,
            operation.value,
          );
          // `dependencyKeyOf` because a binding to `color.primary` records its
          // dependency under `color` — the index and the resolver have to agree
          // on what a dependency is, and the resolver splits at the first dot.
          const dependents = this.#dependencies.dependentsOfAny(
            [...moved].map(dependencyKeyOf),
          );
          for (const nodeId of dependents) {
            if (this.mirror.has(nodeId)) dirty.mark("material", nodeId);
          }
        }
        return { created: 0, destroyed: 0, reparented: 0 };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Flush — turn dirty state into backend writes
  // -------------------------------------------------------------------------

  /**
   * Design pixels per world unit, from `world.pixelsPerUnit`.
   *
   * Held on the projector because `#applyText` is reached from the component
   * loop, which does not carry the document. Re-read on every entry point that
   * does, so an operation editing the world takes effect on the next flush.
   */
  #pixelsPerUnit = DEFAULT_PIXELS_PER_UNIT;

  /**
   * Tells the backend about the document's environment, once, when it changes.
   *
   * Compared against what was last sent rather than sent every flush. A setter
   * called on every projection would be a backend write per frame for a value
   * nobody touched, which is precisely the kind of cost the dirty tracking
   * exists to avoid — and `backendWrites` is asserted in the test suite, so an
   * unconditional call would have shown up as every write count being one too
   * high.
   */
  #syncEnvironment(document: SceneDocument): void {
    const wanted = environmentDescriptorOf(document);
    if (
      this.#environment.exposure === wanted.exposure &&
      this.#environment.shadows === wanted.shadows &&
      this.#environment.reflections === wanted.reflections
    ) {
      return;
    }
    this.#environment = wanted;
    this.backend.setEnvironment(wanted);
  }

  /**
   * Recomputes tree-derived paint order and pushes what changed.
   *
   * Walks the MIRROR rather than the document, for two reasons: its child
   * lists are already kept sorted by `order`, and it contains repeat
   * INSTANCES, which the document tree does not — a leaderboard's rows would
   * otherwise all share one order and composite arbitrarily against each
   * other.
   *
   * Called only when the shape of the tree actually changed. A walk per
   * transaction would be the O(scene) cost the incremental path exists to
   * avoid; a reorder is rare and human-driven, and a colour change does not
   * reach here at all.
   */
  #repaintOrder(): void {
    const root = this.mirror.rootId;
    if (root === null) return;

    this.#paintOrder.clear();
    let next = 0;

    const visit = (nodeId: string): void => {
      if (this.#isFlat(nodeId)) this.#paintOrder.set(nodeId, (next += 1));
      for (const childId of this.mirror.childrenOf(nodeId)) visit(childId);
    };
    visit(root);

    // Push only differences. Every flat node's order shifts by one when a node
    // is inserted near the front, but the mirror holds what the backend was
    // last told, so a no-op stays a no-op where it can.
    for (const nodeId of this.#paintOrderCandidates()) {
      const mirror = this.mirror.get(nodeId);
      if (mirror === undefined) continue;
      const wanted = this.#renderOrderOf(nodeId);
      if (wanted === mirror.renderOrder) continue;
      mirror.renderOrder = wanted;
      this.backend.setRenderOrder(mirror.handle, wanted);
    }
  }

  /** Every node that could carry a render order — flat now, or flat before. */
  #paintOrderCandidates(): Set<string> {
    const ids = new Set(this.#paintOrder.keys());
    // A node that STOPPED being flat, or left the tree's flat set, still holds
    // a stale order in the backend. Sweeping the mirror costs a map walk and
    // saves a graphic that composites by a rule that no longer applies.
    for (const nodeId of this.mirror.nodeIds()) {
      if (this.mirror.get(nodeId)?.renderOrder !== 0) ids.add(nodeId);
    }
    return ids;
  }

  /** The order a node should carry: authored if stated, else tree-derived. */
  #renderOrderOf(nodeId: string): number {
    const authored = this.#index.get(nodeId)?.runtime?.renderOrder;
    if (authored !== undefined) return authored;
    return this.#paintOrder.get(nodeId) ?? 0;
  }

  /**
   * Whether a node's compositing is decided by the tree rather than by space.
   *
   * Flat graphics — plates, bars, text, images — sit on the same plane often
   * enough that depth cannot separate them, so the tree does. A meshRenderer
   * is a thing in space and is left to the camera, even on a node that also
   * carries a rect.
   */
  #isFlat(nodeId: string): boolean {
    const components = this.#index.get(nodeId)?.components;
    if (components === undefined) return false;
    let flat = false;
    for (const component of components) {
      if (component.type === "meshRenderer") return false;
      if (
        component.type === "rect" ||
        component.type === "text" ||
        component.type === "image"
      ) {
        flat = true;
      }
    }
    return flat;
  }

  #flush(
    document: SceneDocument,
    variables: VariableSource,
    dirty: DirtySet,
    localRefresh: Set<string> = new Set(),
  ): void {
    this.#adoptDocument(document);
    this.#syncEnvironment(document);
    // Re-read authored values for nodes whose own properties changed, before
    // anything is recomputed from them. Without this, world matrices are
    // composed from a stale local and propagation is correct but its input is
    // not — found by the consistency verifier, which re-derives independently
    // rather than trusting what projection recorded.
    for (const nodeId of localRefresh) {
      if (!this.mirror.has(nodeId)) continue;
      const node = this.#lookup(nodeId);
      if (node) this.#applyNodeState(node, this.#scopeFor(nodeId, variables));
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
      if (node) this.#applyNodeState(node, this.#scopeFor(nodeId, variables));
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
    const renderOrder = runtime?.renderOrder ?? this.#paintOrder.get(node.id) ?? 0;
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
      else if (component.type === "meshRenderer") this.#applyMesh(resolved, props);
      else if (component.type === "light") this.#applyLight(resolved, props);
      else if (component.type === "text") this.#applyText(resolved, props);
      else if (component.type === "image") this.#applyImage(resolved, props);
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
    const instances = expandRepeat(
      container,
      collection,
      repeat.key,
      this.#expansions,
    );
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
          this.#releaseMesh(id);
          this.#releaseLight(id);
          this.#releaseText(id);
          this.#index.delete(id);
          this.#instanceOf.delete(id);
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
        this.#rememberScope(node, container.id, instance.identity);
        visit(node, container.id);
        created += 1;
        dirty.mark("transform", node.id);
      }
    }

    this.#repeatItems.set(container.id, nextItems);
    if (created > 0 || destroyed > 0) dirty.mark("hierarchy", container.id);
    return { created, destroyed };
  }

  /** Records the instance scope for a node and everything beneath it. */
  #rememberScope(node: SceneNode, containerId: string, identity: string): void {
    this.#instanceOf.set(node.id, { containerId, identity });
    for (const child of childrenOf(node)) {
      this.#rememberScope(child, containerId, identity);
    }
  }

  /**
   * The variable source a node must be resolved against.
   *
   * The document source for an ordinary node; the instance's scoped source for
   * anything inside a repeat. Falls back to the document source when the item
   * has gone, which happens for one flush between a row being removed and the
   * mirror catching up.
   */
  #scopeFor(nodeId: string, variables: VariableSource): VariableSource {
    const record = this.#instanceOf.get(nodeId);
    if (record === undefined) return variables;
    const container = this.#index.get(record.containerId);
    if (container?.repeat === undefined) return variables;
    const item = this.#repeatItems.get(record.containerId)?.get(record.identity);
    if (item === undefined) return variables;
    return new ScopedVariables(variables, container.repeat.as, item);
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

  /**
   * Attaches geometry and a material for a `meshRenderer`. SCENE_FORMAT §7.1.
   *
   * ========================================================================
   * 3D IS NOT A SECOND PIPELINE
   * ========================================================================
   * This method is deliberately the same shape as `#applyRect`: resolve props,
   * compare against what is already attached, update in place when only the
   * material changed, recreate only when the geometry did. A mesh is a node
   * with a component, exactly like a rectangle — it inherits the hierarchy, the
   * transform, the dirty tracking, the variable bindings, the timeline, the
   * collections and the states without any of them knowing it is 3D.
   *
   * `props.primitive` is an ADDITIVE optional property (SCENE_FORMAT §13
   * rule 4), so it needs no version bump. Asset-backed meshes (`assetId`,
   * `meshIndex`) are specified in §7.1 and are NOT wired here: geometry from a
   * glTF needs an asset pipeline, which is a phase of its own. A meshRenderer
   * naming an asset attaches nothing and the node survives unattached, which is
   * the same behaviour a rect over budget already has.
   *
   * A material with `metallic` or `roughness` becomes `pbr`; otherwise `unlit`.
   * That split is not cosmetic — see the Phase 2 finding: **the frozen backend
   * has no lights**, so a `pbr` material renders black until ADR-013 is
   * reopened, and `unlit` is the only kind that produces a picture today.
   */
  #applyMesh(node: SceneNode, props: Record<string, unknown>): void {
    const spec = readPrimitive(props.primitive);
    if (spec === null) {
      // An asset-backed mesh, or a malformed spec. Release anything this node
      // used to own rather than leaving a stale attachment on screen.
      this.#releaseMesh(node.id);
      return;
    }

    const key = primitiveKey(spec);
    const material = materialDescriptorOf(props.material);

    const previous = this.#meshes.get(node.id);
    if (previous !== undefined && previous.key === key) {
      if (sameMaterial(previous.material, material)) return;
      // Material only. Update in place so the handle stays stable — recreating
      // would free and reallocate a GPU resource to change a colour, which is
      // exactly what a variable-bound team colour does sixty times a second.
      this.backend.updateMaterial(previous.materialHandle, material);
      this.#meshes.set(node.id, { ...previous, material });
      return;
    }
    if (previous !== undefined) this.#releaseMesh(node.id);

    const geometry = this.backend.createGeometry(primitiveDescriptor(spec));
    if (!geometry.ok) return;
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
    this.#meshes.set(node.id, {
      key,
      material,
      geometry: geometry.value,
      materialHandle: materialHandle.value,
    });
  }

  /** Frees what a meshRenderer owned. Every create* above is matched here once. */
  #releaseMesh(nodeId: string): void {
    const mesh = this.#meshes.get(nodeId);
    if (mesh === undefined) return;
    this.#meshes.delete(nodeId);
    this.backend.destroyGeometry(mesh.geometry);
    this.backend.destroyMaterial(mesh.materialHandle);
  }

  /**
   * Attaches a light. SCENE_FORMAT §7, ADR-013 amendment 1.
   *
   * A light is a node attachment exactly as a camera is, so this method is the
   * same shape as `#applyCamera` — create once, update in place, release on
   * teardown. It carries no position and no direction: the node's world matrix
   * places it and it points down local −Z, which is what makes the existing
   * timeline able to animate a light with no new machinery.
   *
   * Every property comes from RESOLVED props, so a light's colour and intensity
   * are bindable to runtime variables like anything else — `team.accent` can
   * drive a material and a key light from one value.
   */
  #applyLight(node: SceneNode, props: Record<string, unknown>): void {
    const descriptor = lightDescriptorOf(props);
    const existing = this.#lights.get(node.id);

    if (existing === undefined) {
      const handle = this.backend.createLight(descriptor);
      this.#lights.set(node.id, { handle, descriptor });
      this.mirror.setAttachment(node.id, { kind: "light", light: handle });
      return;
    }
    if (sameLight(existing.descriptor, descriptor)) return;
    // In place. Recreating would free and reallocate to dim a light, which is
    // exactly what an animated intensity does sixty times a second.
    this.backend.updateLight(existing.handle, descriptor);
    this.#lights.set(node.id, { ...existing, descriptor });
  }

  /** Frees a light. Every createLight above is matched here exactly once (C2). */
  #releaseLight(nodeId: string): void {
    const light = this.#lights.get(nodeId);
    if (light === undefined) return;
    this.#lights.delete(nodeId);
    this.backend.destroyLight(light.handle);
  }

  /**
   * Attaches an image. SCENE_FORMAT §7.4, IF-005.
   *
   * ========================================================================
   * AN IMAGE IS A TEXTURED RECT, AND THAT IS THE WHOLE INTEGRATION
   * ========================================================================
   * Deliberately the same shape as `#applyRect` and `#applyText`: resolve
   * props, compare against what is attached, recreate only what changed. So an
   * image node inherits the hierarchy, transform, dirty channels, variable
   * bindings, timeline, collections and states without any of them knowing it
   * is an image.
   *
   * That is what makes "replace a logo" a live operation rather than a feature:
   * `assetId` is `Bindable<string>`, so it arrives here RESOLVED, and pointing
   * a variable at a different asset swaps the sponsor mid-show through exactly
   * the same path a score change takes.
   *
   * ========================================================================
   * FIT IS GEOMETRY OR UVs, NEVER A STRETCHED LOGO BY DEFAULT
   * ========================================================================
   * A brand mark distorted to fill a box is the single most visible thing a
   * broadcast graphics tool can get wrong, so `contain` is the default and
   * `stretch` must be asked for by name.
   *
   *   - `contain` shrinks the QUAD to the image's aspect inside the box.
   *   - `cover`   keeps the quad and crops the UVs.
   *   - `stretch` fills the box and distorts.
   */
  #applyImage(node: SceneNode, props: Record<string, unknown>): void {
    const provider = this.images;
    const assetId = typeof props.assetId === "string" ? props.assetId : "";
    if (provider === undefined || assetId === "") {
      this.#releaseImage(node.id);
      return;
    }

    const image = provider.image(assetId);
    if (image === undefined || image.width <= 0 || image.height <= 0) {
      // Not loaded, or failed to. The node draws nothing rather than showing a
      // placeholder — a stand-in for a sponsor logo is the kind of thing that
      // reaches air.
      this.#releaseImage(node.id);
      return;
    }

    const box = node.size ?? { width: 1, height: 1 };
    const fit = typeof props.fit === "string" ? props.fit : "contain";
    const tint = typeof props.tint === "string" ? props.tint : "#FFFFFF";

    const { width, height, uvs } = fitImage(
      box.width,
      box.height,
      image.width,
      image.height,
      fit,
    );

    const previous = this.#images.get(node.id);
    if (
      previous !== undefined &&
      previous.assetId === assetId &&
      previous.width === width &&
      previous.height === height &&
      previous.fit === fit
    ) {
      if (previous.tint === tint) return;
      // Tint only. A brand colour bound to a variable changes without
      // reallocating a vertex buffer to do it.
      const texture = this.#imageTextures.get(assetId);
      if (texture === undefined) return;
      this.backend.updateMaterial(previous.material, {
        kind: "unlit",
        color: rgbaFromHex(tint),
        map: texture.handle,
        transparent: true,
        doubleSided: true,
      });
      this.#images.set(node.id, { ...previous, tint });
      return;
    }

    const texture = this.#textureForImage(assetId, image);
    if (texture === undefined) return;

    if (previous !== undefined) this.#releaseImage(node.id);

    const descriptor = imageQuadDescriptor(width, height);
    const geometry = this.backend.createGeometry({ ...descriptor, uvs });
    if (!geometry.ok) {
      // Refusing over budget is documented behaviour (ENGINE_RUNTIME §4.4).
      return;
    }
    const material = this.backend.createMaterial({
      kind: "unlit",
      color: rgbaFromHex(tint),
      map: texture.handle,
      // Broadcast graphics composite over live video and a logo has an alpha
      // channel by definition.
      transparent: true,
      doubleSided: true,
    });
    if (!material.ok) {
      this.backend.destroyGeometry(geometry.value);
      return;
    }

    this.mirror.setAttachment(node.id, {
      kind: "mesh",
      geometry: geometry.value,
      material: material.value,
    });
    this.#images.set(node.id, {
      assetId,
      width,
      height,
      fit,
      tint,
      geometry: geometry.value,
      material: material.value,
    });
  }

  /**
   * The texture for an asset, uploaded once and shared.
   *
   * The projector owns it because MirrorBackend C2 makes GPU lifetime the
   * caller's. The provider hands over pixels and nothing else.
   */
  #textureForImage(
    assetId: string,
    image: ProvidedImage,
  ): { handle: TextureHandle } | undefined {
    const existing = this.#imageTextures.get(assetId);
    if (existing !== undefined) {
      if (existing.width === image.width && existing.height === image.height) {
        return existing;
      }
      // Same asset id, different pixels — an asset replaced in place. The old
      // texture is the wrong size for the new geometry, so it goes.
      this.backend.destroyTexture(existing.handle);
      this.#imageTextures.delete(assetId);
    }

    const created = this.backend.createTexture({
      width: image.width,
      height: image.height,
      // Already premultiplied linear RGBA — MirrorBackend C9. The conversion
      // happens once at decode, never per frame.
      pixels: image.pixels,
      format: "rgba8",
      // Unlike an MSDF atlas, an image has no boundary that filtering must not
      // cross, and a logo drawn at anything other than 1:1 needs interpolation.
      filter: "linear",
      // ADR-013 Amendment 2. A 512px mark in a 1.4-unit box is minified ~3x,
      // and without a mip chain it crawls on every animated frame. The atlas
      // passes neither of these, deliberately — see the descriptor.
      mipmaps: true,
      anisotropy: 8,
    });
    if (!created.ok) return undefined;

    const entry = {
      handle: created.value,
      width: image.width,
      height: image.height,
    };
    this.#imageTextures.set(assetId, entry);
    return entry;
  }

  /**
   * Frees what an image node owned. Safe to call for a node without one.
   *
   * The TEXTURE is not freed here: it belongs to the asset and is shared. See
   * `#imageTextures`.
   */
  #releaseImage(nodeId: string): void {
    const held = this.#images.get(nodeId);
    if (held === undefined) return;
    this.backend.destroyGeometry(held.geometry);
    this.backend.destroyMaterial(held.material);
    this.#images.delete(nodeId);
    if (this.mirror.has(nodeId)) {
      this.mirror.setAttachment(nodeId, { kind: "none" });
    }
  }

  #applyRect(node: SceneNode, props: Record<string, unknown>): void {
    const width = typeof props.width === "number" ? props.width : 1;
    const height = typeof props.height === "number" ? props.height : 1;
    const fill = typeof props.fill === "string" ? props.fill : "#FFFFFF";

    // ======================================================================
    // DEPTH IS A PROPERTY. IT IS NOT A DIFFERENT KIND OF NODE
    // ======================================================================
    // SCENE_FORMAT gains no new component for this, and the node does not
    // become a mesh: a rect with `depth` is still a rect, still carries its
    // own width, height and fill, and still animates, binds and states
    // exactly as it did flat. That is what "any 2D object can become 3D,
    // everything remains editable, nothing leaves the document model" has to
    // mean if it is to survive contact with the timeline and the variable
    // system.
    //
    // Zero or absent is the flat quad, unchanged, down to the same geometry
    // call — so nothing that exists today renders differently.
    const depth = typeof props.depth === "number" && props.depth > 0 ? props.depth : 0;

    // ======================================================================
    // PAINT IS A TEXTURE, SO IT IS NOT A NEW KIND OF NODE EITHER
    // ======================================================================
    // Gradients, rounded corners, strokes, shadows and glows all arrive as one
    // rasterised RGBA texture on the SAME `unlit` material a logo already
    // uses. See `paint.ts` for why that is the design and not a shortcut.
    //
    // Silhouette effects are dropped on a SOLID. A texture can round the front
    // face of an extruded box but not the box, so a rounded paint at depth
    // would show soft corners on the face and square ones on the sides — a
    // worse result than square corners honestly. A gradient has no silhouette
    // and survives at any depth, which is what a 3D card actually needs.
    const requestedPaint = readPaint(props.paint);
    const paintSpec =
      requestedPaint === undefined || depth === 0
        ? requestedPaint
        : withoutSilhouette(requestedPaint);

    const raster =
      paintSpec === undefined
        ? undefined
        : rasterisePaint(paintSpec, width, height, fill);

    // A flat quad is DOUBLE-SIDED — seen from behind it must still draw, or a
    // graphic disappears the moment a camera passes it. A solid must not be:
    // back faces of a closed box are never visible, and drawing them shades
    // the inside of the object over its own front face.
    //
    // With a paint, the base colour becomes WHITE: the texture already carries
    // the authored colour, and a tint would multiply it a second time. Opacity
    // still applies, so fading a painted graphic out works unchanged.
    const material = materialDescriptorOf({
      baseColor: raster === undefined ? fill : "#FFFFFF",
      doubleSided: depth === 0,
      ...(typeof props.opacity === "number" ? { opacity: props.opacity } : {}),
      ...(typeof props.metallic === "number" ? { metallic: props.metallic } : {}),
      ...(typeof props.roughness === "number" ? { roughness: props.roughness } : {}),
    });

    const previous = this.#rects.get(node.id);
    if (
      previous !== undefined &&
      previous.width === width &&
      previous.height === height &&
      previous.depth === depth &&
      previous.paint === raster?.key &&
      sameMaterial(previous.descriptor, material)
    ) {
      return;
    }

    if (raster !== undefined) {
      this.#applyPaintedRect(node, raster, material, previous);
      return;
    }

    if (previous !== undefined) {
      // Geometry depends on size AND depth, because both are baked into the
      // vertices. Anything else is a material change and must not reallocate.
      //
      // A paint being REMOVED also changes the geometry, even at the same size:
      // a painted quad is bleed-expanded to make room for its shadow, so
      // updating the material in place would leave an oversized quad sampling a
      // texture that is no longer there.
      const shapeChanged =
        previous.width !== width ||
        previous.height !== height ||
        previous.depth !== depth ||
        previous.paint !== undefined;

      if (!shapeChanged) {
        // Appearance only. Update in place so the handle stays stable —
        // recreating would free and reallocate a GPU resource to change a
        // colour, which a team colour bound to a variable does sixty times a
        // second.
        this.backend.updateMaterial(previous.material, material);
        this.#rects.set(node.id, { ...previous, fill, descriptor: material });
        return;
      }
      this.#releaseRect(node.id);
    }

    const geometry = this.backend.createGeometry(
      depth === 0
        ? quadDescriptor(width, height)
        : extrudedQuadDescriptor(width, height, depth),
    );
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
      depth,
      fill,
      descriptor: material,
      geometry: geometry.value,
      material: materialHandle.value,
    });
  }

  /**
   * Attaches a rect whose appearance comes from a rasterised paint.
   *
   * Separated from `#applyRect` rather than branching inside it, because the
   * two differ in every step that matters: the quad is bleed-expanded, the
   * material carries a map, and a texture reference has to be acquired and
   * released in step with the geometry. Interleaving those into one function
   * produced exactly the kind of half-updated state C2 exists to forbid.
   */
  #applyPaintedRect(
    node: SceneNode,
    raster: RasterisedPaint,
    base: MaterialDescriptor,
    previous:
      | {
          width: number;
          height: number;
          depth: number;
          fill: string;
          descriptor: MaterialDescriptor;
          geometry: GeometryHandle;
          material: MaterialHandle;
          paint?: string;
        }
      | undefined,
  ): void {
    // The same paint at the same size is the common case: a scene re-resolved
    // because an unrelated variable changed must not re-upload every gradient
    // in it.
    const texture = this.#acquirePaintTexture(raster);
    if (texture === undefined) {
      // Over budget. The rect falls back to nothing rather than to a wrong
      // picture — a gradient panel rendered as a flat white box mid-show is
      // harder to diagnose than an absent one.
      if (previous !== undefined) this.#releaseRect(node.id);
      return;
    }

    const descriptor: MaterialDescriptor =
      base.kind === "pbr"
        ? { ...base, baseColorMap: texture }
        : base.kind === "unlit"
          ? { ...base, map: texture }
          : base;

    if (
      previous !== undefined &&
      previous.paint === raster.key &&
      sameMaterial(previous.descriptor, descriptor)
    ) {
      // Acquired one reference too many above; give it straight back so the
      // count still matches the number of rects holding it.
      this.#releasePaintTexture(raster.key);
      return;
    }

    // Opacity-only and colour-only changes still update in place, exactly as an
    // unpainted rect does — the texture is unchanged, so nothing is realloc'd.
    if (previous !== undefined && previous.paint === raster.key) {
      this.#releasePaintTexture(raster.key);
      this.backend.updateMaterial(previous.material, descriptor);
      this.#rects.set(node.id, { ...previous, descriptor });
      return;
    }

    if (previous !== undefined) this.#releaseRect(node.id);

    // The world-oriented quad, NOT the image one: `rasterisePaint` writes row
    // zero at the BOTTOM, so V=0 is the bottom edge. Using `imageQuadDescriptor`
    // here flips every gradient upside down — the trap that module names.
    const geometry = this.backend.createGeometry(
      quadDescriptor(raster.quadWidth, raster.quadHeight),
    );
    if (!geometry.ok) {
      this.#releasePaintTexture(raster.key);
      return;
    }
    const material = this.backend.createMaterial(descriptor);
    if (!material.ok) {
      this.backend.destroyGeometry(geometry.value);
      this.#releasePaintTexture(raster.key);
      return;
    }

    this.mirror.setAttachment(node.id, {
      kind: "mesh",
      geometry: geometry.value,
      material: material.value,
    });
    this.#rects.set(node.id, {
      // The rect's OWN size, not the quad's. Everything else in the engine
      // measures the shape, and a shadow must not change what a layout thinks
      // a panel is.
      width: raster.quadWidth - raster.bleed * 2,
      height: raster.quadHeight - raster.bleed * 2,
      depth: 0,
      fill: "#FFFFFF",
      descriptor,
      geometry: geometry.value,
      material: material.value,
      paint: raster.key,
    });
  }

  /** One texture per distinct paint, reference-counted. */
  #acquirePaintTexture(raster: RasterisedPaint): TextureHandle | undefined {
    const existing = this.#paintTextures.get(raster.key);
    if (existing !== undefined) {
      existing.refs += 1;
      return existing.handle;
    }
    const created = this.backend.createTexture(raster.texture);
    if (!created.ok) return undefined;
    this.#paintTextures.set(raster.key, { handle: created.value, refs: 1 });
    return created.value;
  }

  #releasePaintTexture(key: string): void {
    const held = this.#paintTextures.get(key);
    if (held === undefined) return;
    held.refs -= 1;
    if (held.refs > 0) return;
    this.#paintTextures.delete(key);
    this.backend.destroyTexture(held.handle);
  }

  /**
   * Frees the resources a rect owned. Safe to call for a node without one.
   *
   * Every create* in #applyRect is matched here exactly once, which is what
   * MirrorBackend C2 requires of a caller.
   */
  /**
   * Attaches text. TEXT_ENGINE 6, SCENE_FORMAT 7.2.
   *
   * ========================================================================
   * TEXT IS A MESH, AND THAT IS THE WHOLE INTEGRATION
   * ========================================================================
   * Deliberately the same shape as `#applyRect`: resolve props, compare against
   * what is attached, recreate only what changed. A text node therefore
   * inherits the hierarchy, the transform, the dirty channels, the variable
   * bindings, the timeline, collections and states without any of them knowing
   * it is text - which is the entire objective of this phase.
   *
   * `props.content` is `Bindable<string>`, so it arrives here already RESOLVED.
   * That single fact is why text participates in variables, in live commands
   * and in collections with no code below this line: by the time the projector
   * sees it, a `{ $var: "player.name" }` is a string.
   *
   * ========================================================================
   * ONE MESH PER ATLAS PAGE, AS A CHILD NODE
   * ========================================================================
   * A mesh samples one texture, and a long multilingual string can span two
   * atlas pages. So geometry comes back batched by page and each batch becomes
   * a CHILD of the text node - sharing its transform exactly, but able to carry
   * its own material.
   *
   * The children are mirror nodes with no document counterpart. That is already
   * an established shape: a repeat's instances are exactly that.
   */
  /** Re-reads the document-level inputs component resolution needs. */
  #adoptDocument(document: SceneDocument): void {
    const declared = document.world.pixelsPerUnit;
    this.#pixelsPerUnit =
      typeof declared === "number" && declared > 0
        ? declared
        : DEFAULT_PIXELS_PER_UNIT;

  }

  #applyText(node: SceneNode, props: Record<string, unknown>): void {
    const provider = this.text;
    if (provider === undefined) {
      this.#releaseText(node.id);
      return;
    }

    const font = (props.font ?? {}) as Record<string, unknown>;
    const fit = (props.fit ?? { mode: "overflow" }) as Record<string, unknown>;
    const colour = typeof props.color === "string" ? props.color : "#FFFFFF";
    const size = typeof font.size === "number" && font.size > 0 ? font.size : 48;
    const fonts = [
      typeof font.assetId === "string" ? font.assetId : "",
      ...(Array.isArray(font.fallback) ? (font.fallback as string[]) : []),
    ].filter((id) => id.length > 0);

    // ======================================================================
    // DESIGN PIXELS IN, WORLD UNITS OUT
    // ======================================================================
    // `font.size` is in design pixels (SCENE_FORMAT §7.2); the node's box is
    // in world units (`world.units` is metres). `pixelsPerUnit` is the only
    // thing connecting them, and it is a scene property rather than anything
    // derived here.
    //
    // This previously read `scale = 1 / size`, which is self-cancelling: world
    // em = size x scale = 1, always. Font size changed how many ems fit the
    // box and nothing else, and `bucketFor` — which wants pixels — was handed
    // a metre count. At a plausible world size of 0.52 that bucketed to 1, so
    // every glyph was rasterised into a single texel. Correct geometry,
    // correct UVs, correct material, and text you could not read.
    const scale = 1 / this.#pixelsPerUnit;
    const box =
      node.size === undefined
        ? { width: Infinity, height: Infinity }
        : {
            width: node.size.width * this.#pixelsPerUnit,
            height: node.size.height * this.#pixelsPerUnit,
          };

    const request: TextRequest = {
      content: typeof props.content === "string" ? props.content : "",
      fonts,
      size,
      align: (props.align as TextRequest["align"]) ?? "start",
      verticalAlign: (props.verticalAlign as TextRequest["verticalAlign"]) ?? "top",
      lineHeight: typeof props.lineHeight === "number" ? props.lineHeight : 1.2,
      ...(typeof props.maxLines === "number" ? { maxLines: props.maxLines } : {}),
      box,
      fit: {
        mode: typeof fit.mode === "string" ? fit.mode : "overflow",
        ...(typeof fit.minSize === "number" ? { minSize: fit.minSize } : {}),
      },
      direction: (props.direction as TextRequest["direction"]) ?? "auto",
      scale,
    };

    // Everything the geometry depends on, compared before any GPU work: a
    // scoreboard re-projects on every tick and almost every text node in it is
    // unchanged.
    const signature = JSON.stringify(request);
    const previous = this.#texts.get(node.id);
    // The batches must still EXIST. A collection reorder or a state rebuild can
    // destroy a subtree, taking the mirror children with it, and an unchanged
    // signature would then short-circuit past recreating them — the row keeps
    // its identity and silently loses its words. Found by the reorder test.
    const intact =
      previous !== undefined &&
      previous.instances.every((instance) => this.mirror.has(instance.child));

    if (intact && previous!.signature === signature) {
      if (previous!.colour === colour) return;
      // Colour only. Update the materials in place rather than rebuilding
      // geometry - a team colour bound to a variable changes sixty times a
      // second and must not reallocate a vertex buffer to do it.
      const rgba = rgbaFromHex(colour);
      for (const instance of previous!.instances) {
        // Rebuilt rather than spread: `MaterialDescriptor` is a discriminated
        // union, and spreading loses the discriminant that makes the atlas and
        // pxRange fields legal.
        instance.descriptor =
          instance.descriptor.kind === "msdf-text"
            ? { ...instance.descriptor, color: rgba }
            : instance.descriptor;
        this.backend.updateMaterial(instance.material, instance.descriptor);
      }
      this.#texts.set(node.id, { ...previous!, colour });
      return;
    }

    const draw = provider.draw(request);
    this.#releaseText(node.id);
    if (draw === null || draw.batches.length === 0) return;

    this.#syncAtlasTextures(provider);

    const instances: TextInstance[] = [];
    draw.batches.forEach((batch, index) => {
      const texture = this.#atlasTextures.get(batch.page);
      if (texture === undefined) return;

      const geometry = this.backend.createGeometry({
        positions: batch.positions,
        indices: batch.indices,
        uvs: batch.uvs,
      });
      if (!geometry.ok) return;

      const descriptor: MaterialDescriptor = {
        kind: "msdf-text",
        color: rgbaFromHex(colour),
        atlas: texture.handle,
        pxRange: draw.pxRange,
      };
      const material = this.backend.createMaterial(descriptor);
      if (!material.ok) {
        this.backend.destroyGeometry(geometry.value);
        return;
      }

      const childId = `${node.id}\u00a7text${index}`;
      const mirrored = this.mirror.create(childId, node.id, node.order);
      // The batch shares its parent's world matrix EXACTLY. It is a child only
      // so it can carry its own material; it must never introduce a transform
      // of its own, or text would drift from the node it belongs to.
      mirrored.worldMatrix = this.mirror.get(node.id)!.worldMatrix;
      this.backend.setWorldMatrix(mirrored.handle, mirrored.worldMatrix);
      this.mirror.setAttachment(childId, {
        kind: "mesh",
        geometry: geometry.value,
        material: material.value,
      });
      instances.push({
        geometry: geometry.value,
        material: material.value,
        child: childId,
        descriptor,
      });
    });

    this.#texts.set(node.id, {
      signature,
      colour,
      instances,
      facts: {
        overflowed: draw.overflowed,
        truncated: draw.truncated,
        brokeWithoutOpportunity: draw.brokeWithoutOpportunity,
        resolvedSize: draw.resolvedSize,
      },
    });
  }

  /**
   * Layout facts for every text node currently projected.
   *
   * The reader the pre-flight needs: it answers "which layer overflowed?"
   * rather than "did something overflow?". Empty for a document with no text,
   * and a node absent from it produced no drawable batches at all.
   */
  textFacts(): ReadonlyMap<string, TextFacts> {
    const out = new Map<string, TextFacts>();
    for (const [nodeId, entry] of this.#texts) out.set(nodeId, entry.facts);
    return out;
  }

  /**
   * The camera descriptors currently projected, keyed by node.
   *
   * The reader an EDITOR needs. Studio has to hit-test and draw handles in the
   * same space the renderer draws in, and the only way to guarantee they agree
   * is to project through the same numbers. Deriving a second descriptor from
   * the document would compile, look right, and drift the moment a default
   * changed on one side — the failure that leaves gizmos silently wrong while
   * the picture still looks correct.
   */
  cameraFacts(): ReadonlyMap<string, CameraDescriptor> {
    return new Map(this.#cameras);
  }

  /**
   * Creates or updates the textures holding the atlas pages.
   *
   * One texture per page, created once and then updated BY REGION - which is
   * what `updateTexture` exists for; its doc comment names this exact case. A
   * page is up to 16MB, so re-uploading it because one glyph arrived would cost
   * more than everything else in the frame put together.
   */
  #syncAtlasTextures(provider: TextProvider): void {
    const pages = provider.pages();
    const dirty = new Map(provider.flushDirty().map((entry) => [entry.page, entry.regions]));

    pages.forEach((page, index) => {
      const existing = this.#atlasTextures.get(index);
      if (existing === undefined) {
        const texture = this.backend.createTexture({
          width: page.width,
          height: page.height,
          pixels: page.pixels,
          format: "rgba8",
          // Linear: the shader interpolates the distance field, which is the
          // entire point of a distance field. Nearest would stair-step it.
          filter: "linear",
        });
        if (texture.ok) {
          this.#atlasTextures.set(index, { handle: texture.value, revision: page.revision });
        }
        return;
      }
      if (existing.revision === page.revision) return;

      for (const region of dirty.get(index) ?? []) {
        const pixels = new Uint8Array(region.width * region.height * 4);
        for (let row = 0; row < region.height; row += 1) {
          const source = ((region.y + row) * page.width + region.x) * 4;
          pixels.set(
            page.pixels.subarray(source, source + region.width * 4),
            row * region.width * 4,
          );
        }
        this.backend.updateTexture(existing.handle, region, pixels);
      }
      this.#atlasTextures.set(index, { ...existing, revision: page.revision });
    });
  }

  /** Frees a text node's meshes. Every create above is matched here once (C2). */
  #releaseText(nodeId: string): void {
    const text = this.#texts.get(nodeId);
    if (text === undefined) return;
    this.#texts.delete(nodeId);
    for (const instance of text.instances) {
      if (this.mirror.has(instance.child)) this.mirror.destroySubtree(instance.child);
      this.backend.destroyGeometry(instance.geometry);
      this.backend.destroyMaterial(instance.material);
    }
  }

  #releaseRect(nodeId: string): void {
    const rect = this.#rects.get(nodeId);
    if (rect === undefined) return;
    this.#rects.delete(nodeId);
    this.backend.destroyGeometry(rect.geometry);
    this.backend.destroyMaterial(rect.material);
    // Ordered after the material, so the texture is never freed while
    // something still samples it.
    if (rect.paint !== undefined) this.#releasePaintTexture(rect.paint);
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

/**
 * A material descriptor from a component's resolved props.
 *
 * `pbr` only when the author asked for it by giving a metallic or roughness
 * value. Defaulting to pbr would be the obvious choice and is currently wrong:
 * the frozen MirrorBackend has no lights, so a pbr surface has nothing to
 * reflect and renders black. `unlit` is what produces a picture today, and an
 * author who writes `metallic` has explicitly asked for the other thing.
 *
 * Every field here is resolved from props, so every one of them is BINDABLE —
 * `{ "$var": "team.accent" }` in `baseColor` drives the colour of every
 * instance from one runtime variable, with no code path of its own.
 */
/**
 * The parts of a paint that a solid can honestly wear.
 *
 * Corner radii and shadows describe an OUTLINE, and an extruded box's outline
 * is its geometry — a texture cannot change it. Keeping them would round the
 * front face while the side walls stayed square, which reads as a rendering
 * bug rather than as a design. Gradients and strokes are surface, so they stay.
 *
 * Returns undefined when nothing survives, putting the rect back on the flat
 * path with no texture at all.
 */
function withoutSilhouette(spec: PaintSpec): PaintSpec | undefined {
  const surface: PaintSpec = {
    ...(spec.gradient === undefined ? {} : { gradient: spec.gradient }),
    ...(spec.stroke === undefined ? {} : { stroke: spec.stroke }),
    ...(spec.density === undefined ? {} : { density: spec.density }),
  };
  return isFlatPaint(surface) ? undefined : surface;
}

function materialDescriptorOf(value: unknown): MaterialDescriptor {
  const raw =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const colour = typeof raw.baseColor === "string" ? raw.baseColor : "#FFFFFF";
  const opacity = typeof raw.opacity === "number" ? raw.opacity : 1;
  const doubleSided = raw.doubleSided === true;
  // Transparent unless told otherwise: broadcast output composites over live
  // video, and an opaque default is a black rectangle on air.
  const transparent = raw.transparent !== false || opacity < 1;

  const metallic = typeof raw.metallic === "number" ? raw.metallic : undefined;
  const roughness = typeof raw.roughness === "number" ? raw.roughness : undefined;

  const base = rgbaFromHex(colour);
  // Premultiplied, per C9. Multiplying after the sRGB conversion is correct —
  // alpha is linear and the colour is not.
  const rgba: Rgba =
    opacity >= 1
      ? base
      : [base[0] * opacity, base[1] * opacity, base[2] * opacity, base[3] * opacity];

  if (metallic === undefined && roughness === undefined) {
    return { kind: "unlit", color: rgba, transparent, doubleSided };
  }
  return {
    kind: "pbr",
    baseColor: rgba,
    metallic: metallic ?? 0,
    roughness: roughness ?? 1,
    transparent,
    doubleSided,
  };
}

/** Structural equality, so an unchanged material never touches the GPU. */
function sameMaterial(a: MaterialDescriptor, b: MaterialDescriptor): boolean {
  if (a.kind !== b.kind) return false;
  const colourA = a.kind === "pbr" ? a.baseColor : a.kind === "unlit" ? a.color : null;
  const colourB = b.kind === "pbr" ? b.baseColor : b.kind === "unlit" ? b.color : null;
  if (colourA === null || colourB === null) return false;
  for (let index = 0; index < 4; index += 1) {
    if (colourA[index] !== colourB[index]) return false;
  }
  if (a.kind === "pbr" && b.kind === "pbr") {
    if (a.metallic !== b.metallic || a.roughness !== b.roughness) return false;
  }
  if (a.kind === "unlit" && b.kind === "unlit") {
    if (a.transparent !== b.transparent || a.doubleSided !== b.doubleSided) return false;
  }
  return true;
}

/**
 * A light descriptor from a component's resolved props.
 *
 * Defaults are a neutral white key light at unit intensity: a `light` component
 * with no props must produce something visible, or an author adding one sees
 * nothing and concludes lighting is broken.
 */
function lightDescriptorOf(props: Record<string, unknown>): LightDescriptor {
  const kind =
    props.kind === "ambient" || props.kind === "point" || props.kind === "spot"
      ? props.kind
      : "directional";
  const color = rgbaFromHex(typeof props.color === "string" ? props.color : "#FFFFFF");
  const intensity = typeof props.intensity === "number" ? props.intensity : 1;
  const number = (key: string, fallback: number): number =>
    typeof props[key] === "number" && Number.isFinite(props[key]) ? (props[key] as number) : fallback;

  if (kind === "ambient") return { kind, color, intensity };
  if (kind === "directional") return { kind, color, intensity };
  if (kind === "point") {
    return { kind, color, intensity, distance: number("distance", 0), decay: number("decay", 2) };
  }
  return {
    kind: "spot",
    color,
    intensity,
    distance: number("distance", 0),
    angle: number("angle", Math.PI / 6),
    penumbra: number("penumbra", 0),
    decay: number("decay", 2),
  };
}

/** Structural equality, so an unchanged light never touches the GPU. */
function sameLight(a: LightDescriptor, b: LightDescriptor): boolean {
  if (a.kind !== b.kind || a.intensity !== b.intensity) return false;
  for (let index = 0; index < 4; index += 1) {
    if (a.color[index] !== b.color[index]) return false;
  }
  if (a.kind === "point" && b.kind === "point") {
    return a.distance === b.distance && a.decay === b.decay;
  }
  if (a.kind === "spot" && b.kind === "spot") {
    return (
      a.distance === b.distance &&
      a.decay === b.decay &&
      a.angle === b.angle &&
      a.penumbra === b.penumbra
    );
  }
  return true;
}
