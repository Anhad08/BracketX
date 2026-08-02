/**
 * 3D primitive geometry. Phase 2 — the hybrid runtime.
 *
 * ============================================================================
 * WHY THESE LIVE IN THE RECONCILER AND NOT IN A BACKEND
 * ============================================================================
 * The same reason `quadDescriptor` does: a cube is a cube in every backend, and
 * if each one built its own, any disagreement about winding, UV origin or units
 * would show up as a back-face-culled model or a swapped texture rather than as
 * a type error.
 *
 * Generating them here also means a primitive costs no ASSET. A scene that
 * renders a cube is a scene the engine can draw entirely from its own format,
 * with no import pipeline, no loader and no network — exactly the property that
 * made `rect` the first component wired in Phase 2.6, and the reason primitives
 * are the first 3D geometry wired here.
 *
 * Every shape is centred on the node's origin, +Y up, +Z toward the viewer,
 * counter-clockwise front faces (SCENE_FORMAT §5).
 */
import type { GeometryDescriptor } from "./mirror-backend";

export type PrimitiveShape = "box" | "plane" | "sphere" | "cylinder";

export interface PrimitiveSpec {
  readonly shape: PrimitiveShape;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly radius?: number;
  /** Longitude divisions for a sphere, radial divisions for a cylinder. */
  readonly segments?: number;
  /** Latitude divisions. Spheres only. */
  readonly rings?: number;
}

/**
 * A box centred on the origin.
 *
 * Twenty-four vertices, not eight. A shared corner would have to average three
 * face normals, which turns every hard edge into a smooth-shading artefact —
 * the cube would look like a rounded lump under any light.
 */
export function boxDescriptor(
  width = 1,
  height = 1,
  depth = 1,
): GeometryDescriptor {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;

  const faces: readonly {
    normal: readonly [number, number, number];
    corners: readonly (readonly [number, number, number])[];
  }[] = [
    { normal: [0, 0, 1], corners: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { normal: [0, 0, -1], corners: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    { normal: [1, 0, 0], corners: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },
    { normal: [-1, 0, 0], corners: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] },
    { normal: [0, 1, 0], corners: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { normal: [0, -1, 0], corners: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  faces.forEach((face, faceIndex) => {
    for (const corner of face.corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

/** A plane in the XZ ground plane facing +Y. The floor of a set. */
export function planeDescriptor(width = 1, depth = 1): GeometryDescriptor {
  const x = width / 2;
  const z = depth / 2;
  return {
    positions: new Float32Array([-x, 0, z, x, 0, z, x, 0, -z, -x, 0, -z]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/**
 * A UV sphere.
 *
 * UV rather than icosphere. An icosphere distributes triangles far better and
 * has no poles, and it is the right choice for a shape nobody textures. A UV
 * sphere has a trivially correct UV mapping, and a globe, a ball and a planet
 * all need one — an icosphere would need a separate unwrap to be texturable at
 * all. Chosen for what the shape is used FOR, not for what it looks like in
 * wireframe.
 */
export function sphereDescriptor(
  radius = 0.5,
  segments = 32,
  rings = 16,
): GeometryDescriptor {
  const longitudes = Math.max(3, Math.floor(segments));
  const latitudes = Math.max(2, Math.floor(rings));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring <= latitudes; ring += 1) {
    const v = ring / latitudes;
    const phi = v * Math.PI;
    for (let segment = 0; segment <= longitudes; segment += 1) {
      const u = segment / longitudes;
      const theta = u * Math.PI * 2;

      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      positions.push(nx * radius, ny * radius, nz * radius);
      // A unit sphere's position IS its normal — the one place this shape is
      // simpler than every other.
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }

  const stride = longitudes + 1;
  for (let ring = 0; ring < latitudes; ring += 1) {
    for (let segment = 0; segment < longitudes; segment += 1) {
      const a = ring * stride + segment;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

/** A capped cylinder about the Y axis. A podium, a trophy stem, a bar. */
export function cylinderDescriptor(
  radius = 0.5,
  height = 1,
  segments = 32,
): GeometryDescriptor {
  const radial = Math.max(3, Math.floor(segments));
  const y = height / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Side. Duplicated at the seam so U can run 0..1 without wrapping backwards.
  for (let segment = 0; segment <= radial; segment += 1) {
    const u = segment / radial;
    const theta = u * Math.PI * 2;
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);
    positions.push(nx * radius, y, nz * radius, nx * radius, -y, nz * radius);
    normals.push(nx, 0, nz, nx, 0, nz);
    uvs.push(u, 1, u, 0);
  }
  for (let segment = 0; segment < radial; segment += 1) {
    const a = segment * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }

  // Caps get their own vertices: a cap normal is ±Y and a side normal is
  // radial, so sharing them would round the rim into a lampshade.
  for (const sign of [1, -1] as const) {
    const centre = positions.length / 3;
    positions.push(0, sign * y, 0);
    normals.push(0, sign, 0);
    uvs.push(0.5, 0.5);

    for (let segment = 0; segment <= radial; segment += 1) {
      const theta = (segment / radial) * Math.PI * 2;
      const nx = Math.cos(theta);
      const nz = Math.sin(theta);
      positions.push(nx * radius, sign * y, nz * radius);
      normals.push(0, sign, 0);
      uvs.push(nx * 0.5 + 0.5, nz * 0.5 + 0.5);
    }
    for (let segment = 0; segment < radial; segment += 1) {
      const a = centre + 1 + segment;
      // Winding flips for the bottom cap, or it is culled when seen from below.
      if (sign > 0) indices.push(centre, a, a + 1);
      else indices.push(centre, a + 1, a);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
  };
}

/** The geometry a spec describes. Defaults are one world unit. */
export function primitiveDescriptor(spec: PrimitiveSpec): GeometryDescriptor {
  switch (spec.shape) {
    case "plane":
      return planeDescriptor(spec.width ?? 1, spec.depth ?? 1);
    case "sphere":
      return sphereDescriptor(spec.radius ?? 0.5, spec.segments ?? 32, spec.rings ?? 16);
    case "cylinder":
      return cylinderDescriptor(spec.radius ?? 0.5, spec.height ?? 1, spec.segments ?? 32);
    case "box":
    default:
      return boxDescriptor(spec.width ?? 1, spec.height ?? 1, spec.depth ?? 1);
  }
}

/**
 * A stable key for a primitive.
 *
 * Two nodes with identical specs share ONE GPU geometry. A stadium of a
 * thousand identical seats is one buffer, which is the whole reason the
 * resource manager is content-addressed.
 */
export function primitiveKey(spec: PrimitiveSpec): string {
  return [
    spec.shape,
    spec.width ?? 1,
    spec.height ?? 1,
    spec.depth ?? 1,
    spec.radius ?? 0.5,
    spec.segments ?? 32,
    spec.rings ?? 16,
  ].join(":");
}

/** Reads a spec off a component's resolved props. Unknown shapes become a box. */
export function readPrimitive(value: unknown): PrimitiveSpec | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const shape = raw.shape;
  if (typeof shape !== "string") return null;

  const number = (key: string): number | undefined =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : undefined;

  return {
    shape: (["box", "plane", "sphere", "cylinder"] as const).includes(
      shape as PrimitiveShape,
    )
      ? (shape as PrimitiveShape)
      : "box",
    ...(number("width") === undefined ? {} : { width: number("width")! }),
    ...(number("height") === undefined ? {} : { height: number("height")! }),
    ...(number("depth") === undefined ? {} : { depth: number("depth")! }),
    ...(number("radius") === undefined ? {} : { radius: number("radius")! }),
    ...(number("segments") === undefined ? {} : { segments: number("segments")! }),
    ...(number("rings") === undefined ? {} : { rings: number("rings")! }),
  };
}
