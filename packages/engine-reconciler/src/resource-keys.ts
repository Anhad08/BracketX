/**
 * Content addressing and size estimation for GPU resources.
 *
 * ==========================================================================
 * PURE FUNCTIONS OF A DESCRIPTOR, SO THEY BELONG TO NO RENDERER
 * ==========================================================================
 * A geometry key is a hash of the vertices the engine asked for. A byte
 * estimate is arithmetic on the same numbers. Neither reads a three.js type or
 * a Babylon one, and both were living inside the three adapter purely because
 * that was the only adapter.
 *
 * They moved when the second one arrived, and the reason is not tidiness: the
 * key is what makes two identical rects SHARE one buffer. Two backends with
 * two hashing schemes would dedup differently, so the same scene would hold a
 * different number of buffers on each — and every memory comparison between
 * them would be measuring the hash rather than the renderer.
 */
import { hashBytes, hashString } from "./gpu-resources";
import type {
  GeometryDescriptor,
  MaterialDescriptor,
  Rgba,
  TextureDescriptor,
} from "./mirror-backend";

/** A colour, at a fixed precision, so two equal colours hash identically. */
function rgbaKey(color: Rgba): string {
  return color.map((c) => c.toFixed(4)).join(",");
}

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

/** Materials cost little GPU memory; the shader program dominates and is shared. */
export function estimateMaterialBytes(): number {
  return 512;
}

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
