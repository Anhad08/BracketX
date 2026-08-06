/**
 * The editor's projection, pinned against the renderer's.
 *
 * ==========================================================================
 * WHY THIS TEST IS THE POINT
 * ==========================================================================
 * Studio has to hit-test and draw handles in the same space three.js draws in.
 * The camera PARAMETERS have one source — the projector's `CameraDescriptor` —
 * but the arithmetic that turns them into a matrix is written twice: once by
 * three.js for rendering, once here for editing.
 *
 * That is the drift risk, and it is a nasty one, because a small disagreement
 * does not look like a bug. The picture stays correct and the handles land
 * a few pixels off — which reads as "the gizmo is a bit imprecise" for as long
 * as anyone can stand it.
 *
 * So every projection claim below is checked against three.js itself. If a
 * three upgrade changes a convention, this fails loudly instead of quietly
 * moving every handle in the product.
 */

import { describe, expect, it } from "vitest";
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import {
  dolly,
  intersectPlane,
  invert,
  lookAtRotation,
  multiply,
  orbitBy,
  orbitOf,
  positionFor,
  project,
  projectionMatrix,
  rayThrough,
  verticalFov,
  type CameraView,
} from "./studio/camera";

const PERSPECTIVE: CameraDescriptor = {
  kind: "perspective",
  focalLengthMm: 35,
  sensorWidthMm: 36,
  near: 0.1,
  far: 1000,
};

const ORTHOGRAPHIC: CameraDescriptor = {
  kind: "orthographic",
  size: 5,
  near: 0.1,
  far: 1000,
};

const CANVAS = { width: 1920, height: 1080 };
const ASPECT = CANVAS.width / CANVAS.height;

/** A camera at (0, 0, 10) looking at the origin — the default broadcast view. */
function frontOn(): CameraView {
  return { descriptor: PERSPECTIVE, world: translation(0, 0, 10), canvas: CANVAS };
}

function translation(x: number, y: number, z: number): readonly number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

describe("projection matrix", () => {
  it("matches three.js for a perspective camera", () => {
    const fov = (verticalFov(PERSPECTIVE, ASPECT) * 180) / Math.PI;
    const reference = new PerspectiveCamera(fov, ASPECT, PERSPECTIVE.near, PERSPECTIVE.far);
    reference.updateProjectionMatrix();

    const ours = projectionMatrix(PERSPECTIVE, ASPECT);
    reference.projectionMatrix.elements.forEach((value, index) => {
      expect(ours[index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("matches three.js for an orthographic camera", () => {
    const halfHeight = ORTHOGRAPHIC.size;
    const halfWidth = halfHeight * ASPECT;
    const reference = new OrthographicCamera(
      -halfWidth, halfWidth, halfHeight, -halfHeight, ORTHOGRAPHIC.near, ORTHOGRAPHIC.far,
    );
    reference.updateProjectionMatrix();

    const ours = projectionMatrix(ORTHOGRAPHIC, ASPECT);
    reference.projectionMatrix.elements.forEach((value, index) => {
      expect(ours[index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("derives the same field of view the render adapter does", () => {
    // `verticalFovDegrees` in the render adapter, restated. A 35mm lens on a
    // 36mm sensor is the broadcast default and the number most likely to be
    // "simplified" by someone who does not know it is physical.
    const sensorHeight = 36 / ASPECT;
    const expected = 2 * Math.atan(sensorHeight / (2 * 35));
    expect(verticalFov(PERSPECTIVE, ASPECT)).toBeCloseTo(expected, 12);
  });
});

describe("matrix arithmetic", () => {
  it("multiplies the way three.js does", () => {
    const a = new Matrix4().makeRotationY(0.7).multiply(new Matrix4().makeTranslation(1, 2, 3));
    const b = new Matrix4().makeRotationX(-0.3).multiply(new Matrix4().makeScale(2, 2, 2));
    const reference = new Matrix4().multiplyMatrices(a, b);

    const ours = multiply([...a.elements], [...b.elements]);
    reference.elements.forEach((value, index) => {
      expect(ours[index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("inverts a matrix with scale in it, where the transpose shortcut is wrong", () => {
    const m = new Matrix4()
      .makeTranslation(3, -1, 4)
      .multiply(new Matrix4().makeRotationY(0.9))
      .multiply(new Matrix4().makeScale(2, 2, 2));
    const reference = new Matrix4().copy(m).invert();

    const ours = invert([...m.elements]);
    expect(ours).not.toBeNull();
    reference.elements.forEach((value, index) => {
      expect(ours![index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("refuses a degenerate matrix rather than producing NaN", () => {
    // A zero scale. Returning NaN here would spread into every handle
    // position, where the cause is impossible to see.
    expect(invert([...new Matrix4().makeScale(1, 0, 1).elements])).toBeNull();
  });
});

describe("project", () => {
  it("puts the origin at the centre of the canvas", () => {
    const result = project(frontOn(), { x: 0, y: 0, z: 0 });
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(CANVAS.width / 2, 6);
    expect(result!.point.y).toBeCloseTo(CANVAS.height / 2, 6);
    expect(result!.inFront).toBe(true);
  });

  it("agrees with three.js for an off-axis point", () => {
    const view = frontOn();
    const world = new Vector3(1.5, -0.75, 0.5);

    const camera = new PerspectiveCamera(
      (verticalFov(PERSPECTIVE, ASPECT) * 180) / Math.PI, ASPECT, PERSPECTIVE.near, PERSPECTIVE.far,
    );
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const ndc = world.clone().project(camera);
    const expected = {
      x: (ndc.x * 0.5 + 0.5) * CANVAS.width,
      y: (0.5 - ndc.y * 0.5) * CANVAS.height,
    };

    const ours = project(view, { x: world.x, y: world.y, z: world.z })!;
    expect(ours.point.x).toBeCloseTo(expected.x, 6);
    expect(ours.point.y).toBeCloseTo(expected.y, 6);
  });

  it("puts Y up in the world at the TOP of the canvas", () => {
    // Canvas Y grows down. Getting this backwards flips every graphic
    // vertically and looks, at a glance, like a scene authored upside down.
    const above = project(frontOn(), { x: 0, y: 1, z: 0 })!;
    expect(above.point.y).toBeLessThan(CANVAS.height / 2);
  });

  it("reports a point behind the camera rather than projecting it anyway", () => {
    // Behind the lens, a perspective divide by a negative w yields plausible
    // screen coordinates mirrored through the centre. An editor that trusted
    // them would draw a handle for something nobody can see.
    const behind = project(frontOn(), { x: 0.5, y: 0, z: 20 });
    expect(behind).not.toBeNull();
    expect(behind!.inFront).toBe(false);
  });
});

describe("rayThrough and intersectPlane", () => {
  it("round-trips: a projected point unprojects to where it started", () => {
    const view = frontOn();
    const world = { x: 2, y: -1.25, z: 0 };
    const projected = project(view, world)!;

    const ray = rayThrough(view, projected.point)!;
    const back = intersectPlane(ray, 0)!;
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it("round-trips under an orbited camera, which is the whole point", () => {
    // The 2D affine map this replaced was correct ONLY for a camera on the Z
    // axis. This is the case that proves the editor now follows the camera.
    const pivot = { x: 0, y: 0, z: 0 };
    const orbit = orbitBy(orbitOf({ x: 0, y: 0, z: 10 }, pivot), 240, -90);
    const position = positionFor(orbit, pivot);
    const rotation = lookAtRotation(position, pivot);

    const world = new Matrix4().makeRotationFromEuler(
      new Euler(
        (rotation[0] * Math.PI) / 180,
        (rotation[1] * Math.PI) / 180,
        (rotation[2] * Math.PI) / 180,
        "YXZ",
      ),
    );
    world.setPosition(position.x, position.y, position.z);

    const view: CameraView = { descriptor: PERSPECTIVE, world: [...world.elements], canvas: CANVAS };
    const target = { x: 1.5, y: 0.5, z: 0 };
    const projected = project(view, target)!;
    expect(projected.inFront).toBe(true);

    const back = intersectPlane(rayThrough(view, projected.point)!, 0)!;
    expect(back.x).toBeCloseTo(target.x, 5);
    expect(back.y).toBeCloseTo(target.y, 5);
  });

  it("round-trips for an orthographic camera too", () => {
    const view: CameraView = { descriptor: ORTHOGRAPHIC, world: translation(0, 0, 10), canvas: CANVAS };
    const world = { x: -3, y: 2, z: 0 };
    const back = intersectPlane(rayThrough(view, project(view, world)!.point)!, 0)!;
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it("finds nothing on a plane the ray runs parallel to", () => {
    const ray = { origin: { x: 0, y: 0, z: 5 }, direction: { x: 1, y: 0, z: 0 } };
    expect(intersectPlane(ray, 0)).toBeNull();
  });

  it("finds nothing on a plane behind the camera", () => {
    const ray = { origin: { x: 0, y: 0, z: 5 }, direction: { x: 0, y: 0, z: 1 } };
    expect(intersectPlane(ray, 0)).toBeNull();
  });
});

describe("orbit", () => {
  it("recovers the angles of a position and returns to it", () => {
    const pivot = { x: 1, y: 2, z: -1 };
    const position = { x: 4, y: 5, z: 3 };
    const back = positionFor(orbitOf(position, pivot), pivot);
    expect(back.x).toBeCloseTo(position.x, 9);
    expect(back.y).toBeCloseTo(position.y, 9);
    expect(back.z).toBeCloseTo(position.z, 9);
  });

  it("keeps the distance while turning", () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const start = orbitOf({ x: 0, y: 0, z: 10 }, pivot);
    const turned = orbitBy(start, 300, 120);
    expect(turned.radius).toBeCloseTo(start.radius, 12);
  });

  it("never reaches the pole, so the horizon cannot flip", () => {
    // Straight down is where a naive orbit gimbals: the camera rolls, the
    // horizon tilts, and the only fix a user has is to give up and refit.
    const start = orbitOf({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    const far = orbitBy(start, 0, 100_000);
    expect(Math.abs(far.elevation)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(orbitBy(start, 0, -100_000).elevation)).toBeLessThan(Math.PI / 2);
  });

  it("never dollies through the pivot", () => {
    const start = orbitOf({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    let orbit = start;
    for (let i = 0; i < 200; i += 1) orbit = dolly(orbit, 0.5);
    expect(orbit.radius).toBeGreaterThan(0);
  });

  it("aims the camera at the pivot, with no roll", () => {
    const pivot = { x: 0, y: 0, z: 0 };
    const position = positionFor(orbitBy(orbitOf({ x: 0, y: 0, z: 10 }, pivot), 180, -60), pivot);
    const [pitch, yaw, roll] = lookAtRotation(position, pivot);
    expect(roll).toBe(0);

    // Build the matrix the renderer would and check it actually looks at the
    // pivot — a rotation that is merely plausible is not good enough.
    const world = new Matrix4().makeRotationFromEuler(
      new Euler((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, "YXZ"),
    );
    const forward = new Vector3(0, 0, -1).applyMatrix4(
      new Matrix4().extractRotation(world),
    );
    const toPivot = new Vector3(pivot.x - position.x, pivot.y - position.y, pivot.z - position.z)
      .normalize();
    expect(forward.dot(toPivot)).toBeCloseTo(1, 6);
  });
});
