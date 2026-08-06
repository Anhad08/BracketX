/**
 * Named camera views.
 *
 * The cases here are the ones that make a 3D editor feel broken: a view that
 * silently re-frames, a "Top" that flips the horizon, and a highlight that
 * lies about which view you are in.
 */
import { describe, expect, it } from "vitest";
import { lookAtRotation, orbitOf, positionFor, type Vec3 } from "./studio/camera";
import { poseFor, viewOf, VIEWS } from "./studio/views";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

describe("named views", () => {
  it("keeps the distance the camera already had", () => {
    // Someone dollied in on letter-spacing expects "Side" to show them that
    // title from the side, not to fly back out to a default distance.
    for (const view of VIEWS) {
      const pose = poseFor(view, ORIGIN, 3.5);
      expect(Math.hypot(...pose.position), view.label).toBeCloseTo(3.5, 5);
    }
  });

  it("aims every view at the pivot", () => {
    const pivot: Vec3 = { x: 1, y: -0.5, z: 2 };
    for (const view of VIEWS) {
      const pose = poseFor(view, pivot, 8);
      const expected = lookAtRotation(
        { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
        pivot,
      );
      expect(pose.rotation[0], `${view.label} pitch`).toBeCloseTo(expected[0], 4);
      expect(pose.rotation[1], `${view.label} yaw`).toBeCloseTo(expected[1], 4);
      expect(pose.rotation[2], `${view.label} roll`).toBe(0);
    }
  });

  it("never puts the camera at the pole, where the horizon flips", () => {
    const top = VIEWS.find((view) => view.id === "top")!;
    expect(Math.abs(top.elevation)).toBeLessThan(Math.PI / 2);
    // And the pose it produces still has a usable horizontal component.
    const pose = poseFor(top, ORIGIN, 10);
    expect(Math.hypot(pose.position[0], pose.position[2])).toBeGreaterThan(0);
  });

  it("puts Front on the +Z axis, where flat graphics are designed", () => {
    const pose = poseFor(VIEWS.find((view) => view.id === "front")!, ORIGIN, 10);
    expect(pose.position[0]).toBeCloseTo(0, 6);
    expect(pose.position[1]).toBeCloseTo(0, 6);
    expect(pose.position[2]).toBeCloseTo(10, 6);
    expect(pose.rotation).toEqual([0, 0, 0]);
  });

  it("recognises the view a camera is actually in", () => {
    for (const view of VIEWS) {
      const pose = poseFor(view, ORIGIN, 10);
      const orbit = orbitOf(
        { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
        ORIGIN,
      );
      expect(viewOf(orbit)?.id, view.label).toBe(view.id);
    }
  });

  it("reports no view once the camera has been orbited away", () => {
    // The distinction that matters: "I am in Front" versus "I have orbited
    // back to roughly the front", which is where a graphic quietly stops
    // being pixel-accurate.
    const nudged = orbitOf(positionFor({ radius: 10, azimuth: 0.3, elevation: 0.2 }, ORIGIN), ORIGIN);
    expect(viewOf(nudged)).toBeNull();
  });

  it("does not treat 359 degrees as far from 1 degree", () => {
    const front = orbitOf(positionFor({ radius: 10, azimuth: -0.005, elevation: 0 }, ORIGIN), ORIGIN);
    expect(viewOf(front)?.id).toBe("front");
  });
});
