/**
 * What a model IS, once Streamatrix has read it.
 *
 * ============================================================================
 * THIS SHAPE IS THE WHOLE ARCHITECTURAL POINT
 * ============================================================================
 * A `ParsedModel` is vertex data, a tree, and material intent. It contains no
 * renderer type, no file-format type, and no handle. That is what lets the
 * same parsed asset be drawn by three or by Babylon without either of them
 * learning what glTF is, and what lets Marketplace and Assets deal in models
 * without importing a renderer.
 *
 * `ParsedMesh` is deliberately the same shape MirrorBackend's
 * `GeometryDescriptor` already takes — positions, indices, normals, uvs. The
 * backend needed no change to draw an imported model, which is the strongest
 * evidence available that the boundary was drawn in the right place.
 *
 * ============================================================================
 * HIERARCHY IS PRESERVED, NOT FLATTENED
 * ============================================================================
 * A stadium arrives as a set with parts. Flattening it to one mesh would make
 * it a prop you cannot open: no selecting the sponsor board, no animating the
 * roof, no hiding the crowd. `ParsedNode` keeps the file's own tree so that
 * instantiation can put REAL Scene Tree nodes in the document — one per part,
 * each selectable, transformable and animatable like anything else a designer
 * drew.
 */

/** Column-major 4x4, the same convention as everywhere else in the engine. */
export type Mat4 = readonly number[];

export interface ParsedMesh {
  /** Interleaved-free vertex positions, three floats per vertex. */
  readonly positions: Float32Array;
  readonly indices?: Uint32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  /** Index into `ParsedModel.materials`, or −1 for the format's default. */
  readonly material: number;
}

/**
 * A material as the FILE describes it, in Streamatrix's own vocabulary.
 *
 * Named for what it means rather than for glTF's spelling, because the next
 * format will spell it differently and this is the vocabulary the product
 * speaks: the Inspector's Material group edits exactly these.
 */
export interface ParsedMaterial {
  readonly name: string;
  /** Linear RGBA, 0..1. Premultiplied nowhere — that is the projector's job. */
  readonly baseColor: readonly [number, number, number, number];
  readonly metallic: number;
  readonly roughness: number;
  /** Index into `ParsedModel.textures`, or −1 when the material has none. */
  readonly baseColorTexture: number;
  readonly doubleSided: boolean;
}

/** An encoded image, still in its file format. Decoding belongs to IF-005. */
export interface ParsedTexture {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface ParsedNode {
  readonly name: string;
  /** Local transform, relative to the parent. Composed by the consumer. */
  readonly matrix: Mat4;
  /** Indices into `ParsedModel.nodes`. */
  readonly children: readonly number[];
  /** Index into `ParsedModel.meshes`, or −1 for a pure transform node. */
  readonly mesh: number;
}

/**
 * One animated property over time, in the file's own units.
 *
 * Kept as raw samples rather than converted to Streamatrix keyframes here: the
 * conversion needs a node id, which does not exist until the model is
 * instantiated into a document. Parsing must not need to know that.
 */
export interface ParsedAnimationChannel {
  /** Index into `ParsedModel.nodes`. */
  readonly node: number;
  readonly path: "translation" | "rotation" | "scale";
  /** Seconds. */
  readonly times: Float32Array;
  /** 3 values per sample for translation/scale, 4 for a rotation quaternion. */
  readonly values: Float32Array;
  readonly interpolation: "linear" | "step";
}

export interface ParsedAnimation {
  readonly name: string;
  readonly channels: readonly ParsedAnimationChannel[];
  /** Seconds. The longest channel decides. */
  readonly duration: number;
}

export interface ParsedModel {
  readonly meshes: readonly ParsedMesh[];
  readonly materials: readonly ParsedMaterial[];
  readonly textures: readonly ParsedTexture[];
  readonly nodes: readonly ParsedNode[];
  /** Indices into `nodes`. The tree's tops. */
  readonly roots: readonly number[];
  readonly animations: readonly ParsedAnimation[];
  /** Axis-aligned bounds in the model's own space, for framing and scaling. */
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
}

/**
 * A format this build cannot read.
 *
 * Thrown rather than returned-empty, and never swallowed into a "successful"
 * import of nothing. An import that silently produces no geometry is worse
 * than one that fails: the asset appears in the library, the user places it,
 * and the stage stays empty with no one able to say why.
 */
export class UnsupportedModel extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedModel";
  }
}

/** Every model format this build can read. Anything else is unsupported. */
export const SUPPORTED_MODEL_MIME: readonly string[] = [
  "model/gltf-binary",
  "model/gltf+json",
];

export function isSupportedModelMime(mime: string): boolean {
  return SUPPORTED_MODEL_MIME.includes(mime);
}
