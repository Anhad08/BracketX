/**
 * The built-in studio environment.
 *
 * ============================================================================
 * WHY A METAL NEEDS THIS, AND WHY IT LIVES HERE
 * ============================================================================
 * A metallic surface has almost no diffuse response. Nearly everything you see
 * on a chrome plinth is a REFLECTION of the room it is standing in — so a
 * chrome material in a scene with no environment renders black, with a single
 * specular glint where a light happens to line up.
 *
 * That is physically correct and it makes the control a lie: a designer presses
 * "Chrome" and gets a black box. Every real 3D tool answers this the same way,
 * by shipping a default studio environment, and this is that.
 *
 * It lives in the reconciler, beside `mesh-primitives`, for the same reason
 * those do: a cube is a cube in every backend, and a studio is a studio in
 * every backend. Two renderers generating their own would disagree about what
 * "Chrome" looks like, and a set dressed in one and rendered in the other would
 * not match.
 *
 * ============================================================================
 * GENERATED, NOT SHIPPED
 * ============================================================================
 * The alternative is an HDR asset, which needs a loader, a decoder, a cubemap
 * conversion, a prefiltering step and a network fetch before anything draws.
 * This needs none of them — the same property that made primitives the first
 * geometry wired, and the same reason a scene that renders a cube costs no
 * asset at all.
 *
 * It is deliberately a SOFT GRADIENT rather than a photograph of a room. A
 * detailed environment reflected in a broadcast graphic reads as a texture
 * somebody applied by mistake; what a metal actually needs to read as metal is
 * a bright sky, a darker floor, and one soft source high on one side.
 */

/** Cube face order, matching every graphics API: +X −X +Y −Y +Z −Z. */
export const CUBE_FACES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;

export interface EnvironmentFaces {
  /** Edge length of each square face, in pixels. */
  readonly size: number;
  /** Six RGBA faces, in `CUBE_FACES` order. */
  readonly faces: readonly Uint8Array[];
}

/** Direction of a texel on a cube face, unnormalised. */
function directionOf(face: number, u: number, v: number): [number, number, number] {
  // u and v run −1..1 across the face.
  switch (face) {
    case 0: return [1, -v, -u];
    case 1: return [-1, -v, u];
    case 2: return [u, 1, v];
    case 3: return [u, -1, -v];
    case 4: return [u, -v, 1];
    default: return [-u, -v, -1];
  }
}

/**
 * A neutral studio, as six cube faces.
 *
 * `size` is small on purpose. This is blurred by roughness before anything sees
 * it, and a large map costs memory and upload time for detail that is thrown
 * away — 32 is enough for a gradient and cheap enough to build at start-up.
 */
export function studioEnvironmentFaces(size = 32): EnvironmentFaces {
  const faces: Uint8Array[] = [];

  // High and slightly to one side, so a sphere shows one soft highlight rather
  // than an even glow. Matches where the default key light stands, because a
  // reflection that disagrees with the lighting reads as a mistake.
  const keyDirection = normalise([0.45, 0.78, 0.44]);

  for (let face = 0; face < 6; face += 1) {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const direction = normalise(directionOf(face, u, v));

        // Sky above, floor below, with the horizon a smooth band rather than a
        // line — a hard horizon reflects as a seam across a curved surface.
        const height = direction[1];
        const sky = smoothstep(-0.25, 0.6, height);
        let level = 0.10 + sky * 0.62;

        // The key, as a broad soft blob. Raised to a power rather than
        // thresholded, so its edge is a falloff and not a circle.
        const alignment = Math.max(
          0,
          direction[0] * keyDirection[0] +
            direction[1] * keyDirection[1] +
            direction[2] * keyDirection[2],
        );
        level += Math.pow(alignment, 12) * 0.85;

        const value = Math.round(Math.min(1, level) * 255);
        const index = (y * size + x) * 4;
        // Very slightly cool, because a neutral-grey studio photographs cold
        // and a perfectly grey reflection reads as flat.
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = Math.min(255, Math.round(value * 1.04));
        pixels[index + 3] = 255;
      }
    }
    faces.push(pixels);
  }

  return { size, faces };
}

function normalise(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
