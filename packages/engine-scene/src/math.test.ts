import { describe, expect, it } from "vitest";

import { IDENTITY, composeTRS, multiply, round, transformPoint } from "./math";
import type { Vec3 } from "./math";

const ORIGIN: Vec3 = [0, 0, 0];
const NO_ROTATION: Vec3 = [0, 0, 0];
const UNIT_SCALE: Vec3 = [1, 1, 1];

function expectVec3Close(actual: Vec3, expected: Vec3, precision = 10) {
  for (let i = 0; i < 3; i += 1) {
    expect(actual[i]!).toBeCloseTo(expected[i]!, precision);
  }
}

describe("composeTRS", () => {
  it("returns identity for an identity transform", () => {
    expect(composeTRS(ORIGIN, NO_ROTATION, UNIT_SCALE)).toEqual([...IDENTITY]);
  });

  it("puts translation in the fourth column (column-major)", () => {
    // SCENE_FORMAT §4 / MirrorBackend C10: column-major, matching glTF and
    // Three.js so nothing transposes at the render boundary.
    const m = composeTRS([1, 2, 3], NO_ROTATION, UNIT_SCALE);
    expect([m[12], m[13], m[14], m[15]]).toEqual([1, 2, 3, 1]);
  });

  it("scales along the diagonal", () => {
    const m = composeTRS(ORIGIN, NO_ROTATION, [2, 3, 4]);
    expect([m[0], m[5], m[10]]).toEqual([2, 3, 4]);
  });
});

describe("rotation is right-handed, Y-up", () => {
  it("rotates +X toward -Z for +90 degrees about Y", () => {
    // Right-handed with Y up: a positive rotation about +Y carries +X to -Z.
    const m = composeTRS(ORIGIN, [0, 90, 0], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [1, 0, 0]), [0, 0, -1]);
  });

  it("rotates -Z toward -X for +90 degrees about Y", () => {
    const m = composeTRS(ORIGIN, [0, 90, 0], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [0, 0, -1]), [-1, 0, 0]);
  });

  it("rotates +Y toward +Z for +90 degrees about X", () => {
    const m = composeTRS(ORIGIN, [90, 0, 0], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [0, 1, 0]), [0, 0, 1]);
  });

  it("rotates +X toward +Y for +90 degrees about Z", () => {
    const m = composeTRS(ORIGIN, [0, 0, 90], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [1, 0, 0]), [0, 1, 0]);
  });

  it("leaves the rotation axis fixed", () => {
    const m = composeTRS(ORIGIN, [0, 37, 0], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [0, 1, 0]), [0, 1, 0]);
  });

  it("composes YXZ intrinsically", () => {
    // Y then X then Z. Applying the three separately in that order must match
    // the single composed matrix, which is what "intrinsic YXZ" means.
    const combined = composeTRS(ORIGIN, [20, 35, 50], UNIT_SCALE);
    const y = composeTRS(ORIGIN, [0, 35, 0], UNIT_SCALE);
    const x = composeTRS(ORIGIN, [20, 0, 0], UNIT_SCALE);
    const z = composeTRS(ORIGIN, [0, 0, 50], UNIT_SCALE);
    const stepwise = multiply(multiply(y, x), z);

    const point: Vec3 = [0.3, -0.7, 1.1];
    expectVec3Close(transformPoint(combined, point), transformPoint(stepwise, point));
  });

  it("returns to the original orientation after 360 degrees", () => {
    const m = composeTRS(ORIGIN, [360, 360, 360], UNIT_SCALE);
    expectVec3Close(transformPoint(m, [1, 2, 3]), [1, 2, 3], 8);
  });
});

describe("multiply", () => {
  it("is identity-neutral", () => {
    const m = composeTRS([1, 2, 3], [10, 20, 30], [2, 2, 2]);
    expect(multiply(m, IDENTITY)).toEqual([...m]);
    expect(multiply(IDENTITY, m)).toEqual([...m]);
  });

  it("applies the right operand first to a column vector", () => {
    // parent * child, so the child transform acts first — the convention the
    // hierarchy relies on when composing world matrices.
    const translate = composeTRS([10, 0, 0], NO_ROTATION, UNIT_SCALE);
    const scale = composeTRS(ORIGIN, NO_ROTATION, [2, 2, 2]);
    expectVec3Close(transformPoint(multiply(translate, scale), [1, 0, 0]), [
      12, 0, 0,
    ]);
    expectVec3Close(transformPoint(multiply(scale, translate), [1, 0, 0]), [
      22, 0, 0,
    ]);
  });

  it("is associative", () => {
    const a = composeTRS([1, 0, 0], [0, 30, 0], UNIT_SCALE);
    const b = composeTRS([0, 2, 0], [45, 0, 0], [1, 2, 1]);
    const c = composeTRS([0, 0, 3], [0, 0, 60], UNIT_SCALE);
    const point: Vec3 = [1, 1, 1];
    expectVec3Close(
      transformPoint(multiply(multiply(a, b), c), point),
      transformPoint(multiply(a, multiply(b, c)), point),
    );
  });
});

describe("round", () => {
  it("rounds to the requested precision", () => {
    expect(round(1.234567, 5)).toBe(1.23457);
  });

  it("normalises negative zero", () => {
    // -0 and 0 serialise differently and compare unequal under Object.is,
    // which would make two structurally identical documents differ.
    expect(Object.is(round(-0.0000001, 5), 0)).toBe(true);
    expect(Object.is(round(-0, 5), 0)).toBe(true);
  });

  it("leaves representable values untouched", () => {
    expect(round(0.5, 5)).toBe(0.5);
    expect(round(-3, 5)).toBe(-3);
  });
});
