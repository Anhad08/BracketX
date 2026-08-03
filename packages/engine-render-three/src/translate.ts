/**
 * Descriptor → Three.js translation. Phases 2.5e, 2.5f, 2.5g.
 *
 * ============================================================================
 * ONE-WAY, AND DETERMINISTIC
 * ============================================================================
 * Every function here maps a MirrorBackend descriptor to a Three.js object.
 * Nothing reads back. No scene-graph concept appears — no node, no document,
 * no variable, no binding. The descriptors arrive fully resolved
 * (MirrorBackend header, "why it takes resolved values"), so translation is a
 * pure function and identical descriptors always produce identical objects.
 *
 * That determinism is what makes content addressing sound: if translation
 * varied, two identical descriptors could yield different GPU objects and the
 * cache would be wrong.
 */
import {
  AmbientLight,
  DataTexture,
  DirectionalLight,
  Light,
  Matrix4,
  Object3D,
  PointLight,
  SpotLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector2,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  RedFormat,
  Texture,
  UnsignedByteType,
} from "three";

import type {
  LightDescriptor,
  CameraDescriptor,
  GeometryDescriptor,
  MaterialDescriptor,
  Rgba,
  TextureDescriptor,
} from "@bracketx/engine-reconciler";

import { hashBytes, hashString } from "./resources";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Content key for a geometry descriptor.
 *
 * Hashes every attribute buffer, not just lengths — see hashBytes.
 */
export function geometryKey(descriptor: GeometryDescriptor): string {
  let hash = hashString("geom");
  hash = hashBytes(descriptor.positions, hash);
  if (descriptor.indices) hash = hashBytes(descriptor.indices, hash);
  if (descriptor.normals) hash = hashBytes(descriptor.normals, hash);
  if (descriptor.uvs) hash = hashBytes(descriptor.uvs, hash);
  if (descriptor.colors) hash = hashBytes(descriptor.colors, hash);
  // Length is folded in so two buffers that hash equally but differ in size
  // cannot collide.
  return `g:${hash.toString(16)}:${descriptor.positions.length}:${
    descriptor.indices?.length ?? 0
  }`;
}

export function estimateGeometryBytes(descriptor: GeometryDescriptor): number {
  return (
    descriptor.positions.byteLength +
    (descriptor.indices?.byteLength ?? 0) +
    (descriptor.normals?.byteLength ?? 0) +
    (descriptor.uvs?.byteLength ?? 0) +
    (descriptor.colors?.byteLength ?? 0)
  );
}

export function createGeometry(descriptor: GeometryDescriptor): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(descriptor.positions, 3),
  );
  if (descriptor.indices) {
    geometry.setIndex(new BufferAttribute(descriptor.indices, 1));
  }
  if (descriptor.normals) {
    geometry.setAttribute("normal", new BufferAttribute(descriptor.normals, 3));
  }
  if (descriptor.uvs) {
    geometry.setAttribute("uv", new BufferAttribute(descriptor.uvs, 2));
  }
  if (descriptor.colors) {
    geometry.setAttribute("color", new BufferAttribute(descriptor.colors, 4));
  }
  // Culling needs bounds, and computing them lazily would make the first
  // frame more expensive than every other — the wrong frame to pay on.
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Built-in geometry — Phase 2.5f
// ---------------------------------------------------------------------------

/** Unit quad on the XY plane, centred, facing +Z. The 2D workhorse. */
export function quadGeometry(width = 1, height = 1): GeometryDescriptor {
  const hw = width / 2;
  const hh = height / 2;
  return {
    positions: new Float32Array([
      -hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/** Ground plane on XZ, facing +Y. */
export function planeGeometry(width = 1, depth = 1): GeometryDescriptor {
  const hw = width / 2;
  const hd = depth / 2;
  return {
    positions: new Float32Array([
      -hw, 0, hd, hw, 0, hd, hw, 0, -hd, -hw, 0, -hd,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/** Axis-aligned unit cube, 24 vertices so each face has its own normal. */
export function cubeGeometry(size = 1): GeometryDescriptor {
  const h = size / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // +X, -X, +Y, -Y, +Z, -Z as (normal, tangent, bitangent) triples.
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];

  faces.forEach(([normal, tangent, bitangent], faceIndex) => {
    const base = faceIndex * 4;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      positions.push(
        (normal[0]! + tangent[0]! * u + bitangent[0]! * v) * h,
        (normal[1]! + tangent[1]! * u + bitangent[1]! * v) * h,
        (normal[2]! + tangent[2]! * u + bitangent[2]! * v) * h,
      );
      normals.push(normal[0]!, normal[1]!, normal[2]!);
      uvs.push((u + 1) / 2, (v + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

// ---------------------------------------------------------------------------
// Materials — Phase 2.5e
// ---------------------------------------------------------------------------

export function materialKey(descriptor: MaterialDescriptor): string {
  // Descriptors are plain data with a fixed shape, so a stable stringify is a
  // sound content key and far cheaper than hashing buffers.
  switch (descriptor.kind) {
    case "unlit":
      return `m:unlit:${rgbaKey(descriptor.color)}:${descriptor.map ?? "-"}:${
        descriptor.transparent ? 1 : 0
      }:${descriptor.doubleSided ? 1 : 0}`;
    case "msdf-text":
      return `m:msdf:${rgbaKey(descriptor.color)}:${descriptor.atlas}:${descriptor.pxRange}`;
    case "pbr":
      return `m:pbr:${rgbaKey(descriptor.baseColor)}:${descriptor.metallic}:${
        descriptor.roughness
      }:${descriptor.baseColorMap ?? "-"}:${descriptor.transparent ? 1 : 0}:${
        descriptor.doubleSided ? 1 : 0
      }`;
  }
}

function rgbaKey(color: Rgba): string {
  return color.map((c) => c.toFixed(4)).join(",");
}

/** Materials cost little GPU memory; the shader program dominates and is shared. */
export function estimateMaterialBytes(): number {
  return 512;
}

export interface MaterialOptions {
  /** Debug wireframe. Never enabled for on-air output. */
  readonly wireframe?: boolean;
  readonly resolveTexture?: (handle: number) => Texture | undefined;
}

export function createMaterial(
  descriptor: MaterialDescriptor,
  options: MaterialOptions = {},
): Material {
  switch (descriptor.kind) {
    case "unlit": {
      // Unlit is the broadcast default, not a fallback: graphics composited
      // over live video must not react to scene lighting.
      const material = new MeshBasicMaterial({
        color: colorOf(descriptor.color),
        opacity: descriptor.color[3],
        transparent: descriptor.transparent,
        side: descriptor.doubleSided ? DoubleSide : FrontSide,
        wireframe: options.wireframe ?? false,
      });
      applyMap(material, descriptor.map, options);
      // RFC-003 §6: premultiplied alpha throughout, converted at output only.
      material.premultipliedAlpha = true;
      return material;
    }

    case "msdf-text": {
      // The real MSDF shader. Phase 3B replaced the placeholder that stood here
      // since Phase 2.5e — it sampled the distance field as a COLOUR map, which
      // drew text as three-channel noise. Deliberately visually-wrong rather
      // than silently-wrong, and this is the phase that was waiting for.
      const atlas = options.resolveTexture?.(descriptor.atlas);
      // `Texture.image` is `any` in three's types, so the dimensions are read
      // defensively. Guessing 2048 would put the wrong texel size into the
      // shader and blur every glyph by a constant factor — visible, and the
      // kind of wrongness that gets blamed on the font.
      const image = atlas?.image as { width?: number; height?: number } | undefined;
      const width = typeof image?.width === "number" ? image.width : 2048;
      const height = typeof image?.height === "number" ? image.height : 2048;

      const material = new ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlas ?? null },
          uColor: { value: colorOf(descriptor.color) },
          uOpacity: { value: descriptor.color[3] },
          uPxRange: { value: descriptor.pxRange },
          uAtlasSize: { value: new Vector2(width, height) },
        },
        vertexShader: MSDF_VERTEX,
        fragmentShader: MSDF_FRAGMENT,
        transparent: true,
        // Text sits over other graphics and over itself — adjacent glyph quads
        // overlap where letters kern tightly. Writing depth would make one
        // glyph punch a hole in its neighbour's antialiased edge.
        depthWrite: false,
        side: DoubleSide,
      });
      material.premultipliedAlpha = true;
      material.userData.msdfPxRange = descriptor.pxRange;
      return material;
    }

    case "pbr": {
      const material = new MeshStandardMaterial({
        color: colorOf(descriptor.baseColor),
        opacity: descriptor.baseColor[3],
        metalness: descriptor.metallic,
        roughness: descriptor.roughness,
        transparent: descriptor.transparent,
        side: descriptor.doubleSided ? DoubleSide : FrontSide,
        wireframe: options.wireframe ?? false,
      });
      applyMap(material, descriptor.baseColorMap, options);
      material.premultipliedAlpha = true;
      return material;
    }
  }
}

/**
 * MSDF shaders. TEXT_ENGINE §4.
 *
 * ========================================================================
 * WHY THE MEDIAN, AND WHY THE SCREEN-SPACE RANGE
 * ========================================================================
 * The three channels each carry the distance to a different subset of the
 * glyph's edges, coloured so that two edges meeting at a corner share exactly
 * one channel. Taking the MEDIAN reconstructs the true distance right up to the
 * corner point — which is the entire reason this is multi-channel rather than
 * a plain SDF, and the reason a sharp serif stays sharp.
 *
 * `screenPxRange` converts the field's texel range into SCREEN pixels using
 * the UV derivatives. Without it the antialiasing width is fixed in texture
 * space, so text is crisp at one scale and either blurry or aliased at every
 * other — and broadcast graphics animate their scale constantly.
 */
const MSDF_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MSDF_FRAGMENT = `
uniform sampler2D uAtlas;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPxRange;
uniform vec2 uAtlasSize;
varying vec2 vUv;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  vec3 field = texture2D(uAtlas, vUv).rgb;
  float distance = median(field.r, field.g, field.b);

  // Texels per screen pixel, from the UV derivatives.
  vec2 unitRange = vec2(uPxRange) / uAtlasSize;
  vec2 screenTexSize = vec2(1.0) / max(fwidth(vUv), vec2(1e-6));
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);

  float alpha = clamp((distance - 0.5) * screenPxRange + 0.5, 0.0, 1.0) * uOpacity;
  // Fully-transparent fragments are discarded rather than blended: a glyph quad
  // is mostly empty, and blending its empty half against everything behind it
  // is wasted bandwidth on every frame.
  if (alpha < 0.004) discard;

  // RFC-003 §6: premultiplied throughout, converted at output only.
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

function applyMap(
  material: MeshBasicMaterial | MeshStandardMaterial,
  handle: number | undefined,
  options: MaterialOptions,
): void {
  if (handle === undefined || !options.resolveTexture) return;
  const texture = options.resolveTexture(handle);
  if (texture) material.map = texture;
}

function colorOf(rgba: Rgba): Color {
  // Alpha is carried separately on the material; Color holds RGB only.
  return new Color(rgba[0], rgba[1], rgba[2]);
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

export function textureKey(descriptor: TextureDescriptor): string {
  const hash = hashBytes(descriptor.pixels, hashString("tex"));
  return `t:${hash.toString(16)}:${descriptor.width}x${descriptor.height}:${
    descriptor.format
  }:${descriptor.filter}`;
}

export function estimateTextureBytes(descriptor: TextureDescriptor): number {
  const bytesPerPixel = descriptor.format === "rgba8" ? 4 : 1;
  // No mip allowance: MSDF atlases and UI textures are unmipped, and adding a
  // 1.33x factor everywhere would overstate the budget for the common case.
  return descriptor.width * descriptor.height * bytesPerPixel;
}

export function createTexture(descriptor: TextureDescriptor): Texture {
  // `DataTexture`, not `Texture`.
  //
  // A plain `Texture` holding `{ data, width, height }` looks right and uploads
  // wrong: three dispatches on `isDataTexture` to decide whether it is handing
  // the driver a typed array or an image, and without the flag it takes the
  // image path and the call is rejected outright —
  //
  //   THREE.WebGLState: TypeError: Failed to execute 'texSubImage2D' ...
  //   Overload resolution failed.
  //
  // Dormant since Phase 2.5e because nothing in the engine produced a texture
  // until the glyph atlas did. Found the first time text was rendered in a
  // browser; the headless conformance suite cannot see it, because
  // `MockMirrorBackend` has no driver to reject anything.
  const texture = new DataTexture(
    descriptor.pixels,
    descriptor.width,
    descriptor.height,
  );
  texture.format = descriptor.format === "rgba8" ? RGBAFormat : RedFormat;
  texture.type = UnsignedByteType;
  // Nearest for atlases: filtering across glyph boundaries bleeds neighbouring
  // glyphs into each other (MirrorBackend TextureDescriptor).
  texture.magFilter =
    descriptor.filter === "nearest" ? NearestFilter : LinearFilter;

  // ADR-013 Amendment 2. Both default to today's behaviour, so the MSDF atlas —
  // which passes neither — is bit-identical to before the amendment.
  //
  // Minification is the filter that matters here. A 512px sponsor mark drawn
  // into a 1.4-unit box is minified about 3x, and without a mip chain every
  // animated frame samples a different aliased subset, so the logo crawls. It
  // is most visible on exactly what broadcast graphics are made of — thin
  // strokes, small type, high-contrast edges — and invisible in a still.
  if (descriptor.mipmaps === true) {
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
  } else {
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter;
  }

  // three clamps this against `capabilities.getMaxAnisotropy()` when it
  // uploads, so the descriptor states an intent and the driver states the
  // ceiling. Honouring less than was asked for is legal because C8 excludes
  // pixels from determinism.
  if (descriptor.anisotropy !== undefined && descriptor.anisotropy > 1) {
    texture.anisotropy = descriptor.anisotropy;
  }

  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Cameras — Phase 2.5g
// ---------------------------------------------------------------------------

/**
 * Vertical FOV from focal length and sensor width.
 *
 * SCENE_FORMAT §8 stores lenses because operators think in millimetres. The
 * conversion lives here, in exactly one place, so every backend derives the
 * same value rather than each inventing its own.
 */
export function verticalFovDegrees(
  focalLengthMm: number,
  sensorWidthMm: number,
  aspect: number,
): number {
  const sensorHeight = sensorWidthMm / aspect;
  return (2 * Math.atan(sensorHeight / (2 * focalLengthMm) ) * 180) / Math.PI;
}

export function createCamera(
  descriptor: CameraDescriptor,
  aspect: number,
): PerspectiveCamera | OrthographicCamera {
  if (descriptor.kind === "orthographic") {
    const halfHeight = descriptor.size;
    const halfWidth = halfHeight * aspect;
    const camera = new OrthographicCamera(
      -halfWidth,
      halfWidth,
      halfHeight,
      -halfHeight,
      descriptor.near,
      descriptor.far,
    );
    disableAutoMatrix(camera);
    camera.updateProjectionMatrix();
    return camera;
  }

  const camera = new PerspectiveCamera(
    verticalFovDegrees(
      descriptor.focalLengthMm,
      descriptor.sensorWidthMm,
      aspect,
    ),
    aspect,
    descriptor.near,
    descriptor.far,
  );
  disableAutoMatrix(camera);
  camera.updateProjectionMatrix();
  return camera;
}

export function updateCameraProjection(
  camera: PerspectiveCamera | OrthographicCamera,
  descriptor: CameraDescriptor,
  aspect: number,
): void {
  if (descriptor.kind === "orthographic") {
    const ortho = camera as OrthographicCamera;
    const halfHeight = descriptor.size;
    const halfWidth = halfHeight * aspect;
    ortho.left = -halfWidth;
    ortho.right = halfWidth;
    ortho.top = halfHeight;
    ortho.bottom = -halfHeight;
    ortho.near = descriptor.near;
    ortho.far = descriptor.far;
    ortho.updateProjectionMatrix();
    return;
  }

  const perspective = camera as PerspectiveCamera;
  perspective.fov = verticalFovDegrees(
    descriptor.focalLengthMm,
    descriptor.sensorWidthMm,
    aspect,
  );
  perspective.aspect = aspect;
  perspective.near = descriptor.near;
  perspective.far = descriptor.far;
  perspective.updateProjectionMatrix();
}

/**
 * Turns off Three's own matrix maintenance.
 *
 * ENGINE_RECONCILIATION §1.6 requires the mirror to be a pure derivation of
 * the document. If Three recomputes matrices by traversing, the mirror holds
 * transform state the engine did not write, and the determinism boundary
 * (ARCHITECTURE_VERIFICATION D6) widens instead of closing.
 *
 * Both flags matter: `matrixAutoUpdate` governs local composition from
 * position/quaternion/scale, `matrixWorldAutoUpdate` governs whether a parent's
 * traversal recomputes this object's world matrix.
 */
export function disableAutoMatrix(object: {
  matrixAutoUpdate: boolean;
  matrixWorldAutoUpdate: boolean;
}): void {
  object.matrixAutoUpdate = false;
  object.matrixWorldAutoUpdate = false;
}

// ---------------------------------------------------------------------------
// Lights — ADR-013 amendment 1 (IF-002)
// ---------------------------------------------------------------------------

/**
 * A Three light from a descriptor.
 *
 * The descriptor carries NO position and NO direction, and neither does
 * anything here. Placement is the node's world matrix, which the engine
 * computed; orientation is local -Z, expressed through a target object the
 * backend places by composing that same matrix with a constant offset.
 *
 * Colours arrive linear and premultiplied (C9). Three wants an unpremultiplied
 * linear colour and a separate intensity, so alpha is divided back out here —
 * a light with alpha is not a concept, but the contract says premultiplied and
 * a silent mismatch would darken every light by its own alpha.
 */
export function createLight(
  descriptor: LightDescriptor,
): { object: Light; target: Object3D | null } {
  const object = ((): Light => {
    switch (descriptor.kind) {
      case "ambient":
        return new AmbientLight();
      case "directional":
        return new DirectionalLight();
      case "point":
        return new PointLight();
      case "spot":
      default:
        return new SpotLight();
    }
  })();

  applyLight(object, descriptor);
  const target =
    descriptor.kind === "directional" || descriptor.kind === "spot"
      ? (() => {
          const node = new Object3D();
          node.position.set(0, 0, -1);
          (object as DirectionalLight | SpotLight).target = node;
          return node;
        })()
      : null;

  return { object, target };
}

/** Updates a light in place. Idempotent, per C4. */
export function applyLight(light: Light, descriptor: LightDescriptor): void {
  const alpha = descriptor.color[3];
  const scale = alpha > 0 ? 1 / alpha : 1;
  light.color.setRGB(
    descriptor.color[0] * scale,
    descriptor.color[1] * scale,
    descriptor.color[2] * scale,
  );
  light.intensity = descriptor.intensity;

  if (descriptor.kind === "point" || descriptor.kind === "spot") {
    const positional = light as PointLight | SpotLight;
    positional.distance = descriptor.distance;
    positional.decay = descriptor.decay;
  }
  if (descriptor.kind === "spot") {
    const spot = light as SpotLight;
    spot.angle = descriptor.angle;
    spot.penumbra = descriptor.penumbra;
  }
}

/** One unit down local -Z. What "a light points forward" means, as a matrix. */
export const LIGHT_TARGET_OFFSET = new Matrix4().makeTranslation(0, 0, -1);
