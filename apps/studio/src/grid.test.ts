/**
 * The ground grid and the navigation gizmo.
 *
 * The cases here are the ones that produce the classic hand-written viewport
 * artefacts: a grid line crossing the lens and streaking across the screen, a
 * grid that ends in a hard wall, and an axis ball that renders inside-out.
 */
import { describe, expect, it } from "vitest";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import { cameraPosition, clipToFront, groundGrid, navigationGizmo } from "./studio/grid";
import { lookAtRotation, worldFromEuler, type CameraView } from "./studio/camera";

const PERSPECTIVE: CameraDescriptor = {
  kind: "perspective",
  focalLengthMm: 35,
  sensorWidthMm: 36,
  near: 0.1,
  far: 1000,
};
const CANVAS = { width: 1920, height: 1080 };
const ORIGIN = { x: 0, y: 0, z: 0 };

/**
 * A camera at `position`, aimed at the origin.
 *
 * Built with the editor's own `worldFromEuler` rather than by borrowing the
 * renderer's matrix maths. A test that reached into three to check the editor
 * would tie the editor to a renderer — which is exactly what
 * `check-boundaries.mjs` exists to stop, and exactly what this file used to
 * do.
 */
function at(position: { x: number; y: number; z: number }): CameraView {
  return {
    descriptor: PERSPECTIVE,
    world: worldFromEuler(position, lookAtRotation(position, ORIGIN)),
    canvas: CANVAS,
  };
}

/** Above and to the side — a working 3D angle. */
const RAISED = at({ x: 7, y: 6, z: 9 });

describe("cameraPosition", () => {
  it("reads the position out of the camera's own matrix", () => {
    const where = cameraPosition(at({ x: 3, y: -2, z: 8 }));
    expect(where.x).toBeCloseTo(3, 9);
    expect(where.y).toBeCloseTo(-2, 9);
    expect(where.z).toBeCloseTo(8, 9);
  });
});

describe("clipToFront", () => {
  const view = at({ x: 0, y: 0, z: 10 });

  it("keeps a segment entirely in front", () => {
    expect(clipToFront(view, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })).not.toBeNull();
  });

  it("drops a segment entirely behind", () => {
    expect(clipToFront(view, { x: -5, y: 0, z: 30 }, { x: 5, y: 0, z: 30 })).toBeNull();
  });

  it("trims a segment that crosses the lens", () => {
    // The artefact this prevents: a line crossing behind the camera projects
    // to a segment running the WRONG WAY across the whole viewport, drawing a
    // bright streak through the middle of the scene.
    const clipped = clipToFront(view, { x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 30 });
    expect(clipped).not.toBeNull();
    // Everything kept must be in front of the camera at z = 10.
    expect(clipped!.a.z).toBeLessThan(10);
    expect(clipped!.b.z).toBeLessThan(10);
  });

  it("keeps the end that was in front, whichever end that is", () => {
    const forwards = clipToFront(view, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 30 })!;
    const backwards = clipToFront(view, { x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 0 })!;
    expect(forwards.a.z).toBeCloseTo(0, 6);
    expect(backwards.b.z).toBeCloseTo(0, 6);
  });
});

describe("groundGrid", () => {
  it("draws a grid, with both ground axes marked", () => {
    const lines = groundGrid(RAISED, { extent: 12, spacing: 1 });
    expect(lines.length).toBeGreaterThan(10);
    // Y-up world: the floor is XZ, so the axes ON it are X and Z. Copying
    // Blender's labels rather than its convention would be the mistake.
    expect(lines.some((line) => line.axis === "x")).toBe(true);
    expect(lines.some((line) => line.axis === "z")).toBe(true);
    // And no "y": the vertical axis does not lie in the floor. The type
    // makes this unrepresentable, which is the better guarantee — this line
    // records the intent for a reader.
    expect(lines.every((line) => line.axis === undefined || line.axis === "x" || line.axis === "z"))
      .toBe(true);
  });

  it("draws the axes stronger than the ordinary lines", () => {
    const lines = groundGrid(RAISED, { extent: 12, spacing: 1 });
    const axis = lines.find((line) => line.axis === "x")!;
    const plain = lines.filter((line) => line.axis === undefined);
    expect(axis.strength).toBeGreaterThan(Math.max(...plain.map((line) => line.strength)) * 0.9);
  });

  it("fades with distance instead of ending in a wall", () => {
    const lines = groundGrid(RAISED, { extent: 40, spacing: 2 });
    const strengths = lines.map((line) => line.strength);
    expect(Math.min(...strengths)).toBeLessThan(Math.max(...strengths) * 0.6);
    // And nothing invisible is emitted, which would be pure draw cost.
    expect(Math.min(...strengths)).toBeGreaterThan(0.01);
  });

  it("never emits a coordinate that is not a number, at any angle", () => {
    // Including a camera sitting almost ON the floor, where lines run to the
    // horizon and the maths is at its worst. A single NaN silently destroys
    // an SVG path — nothing throws, the grid simply stops being drawn, and
    // the cause is invisible.
    //
    // A long segment is NOT an error here: a floor line seen from a grazing
    // camera genuinely reaches the horizon, and the browser clips it. The
    // artefact that matters is a line wrapping THROUGH the lens, which
    // `clipToFront` is tested for directly above.
    for (const camera of [RAISED, at({ x: 0, y: 0.2, z: 3 }), at({ x: 1, y: 0.05, z: 0.5 })]) {
      for (const line of groundGrid(camera, { extent: 20, spacing: 1 })) {
        for (const value of [line.from.x, line.from.y, line.to.x, line.to.y, line.strength]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});

describe("navigationGizmo", () => {
  it("shows six ends — three axes, both directions", () => {
    expect(navigationGizmo(RAISED, 30)).toHaveLength(6);
  });

  it("returns them back to front, so the widget is not inside-out", () => {
    // An SVG has no depth buffer, so declaration order IS draw order.
    const balls = navigationGizmo(RAISED, 30);
    for (let i = 1; i < balls.length; i += 1) {
      expect(balls[i]!.depth).toBeGreaterThanOrEqual(balls[i - 1]!.depth);
    }
  });

  it("labels only the ends facing the viewer", () => {
    const balls = navigationGizmo(RAISED, 30);
    const labelled = balls.filter((ball) => ball.labelled);
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.length).toBeLessThan(6);
    // Each axis is labelled at most once — its near end.
    for (const id of ["x", "y", "z"] as const) {
      expect(labelled.filter((ball) => ball.id === id).length).toBeLessThanOrEqual(1);
    }
  });

  it("puts +Y at the top of the widget for a level camera", () => {
    const balls = navigationGizmo(at({ x: 0, y: 0, z: 10 }), 30);
    const up = balls.find((ball) => ball.id === "y" && ball.sign === 1)!;
    // Screen Y grows down, so up is negative.
    expect(up.at.y).toBeLessThan(-20);
    expect(Math.abs(up.at.x)).toBeLessThan(1);
  });

  it("shows orientation only — moving the camera without turning it changes nothing", () => {
    // Translation must be ignored, or the widget drifts as the camera moves
    // and starts reporting something that is not orientation.
    const near = navigationGizmo(at({ x: 0, y: 0, z: 4 }), 30);
    const far = navigationGizmo(at({ x: 0, y: 0, z: 40 }), 30);
    for (let i = 0; i < near.length; i += 1) {
      expect(near[i]!.at.x).toBeCloseTo(far[i]!.at.x, 6);
      expect(near[i]!.at.y).toBeCloseTo(far[i]!.at.y, 6);
    }
  });
});
