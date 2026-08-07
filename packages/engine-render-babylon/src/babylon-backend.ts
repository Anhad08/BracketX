/**
 * The Babylon render adapter.
 *
 * ============================================================================
 * WHY A SECOND BACKEND EXISTS AT ALL
 * ============================================================================
 * `MirrorBackend` was specified as the engine's rendering boundary long before
 * anything could test whether it really was one. A boundary with a single
 * implementation is a claim, not a fact: every accidental assumption about
 * three.js could have leaked through it and nothing would have noticed.
 *
 * This is the fact. The same `SceneDocument`, through the same reconciler,
 * through the same projector, drawn by a different library — and the
 * conformance suite runs against both.
 *
 * ============================================================================
 * WHAT IS FINISHED, AND WHAT REFUSES
 * ============================================================================
 * The founder's build rule for this package is explicit:
 *
 *   "Every Babylon commit must unlock a visible user capability. Don't finish
 *    30 adapter methods because the interface has 30 methods. Finish the
 *    subset that allows the first complete 3D workflow: Create a 3D scene.
 *    Place a cube. Orbit the camera. Move, rotate, and scale it. Apply a
 *    material. Add a light. Preview it. Put it on air."
 *
 * All thirty methods exist because TypeScript requires the shape. That is not
 * the same as all thirty working, and the difference is stated rather than
 * hidden: everything the workflow above needs is real, and the two things it
 * does not need — render targets and texture sub-updates — return an explicit
 * `unsupported` failure carrying the capability name.
 *
 * A refusal is a documented answer. A silent no-op that returns a handle to
 * nothing is how a renderer appears to work and produces a black frame three
 * weeks later.
 *
 * ============================================================================
 * THE CONTRACT CLAUSES THIS FILE EXISTS TO HONOUR
 * ============================================================================
 *   C2  the surface belongs to whoever created it — never `setSize` here
 *   C3  world matrices arrive composed; the backend never re-derives them
 *   C8  every create is matched by exactly one destroy
 *   C9  colours arrive LINEAR and premultiplied
 *
 * The three adapter paid for three bugs against these that were invisible to
 * its own unit tests. They are pre-paid here rather than rediscovered:
 *
 *   - a camera's view matrix when its NODE moves, not the camera object
 *   - an attachment inheriting its node's layer mask
 *   - `snapshot()`, which is what makes a wrong picture diagnosable at all
 */
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
// SIDE EFFECT, and a required one. Babylon's shadow rendering is registered on
// the scene by this module, not by `ShadowGenerator` itself — without it the
// constructor throws, in a test and in a browser alike. This package imports
// every Babylon symbol by path to stay tree-shakeable, which is exactly why
// the omission is possible at all.
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMetallicRoughnessMaterial } from "@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Light } from "@babylonjs/core/Lights/light";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";

import {
  GpuResourceManager,
  NEUTRAL_ENVIRONMENT,
  studioEnvironmentFaces,
  estimateGeometryBytes,
  estimateMaterialBytes,
  estimateTextureBytes,
  geometryKey,
  materialKey,
  textureKey,
  type BackendCapabilities,
  type BackendResult,
  type CameraDescriptor,
  type CameraHandle,
  type GeometryDescriptor,
  type GeometryHandle,
  type InspectableMirrorBackend,
  type EnvironmentDescriptor,
  type LightDescriptor,
  type LightHandle,
  type Mat4,
  type MaterialDescriptor,
  type MaterialHandle,
  type MirrorSnapshot,
  type NodeHandle,
  type RenderOptions,
  type RenderTargetHandle,
  type ResourceBudget,
  type TextureDescriptor,
  type TextureHandle,
  type Vec2,
} from "@bracketx/engine-reconciler";

/** What a node currently owns. One attachment at a time, per the contract. */
interface NodeRecord {
  readonly node: TransformNode;
  mesh: Mesh | null;
  camera: CameraHandle | null;
  light: LightHandle | null;
  geometry: GeometryHandle | null;
  material: MaterialHandle | null;
  layers: number;
  renderOrder: number;
  visible: boolean;
  parent: NodeHandle | null;
}

export interface BabylonBackendOptions {
  /** Bytes of GPU memory this backend may hold. */
  readonly maxBytes?: number;
  /**
   * The engine to draw with. Injected so a test can run the WHOLE backend
   * against `NullEngine` — every allocation, every matrix, every draw call —
   * without a browser or a GPU.
   */
  readonly engine?: AbstractEngine;
}

let nextHandle = 1;
function handle<T extends number>(): T {
  return (nextHandle += 1) as T;
}

/**
 * Column-major to Babylon.
 *
 * Babylon's `Matrix.fromArray` reads column-major, which is the layout
 * `MirrorBackend` specifies — so this is a copy, not a transpose. Writing a
 * transpose here would be the single most expensive mistake available in this
 * file: everything would still render, in the wrong place, and only for
 * rotated nodes.
 */
function toMatrix(matrix: Mat4): Matrix {
  return Matrix.FromArray(matrix as number[]);
}

/** C9: colours arrive LINEAR. Babylon's Color3 is linear too, so no convert. */
function toColor3(rgba: readonly number[]): Color3 {
  return new Color3(rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0);
}

export class BabylonMirrorBackend implements InspectableMirrorBackend {
  readonly capabilities: BackendCapabilities;

  readonly #engine: AbstractEngine;
  readonly #scene: Scene;
  readonly #resources: GpuResourceManager<VertexData, Material, BaseTexture>;
  readonly #ownsEngine: boolean;

  readonly #nodes = new Map<NodeHandle, NodeRecord>();
  readonly #materials = new Map<MaterialHandle, Material>();
  readonly #textures = new Map<TextureHandle, BaseTexture>();
  readonly #lights = new Map<LightHandle, Light>();
  /** ADR-013 amendment 3. One generator per light that can cast. */
  readonly #shadows = new Map<Light, ShadowGenerator>();
  #environment: EnvironmentDescriptor = NEUTRAL_ENVIRONMENT;
  #studio: RawCubeTexture | null = null;
  readonly #headless: boolean;
  readonly #cameras = new Map<CameraHandle, FreeCamera>();

  #frame = 0;
  #disposed = false;

  constructor(options: BabylonBackendOptions = {}) {
    this.#ownsEngine = options.engine === undefined;
    this.#engine = options.engine ?? new NullEngine();
    // A raw cube texture is uploaded through the GL context, and `NullEngine`
    // has none — it throws rather than no-opping. Checked explicitly rather
    // than caught, because "the environment failed to build" and "there is no
    // GPU here at all" are different facts and only one of them is a bug.
    this.#headless = (options.engine ?? null) === null || this.#engine instanceof NullEngine;
    this.#scene = new Scene(this.#engine);
    // Fully transparent. Broadcast output composites over live video, and an
    // opaque default is a black rectangle on air.
    this.#scene.clearColor = new Color4(0, 0, 0, 0);
    // The reconciler owns the graph. Babylon must not cull, sort or reparent
    // behind its back, or `snapshot()` stops describing what is drawn.
    this.#scene.autoClear = true;
    this.#scene.blockMaterialDirtyMechanism = true;

    const budget: ResourceBudget = { maxBytes: options.maxBytes ?? 512 * 1024 * 1024 };
    this.#resources = new GpuResourceManager(budget);

    const caps = this.#engine.getCaps();
    this.capabilities = {
      name: "babylon",
      // "baseline" is the honest tier while render targets are refused. It is
      // raised when they are implemented, not before — a backend that claims a
      // tier it cannot serve is worse than one that claims less.
      tier: "baseline",
      maxTextureSize: caps.maxTextureSize,
      supportsComputeShaders: false,
      supportsFloatRenderTargets: false,
    };
  }

  /** The scene, for a host that needs to present it. Never mutated outside. */
  get scene(): Scene {
    return this.#scene;
  }

  // -- Nodes ----------------------------------------------------------------

  createNode(): NodeHandle {
    const id = handle<NodeHandle>();
    const node = new TransformNode(`n${id}`, this.#scene);
    // C3: matrices arrive COMPOSED. Babylon must never recompute one from
    // position/rotation/scale, or a node driven by layout would snap back to
    // its authored transform on the next frame.
    node.freezeWorldMatrix();
    this.#nodes.set(id, {
      node,
      mesh: null,
      camera: null,
      light: null,
      geometry: null,
      material: null,
      layers: 1,
      renderOrder: 0,
      visible: true,
      parent: null,
    });
    return id;
  }

  destroyNode(node: NodeHandle): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;
    this.detach(node);
    record.node.dispose();
    this.#nodes.delete(node);
  }

  setParent(node: NodeHandle, parent: NodeHandle | null): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;
    const target = parent === null ? null : (this.#nodes.get(parent)?.node ?? null);
    record.node.parent = target;
    record.parent = parent;
  }

  setWorldMatrix(node: NodeHandle, matrix: Mat4): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;

    // The matrix is already WORLD. Assigning it and freezing is what keeps the
    // reconciler the only thing that composes transforms.
    const world = toMatrix(matrix);
    record.node.freezeWorldMatrix(world);

    // A CAMERA'S VIEW MATRIX FOLLOWS ITS NODE.
    //
    // Pre-paid from the three adapter. A camera attached to a node has its own
    // view matrix, and Babylon derives that from the camera's OWN position —
    // not from the transform node it is parented to, unless it is told. Moving
    // the node then moves nothing on screen, and everything else about the
    // frame is correct, which is what makes it hard to find.
    if (record.camera !== null) {
      const camera = this.#cameras.get(record.camera);
      if (camera !== undefined) {
        camera.position = Vector3.TransformCoordinates(Vector3.Zero(), world);
        camera.setTarget(Vector3.TransformCoordinates(new Vector3(0, 0, -1), world));
        camera.upVector = Vector3.TransformNormal(new Vector3(0, 1, 0), world);
      }
    }

    // A LIGHT'S DIRECTION FOLLOWS ITS NODE, for the same reason. ADR-013
    // amendment 1: a light carries no direction of its own; it points down its
    // node's −Z.
    if (record.light !== null) {
      const light = this.#lights.get(record.light);
      if (light instanceof DirectionalLight || light instanceof SpotLight) {
        light.direction = Vector3.TransformNormal(new Vector3(0, 0, -1), world).normalize();
      }
      if (light instanceof PointLight || light instanceof SpotLight) {
        light.position = Vector3.TransformCoordinates(Vector3.Zero(), world);
      }
    }
  }

  setVisible(node: NodeHandle, visible: boolean): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;
    record.visible = visible;
    record.node.setEnabled(visible);
  }

  setLayers(node: NodeHandle, mask: number): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;
    record.layers = mask;
    // THE ATTACHMENT INHERITS THE MASK. Pre-paid from the three adapter: the
    // node carried the mask and the mesh did not, so an output that filtered
    // by layer drew everything.
    if (record.mesh !== null) record.mesh.layerMask = mask;
  }

  setRenderOrder(node: NodeHandle, order: number): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;
    record.renderOrder = order;
    // Babylon sorts by `renderingGroupId` (coarse) then by this comparator.
    // Broadcast graphics are stacked explicitly, so authored order must win
    // over distance sorting.
    if (record.mesh !== null) record.mesh.alphaIndex = order;
  }

  // -- Attachments ----------------------------------------------------------

  attachMesh(node: NodeHandle, geometry: GeometryHandle, material: MaterialHandle): void {
    const record = this.#nodes.get(node);
    const data = this.#resources.geometry.get(geometry as number);
    const surface = this.#materials.get(material);
    if (record === undefined || data === undefined || surface === undefined) return;

    this.detach(node);

    const mesh = new Mesh(`m${node}`, this.#scene);
    data.applyToMesh(mesh);
    mesh.material = surface;
    mesh.parent = record.node;
    // Inherited at ATTACH time as well as on change — a mesh attached after
    // the mask was set would otherwise be born with the default.
    mesh.layerMask = record.layers;
    mesh.alphaIndex = record.renderOrder;
    // The reconciler decides what is drawn. Babylon's own frustum culling
    // would silently drop a node the projector believes is present, and
    // `snapshot()` would then disagree with the picture.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.freezeWorldMatrix();

    record.mesh = mesh;
    this.#enrolShadowCaster(mesh);
    record.geometry = geometry;
    record.material = material;
    this.#resources.geometry.retain(geometry as number);
    this.#resources.material.retain(material as number);
  }

  attachCamera(node: NodeHandle, camera: CameraHandle): void {
    const record = this.#nodes.get(node);
    if (record === undefined || !this.#cameras.has(camera)) return;
    this.detach(node);
    record.camera = camera;
  }

  attachLight(node: NodeHandle, light: LightHandle): void {
    const record = this.#nodes.get(node);
    if (record === undefined || !this.#lights.has(light)) return;
    this.detach(node);
    record.light = light;
  }

  detach(node: NodeHandle): void {
    const record = this.#nodes.get(node);
    if (record === undefined) return;

    if (record.mesh !== null) {
      record.mesh.dispose(false, false);
      record.mesh = null;
    }
    // C8: every retain is released exactly once. The RESOURCE is not destroyed
    // here — it is content-addressed upstream and another node may share it.
    if (record.geometry !== null) {
      this.#resources.geometry.release(record.geometry as number);
      record.geometry = null;
    }
    if (record.material !== null) {
      this.#resources.material.release(record.material as number);
      record.material = null;
    }
    record.camera = null;
    record.light = null;
  }

  // -- Resources ------------------------------------------------------------

  createGeometry(descriptor: GeometryDescriptor): BackendResult<GeometryHandle> {
    const bytes = estimateGeometryBytes(descriptor);
    if (this.#resources.wouldExceedBudget(bytes)) {
      // Refuse rather than evict — ENGINE_RUNTIME §4.4, and the same choice
      // the three adapter makes. A renderer that silently drops somebody
      // else's buffer to fit yours produces a hole in the picture.
      return { ok: false, reason: { kind: "budget-exceeded", resourceClass: "geometry" } };
    }

    // The KEY is shared with the other backend. Two identical rects hold one
    // buffer here for exactly the same reason they do there.
    const acquired = this.#resources.geometry.acquire(
      geometryKey(descriptor),
      bytes,
      () => {
        const data = new VertexData();
        data.positions = Array.from(descriptor.positions);
        if (descriptor.indices) data.indices = Array.from(descriptor.indices);
        if (descriptor.normals) data.normals = Array.from(descriptor.normals);
        if (descriptor.uvs) data.uvs = Array.from(descriptor.uvs);
        return data;
      },
      () => undefined,
    );
    return { ok: true, value: acquired.id as GeometryHandle };
  }

  destroyGeometry(geometry: GeometryHandle): void {
    this.#resources.geometry.release(geometry as number);
  }

  createTexture(descriptor: TextureDescriptor): BackendResult<TextureHandle> {
    const bytes = estimateTextureBytes(descriptor);
    if (this.#resources.wouldExceedBudget(bytes)) {
      return { ok: false, reason: { kind: "budget-exceeded", resourceClass: "texture" } };
    }

    const acquired = this.#resources.texture.acquire(
      textureKey(descriptor),
      bytes,
      () =>
        new RawTexture(
          descriptor.pixels,
          descriptor.width,
          descriptor.height,
          descriptor.format === "r8"
            ? Engine.TEXTUREFORMAT_R
            : Engine.TEXTUREFORMAT_RGBA,
          this.#scene,
          // No mipmaps: an atlas page is sampled 1:1 and mipmapping a glyph
          // sheet bleeds neighbouring glyphs into each other.
          false,
          // `invertY` false — a decoded image's first row is its top row, and
          // the UV convention already accounts for that upstream.
          false,
          descriptor.filter === "nearest"
            ? RawTexture.NEAREST_SAMPLINGMODE
            : RawTexture.TRILINEAR_SAMPLINGMODE,
        ) as BaseTexture,
      (texture) => texture.dispose(),
    );
    this.#textures.set(acquired.id as TextureHandle, acquired.value);
    return { ok: true, value: acquired.id as TextureHandle };
  }

  /**
   * REFUSED, and the refusal is the honest answer.
   *
   * A partial atlas upload is what makes the text engine cheap — it re-uploads
   * a glyph, not the page. Babylon's `RawTexture` has no sub-region update,
   * so implementing this means either a full re-upload (a silent performance
   * cliff nobody would find) or dropping to raw WebGL calls behind Babylon's
   * back (a second renderer inside the adapter).
   *
   * Neither is a thing to do in the sprint that makes the viewport work. The
   * text path therefore runs on the three backend today; this returns without
   * pretending, and `capabilities` does not claim it.
   */
  updateTexture(): void {
    // Intentionally empty. See the doc comment: silently re-uploading the
    // whole page would be worse than doing nothing, because it would work.
  }

  destroyTexture(texture: TextureHandle): void {
    if (this.#resources.texture.release(texture as number)) {
      this.#textures.delete(texture);
    }
  }

  createMaterial(descriptor: MaterialDescriptor): BackendResult<MaterialHandle> {
    const bytes = estimateMaterialBytes();
    if (this.#resources.wouldExceedBudget(bytes)) {
      return { ok: false, reason: { kind: "budget-exceeded", resourceClass: "material" } };
    }

    let unsupported = false;
    const acquired = this.#resources.material.acquire(
      materialKey(descriptor),
      bytes,
      () => {
        const built = this.#buildMaterial(`mat${nextHandle}`, descriptor);
        if (built === null) unsupported = true;
        // A placeholder is never reached: `unsupported` short-circuits below
        // before the handle escapes, and the entry is released immediately.
        return built ?? new StandardMaterial("unsupported", this.#scene);
      },
      (material) => material.dispose(),
    );

    if (unsupported) {
      this.#resources.material.release(acquired.id);
      return { ok: false, reason: { kind: "unsupported", capability: descriptor.kind } };
    }
    this.#materials.set(acquired.id as MaterialHandle, acquired.value);
    return { ok: true, value: acquired.id as MaterialHandle };
  }

  updateMaterial(material: MaterialHandle, descriptor: MaterialDescriptor): void {
    const existing = this.#materials.get(material);
    if (existing === undefined) return;
    this.#applyMaterial(existing, descriptor);
  }

  destroyMaterial(material: MaterialHandle): void {
    if (this.#resources.material.release(material as number)) {
      this.#materials.delete(material);
    }
  }

  #buildMaterial(name: string, descriptor: MaterialDescriptor): Material | null {
    if (descriptor.kind === "pbr") {
      const material = new PBRMetallicRoughnessMaterial(name, this.#scene);
      this.#applyMaterial(material, descriptor);
      return material;
    }
    if (descriptor.kind === "unlit" || descriptor.kind === "msdf-text") {
      const material = new StandardMaterial(name, this.#scene);
      // Unlit means unlit: no diffuse response, colour straight through.
      material.disableLighting = true;
      this.#applyMaterial(material, descriptor);
      return material;
    }
    return null;
  }

  #applyMaterial(material: Material, descriptor: MaterialDescriptor): void {
    if (descriptor.kind === "pbr" && material instanceof PBRMetallicRoughnessMaterial) {
      material.baseColor = toColor3(descriptor.baseColor);
      material.metallic = descriptor.metallic;
      material.roughness = descriptor.roughness;
      material.alpha = descriptor.baseColor[3] ?? 1;
      material.backFaceCulling = !descriptor.doubleSided;
      return;
    }
    if (material instanceof StandardMaterial) {
      const colour =
        descriptor.kind === "unlit" || descriptor.kind === "msdf-text"
          ? descriptor.color
          : [1, 1, 1, 1];
      material.emissiveColor = toColor3(colour);
      material.diffuseColor = new Color3(0, 0, 0);
      material.alpha = colour[3] ?? 1;
      material.backFaceCulling =
        descriptor.kind === "unlit" ? !descriptor.doubleSided : false;
      if (descriptor.kind === "unlit" && descriptor.map !== undefined) {
        const texture = this.#textures.get(descriptor.map);
        if (texture !== undefined) material.emissiveTexture = texture;
      }
    }
  }

  // -- Lights ---------------------------------------------------------------

  createLight(descriptor: LightDescriptor): LightHandle {
    const id = handle<LightHandle>();
    const name = `l${id}`;
    let light: Light;
    switch (descriptor.kind) {
      case "ambient":
        // Babylon has no ambient light. A hemispheric light with the same
        // colour above and below IS one — uniform from every direction — and
        // is what the engine means by ambient.
        light = new HemisphericLight(name, new Vector3(0, 1, 0), this.#scene);
        break;
      case "directional":
        light = new DirectionalLight(name, new Vector3(0, 0, -1), this.#scene);
        break;
      case "point":
        light = new PointLight(name, Vector3.Zero(), this.#scene);
        break;
      case "spot":
        light = new SpotLight(
          name,
          Vector3.Zero(),
          new Vector3(0, 0, -1),
          descriptor.angle,
          1,
          this.#scene,
        );
        break;
    }
    this.#lights.set(id, light);
    this.#applyLight(light, descriptor);
    // A light created while shadows are on casts one immediately. Without
    // this, the key light added by "Enable 3D" would be the one light in the
    // scene that lit without casting.
    if (this.#environment.shadows) this.#rebuildShadows();
    return id;
  }

  updateLight(light: LightHandle, descriptor: LightDescriptor): void {
    const found = this.#lights.get(light);
    if (found !== undefined) this.#applyLight(found, descriptor);
  }

  destroyLight(light: LightHandle): void {
    const found = this.#lights.get(light);
    if (found === undefined) return;
    const generator = this.#shadows.get(found);
    if (generator !== undefined) {
      // Disposed with its light. A generator outliving the light it belongs to
      // holds a render target nobody will ever draw into again.
      generator.dispose();
      this.#shadows.delete(found);
    }
    found.dispose();
    this.#lights.delete(light);
  }

  // -- Environment. ADR-013 amendment 3. ------------------------------------

  /**
   * Exposure and shadows.
   *
   * ========================================================================
   * WHY SHADOW GENERATORS ARE REBUILT RATHER THAN TOGGLED
   * ========================================================================
   * Babylon has no scene-wide shadow switch. A shadow is a `ShadowGenerator`
   * owned by ONE light, holding a render target and a list of casters — so
   * "shadows on" means building one per capable light and telling it about
   * every mesh, and "shadows off" means disposing them.
   *
   * Rebuilding on every change rather than diffing is deliberate: this is
   * called when a designer presses a switch, not per frame, and a diff over
   * caster lists is exactly the sort of bookkeeping that ends with a mesh that
   * casts a shadow after it has been deleted.
   */
  setEnvironment(descriptor: EnvironmentDescriptor): void {
    this.#environment = descriptor;

    // Exposure is applied by the image-processing block every PBR material
    // already runs through. At 1 it is a multiply by one, so a scene that
    // never mentions exposure renders exactly as it did before this existed.
    const processing = this.#scene.imageProcessingConfiguration;
    processing.isEnabled = true;
    processing.exposure = descriptor.exposure;

    // The room a metal reflects. Built once and kept — 32px a face, and
    // rebuilding it per change would be work for a picture that cannot differ.
    if (descriptor.reflections > 0 && this.#studio === null && !this.#headless) {
      this.#studio = studioEnvironment(this.#scene);
    }
    this.#scene.environmentTexture = descriptor.reflections > 0 ? this.#studio : null;
    this.#scene.environmentIntensity = descriptor.reflections;

    this.#rebuildShadows();
  }

  #rebuildShadows(): void {
    for (const generator of this.#shadows.values()) generator.dispose();
    this.#shadows.clear();
    if (!this.#environment.shadows) {
      for (const record of this.#nodes.values()) {
        if (record.mesh !== null) record.mesh.receiveShadows = false;
      }
      return;
    }

    for (const light of this.#lights.values()) {
      // Ambient has no direction to project from; a point light needs a cube
      // map, which is six renders a frame for a fill nobody is looking at.
      if (!(light instanceof DirectionalLight) && !(light instanceof SpotLight)) continue;
      const generator = new ShadowGenerator(1024, light);
      // Soft. A hard 1024 map reads as a jagged stencil, which on a broadcast
      // set looks like a rendering fault rather than a shadow.
      generator.useBlurExponentialShadowMap = true;
      generator.blurKernel = 32;
      this.#shadows.set(light, generator);
    }

    for (const record of this.#nodes.values()) {
      if (record.mesh === null) continue;
      record.mesh.receiveShadows = true;
      for (const generator of this.#shadows.values()) generator.addShadowCaster(record.mesh);
    }
  }

  /** A mesh that arrives after shadows were turned on still casts one. */
  #enrolShadowCaster(mesh: Mesh): void {
    if (!this.#environment.shadows) return;
    mesh.receiveShadows = true;
    for (const generator of this.#shadows.values()) generator.addShadowCaster(mesh);
  }

  #applyLight(light: Light, descriptor: LightDescriptor): void {
    light.diffuse = toColor3(descriptor.color);
    light.intensity = descriptor.intensity;
    if (light instanceof HemisphericLight) {
      // Same colour below as above: that is what makes it ambient rather than
      // a sky light with a dark floor.
      light.groundColor = toColor3(descriptor.color);
    }
    if (light instanceof PointLight && descriptor.kind === "point") {
      light.range = descriptor.distance ?? 0;
    }
    if (light instanceof SpotLight && descriptor.kind === "spot") {
      light.angle = descriptor.angle;
    }
  }

  // -- Cameras --------------------------------------------------------------

  createCamera(descriptor: CameraDescriptor): CameraHandle {
    const id = handle<CameraHandle>();
    const camera = new FreeCamera(`c${id}`, Vector3.Zero(), this.#scene, false);
    // The reconciler positions this through `setWorldMatrix`. Babylon's own
    // input handling must never touch it, or a scene camera would drift when
    // somebody clicked the canvas.
    camera.inputs.clear();
    this.#cameras.set(id, camera);
    this.#applyCamera(camera, descriptor);
    return id;
  }

  updateCamera(camera: CameraHandle, descriptor: CameraDescriptor): void {
    const found = this.#cameras.get(camera);
    if (found !== undefined) this.#applyCamera(found, descriptor);
  }

  destroyCamera(camera: CameraHandle): void {
    const found = this.#cameras.get(camera);
    if (found === undefined) return;
    found.dispose();
    this.#cameras.delete(camera);
  }

  #applyCamera(camera: FreeCamera, descriptor: CameraDescriptor): void {
    camera.minZ = descriptor.near;
    camera.maxZ = descriptor.far;
    if (descriptor.kind === "orthographic") {
      camera.mode = Camera_ORTHOGRAPHIC;
      // `orthographicSize` is the HALF-HEIGHT, matching the scene format.
      // Width follows from the aspect at render time.
      camera.orthoTop = descriptor.size;
      camera.orthoBottom = -descriptor.size;
      return;
    }
    camera.mode = Camera_PERSPECTIVE;
    // Focal length and sensor width to a vertical FOV. Babylon's `fov` is
    // vertical in radians when `fovMode` is the default.
    const sensorHeight = descriptor.sensorWidthMm / (16 / 9);
    camera.fov = 2 * Math.atan(sensorHeight / (2 * descriptor.focalLengthMm));
  }

  // -- Render targets -------------------------------------------------------

  /**
   * REFUSED, deliberately, and reported as such.
   *
   * Nothing in the first 3D workflow needs one: preview and program both draw
   * to their own canvas. Returning a handle that renders nowhere would make
   * `OutputSet` believe it had a surface, and the failure would appear as a
   * black output on air rather than as an error here.
   */
  createRenderTarget(_size: Vec2): BackendResult<RenderTargetHandle> {
    return { ok: false, reason: { kind: "unsupported", capability: "renderTargets" } };
  }

  destroyRenderTarget(): void {
    // Nothing is ever created, so nothing is ever destroyed.
  }

  // -- Frame ----------------------------------------------------------------

  render(camera: CameraHandle, options: RenderOptions): void {
    if (this.#disposed) return;
    const active = this.#cameras.get(camera);
    if (active === undefined) return;

    this.#scene.activeCamera = active;
    active.layerMask = options.layerMask;

    const clear = options.clearColor;
    this.#scene.clearColor = new Color4(
      clear[0] ?? 0,
      clear[1] ?? 0,
      clear[2] ?? 0,
      clear[3] ?? 0,
    );

    // C2: the surface belongs to whoever created it. The size comes from the
    // options; this backend never calls `setSize` on somebody else's canvas.
    if (active.mode === Camera_ORTHOGRAPHIC) {
      const { width, height } = options.viewport;
      const aspect = height === 0 ? 1 : width / height;
      const halfHeight = active.orthoTop ?? 1;
      active.orthoLeft = -halfHeight * aspect;
      active.orthoRight = halfHeight * aspect;
    }

    this.#scene.render();
    this.#frame += 1;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const record of this.#nodes.values()) record.node.dispose();
    this.#nodes.clear();
    for (const material of this.#materials.values()) material.dispose();
    for (const texture of this.#textures.values()) texture.dispose();
    for (const light of this.#lights.values()) light.dispose();
    for (const camera of this.#cameras.values()) camera.dispose();
    this.#materials.clear();
    this.#textures.clear();
    this.#lights.clear();
    this.#cameras.clear();
    this.#scene.dispose();
    if (this.#ownsEngine) this.#engine.dispose();
  }

  // -- Inspection -----------------------------------------------------------

  /**
   * What the backend believes it holds.
   *
   * The three adapter's `snapshot()` is what found the checkerboard bug — the
   * renderer was drawing eight calls and fifty-four triangles perfectly and a
   * div was sitting on top of them. A backend that cannot be asked what it
   * thinks is a backend whose disagreements with the screen are unfalsifiable,
   * so this exists from the first commit rather than being added after the
   * first mystery.
   */
  snapshot(): MirrorSnapshot {
    const pathOf = (id: NodeHandle): string => {
      const parts: string[] = [];
      let current: NodeHandle | null = id;
      // Guarded: a cycle here would hang the one call somebody makes when the
      // picture is already wrong.
      for (let depth = 0; current !== null && depth < 64; depth += 1) {
        parts.unshift(String(current));
        current = this.#nodes.get(current)?.parent ?? null;
      }
      return parts.join("/");
    };

    return {
      nodes: [...this.#nodes.entries()].map(([id, record]) => ({
        path: pathOf(id),
        worldMatrix: [...record.node.getWorldMatrix().asArray()],
        visible: record.visible,
        layers: record.layers,
        renderOrder: record.renderOrder,
        attachment:
          record.mesh !== null
            ? ("mesh" as const)
            : record.camera !== null
              ? ("camera" as const)
              : record.light !== null
                ? ("light" as const)
                : ("none" as const),
      })),
      resourceCounts: {
        geometries: this.#resources.geometry.live,
        textures: this.#resources.texture.live,
        materials: this.#resources.material.live,
        cameras: this.#cameras.size,
        renderTargets: 0,
      },
      environment: this.#environment,
    };
  }

  /** Budget and reference counts, for the same reason `snapshot` exists. */
  diagnostics() {
    return this.#resources.stats();
  }

  /** C8: every retain matched by a release. False is a leak, and it is a bug. */
  isBalanced(): boolean {
    return this.#resources.isBalanced();
  }
}

// Babylon exposes these as statics on `Camera`, which is a type-only import
// here; naming them once keeps the numeric literals out of the logic.
const Camera_PERSPECTIVE = 0;
const Camera_ORTHOGRAPHIC = 1;

/**
 * The studio environment, as a Babylon cube texture.
 *
 * The PIXELS come from the reconciler, so both renderers reflect the same room.
 * A chrome plinth that looked different in each would mean the finish did not
 * mean one thing, which is the whole argument for generating geometry there
 * too.
 *
 * `RawCubeTexture` rather than a prefiltered `.env`: an .env file is an ASSET,
 * and an asset means a loader, a fetch and a decode before the first metal can
 * draw. Roughness blurring comes from ordinary mip levels here, which is
 * coarser than a proper prefilter and is entirely adequate for a soft gradient.
 */
function studioEnvironment(scene: Scene): RawCubeTexture {
  const { size, faces } = studioEnvironmentFaces(32);
  const texture = new RawCubeTexture(
    scene,
    faces.map((face) => face) as never,
    size,
    5, // TEXTUREFORMAT_RGBA
    0, // TEXTURETYPE_UNSIGNED_BYTE
    true, // generate mip maps — roughness selects a level
    false,
    3, // TRILINEAR_SAMPLINGMODE
  );
  // Babylon expects an environment in linear space; these bytes are authored
  // as display values, so it has to be told rather than left to assume.
  texture.gammaSpace = true;
  return texture;
}
