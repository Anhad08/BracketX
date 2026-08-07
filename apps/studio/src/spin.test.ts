/**
 * Rotate and scale in space.
 *
 * ============================================================================
 * WHAT THESE CASES ARE FOR
 * ============================================================================
 * Every one of them is a way a rotate or scale gizmo feels WRONG rather than
 * broken — the failures that leave a designer saying the viewport is "off"
 * without being able to say why:
 *
 *   · a ring seen edge-on that you can somehow still grab, and which turns the
 *     object wildly when you do
 *   · a drag past half a turn that suddenly spins backwards
 *   · a handle drawn along the red axis that stretches a different one
 *   · a turn about X that quietly discards a turn about Y
 *
 * The last is the one that cost the most to get right, and it is why the
 * rotation is composed as matrices rather than added to a euler component.
 */
import { describe, expect, it } from "vitest";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import { AXES, MIN_FORESHORTENING } from "./studio/axis";
import {
  eulerFromMatrix,
  lookAtRotation,
  orbitBy,
  orbitOf,
  positionFor,
  project,
  rotationAbout,
  worldFromEuler,
  type CameraView,
  type Vec3,
} from "./studio/camera";
import {
  angleAt,
  distanceAlongAxis,
  frameOf,
  GIZMO_MODES,
  pickRing,
  pickScaleHandle,
  projectRings,
  projectScaleHandles,
  scaleFactor,
  turnBetween,
  turnedAbout,
  turnedEuler,
  WORLD_FRAME,
} from "./studio/spin";

const PERSPECTIVE: CameraDescriptor = {
  kind: "perspective",
  focalLengthMm: 35,
  sensorWidthMm: 36,
  near: 0.1,
  far: 1000,
};
const CANVAS = { width: 1920, height: 1080 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function at(position: Vec3): CameraView {
  return {
    descriptor: PERSPECTIVE,
    world: worldFromEuler(position, lookAtRotation(position, ORIGIN)),
    canvas: CANVAS,
  };
}

const FRONT = at({ x: 0, y: 0, z: 10 });
const THREE_QUARTER = at(
  positionFor(orbitBy(orbitOf({ x: 0, y: 0, z: 10 }, ORIGIN), 200, -80), ORIGIN),
);

// ===========================================================================
// The three modes
// ===========================================================================

describe("the modes", () => {
  it("offers exactly move, rotate and scale, in that order", () => {
    expect(GIZMO_MODES.map((mode) => mode.id)).toEqual(["move", "rotate", "scale"]);
  });

  it("explains each in a designer's words, never the engine's", () => {
    for (const mode of GIZMO_MODES) {
      expect(mode.hint).not.toMatch(/matrix|quaternion|euler|vector|transform node/i);
      expect(mode.hint.length).toBeGreaterThan(10);
    }
  });
});

// ===========================================================================
// The frame
// ===========================================================================

describe("frameOf", () => {
  it("is the world frame for a node that has not been turned", () => {
    const frame = frameOf(worldFromEuler(ORIGIN, [0, 0, 0]));
    for (let index = 0; index < 3; index += 1) {
      const wanted = AXES[index]!.direction;
      expect(frame[index]!.direction.x).toBeCloseTo(wanted.x, 6);
      expect(frame[index]!.direction.y).toBeCloseTo(wanted.y, 6);
      expect(frame[index]!.direction.z).toBeCloseTo(wanted.z, 6);
    }
  });

  /**
   * The whole reason the frame exists.
   *
   * A node yawed 90° has its own X pointing along world −Z. A gizmo that drew
   * the red handle along world X would be offering to stretch the object
   * sideways and stretching it towards the camera instead.
   */
  it("follows the node it describes when the node is turned", () => {
    const frame = frameOf(worldFromEuler(ORIGIN, [0, 90, 0]));
    expect(frame[0]!.direction.x).toBeCloseTo(0, 6);
    expect(frame[0]!.direction.z).toBeCloseTo(-1, 6);
    // Y is the axis it was turned about, so Y does not move.
    expect(frame[1]!.direction.y).toBeCloseTo(1, 6);
  });

  it("keeps the colour convention whatever the node is doing", () => {
    const frame = frameOf(worldFromEuler(ORIGIN, [30, 40, 50]));
    expect(frame.map((axis) => axis.colour)).toEqual(AXES.map((axis) => axis.colour));
    expect(frame.map((axis) => axis.id)).toEqual(["x", "y", "z"]);
  });

  /**
   * A scaled node's matrix columns are not unit vectors, and a direction that
   * is not unit length turns every distance solve into a distance in the wrong
   * units — a drag on a node scaled 4× would move it four times too far.
   */
  it("normalises, so a scaled node's gizmo is not scaled with it", () => {
    const scaled = [...worldFromEuler(ORIGIN, [0, 0, 0])];
    scaled[0] = 4;
    scaled[5] = 0.25;
    const frame = frameOf(scaled);
    for (const axis of frame) {
      const { x, y, z } = axis.direction;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
  });

  it("falls back to the world frame rather than vanishing on a degenerate matrix", () => {
    const flat = [...worldFromEuler(ORIGIN, [0, 0, 0])];
    flat[0] = 0;
    flat[1] = 0;
    flat[2] = 0;
    expect(frameOf(flat)).toBe(WORLD_FRAME);
    expect(frameOf(undefined)).toBe(WORLD_FRAME);
  });
});

// ===========================================================================
// Rotate — the rings
// ===========================================================================

describe("projectRings", () => {
  it("draws a ring per axis, closed", () => {
    const rings = projectRings(THREE_QUARTER, ORIGIN, 2);
    expect(rings).toHaveLength(3);
    for (const ring of rings) {
      const first = ring.points[0]!;
      const last = ring.points[ring.points.length - 1]!;
      expect(last.x).toBeCloseTo(first.x, 6);
      expect(last.y).toBeCloseTo(first.y, 6);
    }
  });

  /**
   * Square-on, the Z ring faces the camera and is fully open; the X and Y
   * rings are edge-on and are refused. Which is exactly the flat case: the
   * only rotation a lower third wants is the one in the plane of the picture.
   */
  it("opens the ring that faces the camera and closes the two that do not", () => {
    const rings = projectRings(FRONT, ORIGIN, 2);
    const z = rings.find((ring) => ring.axis.id === "z")!;
    const x = rings.find((ring) => ring.axis.id === "x")!;
    expect(z.openness).toBeGreaterThan(0.95);
    expect(x.openness).toBeLessThan(MIN_FORESHORTENING);
  });

  /**
   * THE BUG THE OBVIOUS MEASURE WOULD HAVE SHIPPED.
   *
   * Openness taken from the bounding box calls a ring seen edge-on at
   * forty-five degrees fully open, because a diagonal line's bounding box is a
   * square. The hit test would then offer a target one pixel wide, and any
   * drag on it would turn the object by an arbitrary amount.
   */
  it("calls an edge-on ring closed however it is angled on screen", () => {
    // A frame rolled 45° about Z, seen square-on. The ring about its local X
    // lies in the plane spanned by local Y and local Z — local Z runs straight
    // down the view axis, so the ring is EDGE-ON, and local Y draws as a
    // diagonal. It is therefore a diagonal line, whose bounding box is a
    // SQUARE.
    const rolled = frameOf(worldFromEuler(ORIGIN, [0, 0, 45]));
    const ring = projectRings(FRONT, ORIGIN, 2, rolled).find(
      (candidate) => candidate.axis.id === "x",
    )!;

    const xs = ring.points.map((point) => point.x);
    const ys = ring.points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // The measure that would have shipped says fully open...
    expect(Math.min(width, height) / Math.max(width, height)).toBeGreaterThan(0.9);
    // ...and the ring is a line, so it must be refused.
    expect(ring.openness).toBeLessThan(MIN_FORESHORTENING);
    expect(pickRing([ring], ring.points[8]!, 8)).toBeNull();
  });

  it("draws the rings in the selection's frame, not the world's", () => {
    const yawed = frameOf(worldFromEuler(ORIGIN, [0, 90, 0]));
    const world = projectRings(FRONT, ORIGIN, 2);
    const local = projectRings(FRONT, ORIGIN, 2, yawed);
    // Yawed 90°, the node's own X ring now lies where the world's Z ring was:
    // it faces the camera and is the open one.
    expect(local.find((ring) => ring.axis.id === "x")!.openness).toBeGreaterThan(0.95);
    expect(world.find((ring) => ring.axis.id === "x")!.openness).toBeLessThan(
      MIN_FORESHORTENING,
    );
  });
});

describe("pickRing", () => {
  it("grabs the ring the pointer is on", () => {
    const rings = projectRings(THREE_QUARTER, ORIGIN, 2);
    for (const ring of rings) {
      if (ring.openness < MIN_FORESHORTENING) continue;
      expect(pickRing(rings, ring.points[8]!, 6)).toBe(ring.axis.id);
    }
  });

  it("refuses a ring too edge-on to aim at", () => {
    const rings = projectRings(FRONT, ORIGIN, 2);
    const x = rings.find((ring) => ring.axis.id === "x")!;
    expect(pickRing([x], x.points[8]!, 6)).toBeNull();
  });

  it("grabs nothing in the middle of the gizmo, where a free drag belongs", () => {
    const rings = projectRings(FRONT, ORIGIN, 2);
    const centre = project(FRONT, ORIGIN)!.point;
    expect(pickRing(rings, centre, 6)).toBeNull();
  });
});

describe("angleAt", () => {
  /**
   * Solved in world space, not on screen.
   *
   * The round trip is the assertion: a point on the ring, projected to the
   * canvas and read back, must report the angle it was built at. Screen angle
   * would fail this the moment the ring is tilted, because an ellipse's
   * parameter is not its apparent angle.
   */
  it("round-trips a point on the ring back to the angle it was built at", () => {
    const radius = 2;
    for (const theta of [0, 0.7, 2.1, -1.3, 3.0]) {
      const world: Vec3 = {
        x: 0,
        y: radius * Math.sin(theta),
        z: radius * Math.cos(theta),
      };
      // The X ring's own basis is [Y, Z] — cos along Y, sin along Z.
      const wanted = Math.atan2(world.z, world.y);
      const canvas = project(THREE_QUARTER, world)!.point;
      const found = angleAt(THREE_QUARTER, canvas, ORIGIN, "x")!;
      expect(Math.abs(turnBetween(wanted, found))).toBeLessThan(0.02);
    }
  });

  it("gives up rather than guessing when the pointer never meets the plane", () => {
    // From the side, the pointer ray through the centre runs ALONG the Z
    // ring's plane and never crosses it. There is no angle to report, and
    // reporting one anyway would make the object jump on the first move.
    const side = at({ x: 10, y: 0, z: 0 });
    const centre = project(side, ORIGIN)!.point;
    expect(angleAt(side, centre, ORIGIN, "z")).toBeNull();
  });
});

describe("turnBetween", () => {
  it("takes the short way round, so a drag never spins the wrong way", () => {
    expect(turnBetween(3.0, -3.0)).toBeCloseTo(0.283, 2);
    expect(turnBetween(-3.0, 3.0)).toBeCloseTo(-0.283, 2);
  });

  it("is zero for no movement", () => {
    expect(turnBetween(1.2, 1.2)).toBe(0);
  });
});

// ===========================================================================
// Rotate — composing the turn
// ===========================================================================

describe("turnedEuler", () => {
  it("turns an unrotated node by exactly what was asked", () => {
    const next = turnedEuler([0, 0, 0], { x: 0, y: 1, z: 0 }, Math.PI / 4);
    expect(next[0]).toBeCloseTo(0, 6);
    expect(next[1]).toBeCloseTo(45, 6);
    expect(next[2]).toBeCloseTo(0, 6);
  });

  /**
   * THE CASE THAT MAKES THE MATRIX COMPOSITION NECESSARY.
   *
   * Adding the drag's angle to one euler component is the obvious thing, and a
   * node already yawed 90° proves it wrong: turning about world X must tip the
   * object towards the camera, and adding 30 to the X component tips it about
   * its OWN x, which after a 90° yaw is a completely different direction. The
   * object slides off the ring you are dragging and no correction brings it
   * back.
   */
  it("turns about the WORLD axis even when the node is already turned", () => {
    const start: readonly [number, number, number] = [0, 90, 0];
    const next = turnedEuler(start, { x: 1, y: 0, z: 0 }, Math.PI / 6);

    // Verified through the matrices rather than by asserting euler numbers,
    // because there is more than one euler for the same orientation.
    const wanted = multiply3(
      rotationAbout({ x: 1, y: 0, z: 0 }, Math.PI / 6),
      worldFromEuler(ORIGIN, start),
    );
    const got = worldFromEuler(ORIGIN, [...next] as [number, number, number]);
    for (let index = 0; index < 12; index += 1) {
      if (index % 4 === 3) continue;
      expect(got[index]!).toBeCloseTo(wanted[index]!, 5);
    }
    // And it is NOT what adding to the component would have given.
    expect(Math.abs(next[0]! - 30) + Math.abs(next[1]! - 90)).toBeGreaterThan(1);
  });

  it("composes, so two half turns are one whole one", () => {
    const once = turnedEuler([0, 0, 0], { x: 0, y: 0, z: 1 }, Math.PI / 4);
    const twice = turnedEuler(once, { x: 0, y: 0, z: 1 }, Math.PI / 4);
    expect(twice[2]).toBeCloseTo(90, 4);
  });

  it("does nothing for a turn of nothing", () => {
    const start: readonly [number, number, number] = [12, 34, 56];
    const next = turnedEuler(start, { x: 0, y: 1, z: 0 }, 0);
    for (let index = 0; index < 3; index += 1) {
      expect(next[index]!).toBeCloseTo(start[index]!, 4);
    }
  });
});

describe("eulerFromMatrix", () => {
  it("round-trips every rotation worldFromEuler can build", () => {
    for (const rotation of [
      [0, 0, 0],
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 90],
      [15, -60, 200],
      [-80, 170, -45],
    ] as const) {
      const back = eulerFromMatrix(worldFromEuler(ORIGIN, rotation));
      const rebuilt = worldFromEuler(ORIGIN, [...back] as [number, number, number]);
      const original = worldFromEuler(ORIGIN, rotation);
      for (let index = 0; index < 12; index += 1) {
        if (index % 4 === 3) continue;
        expect(rebuilt[index]!).toBeCloseTo(original[index]!, 5);
      }
    }
  });

  /**
   * Straight up, yaw and roll turn about the same world axis and only their
   * sum survives. Roll is what is given up: an object aimed straight down is
   * one somebody aimed, and aim is what yaw carries.
   */
  it("keeps the aim rather than the roll when the two collapse into one", () => {
    const back = eulerFromMatrix(worldFromEuler(ORIGIN, [90, 40, 0]));
    expect(back[0]).toBeCloseTo(90, 3);
    expect(back[2]).toBe(0);
  });
});

describe("turnedAbout", () => {
  it("orbits a point about the pivot, so a group turns as a group", () => {
    const next = turnedAbout([2, 0, 0], ORIGIN, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(next[0]).toBeCloseTo(0, 6);
    expect(next[2]).toBeCloseTo(-2, 6);
  });

  it("leaves a point standing on the pivot exactly where it is", () => {
    const next = turnedAbout([3, 4, 5], { x: 3, y: 4, z: 5 }, { x: 1, y: 0, z: 0 }, 1.1);
    expect(next[0]).toBeCloseTo(3, 6);
    expect(next[1]).toBeCloseTo(4, 6);
    expect(next[2]).toBeCloseTo(5, 6);
  });
});

// ===========================================================================
// Scale
// ===========================================================================

describe("projectScaleHandles", () => {
  it("draws a handle per axis from the selection's centre", () => {
    const handles = projectScaleHandles(THREE_QUARTER, ORIGIN, 2);
    expect(handles).toHaveLength(3);
    const centre = project(THREE_QUARTER, ORIGIN)!.point;
    for (const handle of handles) {
      expect(handle.from.x).toBeCloseTo(centre.x, 6);
      expect(handle.from.y).toBeCloseTo(centre.y, 6);
    }
  });

  it("fades the handle pointing at the lens below the same threshold the arms use", () => {
    const handles = projectScaleHandles(FRONT, ORIGIN, 2);
    const z = handles.find((handle) => handle.axis.id === "z")!;
    expect(z.foreshortening).toBeLessThan(MIN_FORESHORTENING);
    const x = handles.find((handle) => handle.axis.id === "x")!;
    expect(x.foreshortening).toBeGreaterThan(0.9);
  });

  it("draws along the node's own axes when it has been turned", () => {
    const yawed = frameOf(worldFromEuler(ORIGIN, [0, 90, 0]));
    const handles = projectScaleHandles(FRONT, ORIGIN, 2, yawed);
    // X now points along world −Z, straight at the lens, so it is the one
    // that foreshortens — the handle describes the object, not the room.
    const x = handles.find((handle) => handle.axis.id === "x")!;
    expect(x.foreshortening).toBeLessThan(MIN_FORESHORTENING);
  });
});

describe("pickScaleHandle", () => {
  it("grabs the cap the pointer is on", () => {
    const handles = projectScaleHandles(THREE_QUARTER, ORIGIN, 2);
    for (const handle of handles) {
      if (handle.foreshortening < MIN_FORESHORTENING) continue;
      expect(pickScaleHandle(handles, handle.at, 6)).toBe(handle.axis.id);
    }
  });

  it("refuses a cap on an axis pointing at the camera", () => {
    const handles = projectScaleHandles(FRONT, ORIGIN, 2);
    const z = handles.find((handle) => handle.axis.id === "z")!;
    expect(pickScaleHandle([z], z.at, 6)).toBeNull();
  });

  it("does not grab from halfway down the stem, where a free drag belongs", () => {
    const handles = projectScaleHandles(THREE_QUARTER, ORIGIN, 2);
    const handle = handles.find((entry) => entry.foreshortening > 0.5)!;
    const middle = {
      x: (handle.from.x + handle.at.x) / 2,
      y: (handle.from.y + handle.at.y) / 2,
    };
    expect(pickScaleHandle(handles, middle, 6)).toBeNull();
  });
});

describe("distanceAlongAxis", () => {
  it("reads back the distance a point was placed at", () => {
    for (const distance of [1, 2.5, -3]) {
      const world: Vec3 = { x: distance, y: 0, z: 0 };
      const canvas = project(THREE_QUARTER, world)!.point;
      const found = distanceAlongAxis(THREE_QUARTER, canvas, ORIGIN, "x")!;
      expect(found).toBeCloseTo(distance, 3);
    }
  });

  it("measures along the node's own axis when given its frame", () => {
    const yawed = frameOf(worldFromEuler(ORIGIN, [0, 90, 0]));
    // The node's local +X is world −Z. A point 2 along it is at z = −2.
    const canvas = project(THREE_QUARTER, { x: 0, y: 0, z: -2 })!.point;
    expect(distanceAlongAxis(THREE_QUARTER, canvas, ORIGIN, "x", yawed)!).toBeCloseTo(2, 3);
  });
});

describe("scaleFactor", () => {
  it("is a ratio, so letting go where you grabbed changes nothing", () => {
    expect(scaleFactor(2, 2)).toBe(1);
  });

  it("doubles when the pointer goes twice as far from the pivot", () => {
    expect(scaleFactor(2, 4)).toBe(2);
  });

  /**
   * Dragging past the pivot flips the sign, and a factor of zero or less
   * collapses the object to nothing. There is no gesture that recovers from
   * that, so it is clamped rather than allowed.
   */
  it("refuses to collapse an object to nothing", () => {
    expect(scaleFactor(2, 0)).toBeGreaterThan(0);
    expect(scaleFactor(2, -5)).toBeGreaterThan(0);
  });

  it("gives up on a grab that started on the pivot itself", () => {
    expect(scaleFactor(0, 4)).toBe(1);
  });
});

/** Column-major multiply, matching the editor's own convention. */
function multiply3(a: readonly number[], b: readonly number[]): readonly number[] {
  const out: number[] = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let total = 0;
      for (let k = 0; k < 4; k += 1) total += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = total;
    }
  }
  return out;
}
