/**
 * The editor's projection, pinned against three.js.
 *
 * ==========================================================================
 * WHY THIS TEST LIVES HERE AND NOT IN THE EDITOR
 * ==========================================================================
 * Studio has to hit-test and draw handles in the same space the renderer draws
 * in. The camera PARAMETERS have one source — the projector's
 * `CameraDescriptor` — but the arithmetic that turns them into a matrix is
 * written twice: once by three.js for rendering, once by `studio/camera.ts`
 * for editing.
 *
 * That drift is worth pinning, and it was pinned — inside `apps/studio`, which
 * imported three to do it. That tied the EDITOR to a RENDERER, which is the
 * one thing this architecture spends effort preventing, and
 * `check-boundaries.mjs` said so on every run.
 *
 * So the pin lives in the render adapter, where three may be imported. The
 * numbers below are the editor's formulae restated; when a Babylon adapter
 * arrives it gets the same file, and the editor stays ignorant of both.
 *
 * A disagreement here does not look like a bug. The picture stays correct and
 * the handles land a few pixels off, which reads as "the gizmo is a bit
 * imprecise" for as long as anyone can stand it.
 */

import { describe, expect, it } from "vitest";
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { verticalFovDegrees } from "./translate";

/** The editor's `verticalFov`, restated. Radians. */
function editorVerticalFov(focalLengthMm: number, sensorWidthMm: number, aspect: number): number {
  const sensorHeight = sensorWidthMm / aspect;
  return 2 * Math.atan(sensorHeight / (2 * focalLengthMm));
}

/** The editor's `projectionMatrix`, restated. Column-major. */
function editorPerspective(fovRadians: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovRadians / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}

function editorOrthographic(size: number, aspect: number, near: number, far: number): number[] {
  const halfHeight = size;
  const halfWidth = halfHeight * aspect;
  return [
    1 / halfWidth, 0, 0, 0,
    0, 1 / halfHeight, 0, 0,
    0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ];
}

const ASPECT = 1920 / 1080;
const NEAR = 0.1;
const FAR = 1000;

describe("the editor projects the way three renders", () => {
  it("agrees on the field of view a physical lens produces", () => {
    // A 35mm lens on a 36mm sensor is the broadcast default, and the number
    // most likely to be "simplified" by somebody who does not know it is
    // physical. The adapter's own helper is the reference.
    const theirs = verticalFovDegrees(35, 36, ASPECT);
    const ours = (editorVerticalFov(35, 36, ASPECT) * 180) / Math.PI;
    expect(ours).toBeCloseTo(theirs, 12);
  });

  it("agrees on the perspective matrix, element by element", () => {
    const fov = editorVerticalFov(35, 36, ASPECT);
    const reference = new PerspectiveCamera((fov * 180) / Math.PI, ASPECT, NEAR, FAR);
    reference.updateProjectionMatrix();

    const ours = editorPerspective(fov, ASPECT, NEAR, FAR);
    reference.projectionMatrix.elements.forEach((value, index) => {
      expect(ours[index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("agrees on the orthographic matrix, element by element", () => {
    const size = 5;
    const halfWidth = size * ASPECT;
    const reference = new OrthographicCamera(-halfWidth, halfWidth, size, -size, NEAR, FAR);
    reference.updateProjectionMatrix();

    const ours = editorOrthographic(size, ASPECT, NEAR, FAR);
    reference.projectionMatrix.elements.forEach((value, index) => {
      expect(ours[index], `element ${index}`).toBeCloseTo(value, 10);
    });
  });

  it("projects an off-axis point to the same pixel", () => {
    const fov = editorVerticalFov(35, 36, ASPECT);
    const camera = new PerspectiveCamera((fov * 180) / Math.PI, ASPECT, NEAR, FAR);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const world = new Vector3(1.5, -0.75, 0.5);
    const ndc = world.clone().project(camera);

    // The editor's path: clip = projection · view, then the perspective
    // divide, then NDC to canvas with Y flipped.
    const view = new Matrix4().copy(camera.matrixWorld).invert();
    const projection = new Matrix4().fromArray(editorPerspective(fov, ASPECT, NEAR, FAR));
    const clip = new Matrix4().multiplyMatrices(projection, view);
    const e = clip.elements;
    const x = world.x, y = world.y, z = world.z;
    const cx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    const cy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    const cw = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;

    expect(cx / cw).toBeCloseTo(ndc.x, 10);
    expect(cy / cw).toBeCloseTo(ndc.y, 10);
    expect(cw, "w must be positive in front of the lens").toBeGreaterThan(0);
  });

  it("reports a point behind the lens with a negative w", () => {
    // Behind the camera a perspective divide yields plausible screen
    // coordinates mirrored through the centre. The editor keys `inFront` off
    // this sign, so the sign is the contract.
    const fov = editorVerticalFov(35, 36, ASPECT);
    const camera = new PerspectiveCamera((fov * 180) / Math.PI, ASPECT, NEAR, FAR);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld(true);

    const view = new Matrix4().copy(camera.matrixWorld).invert();
    const projection = new Matrix4().fromArray(editorPerspective(fov, ASPECT, NEAR, FAR));
    const e = new Matrix4().multiplyMatrices(projection, view).elements;
    const behind = { x: 0.5, y: 0, z: 20 };
    const cw = e[3]! * behind.x + e[7]! * behind.y + e[11]! * behind.z + e[15]!;
    expect(cw).toBeLessThan(0);
  });
});
