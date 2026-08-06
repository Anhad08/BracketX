/**
 * The ground — the floor a 3D scene stands on.
 *
 * ==========================================================================
 * WHY A SCENE NEEDS A FLOOR
 * ==========================================================================
 * A perspective view of objects floating in an empty void gives the eye
 * nothing to measure against. You cannot tell whether the camera moved or the
 * object did, whether something is large and far or small and near, or which
 * way "along the ground" even points. Every 3D application solves this the
 * same way and has done for thirty years: a grid on the ground plane and two
 * coloured axes through the origin.
 *
 * It is not decoration. It is the only thing in the viewport that tells you
 * where you are.
 *
 * ==========================================================================
 * ONLY WHEN IT HELPS
 * ==========================================================================
 * A flat graphic seen head on gains nothing from a floor — the grid would
 * project to a single horizontal line across the middle of a lower third,
 * which is worse than nothing. So the ground appears when the camera has been
 * turned and disappears when it returns to Front. The viewport follows the
 * scene rather than offering a mode to choose.
 *
 * ==========================================================================
 * THE GROUND PLANE IS Y = 0
 * ==========================================================================
 * SCENE_FORMAT is Y-up, so the floor is the XZ plane and the two axes drawn on
 * it are X and Z. Blender is Z-up and draws X and Y; the colours are per-axis,
 * not per-screen-direction, so X stays red and Z stays blue. Copying Blender's
 * LABELS rather than its convention would be the mistake here.
 */

import { project, viewMatrix, type CameraView, type Vec3 } from "./camera";
import type { Point } from "./viewport";

export interface GridLine {
  readonly from: Point;
  readonly to: Point;
  /** 0..1. Distance fade, so the grid dissolves rather than ending in a wall. */
  readonly strength: number;
  /** Set for the two axes through the origin. */
  readonly axis?: "x" | "z";
}

export interface GroundOptions {
  /** Half-width in world units. */
  readonly extent?: number;
  readonly spacing?: number;
  /** Every Nth line is drawn stronger, the way a ruler marks centimetres. */
  readonly emphasisEvery?: number;
}

/**
 * The ground grid, projected and ready to draw.
 *
 * Returns screen-space segments rather than world lines because the clipping
 * has to happen in between: a grid line crossing behind the camera projects to
 * a segment that sweeps across the screen in the wrong direction, drawing a
 * bright streak through the middle of the scene. That artefact is the single
 * most common bug in hand-written viewport grids.
 */
export function groundGrid(view: CameraView, options: GroundOptions = {}): readonly GridLine[] {
  const extent = options.extent ?? 20;
  const spacing = options.spacing ?? 1;
  const emphasisEvery = options.emphasisEvery ?? 10;

  const lines: GridLine[] = [];
  const steps = Math.floor(extent / spacing);

  for (let i = -steps; i <= steps; i += 1) {
    const offset = i * spacing;
    const emphasised = i % emphasisEvery === 0;

    // Parallel to X, stepping along Z.
    push(lines, view, { x: -extent, y: 0, z: offset }, { x: extent, y: 0, z: offset },
      i === 0 ? "x" : undefined, emphasised);
    // Parallel to Z, stepping along X.
    push(lines, view, { x: offset, y: 0, z: -extent }, { x: offset, y: 0, z: extent },
      i === 0 ? "z" : undefined, emphasised);
  }
  return lines;
}

function push(
  lines: GridLine[],
  view: CameraView,
  a: Vec3,
  b: Vec3,
  axis: "x" | "z" | undefined,
  emphasised: boolean,
): void {
  const clipped = clipToFront(view, a, b);
  if (clipped === null) return;

  const from = project(view, clipped.a);
  const to = project(view, clipped.b);
  if (from === null || to === null) return;

  // Fade on how close the line COMES to the camera, not on how far its ends
  // are. Measuring the endpoints makes a line running directly beneath the
  // camera fade as though it were at the far edge of the grid, because its
  // ends genuinely are — which faded the entire floor to invisibility while
  // reporting sixty-one perfectly correct lines.
  const distance = distanceToSegment3(cameraPosition(view), clipped.a, clipped.b);
  // Fade to zero over a distance related to where the camera IS, not a fixed
  // 60 units: a camera pulled back to see a whole set would otherwise have no
  // visible grid at all, which is precisely when the floor is most needed.
  const range = Math.max(24, lengthOf(sub(ORIGIN, cameraPosition(view))) * 4);
  const fade = Math.max(0, 1 - distance / range);
  const strength = (axis !== undefined ? 1 : emphasised ? 0.95 : 0.6) * fade;
  if (strength <= 0.02) return;

  lines.push({ from: from.point, to: to.point, strength, ...(axis === undefined ? {} : { axis }) });
}

/**
 * Trims a segment to the part in front of the camera.
 *
 * Without this a line crossing the lens projects to a segment running the
 * wrong way across the whole viewport — a bright streak through the middle of
 * the scene that appears and vanishes as the camera turns.
 */
export function clipToFront(
  view: CameraView,
  a: Vec3,
  b: Vec3,
  margin?: number,
): { a: Vec3; b: Vec3 } | null {
  // The camera's own near plane, not an invented constant. Nothing closer is
  // drawn by the renderer, so nothing closer should be drawn by the editor's
  // chrome either — matching it is both correct and one less number to keep
  // in step by hand.
  const near = margin ?? view.descriptor.near;
  const matrix = viewMatrix(view);
  if (matrix === null) return null;

  // View-space Z, negated: positive means in front, because a camera looks
  // down its own −Z.
  const depth = (p: Vec3): number =>
    -((matrix[2] ?? 0) * p.x + (matrix[6] ?? 0) * p.y + (matrix[10] ?? 0) * p.z + (matrix[14] ?? 0));

  const da = depth(a) - near;
  const db = depth(b) - near;
  if (da <= 0 && db <= 0) return null;
  if (da > 0 && db > 0) return { a, b };

  const t = da / (da - db);
  const cut: Vec3 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  return da > 0 ? { a, b: cut } : { a: cut, b };
}

/** The camera's position, read straight out of its world matrix. */
export function cameraPosition(view: CameraView): Vec3 {
  return { x: view.world[12] ?? 0, y: view.world[13] ?? 0, z: view.world[14] ?? 0 };
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Distance from a point to a segment, in 3D. */
function distanceToSegment3(point: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  if (lengthSquared === 0) return lengthOf(sub(point, a));
  const ap = sub(point, a);
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSquared));
  return lengthOf(sub(point, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }));
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function lengthOf(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

// ---------------------------------------------------------------------------
// The navigation gizmo
// ---------------------------------------------------------------------------

export interface GizmoAxis {
  readonly id: "x" | "y" | "z";
  readonly sign: 1 | -1;
  readonly at: Point;
  /** Painter's-algorithm order: draw the far balls first. */
  readonly depth: number;
  readonly colour: string;
  readonly label: string;
  /** Only the near end of each axis is labelled, as in every tool that has one. */
  readonly labelled: boolean;
}

const GIZMO_COLOURS = { x: "#e5484d", y: "#46a758", z: "#3b82f6" } as const;

/**
 * The little axis ball in the corner.
 *
 * It answers "which way am I facing?" without the designer having to reason
 * about it, and it is the fastest way back to a known angle. It reads the same
 * camera everything else does, so it cannot disagree with the scene.
 *
 * Returned sorted back-to-front, because the balls overlap and an SVG has no
 * depth buffer — drawing them in declaration order puts the far ones on top
 * roughly half the time, which makes the widget read as inside-out.
 */
export function navigationGizmo(view: CameraView, radius: number): readonly GizmoAxis[] {
  const matrix = viewMatrix(view);
  if (matrix === null) return [];

  const out: GizmoAxis[] = [];
  const axes: readonly { id: "x" | "y" | "z"; v: Vec3 }[] = [
    { id: "x", v: { x: 1, y: 0, z: 0 } },
    { id: "y", v: { x: 0, y: 1, z: 0 } },
    { id: "z", v: { x: 0, y: 0, z: 1 } },
  ];

  for (const axis of axes) {
    for (const sign of [1, -1] as const) {
      const v: Vec3 = { x: axis.v.x * sign, y: axis.v.y * sign, z: axis.v.z * sign };
      // Rotate into view space. Translation is ignored: the gizmo shows
      // ORIENTATION, and a widget that drifted as the camera moved would be
      // reporting the wrong thing.
      const vx = (matrix[0] ?? 0) * v.x + (matrix[4] ?? 0) * v.y + (matrix[8] ?? 0) * v.z;
      const vy = (matrix[1] ?? 0) * v.x + (matrix[5] ?? 0) * v.y + (matrix[9] ?? 0) * v.z;
      const vz = (matrix[2] ?? 0) * v.x + (matrix[6] ?? 0) * v.y + (matrix[10] ?? 0) * v.z;

      out.push({
        id: axis.id,
        sign,
        // Screen Y is down, so the view-space Y is negated.
        at: { x: vx * radius, y: -vy * radius },
        depth: vz,
        colour: GIZMO_COLOURS[axis.id],
        label: axis.id.toUpperCase(),
        // vz > 0 is toward the viewer, since the camera looks down −Z.
        labelled: vz > 0,
      });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}
