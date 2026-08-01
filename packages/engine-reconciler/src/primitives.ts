/**
 * Geometry and colour for components the engine draws from its own format.
 *
 * These live in the reconciler, not in a backend, because they are properties
 * of the SCENE FORMAT rather than of any renderer. A rect is two triangles in
 * every backend; if the backend built it, every future backend would have to
 * agree on winding, UV origin, and units independently — and any disagreement
 * would show up as a swapped texture or a back-face-culled graphic rather than
 * as a type error.
 */
import type { GeometryDescriptor, Rgba } from "./mirror-backend";

/**
 * A quad in the XY plane, centred on its node's origin, facing +Z.
 *
 * Centred rather than corner-anchored so that rotation and scale behave the way
 * an operator expects: a lower-third spinning about its own middle, not about
 * its top-left corner. SCENE_FORMAT §5 puts +Y up and +Z toward the viewer, so
 * counter-clockwise winding faces the camera.
 */
export function quadDescriptor(
  width: number,
  height: number,
): GeometryDescriptor {
  const x = width / 2;
  const y = height / 2;

  return {
    positions: new Float32Array([
      -x, -y, 0, // 0 bottom-left
      x, -y, 0, // 1 bottom-right
      x, y, 0, // 2 top-right
      -x, y, 0, // 3 top-left
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]),
    // V origin at the bottom, matching the Y-up convention. Getting this
    // backwards flips every texture, which is invisible until the first image.
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/**
 * Parses `#RGB`, `#RRGGBB`, or `#RRGGBBAA` into linear-ish RGBA 0–1.
 *
 * SCENE_FORMAT §7 stores colours as hex strings because that is what authoring
 * tools and operators exchange. An unparseable value yields opaque magenta
 * rather than throwing: a wrong colour on air is recoverable and obvious, a
 * crash mid-show is neither.
 */
export function rgbaFromHex(hex: string): Rgba {
  const value = hex.trim().replace(/^#/, "");

  const expand = (part: string): number => parseInt(part, 16) / 255;

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return [
      expand(value[0]! + value[0]!),
      expand(value[1]! + value[1]!),
      expand(value[2]! + value[2]!),
      1,
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return [
      expand(value.slice(0, 2)),
      expand(value.slice(2, 4)),
      expand(value.slice(4, 6)),
      1,
    ];
  }
  if (/^[0-9a-fA-F]{8}$/.test(value)) {
    return [
      expand(value.slice(0, 2)),
      expand(value.slice(2, 4)),
      expand(value.slice(4, 6)),
      expand(value.slice(6, 8)),
    ];
  }

  return [1, 0, 1, 1];
}
