/**
 * Transform maths. SCENE_FORMAT §4.
 *
 * Right-handed, Y-up, metres. Rotations are Euler angles in degrees, intrinsic
 * YXZ. Matrices are column-major with 16 elements, matching glTF and Three.js
 * so no transposition happens at the render boundary.
 *
 * Stored transforms are TRS components, never matrices — SCENE_FORMAT §6.1: a
 * matrix loses author intent and is not something a person types or diffs.
 * Matrices are computed here and never persisted.
 */

export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly number[];

export const DEG_TO_RAD = Math.PI / 180;

export const IDENTITY: Mat4 = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/**
 * Local matrix from translation, rotation (degrees, YXZ intrinsic), and scale.
 *
 * The YXZ term layout matches Three.js's `makeRotationFromEuler` for the same
 * order. That is deliberate: it is the standard composition, and matching it
 * exactly removes a class of discrepancy at the backend boundary. It is not a
 * dependency — the formula is reproduced here, and engine-scene imports nothing.
 */
export function composeTRS(
  translation: Vec3,
  rotationDegrees: Vec3,
  scale: Vec3,
): Mat4 {
  const x = rotationDegrees[0] * DEG_TO_RAD;
  const y = rotationDegrees[1] * DEG_TO_RAD;
  const z = rotationDegrees[2] * DEG_TO_RAD;

  const c1 = Math.cos(x);
  const s1 = Math.sin(x);
  const c2 = Math.cos(y);
  const s2 = Math.sin(y);
  const c3 = Math.cos(z);
  const s3 = Math.sin(z);

  // Rotation, YXZ intrinsic, column-major.
  const r0 = c2 * c3 + s1 * s2 * s3;
  const r1 = c1 * s3;
  const r2 = c2 * s1 * s3 - s2 * c3;

  const r4 = s2 * c3 * s1 - c2 * s3;
  const r5 = c1 * c3;
  const r6 = s2 * s3 + c2 * c3 * s1;

  const r8 = c1 * s2;
  const r9 = -s1;
  const r10 = c1 * c2;

  const [sx, sy, sz] = scale;

  // `-sin(0)` is -0, which is === 0 but not deeply equal to it. Matrices are
  // never persisted (SCENE_FORMAT §6.1), but MirrorSnapshot compares world
  // matrices to verify ENGINE_RECONCILIATION invariant R9, so an unnormalised
  // -0 would produce spurious inequality there.
  return [
    z0(r0 * sx),
    z0(r1 * sx),
    z0(r2 * sx),
    0,
    z0(r4 * sy),
    z0(r5 * sy),
    z0(r6 * sy),
    0,
    z0(r8 * sz),
    z0(r9 * sz),
    z0(r10 * sz),
    0,
    z0(translation[0]),
    z0(translation[1]),
    z0(translation[2]),
    1,
  ];
}

/** Collapses -0 to 0. */
function z0(value: number): number {
  return value === 0 ? 0 : value;
}

/** `a * b`, column-major. Applied to a column vector, `b` acts first. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Transforms a point (w = 1), applying translation. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/**
 * Rounds to `places` decimals, normalising negative zero.
 *
 * `-0` and `0` are distinct under Object.is and serialise differently, which
 * would make two structurally identical documents compare unequal. Canonical
 * serialisation (SCENE_FORMAT §12) requires them to be the same value.
 */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function isFiniteVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}
