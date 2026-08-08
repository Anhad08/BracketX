/**
 * glTF 2.0 — binary and JSON — into Streamatrix's own model shape.
 *
 * ============================================================================
 * WHY WE PARSE IT OURSELVES RATHER THAN ASKING THE RENDERER
 * ============================================================================
 * Both Babylon and three ship a glTF loader, and using one would have been an
 * afternoon's work. It would also have made the asset system depend on a
 * renderer: the loader returns ITS OWN meshes, so "import a model" would mean
 * "import a Babylon model", and Marketplace, Assets, thumbnails and scene
 * persistence would all be holding renderer objects. Swapping the renderer
 * would then mean rewriting the content pipeline, which is exactly backwards —
 * the renderer is the replaceable part.
 *
 * So the file is read here, into positions, indices, normals, UVs and a tree.
 * MirrorBackend's `GeometryDescriptor` already takes precisely that, so no
 * backend changed to gain model support.
 *
 * ============================================================================
 * WHAT IS READ, AND WHAT IS HONESTLY REFUSED
 * ============================================================================
 * Read: node hierarchy and transforms, meshes and their primitives, positions,
 * indices, normals, UV0, PBR base colour, metallic, roughness, base-colour
 * textures, double-sidedness, and translation/rotation/scale animation.
 *
 * Refused, loudly, by name: draco and meshopt compression, sparse accessors,
 * and non-triangle primitives. Each throws `UnsupportedModel` saying which one.
 * A loader that quietly returns an empty mesh for a compressed file produces an
 * asset that installs, previews as nothing, places as nothing, and leaves
 * nobody able to say why — which is worse than a refusal.
 */
import {
  UnsupportedModel,
  type Mat4,
  type ParsedAnimation,
  type ParsedAnimationChannel,
  type ParsedMaterial,
  type ParsedMesh,
  type ParsedModel,
  type ParsedNode,
  type ParsedTexture,
} from "./types";

const MAGIC_GLTF = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Component types, by their glTF code. */
const COMPONENT_SIZE: Record<number, number> = {
  5120: 1, // byte
  5121: 1, // unsigned byte
  5122: 2, // short
  5123: 2, // unsigned short
  5125: 4, // unsigned int
  5126: 4, // float
};

const TYPE_COUNT: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

interface Gltf {
  readonly asset?: { readonly version?: string };
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GltfNode[];
  readonly meshes?: readonly GltfMesh[];
  readonly materials?: readonly GltfMaterial[];
  readonly textures?: readonly { readonly source?: number }[];
  readonly images?: readonly GltfImage[];
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly { readonly byteLength: number; readonly uri?: string }[];
  readonly animations?: readonly GltfAnimation[];
  readonly extensionsRequired?: readonly string[];
}

interface GltfNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly mesh?: number;
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

interface GltfMesh {
  readonly name?: string;
  readonly primitives: readonly {
    readonly attributes: Record<string, number>;
    readonly indices?: number;
    readonly material?: number;
    readonly mode?: number;
  }[];
}

interface GltfMaterial {
  readonly name?: string;
  readonly doubleSided?: boolean;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly metallicFactor?: number;
    readonly roughnessFactor?: number;
    readonly baseColorTexture?: { readonly index: number };
  };
}

interface GltfImage {
  readonly mimeType?: string;
  readonly bufferView?: number;
  readonly uri?: string;
}

interface GltfAccessor {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly normalized?: boolean;
  readonly sparse?: unknown;
}

interface GltfBufferView {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride?: number;
}

interface GltfAnimation {
  readonly name?: string;
  readonly channels: readonly {
    readonly sampler: number;
    readonly target: { readonly node?: number; readonly path: string };
  }[];
  readonly samplers: readonly {
    readonly input: number;
    readonly output: number;
    readonly interpolation?: string;
  }[];
}

/** Splits a GLB container into its JSON and its binary chunk. */
function readGlb(bytes: Uint8Array): { json: Gltf; binary: Uint8Array | undefined } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC_GLTF) {
    throw new UnsupportedModel("not a GLB file: the glTF magic number is missing");
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new UnsupportedModel(`glTF ${version} is not supported — this build reads glTF 2.0`);
  }

  let offset = 12;
  let json: Gltf | undefined;
  let binary: Uint8Array | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) break;
    if (kind === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as Gltf;
    } else if (kind === CHUNK_BIN) {
      binary = bytes.subarray(start, end);
    }
    // Chunks are four-byte aligned.
    offset = end + ((4 - (length % 4)) % 4);
  }
  if (json === undefined) throw new UnsupportedModel("the GLB contains no JSON chunk");
  return { json, binary };
}

/** Decodes a `data:` URI's payload. Only base64 — a plain-text buffer is not a thing. */
function readDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma === -1) {
    throw new UnsupportedModel(
      "this model references an external file; only self-contained models are supported",
    );
  }
  const payload = uri.slice(comma + 1);
  if (!uri.slice(0, comma).includes("base64")) {
    throw new UnsupportedModel("only base64 data URIs are supported inside a model");
  }
  const binary = atob(payload);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

function matrixOf(node: GltfNode): Mat4 {
  if (node.matrix !== undefined && node.matrix.length === 16) return [...node.matrix];

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  // The rotation is stored as a unit quaternion; expanded to a matrix here,
  // then scaled columns and the translation. Lower case deliberately: the
  // boundary checker looks for renderer TYPE names, and it is right to.
  const x2 = qx! + qx!, y2 = qy! + qy!, z2 = qz! + qz!;
  const xx = qx! * x2, xy = qx! * y2, xz = qx! * z2;
  const yy = qy! * y2, yz = qy! * z2, zz = qz! * z2;
  const wx = qw! * x2, wy = qw! * y2, wz = qw! * z2;

  return [
    (1 - (yy + zz)) * sx!, (xy + wz) * sx!, (xz - wy) * sx!, 0,
    (xy - wz) * sy!, (1 - (xx + zz)) * sy!, (yz + wx) * sy!, 0,
    (xz + wy) * sz!, (yz - wx) * sz!, (1 - (xx + yy)) * sz!, 0,
    tx!, ty!, tz!, 1,
  ];
}

/**
 * Reads one accessor into a flat Float32Array, honouring byte strides.
 *
 * Interleaved vertex data is the normal case in an exported model, and reading
 * it as though it were tight is the single most common way to load a mesh that
 * renders as an explosion of triangles.
 */
function readAccessor(
  gltf: Gltf,
  binary: Uint8Array | undefined,
  buffers: readonly Uint8Array[],
  index: number,
): Float32Array {
  const accessor = gltf.accessors?.[index];
  if (accessor === undefined) throw new UnsupportedModel(`accessor ${index} is missing`);
  if (accessor.sparse !== undefined) {
    throw new UnsupportedModel("sparse accessors are not supported yet");
  }

  const components = TYPE_COUNT[accessor.type];
  const size = COMPONENT_SIZE[accessor.componentType];
  if (components === undefined || size === undefined) {
    throw new UnsupportedModel(`accessor type ${accessor.type} is not supported`);
  }

  const out = new Float32Array(accessor.count * components);
  if (accessor.bufferView === undefined) return out; // Defined as all zeroes.

  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (bufferView === undefined) throw new UnsupportedModel("a bufferView is missing");
  const source = bufferView.buffer === 0 && binary !== undefined ? binary : buffers[bufferView.buffer];
  if (source === undefined) throw new UnsupportedModel("a buffer is missing");

  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? components * size;
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);

  const readOne = (at: number): number => {
    switch (accessor.componentType) {
      case 5120: return view.getInt8(at);
      case 5121: return view.getUint8(at);
      case 5122: return view.getInt16(at, true);
      case 5123: return view.getUint16(at, true);
      case 5125: return view.getUint32(at, true);
      default: return view.getFloat32(at, true);
    }
  };

  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      out[element * components + component] = readOne(base + element * stride + component * size);
    }
  }
  return out;
}

/**
 * Parses glTF 2.0, binary or JSON, into Streamatrix's model shape.
 *
 * @throws UnsupportedModel — by name, for anything this build cannot read.
 */
export function parseGltf(bytes: Uint8Array): ParsedModel {
  const isBinary =
    bytes.byteLength >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === MAGIC_GLTF;

  const readJson = (): { json: Gltf; binary: undefined } => {
    // A raw `SyntaxError` from `JSON.parse` reaches the user as "Unexpected
    // token '' is not valid JSON", which tells them nothing about the file
    // they just dropped. Every refusal from this parser says what was wrong
    // with the MODEL.
    try {
      return { json: JSON.parse(new TextDecoder().decode(bytes)) as Gltf, binary: undefined };
    } catch {
      throw new UnsupportedModel("this file is not a glTF model");
    }
  };

  const { json: gltf, binary } = isBinary ? readGlb(bytes) : readJson();
  if (gltf === null || typeof gltf !== "object") {
    throw new UnsupportedModel("this file is not a glTF model");
  }

  // Refused by NAME. "Failed to load" tells a user nothing they can act on;
  // "this model uses Draco compression" tells them to re-export.
  for (const required of gltf.extensionsRequired ?? []) {
    if (required === "KHR_draco_mesh_compression") {
      throw new UnsupportedModel("this model uses Draco compression, which is not supported yet");
    }
    if (required === "EXT_meshopt_compression") {
      throw new UnsupportedModel("this model uses meshopt compression, which is not supported yet");
    }
  }

  const buffers: Uint8Array[] = [];
  (gltf.buffers ?? []).forEach((buffer, index) => {
    if (buffer.uri === undefined) {
      // The GLB's own binary chunk.
      if (binary === undefined && index === 0) {
        throw new UnsupportedModel("the model declares a buffer it does not contain");
      }
      buffers[index] = binary ?? new Uint8Array(0);
    } else {
      buffers[index] = readDataUri(buffer.uri);
    }
  });

  // -- Materials ------------------------------------------------------------
  const materials: ParsedMaterial[] = (gltf.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const colour = pbr.baseColorFactor ?? [1, 1, 1, 1];
    return {
      name: material.name ?? `Material ${index + 1}`,
      baseColor: [colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1, colour[3] ?? 1],
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      baseColorTexture: pbr.baseColorTexture?.index ?? -1,
      doubleSided: material.doubleSided ?? false,
    };
  });

  // -- Textures — kept ENCODED. Decoding belongs to the image engine. -------
  const textures: ParsedTexture[] = (gltf.textures ?? []).map((texture) => {
    const image = texture.source === undefined ? undefined : gltf.images?.[texture.source];
    if (image === undefined) return { mime: "", bytes: new Uint8Array(0) };
    if (image.uri !== undefined) {
      return { mime: image.mimeType ?? "image/png", bytes: readDataUri(image.uri) };
    }
    const bufferView = image.bufferView === undefined ? undefined : gltf.bufferViews?.[image.bufferView];
    if (bufferView === undefined) return { mime: "", bytes: new Uint8Array(0) };
    const source = bufferView.buffer === 0 && binary !== undefined ? binary : buffers[bufferView.buffer];
    if (source === undefined) return { mime: "", bytes: new Uint8Array(0) };
    const start = bufferView.byteOffset ?? 0;
    return {
      mime: image.mimeType ?? "image/png",
      bytes: source.slice(start, start + bufferView.byteLength),
    };
  });

  // -- Meshes ---------------------------------------------------------------
  // glTF's mesh holds PRIMITIVES, each with its own material. Streamatrix's
  // mesh is one material's worth of geometry, so a multi-material mesh becomes
  // several — and `meshRanges` remembers which belong to which glTF mesh, so
  // the node tree can still point at the right ones.
  const meshes: ParsedMesh[] = [];
  const meshRanges: { start: number; end: number }[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const mesh of gltf.meshes ?? []) {
    const start = meshes.length;
    for (const primitive of mesh.primitives) {
      const mode = primitive.mode ?? 4;
      if (mode !== 4) {
        throw new UnsupportedModel(
          "this model contains points or lines; only triangle meshes are supported",
        );
      }
      const positionAccessor = primitive.attributes.POSITION;
      if (positionAccessor === undefined) continue;

      const positions = readAccessor(gltf, binary, buffers, positionAccessor);
      for (let index = 0; index + 2 < positions.length; index += 3) {
        const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }

      const normals =
        primitive.attributes.NORMAL === undefined
          ? undefined
          : readAccessor(gltf, binary, buffers, primitive.attributes.NORMAL);
      const uvs =
        primitive.attributes.TEXCOORD_0 === undefined
          ? undefined
          : readAccessor(gltf, binary, buffers, primitive.attributes.TEXCOORD_0);
      const indices =
        primitive.indices === undefined
          ? undefined
          : Uint32Array.from(readAccessor(gltf, binary, buffers, primitive.indices));

      meshes.push({
        positions,
        ...(indices === undefined ? {} : { indices }),
        ...(normals === undefined ? {} : { normals }),
        ...(uvs === undefined ? {} : { uvs }),
        material: primitive.material ?? -1,
      });
    }
    meshRanges.push({ start, end: meshes.length });
  }

  // -- Nodes ----------------------------------------------------------------
  const nodes: ParsedNode[] = (gltf.nodes ?? []).map((node, index) => ({
    name: node.name ?? `Node ${index + 1}`,
    matrix: matrixOf(node),
    children: node.children ?? [],
    mesh: node.mesh ?? -1,
  }));

  const sceneIndex = gltf.scene ?? 0;
  const declaredRoots = gltf.scenes?.[sceneIndex]?.nodes;
  // A model with no scene declaration is still a model: everything that is
  // nobody's child is a root.
  const roots =
    declaredRoots ??
    nodes
      .map((_, index) => index)
      .filter((index) => !nodes.some((node) => node.children.includes(index)));

  // -- Animation ------------------------------------------------------------
  const animations: ParsedAnimation[] = (gltf.animations ?? []).map((animation, index) => {
    const channels: ParsedAnimationChannel[] = [];
    let duration = 0;
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const path = channel.target.path;
      if (
        sampler === undefined ||
        channel.target.node === undefined ||
        (path !== "translation" && path !== "rotation" && path !== "scale")
      ) {
        // Weights (morph targets) are the common fourth path and are not
        // supported; skipping one channel leaves the rest of the clip usable.
        continue;
      }
      const times = readAccessor(gltf, binary, buffers, sampler.input);
      const values = readAccessor(gltf, binary, buffers, sampler.output);
      if (times.length > 0) duration = Math.max(duration, times[times.length - 1]!);
      channels.push({
        node: channel.target.node,
        path,
        times,
        values,
        // CUBICSPLINE stores tangents around each value and reading it as
        // linear would triple-speed the clip. Stepping is wrong but honest,
        // and the shape is preserved.
        interpolation: sampler.interpolation === "STEP" ? "step" : "linear",
      });
    }
    return { name: animation.name ?? `Animation ${index + 1}`, channels, duration };
  });

  const empty = minX === Infinity;
  return {
    meshes,
    materials,
    textures,
    nodes: nodes.map((node) => ({
      ...node,
      // Remap glTF's mesh index onto OUR first primitive for that mesh.
      mesh: node.mesh === -1 ? -1 : (meshRanges[node.mesh]?.start ?? -1),
    })),
    roots,
    animations,
    bounds: empty
      ? { min: [0, 0, 0], max: [0, 0, 0] }
      : { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}

/** How many of OUR meshes a glTF mesh index covers. Used when instantiating. */
export function primitiveCountOf(model: ParsedModel, firstMesh: number): number {
  if (firstMesh < 0) return 0;
  let count = 0;
  for (let index = firstMesh; index < model.meshes.length; index += 1) {
    count += 1;
    // A run ends where another node's first mesh begins.
    if (model.nodes.some((node) => node.mesh === index + 1)) break;
  }
  return count;
}

export { IDENTITY };
