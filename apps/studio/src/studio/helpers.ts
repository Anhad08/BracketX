/**
 * Viewport helpers — the things in a scene that have no surface.
 *
 * ============================================================================
 * A 3D SCENE WHOSE CAMERA AND LIGHTS ARE INVISIBLE IS A 2D EDITOR
 * ============================================================================
 * Every scene Studio opens contains a broadcast camera and, once anything is
 * lit, a key light and a fill. Until now none of them appeared in the 3D
 * viewport at all. You could orbit around a lower third and see a ground grid
 * and a slab — and the three objects that decide how the graphic is SHOT and
 * how it is LIT were not there.
 *
 * That is the single clearest tell that a viewport belongs to a 2D editor with
 * a renderer bolted on. Every real 3D tool draws these, and it draws them for
 * a practical reason rather than a decorative one: they are the objects you
 * most often need to select, and an object you cannot see is an object you
 * cannot click.
 *
 * ============================================================================
 * DRAWN IN CHROME, NOT IN THE SCENE
 * ============================================================================
 * None of this is scene content. A frustum is not a mesh, a light icon is not
 * a graphic, and neither must ever reach air — so nothing here touches the
 * document, the projector or a backend. It is screen-space geometry computed
 * from the same `project()` the selection box and the axis gizmo already use,
 * which is what guarantees a helper lands exactly where the thing it describes
 * actually is.
 *
 * Everything returns SCREEN-SPACE points and nothing draws. The component
 * renders; this file decides where.
 */
import type { CameraDescriptor } from "@bracketx/engine-reconciler";

import {
  project,
  verticalFov,
  type CameraView,
  type Mat4,
  type Vec3,
} from "./camera";
import { clipToFront } from "./grid";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface HelperSegment {
  readonly a: Point;
  readonly b: Point;
}

/** What a helper is FOR, so the component can style it without guessing. */
export type HelperKind = "camera" | "directional" | "ambient" | "point" | "spot";

export interface Helper {
  readonly nodeId: string;
  readonly kind: HelperKind;
  /** Where the icon sits — the node's origin, projected. */
  readonly at: Point;
  /** The wireframe, in screen space. Empty for helpers that have none. */
  readonly lines: readonly HelperSegment[];
  /**
   * Distance from the editor camera, for painter ordering.
   *
   * Helpers are drawn over the scene rather than depth-tested against it, so
   * the only ordering available is among themselves. Far ones first means a
   * near light icon lands on top of a distant frustum instead of under it.
   */
  readonly depth: number;
}

/** Transforms a local point by a column-major world matrix. */
function transform(matrix: Mat4, x: number, y: number, z: number): Vec3 {
  return {
    x: (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    y: (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    z: (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0),
  };
}

/**
 * A segment between two world points, clipped to the front of the camera.
 *
 * `clipToFront` is reused rather than reimplemented: a line with one end
 * behind the viewer projects to a point on the wrong side of the screen, and
 * the ground grid already paid for that lesson.
 */
function segment(view: CameraView, from: Vec3, to: Vec3): HelperSegment | null {
  const clipped = clipToFront(view, from, to);
  if (clipped === null) return null;
  const a = project(view, clipped.a);
  const b = project(view, clipped.b);
  if (a === null || b === null) return null;
  return { a: a.point, b: b.point };
}

/**
 * The volume a broadcast camera actually sees.
 *
 * ==========================================================================
 * THE SHAPE IS THE SPECIFICATION, NOT A DECORATION
 * ==========================================================================
 * Drawn from the SAME `verticalFov` the renderer projects through, at the
 * SAME near and far planes, with the SAME aspect as the output. So the box it
 * traces is not an impression of the framing — it is the framing. A graphic
 * outside it will not be on air, and you can see that by looking.
 *
 * The far plane is pulled in to `reach` for drawing only: a broadcast camera's
 * far plane is typically a hundred metres, and a frustum drawn to it fills the
 * viewport with two lines going to the horizon and tells nobody anything.
 */
export function cameraFrustum(
  view: CameraView,
  world: Mat4,
  descriptor: CameraDescriptor,
  aspect: number,
  reach = 6,
): readonly HelperSegment[] {
  const far = Math.min(reach, descriptor.far);
  const near = Math.max(descriptor.near, far * 0.02);

  const extent = (distance: number): { halfWidth: number; halfHeight: number } => {
    if (descriptor.kind === "orthographic") {
      // An orthographic volume does not converge — the same rectangle at every
      // depth, which is exactly what makes 2D framing predictable.
      return { halfHeight: descriptor.size, halfWidth: descriptor.size * aspect };
    }
    const halfHeight = Math.tan(verticalFov(descriptor, aspect) / 2) * distance;
    return { halfHeight, halfWidth: halfHeight * aspect };
  };

  // The camera looks down its own −Z. SCENE_FORMAT §5.
  const corners = (distance: number): readonly Vec3[] => {
    const { halfWidth, halfHeight } = extent(distance);
    return [
      transform(world, -halfWidth, -halfHeight, -distance),
      transform(world, halfWidth, -halfHeight, -distance),
      transform(world, halfWidth, halfHeight, -distance),
      transform(world, -halfWidth, halfHeight, -distance),
    ];
  };

  const nearCorners = corners(near);
  const farCorners = corners(far);
  const apex = transform(world, 0, 0, 0);

  const lines: HelperSegment[] = [];
  const push = (from: Vec3, to: Vec3) => {
    const drawn = segment(view, from, to);
    if (drawn !== null) lines.push(drawn);
  };

  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    push(nearCorners[index]!, nearCorners[next]!);
    push(farCorners[index]!, farCorners[next]!);
    push(nearCorners[index]!, farCorners[index]!);
    // The rays back to the lens. Without these a frustum reads as two loose
    // rectangles rather than as one object with a viewpoint.
    if (descriptor.kind === "perspective") push(apex, nearCorners[index]!);
  }
  return lines;
}

/**
 * A light's reach, drawn as the thing it physically does.
 *
 * Each kind gets the shape that says what it IS, because "a light" is not one
 * behaviour:
 *
 *   directional  parallel rays — it has a direction and no position that
 *                matters, so the rays are drawn as a bundle rather than a cone
 *   spot         the actual cone, at the actual angle
 *   point        a small cage — reach in every direction
 *   ambient      nothing. It has no position and no direction, and drawing a
 *                shape for it would be inventing a fiction the renderer does
 *                not honour.
 */
export function lightHelper(
  view: CameraView,
  world: Mat4,
  kind: HelperKind,
  options: { readonly angle?: number; readonly reach?: number } = {},
): readonly HelperSegment[] {
  const reach = options.reach ?? 1.6;
  const lines: HelperSegment[] = [];
  const push = (from: Vec3, to: Vec3) => {
    const drawn = segment(view, from, to);
    if (drawn !== null) lines.push(drawn);
  };
  const origin = transform(world, 0, 0, 0);

  if (kind === "ambient") return lines;

  if (kind === "directional") {
    // Four parallel rays down −Z. Parallel because that is what directional
    // means, and a cone here would be a lie about how the scene is lit.
    const spread = 0.16;
    for (const [ox, oy] of [
      [-spread, -spread],
      [spread, -spread],
      [spread, spread],
      [-spread, spread],
    ] as const) {
      push(transform(world, ox, oy, 0), transform(world, ox, oy, -reach));
    }
    return lines;
  }

  if (kind === "spot") {
    const angle = options.angle ?? Math.PI / 6;
    const radius = Math.tan(angle / 2) * reach;
    const points: Vec3[] = [];
    const segments = 16;
    for (let index = 0; index < segments; index += 1) {
      const theta = (index / segments) * Math.PI * 2;
      points.push(
        transform(world, Math.cos(theta) * radius, Math.sin(theta) * radius, -reach),
      );
    }
    for (let index = 0; index < segments; index += 1) {
      push(points[index]!, points[(index + 1) % segments]!);
    }
    // Four edges to the apex, not sixteen — the cone reads at four and turns
    // into a solid smear at sixteen.
    for (let index = 0; index < segments; index += segments / 4) {
      push(origin, points[index]!);
    }
    return lines;
  }

  // Point: a small cage, equal in every axis.
  const r = reach * 0.35;
  for (const [ax, ay, az] of [
    [r, 0, 0],
    [0, r, 0],
    [0, 0, r],
  ] as const) {
    push(transform(world, -ax, -ay, -az), transform(world, ax, ay, az));
  }
  return lines;
}

export interface HelperSource {
  readonly nodeId: string;
  readonly kind: HelperKind;
  readonly world: Mat4;
  /** Cameras only. */
  readonly descriptor?: CameraDescriptor;
  /** Spot lights only, in radians. */
  readonly angle?: number;
}

/**
 * Every helper in the scene, furthest first.
 *
 * ==========================================================================
 * THE CAMERA YOU ARE LOOKING THROUGH GETS NO HELPER
 * ==========================================================================
 * Studio orbits the SCENE's camera — the editor view and the broadcast camera
 * are the same object. Drawing a frustum for it would trace the view volume
 * you are already inside: two rectangles pinned to the edges of the screen
 * that never move however far you orbit, because they move with you.
 *
 * That was built, looked convincing in a screenshot, and told nobody
 * anything. It is excluded rather than shipped, because a control that cannot
 * inform is a control that teaches people to ignore the ones that can.
 *
 * `activeCamera` is the exclusion. A scene with a SECOND camera — a virtual
 * set shot, a bookmarked angle — gets a real frustum for it the day that
 * exists, and this function already draws it.
 */
export function helpers(
  view: CameraView,
  sources: readonly HelperSource[],
  aspect: number,
  activeCamera: string | null = null,
): readonly Helper[] {
  const eye = view.world;
  const eyePosition: Vec3 = {
    x: eye[12] ?? 0,
    y: eye[13] ?? 0,
    z: eye[14] ?? 0,
  };

  const out: Helper[] = [];
  for (const source of sources) {
    if (source.kind === "camera" && source.nodeId === activeCamera) continue;
    const origin = transform(source.world, 0, 0, 0);
    const at = project(view, origin);
    // Behind the camera. Not an error — just nothing to draw.
    if (at === null || !at.inFront) continue;

    const dx = origin.x - eyePosition.x;
    const dy = origin.y - eyePosition.y;
    const dz = origin.z - eyePosition.z;
    const depth = Math.sqrt(dx * dx + dy * dy + dz * dz);

    /**
     * A LIGHT GIZMO IS THE SAME SIZE WHEREVER THE LIGHT IS.
     *
     * It used to be 1.6 WORLD units, which meant its size on screen depended
     * entirely on how far away the light happened to be. A key light hung high
     * over a set drew four rays hundreds of pixels long across the top of the
     * stage — thin diagonal scratches with no icon near them, appearing in
     * every screenshot of a 3D scene and reading as something broken.
     *
     * Blender solves this the way this file's own move gizmo already does:
     * solve the world length so the DRAWN length is constant. Under
     * perspective a thing of size s at distance d subtends roughly s/d, so
     * holding s ∝ d holds its screen size. The clamp keeps a light at the far
     * plane from solving to something enormous, and a light almost inside the
     * lens from vanishing.
     *
     * A gizmo is a piece of interface. Interface does not get bigger because
     * the thing it refers to moved away.
     */
    const reach = Math.min(4, Math.max(0.25, depth * 0.09));

    const lines =
      source.kind === "camera"
        ? source.descriptor === undefined
          ? []
          : cameraFrustum(view, source.world, source.descriptor, aspect)
        : lightHelper(view, source.world, source.kind, {
            reach,
            ...(source.angle === undefined ? {} : { angle: source.angle }),
          });
    out.push({
      nodeId: source.nodeId,
      kind: source.kind,
      at: at.point,
      lines,
      depth: Math.sqrt(dx * dx + dy * dy + dz * dz),
    });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/** How close a click must land to an icon to select it, in canvas pixels. */
export const ICON_RADIUS = 13;

/**
 * The helper under a point, or null.
 *
 * NEAREST wins, not the first match — two lights close together must both be
 * reachable, and picking whichever came first in the document would make one
 * of them permanently unselectable.
 */
export function pickHelper(
  drawn: readonly Helper[],
  canvas: Point,
  tolerance = ICON_RADIUS,
): string | null {
  let best: string | null = null;
  let bestDistance = tolerance;
  for (const helper of drawn) {
    const dx = helper.at.x - canvas.x;
    const dy = helper.at.y - canvas.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = helper.nodeId;
    }
  }
  return best;
}
