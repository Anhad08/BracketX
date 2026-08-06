/**
 * Viewport navigation, picking and snapping.
 *
 * ============================================================================
 * PAN AND ZOOM ARE NOT A CAMERA
 * ============================================================================
 * The obvious way to implement zoom is to change the scene camera's
 * `orthographicSize`. It is also the one implementation that must never ship:
 * the camera is CONTENT. It is what the programme output draws through, it is
 * persisted in the document, and moving it would mean a designer zooming in to
 * nudge a corner had changed what goes on air.
 *
 * So Studio's navigation is a view transform over the rendered canvas and the
 * engine never learns about it. The canvas is rendered at the document's own
 * resolution — exactly as the programme feed is — and Studio scales the
 * resulting pixels. Zooming changes nothing the engine can observe, which is
 * asserted in the verification suite by session hash.
 *
 * ============================================================================
 * THREE SPACES
 * ============================================================================
 *   world    metres, Y up, origin at the centre. What the document stores.
 *   canvas   pixels, Y down, origin top-left. What the engine renders.
 *   screen   pixels in the viewport element. What a mouse reports.
 *
 * Everything here converts between them and nothing else does. Two copies of
 * this arithmetic is how a gizmo ends up half a pixel from the thing it drags.
 */
import { childrenOf, type SceneDocument, type SceneNode } from "@bracketx/engine-scene";
import { intersectPlane, project, rayThrough, type CameraView } from "./camera";

export interface Viewport {
  /** Screen pixels per canvas pixel. */
  readonly zoom: number;
  /** Screen-space offset of the canvas origin. */
  readonly panX: number;
  readonly panY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The document's own output size. The canvas is always exactly this. */
export function canvasSize(document: SceneDocument): { width: number; height: number } {
  return { width: document.world.output.width, height: document.world.output.height };
}

/**
 * Canvas pixels per world unit.
 *
 * Derived from the ACTIVE CAMERA's orthographic size, not from a constant. A
 * hardcoded 108 px/unit works until someone authors a camera at a different
 * size, at which point every gizmo is silently wrong and the scene still looks
 * fine — the worst combination.
 */
export function pixelsPerUnit(document: SceneDocument): number {
  const { height } = canvasSize(document);
  return height / (orthographicSize(document) * 2);
}

export function orthographicSize(document: SceneDocument): number {
  let size = 5;
  const visit = (node: SceneNode): boolean => {
    const camera = (node.components ?? []).find(
      (component) => component.type === "camera",
    );
    if (camera !== undefined) {
      const value = (camera.props as { orthographicSize?: unknown }).orthographicSize;
      if (typeof value === "number" && value > 0) {
        size = value;
        return true;
      }
    }
    for (const child of childrenOf(node)) if (visit(child)) return true;
    return false;
  };
  visit(document.root);
  return size;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export function worldToCanvas(document: SceneDocument, world: Point): Point {
  const { width, height } = canvasSize(document);
  const scale = pixelsPerUnit(document);
  // Y is negated: the canvas grows down and the scene grows up.
  return { x: width / 2 + world.x * scale, y: height / 2 - world.y * scale };
}

export function canvasToWorld(document: SceneDocument, canvas: Point): Point {
  const { width, height } = canvasSize(document);
  const scale = pixelsPerUnit(document);
  return { x: (canvas.x - width / 2) / scale, y: (height / 2 - canvas.y) / scale };
}

export function canvasToScreen(viewport: Viewport, canvas: Point): Point {
  return { x: canvas.x * viewport.zoom + viewport.panX, y: canvas.y * viewport.zoom + viewport.panY };
}

export function screenToCanvas(viewport: Viewport, screen: Point): Point {
  return { x: (screen.x - viewport.panX) / viewport.zoom, y: (screen.y - viewport.panY) / viewport.zoom };
}

/**
 * Screen → the world, THROUGH THE CAMERA when one is supplied.
 *
 * The `view` argument is what makes the editor follow the camera instead of
 * assuming one. Without it these fall back to the flat map, which is exactly
 * right for a scene whose camera is the default broadcast camera — proved
 * element by element in `camera.test.ts`, which is what made replacing the
 * flat map safe rather than hopeful.
 *
 * The plane is z = `planeZ`. A broadcast scene is overwhelmingly flat content
 * at known depths, so picking against the plane a node lives on is both exact
 * for that case and cheap enough for every pointer move.
 */
export function screenToWorld(
  document: SceneDocument,
  viewport: Viewport,
  screen: Point,
  view?: CameraView,
  planeZ = 0,
): Point {
  const canvas = screenToCanvas(viewport, screen);
  if (view === undefined) return canvasToWorld(document, canvas);
  const ray = rayThrough(view, canvas);
  const hit = ray === null ? null : intersectPlane(ray, planeZ);
  // Behind the camera, or a degenerate matrix. The flat map is wrong here but
  // finite, and a finite wrong answer beats NaN spreading into a drag.
  return hit === null ? canvasToWorld(document, canvas) : { x: hit.x, y: hit.y };
}

export function worldToScreen(
  document: SceneDocument,
  viewport: Viewport,
  world: Point,
  view?: CameraView,
  worldZ = 0,
): Point {
  if (view === undefined) return canvasToScreen(viewport, worldToCanvas(document, world));
  const projected = project(view, { x: world.x, y: world.y, z: worldZ });
  return projected === null
    ? canvasToScreen(viewport, worldToCanvas(document, world))
    : canvasToScreen(viewport, projected.point);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Zooms about a screen point, so the pixel under the cursor stays under it.
 *
 * The alternative — zooming about the viewport centre — is what makes an editor
 * feel like it is fighting you: you point at a corner, zoom, and the corner
 * leaves the screen.
 */
export function zoomAt(viewport: Viewport, anchor: Point, factor: number): Viewport {
  const zoom = clampZoom(viewport.zoom * factor);
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - viewport.panX) * ratio,
    panY: anchor.y - (anchor.y - viewport.panY) * ratio,
  };
}

export function pan(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, panX: viewport.panX + dx, panY: viewport.panY + dy };
}

/** Fits the whole canvas in the element, with a margin. */
export function fit(
  document: SceneDocument,
  element: { width: number; height: number },
  margin = 32,
): Viewport {
  const canvas = canvasSize(document);
  if (canvas.width === 0 || canvas.height === 0) return DEFAULT_VIEWPORT;
  const zoom = clampZoom(
    Math.min(
      (element.width - margin * 2) / canvas.width,
      (element.height - margin * 2) / canvas.height,
    ),
  );
  return {
    zoom,
    panX: (element.width - canvas.width * zoom) / 2,
    panY: (element.height - canvas.height * zoom) / 2,
  };
}

/**
 * Frames a world-space rectangle — "frame selected".
 *
 * Built on the same clamp and the same centring as `fit`, because the two
 * differ only in WHAT they frame: `fit` frames the output canvas, this frames
 * whatever is selected. Two independently-written framings would drift, and
 * the one used less would be the wrong one.
 */
export function frame(
  document: SceneDocument,
  rect: Rect,
  element: { width: number; height: number },
  margin = 64,
): Viewport {
  if (rect.width <= 0 || rect.height <= 0) return DEFAULT_VIEWPORT;
  const scale = pixelsPerUnit(document);
  // World extent to canvas pixels — the space `zoom` is measured in.
  const width = rect.width * scale;
  const height = rect.height * scale;
  const zoom = clampZoom(
    Math.min((element.width - margin * 2) / width, (element.height - margin * 2) / height),
  );
  // The rect's centre, in canvas pixels, placed at the element's centre.
  const centre = worldToCanvas(document, { x: rect.x, y: rect.y });
  return {
    zoom,
    panX: element.width / 2 - centre.x * zoom,
    panY: element.height / 2 - centre.y * zoom,
  };
}

/**
 * Adjusts a viewport so the same canvas point stays centred after a resize.
 *
 * ==========================================================================
 * WHY THIS IS NOT A REFIT
 * ==========================================================================
 * Refitting on every resize would fight a designer who has zoomed in on a
 * corner: drag a panel divider and their work jumps. So `fit` stays explicit.
 *
 * But doing NOTHING is worse, and shipped: opening the Program row shortens
 * the stage, and because pan is measured from the top-left, everything in the
 * lower part of the canvas — which is where a lower third lives — slid out of
 * sight. A designer taking a graphic to air could not see the graphic.
 *
 * Holding the centre is what every editor does and what neither extreme gets
 * right: zoom is untouched, and the point the designer was looking at is still
 * the point they are looking at.
 */
export function recentre(
  viewport: Viewport,
  from: { width: number; height: number },
  to: { width: number; height: number },
  canvas?: { width: number; height: number },
): Viewport {
  if (from.width <= 0 || from.height <= 0) return viewport;
  const held: Viewport = {
    zoom: viewport.zoom,
    panX: viewport.panX + (to.width - from.width) / 2,
    panY: viewport.panY + (to.height - from.height) / 2,
  };
  if (canvas === undefined) return held;

  // Hold the centre while the frame still FITS. When it no longer does — a
  // panel opened and the view is now shorter than the picture — refit, because
  // a designer who cannot see their graphic has lost more than their zoom.
  //
  // This was found the hard way: at 1280x720 with the bottom dock open, the
  // lower third sat below the visible area and its resize handles were drawn
  // ten pixels beyond the surface that receives pointer events. The handles
  // looked fine and could not be grabbed.
  const fits =
    canvas.width * held.zoom <= to.width && canvas.height * held.zoom <= to.height;
  if (fits) return clampToView(held, to, canvas);

  const zoom = clampZoom(
    Math.min((to.width - 64) / canvas.width, (to.height - 64) / canvas.height),
  );
  return {
    zoom,
    panX: (to.width - canvas.width * zoom) / 2,
    panY: (to.height - canvas.height * zoom) / 2,
  };
}

/** How much of the frame must remain reachable, in pixels. */
const MIN_VISIBLE = 48;

/**
 * Keeps the document frame reachable after the view changes size.
 *
 * Holding the centre is right for a small resize and wrong for a large one: a
 * panel opening can shrink the view enough that the frame ends up entirely
 * outside it, and then the graphic — and every handle on it — is somewhere the
 * pointer cannot go. Found by a resize handle that was drawn ten pixels below
 * the surface that receives pointer events, at 1280x720 with the bottom dock
 * open.
 *
 * This clamps rather than refits, deliberately. A refit would throw away the
 * zoom the designer chose, which is the behaviour `recentre` exists to avoid.
 */
export function clampToView(
  viewport: Viewport,
  view: { width: number; height: number },
  canvas: { width: number; height: number },
): Viewport {
  if (view.width <= 0 || view.height <= 0) return viewport;
  const drawnWidth = canvas.width * viewport.zoom;
  const drawnHeight = canvas.height * viewport.zoom;
  const margin = Math.min(MIN_VISIBLE, drawnWidth, drawnHeight);
  return {
    zoom: viewport.zoom,
    panX: Math.min(
      view.width - margin,
      Math.max(margin - drawnWidth, viewport.panX),
    ),
    panY: Math.min(
      view.height - margin,
      Math.max(margin - drawnHeight, viewport.panY),
    ),
  };
}

// ---------------------------------------------------------------------------
// Node bounds and picking
// ---------------------------------------------------------------------------

export interface NodeBounds {
  readonly nodeId: string;
  /** World-space centre and extent. */
  readonly rect: Rect;
}

/**
 * World bounds for every node that has a size.
 *
 * Reads the MIRROR's world matrix, so a node placed by layout or driven by
 * animation is boxed where it actually is, not where its transform says. An
 * editor that drew handles at the authored position would be unusable for
 * exactly the scenes composition was built for.
 */
export function nodeBounds(
  document: SceneDocument,
  worldOf: (nodeId: string) => readonly number[] | undefined,
): readonly NodeBounds[] {
  const out: NodeBounds[] = [];
  const stack: SceneNode[] = [document.root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    // Reversed, so `pop` yields siblings in DOCUMENT order. Without this the
    // stack inverts them and `pick` — which takes the last match as the
    // topmost — hands back whichever sibling was authored first.
    const children = childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
    if (node.size === undefined) continue;
    const matrix = worldOf(node.id);
    if (matrix === undefined) continue;

    // Column-major: 12/13 are the translation, 0/5 the x/y scale.
    const scaleX = matrix[0] ?? 1;
    const scaleY = matrix[5] ?? 1;
    out.push({
      nodeId: node.id,
      rect: {
        x: matrix[12] ?? 0,
        y: matrix[13] ?? 0,
        width: node.size.width * scaleX,
        height: node.size.height * scaleY,
      },
    });
  }
  return out;
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    Math.abs(point.x - rect.x) <= rect.width / 2 &&
    Math.abs(point.y - rect.y) <= rect.height / 2
  );
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) <= (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) <= (a.height + b.height) / 2
  );
}

/**
 * The node under a world point, or null.
 *
 * LAST match wins. `nodeBounds` emits in a depth-first order, so the last node
 * to contain the point is the one drawn most recently and therefore the one on
 * top. Picking the first would hand back the root group every time — correct by
 * containment and useless to a person.
 */
export function pick(bounds: readonly NodeBounds[], world: Point): string | null {
  let hit: string | null = null;
  for (const entry of bounds) {
    if (containsPoint(entry.rect, world)) hit = entry.nodeId;
  }
  return hit;
}

/** Every node whose bounds intersect a marquee, in world space. */
export function marquee(bounds: readonly NodeBounds[], area: Rect): readonly string[] {
  return bounds.filter((entry) => intersects(entry.rect, area)).map((entry) => entry.nodeId);
}

/** A world rect from two world corners. Handles a drag in any direction. */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export interface SnapResult {
  readonly value: number;
  /** The world coordinate a guide should be drawn at, when one was hit. */
  readonly guide: number | null;
}

/**
 * Snaps one axis to a grid and to nearby edges.
 *
 * The threshold is in SCREEN pixels, converted to world here. A world-space
 * threshold would make snapping aggressive when zoomed out and unreachable when
 * zoomed in — the distance that matters is the one between the pointer and the
 * thing on screen.
 *
 * Candidates beat the grid. A designer aligning two boxes means the boxes.
 */
export function snap(
  value: number,
  candidates: readonly number[],
  options: {
    readonly gridStep: number;
    readonly toGrid: boolean;
    readonly thresholdWorld: number;
  },
): SnapResult {
  let best: number | null = null;
  let bestDistance = options.thresholdWorld;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best !== null) return { value: best, guide: best };

  if (options.toGrid && options.gridStep > 0) {
    return { value: Math.round(value / options.gridStep) * options.gridStep, guide: null };
  }
  return { value, guide: null };
}

/** Edge and centre coordinates of everything except the nodes being dragged. */
export function snapCandidates(
  bounds: readonly NodeBounds[],
  exclude: ReadonlySet<string>,
): { readonly x: readonly number[]; readonly y: readonly number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const entry of bounds) {
    if (exclude.has(entry.nodeId)) continue;
    x.push(entry.rect.x, entry.rect.x - entry.rect.width / 2, entry.rect.x + entry.rect.width / 2);
    y.push(entry.rect.y, entry.rect.y - entry.rect.height / 2, entry.rect.y + entry.rect.height / 2);
  }
  return { x, y };
}

// ---------------------------------------------------------------------------
// Safe areas
// ---------------------------------------------------------------------------

/**
 * Title and action safe rectangles, in canvas pixels.
 *
 * Read from `world.safeAreas` when the document declares them, because safe
 * areas are a property of the delivery format and a broadcaster may specify
 * their own. The defaults are the conventional 90% / 93%.
 */
export function safeAreas(document: SceneDocument): {
  readonly title: Rect;
  readonly action: Rect;
} {
  const { width, height } = canvasSize(document);
  const declared = document.world.safeAreas;
  const inset = (fraction: number): Rect => ({
    x: width / 2,
    y: height / 2,
    width: width * fraction,
    height: height * fraction,
  });
  return {
    title: inset(declared?.title ?? 0.9),
    action: inset(declared?.action ?? 0.93),
  };
}
