/**
 * @bracketx/engine-model — model files into backend-neutral geometry.
 *
 * The package exists so that "the renderer consumes assets through
 * Streamatrix's own abstraction" is true rather than aspirational. A glTF
 * becomes positions, indices, normals and UVs here; MirrorBackend's
 * `GeometryDescriptor` already takes exactly that shape, so no renderer
 * learned what glTF is and no part of the content pipeline holds a renderer
 * object.
 */
export const MODEL_PACKAGE = {
  name: "@bracketx/engine-model",
  layer: "engine-core",
} as const;

export { parseGltf, primitiveCountOf } from "./gltf";
export { UnsupportedModel, SUPPORTED_MODEL_MIME, isSupportedModelMime } from "./types";
export type {
  Mat4,
  ParsedAnimation,
  ParsedAnimationChannel,
  ParsedMaterial,
  ParsedMesh,
  ParsedModel,
  ParsedNode,
  ParsedTexture,
} from "./types";
