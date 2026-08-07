/**
 * The image engine — bytes in, premultiplied linear RGBA out.
 *
 * Deliberately knows nothing about a renderer, for the same reason
 * `engine-text` does not: an image is pixels plus dimensions, which is exactly
 * what `TextureDescriptor` takes, and the package that decodes them should not
 * also be the package that uploads them. See IF-005.
 */
/**
 * Declared here so the layer model and the code cannot disagree silently —
 * `tools/boundaries.test.ts` reads this and fails if they do. It was missing
 * from this package, which meant the one check that keeps the architecture
 * honest was skipping it.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-image",
  layer: "engine-core",
} as const;

export { decodePng, ImageDecodeError, type DecodedImage } from "./png";
export { toPremultipliedLinear } from "./color";
export { thumbnail, type Thumbnail } from "./preview";
export {
  ImageLibrary,
  type ImageData,
  type ImageLibraryOptions,
  type LoadResult,
} from "./library";
