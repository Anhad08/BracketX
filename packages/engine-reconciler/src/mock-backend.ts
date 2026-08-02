/**
 * An in-memory MirrorBackend, for verifying the interface contract without a
 * renderer.
 *
 * Its purpose is not to simulate rendering — it renders nothing. It exists to
 * prove that the reconciler drives the MirrorBackend contract correctly, and to
 * make ownership violations detectable: every create and destroy is recorded,
 * so a leaked handle, a double destroy, or a use-after-destroy is a test
 * failure rather than a silent defect that only appears once a real GPU is
 * attached.
 *
 * It is also the failure-injection harness for 2.4k. A real backend can fail —
 * out of VRAM, unsupported format — and the reconciler must not corrupt the
 * mirror when it does.
 */
import type {
  BackendCapabilities,
  BackendResult,
  CameraDescriptor,
  LightDescriptor,
  LightHandle,
  CameraHandle,
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
} from "./mirror-backend";

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface MockNode {
  readonly handle: number;
  parent: number | null;
  children: number[];
  worldMatrix: Mat4;
  visible: boolean;
  layers: number;
  renderOrder: number;
  attachment: "none" | "mesh" | "camera" | "light";
  light: number | null;
  geometry: number | null;
  material: number | null;
  camera: number | null;
}

export class MirrorBackendViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MirrorBackendViolation";
  }
}

/** Which call to fail, for 2.4k failure testing. */
export interface FailureInjection {
  failCreateGeometry?: boolean;
  failCreateTexture?: boolean;
  failCreateMaterial?: boolean;
  failCreateRenderTarget?: boolean;
  /** Throws instead of returning a failure — simulates a backend defect. */
  throwOnCreateNode?: boolean;
  throwOnDestroyNode?: boolean;
  throwOnSetParent?: boolean;
}

export interface MockBackendStats {
  readonly nodesCreated: number;
  readonly nodesDestroyed: number;
  readonly liveNodes: number;
  readonly geometriesCreated: number;
  readonly geometriesDestroyed: number;
  readonly texturesCreated: number;
  readonly texturesDestroyed: number;
  readonly materialsCreated: number;
  readonly materialsDestroyed: number;
  readonly camerasCreated: number;
  readonly lightsCreated: number;
  readonly lightsDestroyed: number;
  readonly camerasDestroyed: number;
  readonly renderCalls: number;
  /** Every setWorldMatrix, setVisible, etc. Used to prove minimal updates. */
  readonly writes: number;
}

export class MockMirrorBackend implements InspectableMirrorBackend {
  readonly capabilities: BackendCapabilities = {
    name: "mock",
    tier: "baseline",
    maxTextureSize: 4096,
    supportsComputeShaders: false,
    supportsFloatRenderTargets: false,
  };

  failures: FailureInjection = {};

  #nodes = new Map<number, MockNode>();
  #roots: number[] = [];
  #destroyedNodes = new Set<number>();

  #geometries = new Set<number>();
  #textures = new Set<number>();
  #materials = new Map<number, MaterialDescriptor>();
  #lights = new Map<number, LightDescriptor>();
  #cameras = new Map<number, CameraDescriptor>();
  #renderTargets = new Set<number>();

  #nextHandle = 1;
  #disposed = false;

  #counters = {
    nodesCreated: 0,
    nodesDestroyed: 0,
    geometriesCreated: 0,
    geometriesDestroyed: 0,
    texturesCreated: 0,
    texturesDestroyed: 0,
    materialsCreated: 0,
    materialsDestroyed: 0,
    camerasCreated: 0,
    lightsCreated: 0,
    lightsDestroyed: 0,
    camerasDestroyed: 0,
    renderCalls: 0,
    writes: 0,
  };

  // -- Nodes ---------------------------------------------------------------

  createNode(): NodeHandle {
    this.#assertUsable();
    if (this.failures.throwOnCreateNode) {
      throw new MirrorBackendViolation("injected failure: createNode");
    }
    const handle = this.#nextHandle++;
    this.#nodes.set(handle, {
      handle,
      parent: null,
      children: [],
      worldMatrix: IDENTITY,
      visible: true,
      layers: 1,
      renderOrder: 0,
      attachment: "none",
      light: null,
      geometry: null,
      material: null,
      camera: null,
    });
    this.#roots.push(handle);
    this.#counters.nodesCreated += 1;
    return handle as NodeHandle;
  }

  destroyNode(node: NodeHandle): void {
    this.#assertUsable();
    if (this.failures.throwOnDestroyNode) {
      throw new MirrorBackendViolation("injected failure: destroyNode");
    }
    const record = this.#requireNode(node, "destroyNode");

    // The backend does not cascade. Destroying a node with children would
    // orphan them, which is an ownership violation the reconciler must not
    // commit — so it is detected here rather than tolerated.
    if (record.children.length > 0) {
      throw new MirrorBackendViolation(
        `destroyNode(${node}) called while it still has ${record.children.length} ` +
          `child(ren). The reconciler must destroy depth-first.`,
      );
    }

    this.#detachFromParent(record);
    this.#nodes.delete(record.handle);
    this.#destroyedNodes.add(record.handle);
    this.#counters.nodesDestroyed += 1;
  }

  setParent(node: NodeHandle, parent: NodeHandle | null): void {
    this.#assertUsable();
    if (this.failures.throwOnSetParent) {
      throw new MirrorBackendViolation("injected failure: setParent");
    }
    const record = this.#requireNode(node, "setParent");
    const parentRecord =
      parent === null ? null : this.#requireNode(parent, "setParent(parent)");

    if (parentRecord !== null && this.#isDescendant(record, parentRecord)) {
      throw new MirrorBackendViolation(
        `setParent(${node}, ${parent}) would create a cycle`,
      );
    }

    this.#detachFromParent(record);
    if (parentRecord === null) {
      record.parent = null;
      this.#roots.push(record.handle);
    } else {
      record.parent = parentRecord.handle;
      parentRecord.children.push(record.handle);
    }
    this.#counters.writes += 1;
  }

  setWorldMatrix(node: NodeHandle, matrix: Mat4): void {
    const record = this.#requireNode(node, "setWorldMatrix");
    if (matrix.length !== 16) {
      throw new MirrorBackendViolation(
        `setWorldMatrix expects 16 elements, received ${matrix.length}`,
      );
    }
    record.worldMatrix = [...matrix];
    this.#counters.writes += 1;
  }

  setVisible(node: NodeHandle, visible: boolean): void {
    this.#requireNode(node, "setVisible").visible = visible;
    this.#counters.writes += 1;
  }

  setLayers(node: NodeHandle, mask: number): void {
    this.#requireNode(node, "setLayers").layers = mask;
    this.#counters.writes += 1;
  }

  setRenderOrder(node: NodeHandle, order: number): void {
    this.#requireNode(node, "setRenderOrder").renderOrder = order;
    this.#counters.writes += 1;
  }

  // -- Attachments ---------------------------------------------------------

  attachMesh(
    node: NodeHandle,
    geometry: GeometryHandle,
    material: MaterialHandle,
  ): void {
    const record = this.#requireNode(node, "attachMesh");
    if (!this.#geometries.has(geometry)) {
      throw new MirrorBackendViolation(`unknown geometry handle ${geometry}`);
    }
    if (!this.#materials.has(material)) {
      throw new MirrorBackendViolation(`unknown material handle ${material}`);
    }
    record.attachment = "mesh";
    record.geometry = geometry;
    record.material = material;
    record.camera = null;
    record.light = null;
    this.#counters.writes += 1;
  }

  attachLight(node: NodeHandle, light: LightHandle): void {
    const record = this.#requireNode(node, "attachLight");
    if (!this.#lights.has(light)) {
      throw new MirrorBackendViolation(`unknown light handle ${light}`);
    }
    record.attachment = "light";
    record.light = light;
    record.geometry = null;
    record.material = null;
    record.camera = null;
    this.#counters.writes += 1;
  }

  attachCamera(node: NodeHandle, camera: CameraHandle): void {
    const record = this.#requireNode(node, "attachCamera");
    if (!this.#cameras.has(camera)) {
      throw new MirrorBackendViolation(`unknown camera handle ${camera}`);
    }
    record.attachment = "camera";
    record.camera = camera;
    record.geometry = null;
    record.material = null;
    record.light = null;
    this.#counters.writes += 1;
  }

  detach(node: NodeHandle): void {
    const record = this.#requireNode(node, "detach");
    record.attachment = "none";
    record.geometry = null;
    record.material = null;
    record.camera = null;
    record.light = null;
    this.#counters.writes += 1;
  }

  // -- Resources -----------------------------------------------------------

  createGeometry(_d: GeometryDescriptor): BackendResult<GeometryHandle> {
    this.#assertUsable();
    if (this.failures.failCreateGeometry) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "geometry" },
      };
    }
    const handle = this.#nextHandle++;
    this.#geometries.add(handle);
    this.#counters.geometriesCreated += 1;
    return { ok: true, value: handle as GeometryHandle };
  }

  destroyGeometry(geometry: GeometryHandle): void {
    if (!this.#geometries.delete(geometry)) {
      throw new MirrorBackendViolation(
        `destroyGeometry(${geometry}) on an unknown or already-destroyed handle`,
      );
    }
    this.#counters.geometriesDestroyed += 1;
  }

  createTexture(_d: TextureDescriptor): BackendResult<TextureHandle> {
    this.#assertUsable();
    if (this.failures.failCreateTexture) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "texture" },
      };
    }
    const handle = this.#nextHandle++;
    this.#textures.add(handle);
    this.#counters.texturesCreated += 1;
    return { ok: true, value: handle as TextureHandle };
  }

  updateTexture(
    texture: TextureHandle,
    _region: { x: number; y: number; width: number; height: number },
    _pixels: Uint8Array,
  ): void {
    if (!this.#textures.has(texture)) {
      throw new MirrorBackendViolation(`unknown texture handle ${texture}`);
    }
    this.#counters.writes += 1;
  }

  destroyTexture(texture: TextureHandle): void {
    if (!this.#textures.delete(texture)) {
      throw new MirrorBackendViolation(
        `destroyTexture(${texture}) on an unknown or already-destroyed handle`,
      );
    }
    this.#counters.texturesDestroyed += 1;
  }

  createMaterial(
    descriptor: MaterialDescriptor,
  ): BackendResult<MaterialHandle> {
    this.#assertUsable();
    if (this.failures.failCreateMaterial) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "material" },
      };
    }
    const handle = this.#nextHandle++;
    this.#materials.set(handle, descriptor);
    this.#counters.materialsCreated += 1;
    return { ok: true, value: handle as MaterialHandle };
  }

  updateMaterial(
    material: MaterialHandle,
    descriptor: MaterialDescriptor,
  ): void {
    if (!this.#materials.has(material)) {
      throw new MirrorBackendViolation(`unknown material handle ${material}`);
    }
    this.#materials.set(material, descriptor);
    this.#counters.writes += 1;
  }

  destroyMaterial(material: MaterialHandle): void {
    if (!this.#materials.delete(material)) {
      throw new MirrorBackendViolation(
        `destroyMaterial(${material}) on an unknown or already-destroyed handle`,
      );
    }
    this.#counters.materialsDestroyed += 1;
  }

  createLight(descriptor: LightDescriptor): LightHandle {
    this.#assertUsable();
    const handle = this.#nextHandle++;
    this.#lights.set(handle, descriptor);
    this.#counters.lightsCreated += 1;
    return handle as LightHandle;
  }

  updateLight(light: LightHandle, descriptor: LightDescriptor): void {
    if (!this.#lights.has(light)) {
      throw new MirrorBackendViolation(`unknown light handle ${light}`);
    }
    this.#lights.set(light, descriptor);
    this.#counters.writes += 1;
  }

  destroyLight(light: LightHandle): void {
    if (!this.#lights.delete(light)) {
      throw new MirrorBackendViolation(
        `destroyLight(${light}) on an unknown or already-destroyed handle`,
      );
    }
    this.#counters.lightsDestroyed += 1;
  }

  /** The descriptor a light currently holds. Verification only. */
  lightDescriptor(light: LightHandle): LightDescriptor | undefined {
    return this.#lights.get(light);
  }

  createCamera(descriptor: CameraDescriptor): CameraHandle {
    this.#assertUsable();
    const handle = this.#nextHandle++;
    this.#cameras.set(handle, descriptor);
    this.#counters.camerasCreated += 1;
    return handle as CameraHandle;
  }

  updateCamera(camera: CameraHandle, descriptor: CameraDescriptor): void {
    if (!this.#cameras.has(camera)) {
      throw new MirrorBackendViolation(`unknown camera handle ${camera}`);
    }
    this.#cameras.set(camera, descriptor);
    this.#counters.writes += 1;
  }

  destroyCamera(camera: CameraHandle): void {
    if (!this.#cameras.delete(camera)) {
      throw new MirrorBackendViolation(
        `destroyCamera(${camera}) on an unknown or already-destroyed handle`,
      );
    }
    this.#counters.camerasDestroyed += 1;
  }

  createRenderTarget(_size: Vec2): BackendResult<RenderTargetHandle> {
    if (this.failures.failCreateRenderTarget) {
      return {
        ok: false,
        reason: { kind: "budget-exceeded", resourceClass: "renderTarget" },
      };
    }
    const handle = this.#nextHandle++;
    this.#renderTargets.add(handle);
    return { ok: true, value: handle as RenderTargetHandle };
  }

  destroyRenderTarget(target: RenderTargetHandle): void {
    if (!this.#renderTargets.delete(target)) {
      throw new MirrorBackendViolation(`unknown render target ${target}`);
    }
  }

  // -- Frame ---------------------------------------------------------------

  render(camera: CameraHandle, _options: RenderOptions): void {
    this.#assertUsable();
    if (!this.#cameras.has(camera)) {
      throw new MirrorBackendViolation(`render with unknown camera ${camera}`);
    }
    this.#counters.renderCalls += 1;
  }

  dispose(): void {
    this.#nodes.clear();
    this.#roots = [];
    this.#geometries.clear();
    this.#textures.clear();
    this.#materials.clear();
    this.#cameras.clear();
    this.#renderTargets.clear();
    this.#disposed = true;
  }

  // -- Inspection ----------------------------------------------------------

  snapshot(): MirrorSnapshot {
    const nodes: MirrorNodeSnapshot[] = [];

    const visit = (handle: number, path: string) => {
      const record = this.#nodes.get(handle)!;
      nodes.push({
        path,
        worldMatrix: record.worldMatrix,
        visible: record.visible,
        layers: record.layers,
        renderOrder: record.renderOrder,
        attachment: record.attachment,
      });
      record.children.forEach((child, index) => visit(child, `${path}/${index}`));
    };

    // Roots in creation order, so a snapshot is comparable across runs.
    this.#roots.forEach((root, index) => visit(root, `${index}`));

    return {
      nodes,
      resourceCounts: {
        geometries: this.#geometries.size,
        textures: this.#textures.size,
        materials: this.#materials.size,
        cameras: this.#cameras.size,
        renderTargets: this.#renderTargets.size,
      },
    };
  }

  stats(): MockBackendStats {
    return {
      ...this.#counters,
      liveNodes: this.#nodes.size,
    };
  }

  resetWriteCount(): void {
    this.#counters.writes = 0;
  }

  get writeCount(): number {
    return this.#counters.writes;
  }

  /** Live handles by class, for leak assertions. */
  liveHandles(): {
    nodes: number;
    geometries: number;
    textures: number;
    materials: number;
    cameras: number;
    renderTargets: number;
  } {
    return {
      nodes: this.#nodes.size,
      geometries: this.#geometries.size,
      textures: this.#textures.size,
      materials: this.#materials.size,
      cameras: this.#cameras.size,
      renderTargets: this.#renderTargets.size,
    };
  }

  // -- Internals -----------------------------------------------------------

  #assertUsable(): void {
    if (this.#disposed) {
      throw new MirrorBackendViolation("backend has been disposed");
    }
  }

  #requireNode(handle: NodeHandle, operation: string): MockNode {
    const record = this.#nodes.get(handle);
    if (record) return record;
    // Distinguishing these two makes a use-after-destroy immediately
    // diagnosable rather than a generic "unknown handle".
    if (this.#destroyedNodes.has(handle)) {
      throw new MirrorBackendViolation(
        `${operation}(${handle}) on a destroyed node — use after destroy`,
      );
    }
    throw new MirrorBackendViolation(
      `${operation}(${handle}) on a handle this backend never issued`,
    );
  }

  #detachFromParent(record: MockNode): void {
    if (record.parent === null) {
      const index = this.#roots.indexOf(record.handle);
      if (index !== -1) this.#roots.splice(index, 1);
      return;
    }
    const parent = this.#nodes.get(record.parent);
    if (parent) {
      const index = parent.children.indexOf(record.handle);
      if (index !== -1) parent.children.splice(index, 1);
    }
    record.parent = null;
  }

  #isDescendant(ancestor: MockNode, candidate: MockNode): boolean {
    let current: MockNode | undefined = candidate;
    while (current) {
      if (current.handle === ancestor.handle) return true;
      current =
        current.parent === null ? undefined : this.#nodes.get(current.parent);
    }
    return false;
  }
}
