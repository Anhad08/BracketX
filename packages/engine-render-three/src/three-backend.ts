/**
 * ThreeMirrorBackend — BracketX's first production rendering backend.
 *
 * ============================================================================
 * THREE.JS IS A GPU DRIVER, NOT THE ENGINE
 * ============================================================================
 * This class is the entire surface across which BracketX touches Three.js.
 * Above it: the reconciler owns lifetime, the runtime owns time, the scene
 * graph owns truth. Three.js owns GPU objects and nothing else.
 *
 * Concretely, that means this backend:
 *   - never traverses to compute anything (MirrorBackend contract C3)
 *   - never frees on its own initiative (C2)
 *   - never reads back scene state
 *   - exposes no Three.js type through any public signature
 *
 * Three's own matrix maintenance is disabled on every object. The engine
 * computes world matrices; Three is told them. See translate.disableAutoMatrix.
 */
import { Mesh, Object3D, Scene, type Camera, type Light, type Material } from "three";

import type {
  BackendCapabilities,
  BackendResult,
  CameraDescriptor,
  CameraHandle,
  LightDescriptor,
  LightHandle,
  GeometryDescriptor,
  GeometryHandle,
  InspectableMirrorBackend,
  Mat4,
  MaterialDescriptor,
  MaterialHandle,
  MirrorNodeSnapshot,
  MirrorSnapshot,
  NodeHandle,
  RenderOptions,
  RenderTargetHandle,
  TextureDescriptor,
  TextureHandle,
  Vec2,
} from "@bracketx/engine-reconciler";

import { HeadlessRendererHost, type RendererHost } from "./renderer-host";
import { GpuResourceManager, ResourceViolation } from "./resources";
import {
  LIGHT_TARGET_OFFSET,
  applyLight,
  createCamera,
  createLight,
  createGeometry,
  createMaterial,
  createTexture,
  disableAutoMatrix,
  estimateGeometryBytes,
  estimateMaterialBytes,
  estimateTextureBytes,
  geometryKey,
  materialKey,
  textureKey,
  updateCameraProjection,
} from "./translate";

export class BackendViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendViolation";
  }
}

/**
 * A node is a TRANSFORM; a mesh is an ATTACHMENT child of it.
 *
 * This mirrors SCENE_FORMAT §6/§7 exactly - a node is a place in space and
 * what it *is* comes from attached components. It also means attaching or
 * detaching never swaps the node object, so the handle and its position in the
 * hierarchy survive an attachment change.
 *
 * `childHandles` is tracked explicitly rather than derived from
 * `object.children`, because that array also holds the attachment mesh.
 * Deriving child nodes from it would count the attachment as a child and
 * refuse legitimate destroys.
 */
interface NodeRecord {
  readonly handle: number;
  readonly object: Object3D;
  mesh: Mesh | null;
  parent: number | null;
  childHandles: number[];
  attachment: "none" | "mesh" | "camera" | "light";
  geometry: number | null;
  material: number | null;
  camera: number | null;
  light: number | null;
}

export interface ThreeBackendOptions {
  readonly host?: RendererHost;
  readonly width?: number;
  readonly height?: number;
  /** Debug wireframe on every material. Never for on-air output. */
  readonly wireframe?: boolean;
  readonly maxBytes?: number;
}

export interface BackendDiagnostics {
  readonly nodes: { live: number; created: number; destroyed: number; balance: number };
  readonly resources: ReturnType<GpuResourceManager["stats"]>;
  readonly frames: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly contextLosses: number;
  readonly contextRestores: number;
  readonly recreatedAfterRestore: number;
  readonly vramEstimateBytes: number;
}

export class ThreeMirrorBackend implements InspectableMirrorBackend {
  readonly #host: RendererHost;
  readonly #resources: GpuResourceManager;
  readonly #scene = new Scene();

  #nodes = new Map<number, NodeRecord>();
  #destroyedNodes = new Set<number>();
  #roots: number[] = [];
  #nextNodeHandle = 1;

  /** Retained so cameras can be rebuilt on resize and after context loss. */
  #cameraDescriptors = new Map<number, CameraDescriptor>();
  #cameras = new Map<number, Camera>();
  /**
   * Light objects, and the target each directional/spot light aims at.
   *
   * The target is a bare Object3D one unit down local −Z. Three aims those
   * lights at `light.target.matrixWorld`, so this is how "points down the
   * node's −Z" is expressed without the backend deriving a single transform:
   * the target's world matrix is composed from the node's, which the ENGINE
   * set, and nothing here computes an orientation of its own.
   */
  #lights = new Map<number, { object: Light; target: Object3D | null }>();
  #nextLightHandle = 1;
  #nextCameraHandle = 1;

  #width: number;
  #height: number;
  #wireframe: boolean;
  #disposed = false;

  #nodesCreated = 0;
  #nodesDestroyed = 0;
  #frames = 0;
  #contextLosses = 0;
  #contextRestores = 0;
  #recreated = 0;

  constructor(options: ThreeBackendOptions = {}) {
    this.#host = options.host ?? new HeadlessRendererHost();
    this.#width = options.width ?? 1920;
    this.#height = options.height ?? 1080;
    this.#wireframe = options.wireframe ?? false;
    this.#resources = new GpuResourceManager(
      options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : undefined,
    );

    // The scene itself must not auto-update, or Three would traverse and
    // recompute every world matrix the engine already wrote.
    disableAutoMatrix(this.#scene);

    this.#host.onContextLost(() => {
      this.#contextLosses += 1;
    });
    this.#host.onContextRestored(() => {
      this.#contextRestores += 1;
      const rebuilt = this.#resources.recreateAll();
      this.#recreated += rebuilt.geometry + rebuilt.material + rebuilt.texture;
      this.#rebindAfterRestore();
    });
  }

  // -- Capabilities --------------------------------------------------------

  get capabilities(): BackendCapabilities {
    const host = this.#host.capabilities;
    return {
      name: `three/${host.renderer}`,
      // RFC-003 §3: WebGL2 is the Baseline tier. Advanced needs WebGPU.
      tier: "baseline",
      maxTextureSize: host.maxTextureSize,
      supportsComputeShaders: false,
      supportsFloatRenderTargets: host.floatRenderTargets,
    };
  }

  get isContextLost(): boolean {
    return this.#host.isContextLost;
  }

  // -- Nodes ---------------------------------------------------------------

  createNode(): NodeHandle {
    this.#assertUsable();
    const handle = this.#nextNodeHandle++;
    const object = new Object3D();
    disableAutoMatrix(object);

    this.#nodes.set(handle, {
      handle,
      object,
      mesh: null,
      light: null,
      parent: null,
      childHandles: [],
      attachment: "none",
      geometry: null,
      material: null,
      camera: null,
    });
    this.#scene.add(object);
    this.#roots.push(handle);
    this.#nodesCreated += 1;
    return handle as NodeHandle;
  }

  destroyNode(node: NodeHandle): void {
    this.#assertUsable();
    const record = this.#requireNode(node, "destroyNode");

    if (record.childHandles.length > 0) {
      // Destroying a parent while children remain would orphan GPU objects.
      // The reconciler destroys depth-first; this catches it if that changes.
      throw new BackendViolation(
        `destroyNode(${node}) while it still has ${record.childHandles.length} ` +
          `child(ren). Destroy depth-first.`,
      );
    }

    this.#releaseAttachment(record);
    this.#unlink(record);
    record.object.removeFromParent();
    this.#nodes.delete(record.handle);
    this.#destroyedNodes.add(record.handle);
    this.#nodesDestroyed += 1;
  }

  setParent(node: NodeHandle, parent: NodeHandle | null): void {
    const record = this.#requireNode(node, "setParent");
    const parentRecord =
      parent === null ? null : this.#requireNode(parent, "setParent(parent)");

    if (parentRecord !== null && this.#isDescendant(record, parentRecord)) {
      throw new BackendViolation(
        `setParent(${node}, ${parent}) would create a cycle`,
      );
    }

    this.#unlink(record);
    record.object.removeFromParent();

    if (parentRecord === null) {
      record.parent = null;
      this.#scene.add(record.object);
      this.#roots.push(record.handle);
    } else {
      record.parent = parentRecord.handle;
      parentRecord.childHandles.push(record.handle);
      parentRecord.object.add(record.object);
    }
  }

  /**
   * Writes the world matrix directly.
   *
   * `matrixWorldNeedsUpdate = false` is what stops Three recomputing it from
   * the local transform on the next traversal — without it, the value written
   * here is silently overwritten and every transform is wrong.
   */
  setWorldMatrix(node: NodeHandle, matrix: Mat4): void {
    if (matrix.length !== 16) {
      throw new BackendViolation(
        `setWorldMatrix expects 16 elements, received ${matrix.length}`,
      );
    }
    const record = this.#requireNode(node, "setWorldMatrix");
    record.object.matrixWorld.fromArray(matrix as number[]);
    record.object.matrixWorldNeedsUpdate = false;
    // A light aims down the node's −Z, so its target moves with the node.
    if (record.attachment === "light") this.#aimLight(record);
    // The attachment mesh sits under the node with no local transform, and
    // Three will not propagate to it because auto-update is off - so its world
    // matrix is written here too.
    if (record.mesh !== null) {
      record.mesh.matrixWorld.copy(record.object.matrixWorld);
      record.mesh.matrixWorldNeedsUpdate = false;
    }
  }

  setVisible(node: NodeHandle, visible: boolean): void {
    this.#requireNode(node, "setVisible").object.visible = visible;
  }

  setLayers(node: NodeHandle, mask: number): void {
    this.#requireNode(node, "setLayers").object.layers.mask = mask >>> 0;
  }

  setRenderOrder(node: NodeHandle, order: number): void {
    this.#requireNode(node, "setRenderOrder").object.renderOrder = order;
  }

  // -- Attachments ---------------------------------------------------------

  attachMesh(
    node: NodeHandle,
    geometry: GeometryHandle,
    material: MaterialHandle,
  ): void {
    const record = this.#requireNode(node, "attachMesh");
    const geometryObject = this.#resources.geometry.require(
      geometry,
      "attachMesh",
    );
    const materialObject = this.#resources.material.require(
      material,
      "attachMesh",
    );

    this.#releaseAttachment(record);

    const mesh = new Mesh(geometryObject, materialObject);
    disableAutoMatrix(mesh);
    mesh.matrixWorld.copy(record.object.matrixWorld);
    mesh.matrixWorldNeedsUpdate = false;
    record.object.add(mesh);
    record.mesh = mesh;

    this.#resources.geometry.retain(geometry);
    this.#resources.material.retain(material);
    record.attachment = "mesh";
    record.geometry = geometry;
    record.material = material;
    record.camera = null;
  }

  attachLight(node: NodeHandle, light: LightHandle): void {
    const record = this.#requireNode(node, "attachLight");
    const entry = this.#lights.get(light);
    if (!entry) {
      throw new BackendViolation(`attachLight: unknown light ${light}`);
    }

    this.#releaseAttachment(record);
    record.attachment = "light";
    record.light = light;
    record.geometry = null;
    record.material = null;
    record.camera = null;

    // Parented into the node, unlike a camera: a light has to be IN the scene
    // to illuminate it, whereas a camera only has to know where it is. With no
    // local transform, the light's world matrix is the node's.
    record.object.add(entry.object);
    entry.object.matrix.identity();
    entry.object.matrixWorld.copy(record.object.matrixWorld);
    entry.object.matrixWorldNeedsUpdate = false;
    this.#aimLight(record);
  }

  /**
   * Places a light's target from the node's world matrix.
   *
   * Called whenever that matrix changes. The offset is a constant −Z unit
   * vector composed with a matrix the engine produced — no orientation is
   * derived here, which is what C3 requires.
   */
  #aimLight(record: NodeRecord): void {
    if (record.light === null) return;
    const entry = this.#lights.get(record.light);
    if (!entry || entry.target === null) return;
    entry.object.matrixWorld.copy(record.object.matrixWorld);
    entry.object.matrixWorldNeedsUpdate = false;
    entry.target.matrixWorld
      .copy(record.object.matrixWorld)
      .multiply(LIGHT_TARGET_OFFSET);
    entry.target.matrixWorldNeedsUpdate = false;
  }

  createLight(descriptor: LightDescriptor): LightHandle {
    this.#assertUsable();
    const handle = this.#nextLightHandle++;
    const created = createLight(descriptor);
    if (created.target !== null) {
      // The target must be in the scene graph for Three to read its world
      // matrix. Parenting it to the light keeps its lifetime tied to one.
      created.object.add(created.target);
      disableAutoMatrix(created.target);
    }
    disableAutoMatrix(created.object);
    this.#lights.set(handle, created);
    return handle as LightHandle;
  }

  updateLight(light: LightHandle, descriptor: LightDescriptor): void {
    const entry = this.#lights.get(light);
    if (!entry) throw new BackendViolation(`unknown light handle ${light}`);
    applyLight(entry.object, descriptor);
  }

  destroyLight(light: LightHandle): void {
    const entry = this.#lights.get(light);
    if (!entry) {
      throw new BackendViolation(
        `destroyLight(${light}) on an unknown or already-destroyed handle`,
      );
    }
    this.#lights.delete(light);
    entry.object.removeFromParent();
    entry.object.dispose?.();
  }

  attachCamera(node: NodeHandle, camera: CameraHandle): void {
    const record = this.#requireNode(node, "attachCamera");
    const cameraObject = this.#cameras.get(camera);
    if (!cameraObject) {
      throw new BackendViolation(`attachCamera: unknown camera ${camera}`);
    }

    this.#releaseAttachment(record);
    record.attachment = "camera";
    record.camera = camera;
    record.geometry = null;
    record.material = null;

    // The camera tracks the node's world matrix rather than being parented
    // into the scene, so camera placement stays engine-computed like any
    // other transform.
    cameraObject.matrixWorld.copy(record.object.matrixWorld);
    cameraObject.matrixWorldNeedsUpdate = false;
  }

  detach(node: NodeHandle): void {
    const record = this.#requireNode(node, "detach");
    this.#releaseAttachment(record);
    record.attachment = "none";
  }

  // -- Resources -----------------------------------------------------------

  createGeometry(
    descriptor: GeometryDescriptor,
  ): BackendResult<GeometryHandle> {
    this.#assertUsable();
    const bytes = estimateGeometryBytes(descriptor);
    if (this.#resources.wouldExceedBudget(bytes)) {
      // Refuse rather than evict — ENGINE_RUNTIME §4.4.
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "geometry" },
      };
    }

    const key = geometryKey(descriptor);
    const acquired = this.#resources.geometry.acquire(
      key,
      bytes,
      () => createGeometry(descriptor),
      (geometry) => geometry.dispose(),
    );
    // acquire() adds a reference for the caller; attachMesh adds its own.
    return { ok: true, value: acquired.id as GeometryHandle };
  }

  destroyGeometry(geometry: GeometryHandle): void {
    this.#resources.geometry.release(geometry);
  }

  createTexture(descriptor: TextureDescriptor): BackendResult<TextureHandle> {
    this.#assertUsable();
    const bytes = estimateTextureBytes(descriptor);
    if (this.#resources.wouldExceedBudget(bytes)) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "texture" },
      };
    }
    const acquired = this.#resources.texture.acquire(
      textureKey(descriptor),
      bytes,
      () => createTexture(descriptor),
      (texture) => texture.dispose(),
    );
    return { ok: true, value: acquired.id as TextureHandle };
  }

  updateTexture(
    texture: TextureHandle,
    _region: { x: number; y: number; width: number; height: number },
    pixels: Uint8Array,
  ): void {
    const object = this.#resources.texture.require(texture, "updateTexture");
    const image = object.image as { data?: Uint8Array } | undefined;
    if (image && image.data) image.data.set(pixels);
    // Sub-rectangle upload needs WebGLRenderer.copyTextureToTexture or a
    // manual texSubImage2D; the descriptor-level path replaces the whole
    // image. Recorded as a limitation rather than silently ignoring `region`.
    object.needsUpdate = true;
  }

  destroyTexture(texture: TextureHandle): void {
    this.#resources.texture.release(texture);
  }

  createMaterial(descriptor: MaterialDescriptor): BackendResult<MaterialHandle> {
    this.#assertUsable();
    const bytes = estimateMaterialBytes();
    if (this.#resources.wouldExceedBudget(bytes)) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "material" },
      };
    }
    const acquired = this.#resources.material.acquire(
      materialKey(descriptor),
      bytes,
      () =>
        createMaterial(descriptor, {
          wireframe: this.#wireframe,
          resolveTexture: (handle) => this.#resources.texture.get(handle),
        }),
      (material: Material) => material.dispose(),
    );
    return { ok: true, value: acquired.id as MaterialHandle };
  }

  updateMaterial(
    material: MaterialHandle,
    descriptor: MaterialDescriptor,
  ): void {
    const existing = this.#resources.material.require(material, "updateMaterial");
    const replacement = createMaterial(descriptor, {
      wireframe: this.#wireframe,
      resolveTexture: (handle) => this.#resources.texture.get(handle),
    });
    // Copying rather than swapping keeps the handle and every mesh reference
    // valid. Swapping would require finding and repointing every user.
    existing.copy(replacement);
    existing.needsUpdate = true;
    replacement.dispose();
  }

  destroyMaterial(material: MaterialHandle): void {
    this.#resources.material.release(material);
  }

  createCamera(descriptor: CameraDescriptor): CameraHandle {
    this.#assertUsable();
    const handle = this.#nextCameraHandle++;
    const camera = createCamera(descriptor, this.#width / this.#height);
    this.#cameras.set(handle, camera);
    this.#cameraDescriptors.set(handle, descriptor);
    return handle as CameraHandle;
  }

  updateCamera(camera: CameraHandle, descriptor: CameraDescriptor): void {
    const object = this.#cameras.get(camera);
    if (!object) {
      throw new BackendViolation(`updateCamera: unknown camera ${camera}`);
    }
    updateCameraProjection(
      object as never,
      descriptor,
      this.#width / this.#height,
    );
    this.#cameraDescriptors.set(camera, descriptor);
  }

  destroyCamera(camera: CameraHandle): void {
    if (!this.#cameras.delete(camera)) {
      throw new BackendViolation(
        `destroyCamera(${camera}) on an unknown or already-destroyed handle`,
      );
    }
    this.#cameraDescriptors.delete(camera);
  }

  createRenderTarget(size: Vec2): BackendResult<RenderTargetHandle> {
    const bytes = size[0] * size[1] * 4;
    if (this.#resources.wouldExceedBudget(bytes)) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "renderTarget" },
      };
    }
    const acquired = this.#resources.renderTarget.acquire(
      `rt:${size[0]}x${size[1]}`,
      bytes,
      () => ({ dispose: () => undefined, width: size[0], height: size[1] }),
      (target) => target.dispose(),
    );
    return { ok: true, value: acquired.id as RenderTargetHandle };
  }

  destroyRenderTarget(target: RenderTargetHandle): void {
    this.#resources.renderTarget.release(target);
  }

  // -- Frame ---------------------------------------------------------------

  /**
   * Submits the mirror through a camera.
   *
   * No traversal happens here beyond Three's own render walk — the engine
   * already wrote every world matrix, so submission is a handoff rather than
   * a synchronisation step.
   */
  render(camera: CameraHandle, options: RenderOptions): void {
    this.#assertUsable();
    const cameraObject = this.#cameras.get(camera);
    if (!cameraObject) {
      throw new BackendViolation(`render: unknown camera ${camera}`);
    }

    this.#syncCameraTransform(camera);
    cameraObject.layers.mask = options.layerMask >>> 0;

    this.#host.render(this.#scene, cameraObject, {
      width: options.viewport.width,
      height: options.viewport.height,
      clearColor: options.clearColor,
      target: options.target === null ? null : { handle: options.target },
    });
    this.#frames += 1;
  }

  setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#host.setSize(width, height);
    // Aspect changed, so every camera's projection is stale.
    for (const [handle, descriptor] of this.#cameraDescriptors) {
      const camera = this.#cameras.get(handle);
      if (camera) {
        updateCameraProjection(camera as never, descriptor, width / height);
      }
    }
  }

  dispose(): void {
    this.#resources.disposeAll();
    this.#nodes.clear();
    this.#destroyedNodes.clear();
    this.#roots = [];
    this.#cameras.clear();
    this.#cameraDescriptors.clear();
    this.#detachSceneChildren();
    this.#host.dispose();
    this.#disposed = true;
  }

  // -- Diagnostics — Phase 2.5i --------------------------------------------

  diagnostics(): BackendDiagnostics {
    const submission = this.#host.submission();
    return {
      nodes: {
        live: this.#nodes.size,
        created: this.#nodesCreated,
        destroyed: this.#nodesDestroyed,
        balance: this.#nodesCreated - this.#nodesDestroyed - this.#nodes.size,
      },
      resources: this.#resources.stats(),
      frames: this.#frames,
      drawCalls: submission.drawCalls,
      triangles: submission.triangles,
      contextLosses: this.#contextLosses,
      contextRestores: this.#contextRestores,
      recreatedAfterRestore: this.#recreated,
      vramEstimateBytes: this.#resources.totalBytes,
    };
  }

  /** True when nodes and every resource pool balance. */
  isBalanced(): boolean {
    return (
      this.#nodesCreated - this.#nodesDestroyed === this.#nodes.size &&
      this.#resources.isBalanced()
    );
  }

  snapshot(): MirrorSnapshot {
    const nodes: MirrorNodeSnapshot[] = [];

    const visit = (handle: number, path: string) => {
      const record = this.#nodes.get(handle);
      if (!record) return;
      nodes.push({
        path,
        worldMatrix: record.object.matrixWorld.toArray(),
        visible: record.object.visible,
        layers: record.object.layers.mask,
        renderOrder: record.object.renderOrder,
        attachment: record.attachment,
      });
      // Children in Three's own order, which mirrors insertion — the same
      // ordering MockMirrorBackend reports, so snapshots are comparable.
      record.childHandles.forEach((childHandle, index) =>
        visit(childHandle, `${path}/${index}`),
      );
    };

    this.#roots.forEach((root, index) => visit(root, `${index}`));

    const stats = this.#resources.stats();
    return {
      nodes,
      resourceCounts: {
        geometries: stats.geometry.live,
        textures: stats.texture.live,
        materials: stats.material.live,
        cameras: this.#cameras.size,
        renderTargets: stats.renderTarget.live,
      },
    };
  }

  // -- Context recovery — Phase 2.5j/o -------------------------------------

  simulateContextLoss(): void {
    this.#host.simulateContextLoss();
  }

  simulateContextRestore(): void {
    this.#host.simulateContextRestore();
  }

  // -- Internals -----------------------------------------------------------

  #assertUsable(): void {
    if (this.#disposed) {
      throw new BackendViolation("backend has been disposed");
    }
  }

  #requireNode(handle: NodeHandle, operation: string): NodeRecord {
    const record = this.#nodes.get(handle);
    if (record) return record;
    throw new BackendViolation(
      this.#destroyedNodes.has(handle)
        ? `${operation}(${handle}) on a destroyed node — use after destroy`
        : `${operation}(${handle}) on a handle this backend never issued`,
    );
  }

  /**
   * Empties the Three scene in O(n).
   *
   * Scene.clear() is quadratic past roughly ten thousand children: it calls
   * `remove(...this.children)`, and spreading tens of thousands of arguments
   * falls off a V8 fast path. Measured on r185: 4ms at 10k children, 1,828ms
   * at 50k — 5x the nodes for 457x the time, which showed up as a 3-second
   * teardown in the Phase 2.5l benchmark.
   *
   * Nothing subscribes to Three's "removed" event, so detaching directly is
   * equivalent. This is the GPU-driver posture in practice: route around a
   * slow path in the driver rather than accept it as the engine's cost.
   */
  #detachSceneChildren(): void {
    for (const child of this.#scene.children) child.parent = null;
    this.#scene.children.length = 0;
  }

  /** Detaches from whichever parent list currently holds this node. */
  #unlink(record: NodeRecord): void {
    if (record.parent === null) {
      const index = this.#roots.indexOf(record.handle);
      if (index !== -1) this.#roots.splice(index, 1);
      return;
    }
    const parent = this.#nodes.get(record.parent);
    if (parent) {
      const index = parent.childHandles.indexOf(record.handle);
      if (index !== -1) parent.childHandles.splice(index, 1);
    }
  }

  #isDescendant(ancestor: NodeRecord, candidate: NodeRecord): boolean {
    let current: Object3D | null = candidate.object;
    while (current) {
      if (current === ancestor.object) return true;
      current = current.parent;
    }
    return false;
  }

  /** Drops references an attachment held. Nodes are not resources. */
  #releaseAttachment(record: NodeRecord): void {
    if (record.geometry !== null) {
      this.#resources.geometry.release(record.geometry);
      record.geometry = null;
    }
    if (record.material !== null) {
      this.#resources.material.release(record.material);
      record.material = null;
    }
    if (record.mesh !== null) {
      // The Mesh wrapper is discarded; geometry and material are pooled and
      // were released above, so nothing is disposed twice.
      record.mesh.removeFromParent();
      record.mesh = null;
    }
    record.camera = null;
  }

  #syncCameraTransform(handle: number): void {
    const camera = this.#cameras.get(handle);
    if (!camera) return;
    for (const record of this.#nodes.values()) {
      if (record.camera === handle) {
        camera.matrixWorld.copy(record.object.matrixWorld);
        camera.matrixWorldNeedsUpdate = false;
        // matrixWorldInverse is what the renderer actually uses for the view.
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        return;
      }
    }
  }

  /**
   * Re-points meshes at rebuilt GPU objects after a context restore.
   *
   * Handles are stable across recreation, so nothing above the backend knows
   * this happened — which is the property that lets a GPU reset not restart
   * the engine.
   */
  #rebindAfterRestore(): void {
    for (const record of this.#nodes.values()) {
      if (record.attachment !== "mesh" || record.mesh === null) continue;
      if (record.geometry !== null) {
        const geometry = this.#resources.geometry.get(record.geometry);
        if (geometry) record.mesh.geometry = geometry;
      }
      if (record.material !== null) {
        const material = this.#resources.material.get(record.material);
        if (material) record.mesh.material = material;
      }
    }
  }
}

export { ResourceViolation };
