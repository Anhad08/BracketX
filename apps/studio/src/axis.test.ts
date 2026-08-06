/**
 * The three-axis move gizmo.
 *
 * The cases here are the ones that make an axis gizmo feel wrong rather than
 * broken: an arm that drifts out from under the pointer, an arm pointing at
 * the camera that you cannot aim at, and a gizmo that changes size with zoom.
 */
import { describe, expect, it } from "vitest";
import { Euler, Matrix4 } from "three";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import {
  armLength,
  AXES,
  axisById,
  axisParameterAt,
  closestOnAxis,
  MIN_FORESHORTENING,
  pickAxis,
  projectAxes,
  tipOf,
} from "./studio/axis";
import { lookAtRotation, orbitBy, orbitOf, positionFor, project, type CameraView } from "./studio/camera";

const PERSPECTIVE: CameraDescriptor = {
  kind: "perspective",
  focalLengthMm: 35,
  sensorWidthMm: 36,
  near: 0.1,
  far: 1000,
};
const CANVAS = { width: 1920, height: 1080 };
const ORIGIN = { x: 0, y: 0, z: 0 };

function at(position: { x: number; y: number; z: number }): CameraView {
  const rotation = lookAtRotation(position, ORIGIN);
  const world = new Matrix4().makeRotationFromEuler(
    new Euler(
      (rotation[0] * Math.PI) / 180,
      (rotation[1] * Math.PI) / 180,
      (rotation[2] * Math.PI) / 180,
      "YXZ",
    ),
  );
  world.setPosition(position.x, position.y, position.z);
  return { descriptor: PERSPECTIVE, world: [...world.elements], canvas: CANVAS };
}

const FRONT = at({ x: 0, y: 0, z: 10 });
const THREE_QUARTER = at(positionFor(orbitBy(orbitOf({ x: 0, y: 0, z: 10 }, ORIGIN), 200, -80), ORIGIN));

describe("axes", () => {
  it("uses the colour convention every 3D tool shares", () => {
    expect(axisById("x").colour).toBe("#e5484d");
    expect(axisById("y").colour).toBe("#46a758");
    expect(axisById("z").colour).toBe("#3b82f6");
  });

  it("describes each axis in a designer's words, not the engine's", () => {
    for (const axis of AXES) {
      expect(axis.label).not.toMatch(/axis|vector|world|transform/i);
    }
  });
});

describe("projectAxes", () => {
  it("draws all three from a three-quarter view", () => {
    const arms = projectAxes(THREE_QUARTER, ORIGIN, 2);
    expect(arms).toHaveLength(3);
    for (const arm of arms) {
      expect(Math.hypot(arm.to.x - arm.from.x, arm.to.y - arm.from.y)).toBeGreaterThan(1);
    }
  });

  it("reports Z as foreshortened when the camera looks straight down it", () => {
    // Front-on, Z points at the lens. It projects to almost nothing, and a
    // stub is both impossible to aim at and ambiguous — push and pull look
    // identical.
    const arms = projectAxes(FRONT, ORIGIN, 2);
    const z = arms.find((arm) => arm.axis.id === "z")!;
    const x = arms.find((arm) => arm.axis.id === "x")!;
    expect(z.foreshortening).toBeLessThan(MIN_FORESHORTENING);
    expect(x.foreshortening).toBeGreaterThan(0.9);
  });

  it("draws nothing for an origin behind the camera", () => {
    expect(projectAxes(FRONT, { x: 0, y: 0, z: 40 }, 2)).toHaveLength(0);
  });
});

describe("pickAxis", () => {
  it("picks the arm the pointer is on", () => {
    const arms = projectAxes(THREE_QUARTER, ORIGIN, 2);
    for (const arm of arms) {
      if (arm.foreshortening < MIN_FORESHORTENING) continue;
      const midpoint = { x: (arm.from.x + arm.to.x) / 2, y: (arm.from.y + arm.to.y) / 2 };
      expect(pickAxis(arms, midpoint, 12)?.id, arm.axis.id).toBe(arm.axis.id);
    }
  });

  it("refuses an arm that is too edge-on to aim at", () => {
    const arms = projectAxes(FRONT, ORIGIN, 2);
    const z = arms.find((arm) => arm.axis.id === "z")!;
    // Right on top of the Z stub — and it must still not be offered, because
    // a drag along it cannot be aimed.
    const point = { x: (z.from.x + z.to.x) / 2, y: (z.from.y + z.to.y) / 2 };
    expect(pickAxis([z], point, 12)).toBeNull();
  });

  it("does not grab the whole ray beyond the arrowhead", () => {
    // Distance to the SEGMENT, not the infinite line. Otherwise everything
    // behind the arrow is grabbable and steals clicks from real content.
    const arms = projectAxes(THREE_QUARTER, ORIGIN, 2);
    const x = arms.find((arm) => arm.axis.id === "x")!;
    const beyond = {
      x: x.to.x + (x.to.x - x.from.x) * 3,
      y: x.to.y + (x.to.y - x.from.y) * 3,
    };
    expect(pickAxis(arms, beyond, 12)).toBeNull();
  });

  it("picks nothing far from every arm", () => {
    const arms = projectAxes(THREE_QUARTER, ORIGIN, 2);
    expect(pickAxis(arms, { x: 40, y: 40 }, 8)).toBeNull();
  });
});

describe("dragging along an axis", () => {
  it("keeps the arm under the pointer, which screen deltas do not", () => {
    // Grab the X arm at its tip and the parameter there must BE the arm
    // length. This is the property that makes a drag feel attached rather
    // than sliding on ice.
    const length = 2;
    const tip = tipOf(ORIGIN, axisById("x"), length);
    const canvas = project(THREE_QUARTER, tip)!.point;
    const t = axisParameterAt(THREE_QUARTER, canvas, ORIGIN, axisById("x"));
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(length, 5);
  });

  it("is exact from every named angle, not just front on", () => {
    for (const camera of [FRONT, THREE_QUARTER, at({ x: 8, y: 0, z: 0 }), at({ x: 0, y: 9, z: 1 })]) {
      for (const axis of AXES) {
        const target = tipOf(ORIGIN, axis, 1.5);
        const projected = project(camera, target);
        if (projected === null || !projected.inFront) continue;
        const t = axisParameterAt(camera, projected.point, ORIGIN, axis);
        if (t === null) continue;
        expect(t, `${axis.id}`).toBeCloseTo(1.5, 4);
      }
    }
  });

  it("refuses a ray parallel to the axis rather than teleporting the node", () => {
    const ray = { origin: { x: 0, y: 0, z: 5 }, direction: { x: 1, y: 0, z: 0 } };
    expect(closestOnAxis(ray, ORIGIN, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});

describe("armLength", () => {
  it("gives a constant screen size whatever the distance", () => {
    const near = armLength(at({ x: 0, y: 0, z: 4 }), ORIGIN, 80);
    const far = armLength(at({ x: 0, y: 0, z: 20 }), ORIGIN, 80);
    // Further away means a LONGER world arm for the same pixels.
    expect(far).toBeGreaterThan(near);

    // And both actually draw at the requested size.
    for (const [view, length] of [
      [at({ x: 0, y: 0, z: 4 }), near],
      [at({ x: 0, y: 0, z: 20 }), far],
    ] as const) {
      const centre = project(view, ORIGIN)!.point;
      const tip = project(view, tipOf(ORIGIN, axisById("x"), length))!.point;
      expect(Math.hypot(tip.x - centre.x, tip.y - centre.y)).toBeCloseTo(80, 3);
    }
  });

  it("works for an orthographic camera, where distance does not change size", () => {
    const ortho: CameraView = {
      descriptor: { kind: "orthographic", size: 5, near: 0.1, far: 1000 },
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1],
      canvas: CANVAS,
    };
    const length = armLength(ortho, ORIGIN, 60);
    const centre = project(ortho, ORIGIN)!.point;
    const tip = project(ortho, tipOf(ORIGIN, axisById("x"), length))!.point;
    expect(Math.hypot(tip.x - centre.x, tip.y - centre.y)).toBeCloseTo(60, 3);
  });
});
