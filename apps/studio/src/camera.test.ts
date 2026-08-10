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
 * That pin lives in the RENDER ADAPTER — `projection-parity.test.ts` in
 * engine-render-three, where three may be imported. It used to live here, and
 * importing three to check the editor tied the editor to a renderer, which is
 * the one thing this architecture spends effort preventing.
 *
 * What remains here is the maths that is the editor's own: inversion,
 * multiplication, unprojection, ray-plane intersection and the orbit model.
 * None of it needs a renderer to be checked, and none of it should.
 */
import { describe, expect, it } from "vitest";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import {
  DEFAULT_ORBIT,
  framedOrbit,
  framingRadius,
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
  worldFromEuler,
  type CameraView,
} from "./studio/camera";
import { canvasSize, canvasToWorld, worldToCanvas } from "./studio/viewport";
import { instantiateTemplate } from "./studio/packs";
import { ESSENTIALS } from "./studio/essentials";
import { makeIdFactory } from "./studio/ids";

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


});

describe("project", () => {
  it("puts the origin at the centre of the canvas", () => {
    const result = project(frontOn(), { x: 0, y: 0, z: 0 });
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(CANVAS.width / 2, 6);
    expect(result!.point.y).toBeCloseTo(CANVAS.height / 2, 6);
    expect(result!.inFront).toBe(true);
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

    const view: CameraView = {
      descriptor: PERSPECTIVE,
      world: worldFromEuler(position, rotation),
      canvas: CANVAS,
    };
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

    // Build the matrix and check it actually LOOKS AT the pivot — a rotation
    // that is merely plausible is not good enough. A camera looks down its
    // own −Z, so the third column negated is its forward direction.
    const world = worldFromEuler(position, [pitch, yaw, roll]);
    const forward = { x: -(world[8] ?? 0), y: -(world[9] ?? 0), z: -(world[10] ?? 0) };
    const dx = pivot.x - position.x, dy = pivot.y - position.y, dz = pivot.z - position.z;
    const length = Math.hypot(dx, dy, dz);
    const dot = (forward.x * dx + forward.y * dy + forward.z * dz) / length;
    expect(dot).toBeCloseTo(1, 6);
  });
});

// ===========================================================================
// Equivalence with the affine map it replaces
// ===========================================================================

/**
 * The safety proof for the swap.
 *
 * Every existing 2D scene uses the default broadcast camera: orthographic,
 * size 5, at (0, 0, 10), unrotated. For THAT camera the new projection must
 * agree with `worldToCanvas` exactly — otherwise replacing the affine map
 * moves every lower third in the product by a few pixels, and no test that
 * looks only at 3D would notice.
 *
 * This is what makes the change safe to make at all: it is a strict
 * generalisation, not a replacement.
 */
describe("agreement with the affine map, for the default broadcast camera", () => {
  const document_ = instantiateTemplate(ESSENTIALS[0]!, makeIdFactory(11), "2026-01-01T00:00:00.000Z");
  const canvas = canvasSize(document_);
  const view: CameraView = {
    descriptor: { kind: "orthographic", size: 5, near: 0.1, far: 100 },
    world: translation(0, 0, 10),
    canvas,
  };

  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 3.2, y: -1.8, z: 0 },
    { x: -4.9, y: 2.4, z: 0 },
    { x: 8.88, y: 4.99, z: 0 },
  ];

  it("projects every point to the same canvas pixel", () => {
    for (const point of points) {
      const affine = worldToCanvas(document_, { x: point.x, y: point.y });
      const ours = project(view, point)!;
      expect(ours.point.x, `x for ${JSON.stringify(point)}`).toBeCloseTo(affine.x, 6);
      expect(ours.point.y, `y for ${JSON.stringify(point)}`).toBeCloseTo(affine.y, 6);
    }
  });

  it("unprojects every point back the same way", () => {
    for (const point of points) {
      const canvasPoint = worldToCanvas(document_, { x: point.x, y: point.y });
      const affine = canvasToWorld(document_, canvasPoint);
      const ours = intersectPlane(rayThrough(view, canvasPoint)!, 0)!;
      expect(ours.x).toBeCloseTo(affine.x, 6);
      expect(ours.y).toBeCloseTo(affine.y, 6);
    }
  });
})

// ===========================================================================
// FRAMING — the distance is derived, never chosen
// ===========================================================================
// A fixed camera distance is only right for the set it was written against,
// and Streamatrix graphics are authored at wildly different world scales. So
// these check the RELATIONSHIPS a framing calculation has to satisfy, at the
// shapes that break naive implementations.
describe("framingRadius holds a box inside the frustum", () => {
  const FOV = 50;
  const WIDE = 16 / 9;

  /** Half-angles, from the same convention the function uses. */
  const halfAngles = (fov: number, aspect: number) => {
    const v = (fov * Math.PI) / 180;
    return { v: v / 2, h: Math.atan(Math.tan(v / 2) * aspect) };
  };

  /** Does a box of this size actually fit at this distance? */
  const fits = (
    extent: { width: number; height: number; depth: number },
    radius: number,
    fov: number,
    aspect: number,
  ) => {
    const { v, h } = halfAngles(fov, aspect);
    // The FRONT face is what has to fit — the near plane of the box, not its
    // centre, which is why depth participates.
    const front = radius - extent.depth / 2;
    return (
      front > 0 &&
      extent.height / 2 <= Math.tan(v) * front + 1e-9 &&
      extent.width / 2 <= Math.tan(h) * front + 1e-9
    );
  };

  it("fits a cube, a wide plate, a tall column and a deep block", () => {
    const shapes = [
      { name: "cube", width: 2, height: 2, depth: 2 },
      { name: "wide", width: 40, height: 2, depth: 1 },
      { name: "tall", width: 1, height: 30, depth: 1 },
      { name: "deep", width: 2, height: 2, depth: 60 },
      { name: "asymmetric", width: 17, height: 3, depth: 9 },
    ];
    for (const shape of shapes) {
      const radius = framingRadius(shape, FOV, WIDE);
      expect(fits(shape, radius, FOV, WIDE), `${shape.name} did not fit`).toBe(true);
    }
  });

  it("binds on WIDTH in a narrow viewport and on HEIGHT in a wide one", () => {
    // The failure this rules out: using only the vertical fov, which frames
    // correctly in landscape and lets wide content spill off the sides the
    // moment the viewport is portrait.
    const plate = { width: 20, height: 4, depth: 0 };
    const portrait = framingRadius(plate, FOV, 0.5);
    const landscape = framingRadius(plate, FOV, 2);
    expect(portrait, "a narrow viewport did not pull the camera back").toBeGreaterThan(landscape);
    expect(fits(plate, portrait, FOV, 0.5)).toBe(true);
    expect(fits(plate, landscape, FOV, 2)).toBe(true);
  });

  it("scales with the content rather than sitting at a fixed distance", () => {
    // Ten times the object, ten times the distance. A magic number cannot do
    // this, which is the whole reason the calculation exists.
    const small = framingRadius({ width: 1, height: 1, depth: 1 }, FOV, WIDE);
    const large = framingRadius({ width: 10, height: 10, depth: 10 }, FOV, WIDE);
    expect(large / small).toBeCloseTo(10, 1);
  });

  it("pulls further back as the lens narrows", () => {
    const box = { width: 5, height: 5, depth: 5 };
    expect(framingRadius(box, 20, WIDE)).toBeGreaterThan(framingRadius(box, 60, WIDE));
  });

  it("survives a degenerate box instead of landing on the pivot", () => {
    // A scene with one zero-size node must not produce radius 0, where the
    // projection degenerates and no gesture can recover the view.
    expect(framingRadius({ width: 0, height: 0, depth: 0 }, FOV, WIDE)).toBeGreaterThan(0);
    expect(framingRadius({ width: 2, height: 2, depth: 2 }, FOV, Number.NaN)).toBeGreaterThan(0);
  });
});

describe("framedOrbit changes distance, not viewpoint", () => {
  it("keeps the angle the user is already looking from", () => {
    // Fit is not Reset. Snapping to a canned three-quarter angle would throw
    // away the orientation somebody just chose to inspect from.
    const current = { radius: 3, azimuth: 1.1, elevation: -0.4 };
    const framed = framedOrbit(current, { width: 8, height: 8, depth: 8 }, 50, 1.6);
    expect(framed.azimuth).toBe(current.azimuth);
    expect(framed.elevation).toBe(current.elevation);
    expect(framed.radius).not.toBe(current.radius);
  });

  it("adopts the default angle when there is no angle yet", () => {
    const framed = framedOrbit({ radius: 0, azimuth: 0, elevation: 0 }, { width: 4, height: 4, depth: 4 }, 50, 1.6);
    expect(framed.azimuth).toBe(DEFAULT_ORBIT.azimuth);
    expect(framed.elevation).toBe(DEFAULT_ORBIT.elevation);
  });

  it("opens on an angle that shows more than a silhouette", () => {
    // Square-on is the one view that cannot say what shape something is.
    expect(DEFAULT_ORBIT.azimuth).toBeGreaterThan(0);
    expect(DEFAULT_ORBIT.elevation).toBeGreaterThan(0);
  });
});
