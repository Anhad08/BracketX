import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";

import type { StudioSession } from "../studio/session";
import type { Selection } from "../studio/selection";
import {
  EMPTY_SELECTION,
  add,
  primaryOf,
  selectMany,
  selectOnly,
  toggle,
} from "../studio/selection";
import { setProp, setPropOnMany, setProps } from "../studio/editing";
import {
  handleAt,
  handleDirection,
  handlesFor,
  normaliseDegrees,
  resize as resizeBox,
  rotate as rotateBox,
  type Handle,
} from "../studio/transform";
import {
  canvasSize,
  canvasToScreen,
  fit,
  frame,
  marquee,
  nodeBounds,
  pan,
  pick,
  pixelsPerUnit,
  rectFromCorners,
  safeAreas,
  screenToCanvas,
  screenToWorld,
  worldToScreen,
  snap,
  snapCandidates,
  worldToCanvas,
  zoomAt,
  type NodeBounds,
  type Point,
  type Rect,
  recentre,
  type Viewport,
} from "../studio/viewport";
import { SCENE_DRAG } from "../studio/place";
import { cameraPosition, groundGrid, navigationGizmo } from "../studio/grid";
import {
  armLength,
  axisParameterAt,
  MIN_FORESHORTENING,
  pickAxis,
  projectAxes,
  type Axis,
  type AxisId,
} from "../studio/axis";
import {
  lookAtRotation,
  orbitBy,
  orbitOf,
  positionFor,
  type Orbit,
  type Vec3,
} from "../studio/camera";
import type { StudioCommand } from "../studio/commands";
import type { Workspace } from "../studio/workspace";

/**
 * The Scene View.
 *
 * ============================================================================
 * THE PICTURE COMES ENTIRELY FROM THE ENGINE
 * ============================================================================
 * There is one `<canvas>`, rendered by the engine at the DOCUMENT's resolution
 * — the same pixels a programme output would receive. Studio scales and offsets
 * those pixels with a CSS transform and draws its chrome in an SVG on top.
 *
 * Nothing here approximates the scene. An editor that drew its own rectangles
 * "for speed" would be a second renderer, and the day it disagreed with the
 * engine would be the day someone shipped a graphic that looked different on
 * air than it did while they were making it.
 *
 * ============================================================================
 * WHEN A FRAME IS DRAWN
 * ============================================================================
 * While playing: every animation frame. Otherwise: once, after something
 * changed. An editor that re-rendered continuously on a static scene would burn
 * a GPU to display a still image, and the brief asks explicitly that Studio not
 * rebuild the scene unnecessarily.
 */

export interface SceneViewProps {
  readonly session: StudioSession;
  /**
   * The canvas the engine renders into.
   *
   * Created by the shell and ATTACHED here, not created here. The backend binds
   * to a canvas for the session's lifetime (MirrorBackend contract C2 puts that
   * lifetime on the caller), so a canvas that unmounted with this component
   * would take the mirror with it every time a panel layout changed.
   */
  readonly canvas: HTMLCanvasElement;
  readonly revision: number;
  readonly workspace: Workspace;
  readonly selection: Selection;
  readonly onSelection: (selection: Selection) => void;
  readonly lockedIds: ReadonlySet<string>;
  readonly viewport: Viewport;
  readonly onViewport: (viewport: Viewport) => void;
  /** Bumped by the shell to request a fit. */
  readonly fitToken: number;
  /** Bumped by the shell to request a frame of the current selection. */
  readonly frameToken: number;
  /**
   * A scene was dropped on the stage, at this point in canvas coordinates.
   *
   * The Stage does not know what a template is — it reports WHERE, and the
   * shell decides what to place. Keeping instantiation out of the viewport is
   * what stops this becoming a second, half-informed copy of the shell.
   */
  readonly onDropScene: (templateId: string, at: Point) => void;
  /**
   * The actions a right-click offers, already built by the shell.
   *
   * Passed in rather than assembled here: the command palette, the keyboard
   * and this menu must run the SAME code, or a "Duplicate" that behaves one
   * way from the palette and another from the menu becomes a bug nobody can
   * reproduce. The menu is a view onto the commands, not a second set.
   */
  readonly menuCommands: readonly StudioCommand[];
  /** A ball on the axis widget was clicked: look down that axis. */
  readonly onCompass: (axis: "x" | "y" | "z", sign: 1 | -1) => void;
  /** Milliseconds between drawn frames. Only frames that actually drew. */
  readonly onFrame: (milliseconds: number) => void;
  /**
   * This screen can be authored in.
   *
   * False on a phone: a resize handle is eight pixels and a fingertip is
   * about forty-four. The stage still pans, zooms and selects — looking at
   * your work and choosing a layer are not authoring — but the gizmos are
   * neither drawn nor grabbable, because a control you cannot hit is worse
   * than one that is not there.
   */
  readonly canAuthor: boolean;
}

/** Screen pixels within which a handle counts as grabbed. */
const HANDLE_TOLERANCE = 10;

/** The eight compass cursors, indexed by 45-degree sector. */
const COMPASS = [
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
] as const;

function cursorFor(
  drag: DragState | null,
  hover: { node: string | null; handle: Handle | null; axis: AxisId | null },
): string {
  if (drag?.kind === "pan") return "grabbing";
  if (drag?.kind === "move") return "move";
  if (drag?.kind === "axis") return "grabbing";
  if (drag !== null) return "default";
  if (hover.axis !== null) return "grab";
  if (hover.handle !== null) {
    if (hover.handle.id === "rotate") return "grab";
    const sector = Math.round(handleDirection(hover.handle) / 45) % 8;
    return COMPASS[(sector + 8) % 8] ?? "default";
  }
  return hover.node === null ? "default" : "move";
}

interface DragState {
  readonly kind: "pan" | "move" | "marquee" | "resize" | "rotate" | "orbit" | "axis";
  readonly startScreen: Point;
  readonly startWorld: Point;
  /** World positions of the nodes being moved, at drag start. */
  readonly origins: ReadonlyMap<string, readonly [number, number, number]>;
  readonly startViewport: Viewport;
  /** Resize and rotate only: the grabbed handle and the box it belongs to. */
  readonly handle?: Handle;
  readonly startRect?: { x: number; y: number; width: number; height: number };
  /** Authored scale of each node at drag start, so resize is a multiplier. */
  readonly startScales?: ReadonlyMap<string, readonly [number, number, number]>;
  /** Authored Z rotation at drag start, so rotation composes. */
  readonly startRotations?: ReadonlyMap<string, number>;
  /** Orbit only: the camera node, where it started, and what it turns about. */
  readonly cameraId?: string;
  readonly startOrbit?: Orbit;
  readonly pivot?: Vec3;
  /** Axis drag only: which arm, where it was grabbed, and about what. */
  readonly axis?: Axis;
  readonly startParam?: number;
  readonly axisOrigin?: Vec3;
}

export function SceneView({
  session,
  canvas,
  revision,
  workspace,
  selection,
  onSelection,
  lockedIds,
  viewport,
  onViewport,
  fitToken,
  frameToken,
  onDropScene,
  menuCommands,
  onCompass,
  onFrame,
  canAuthor,
}: SceneViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [element, setElement] = useState({ width: 0, height: 0 });
  // Set by the shell when the backend refuses to start. The scene view itself
  // never creates a backend, so it can only report a failure, not cause one.
  const [error] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ a: Point; b: Point } | null>(null);
  /** A scene is hovering over the stage. Volume Two: a target must say so. */
  const [dropping, setDropping] = useState(false);
  /**
   * What the pointer is over, when nothing is being dragged.
   *
   * The stage had NO hover feedback: moving the pointer across a graphic said
   * nothing, so the only way to learn what was clickable was to click. Every
   * editor this product is measured against answers before you commit.
   */
  const [hover, setHover] = useState<{
    node: string | null;
    handle: Handle | null;
    axis: AxisId | null;
  }>({ node: null, handle: null, axis: null });
  /** Where the context menu is open, in screen coordinates. */
  const [menu, setMenu] = useState<Point | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const document_ = session.document;
  const size = canvasSize(document_);
  const ppu = pixelsPerUnit(document_);

  // -- Canvas attachment ----------------------------------------------------

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    surface.appendChild(canvas);
    canvas.dataset.testid = "studio-canvas";
    return () => {
      if (canvas.parentElement === surface) surface.removeChild(canvas);
    };
  }, [canvas]);

  // The canvas always carries the DOCUMENT's resolution. CSS scales it; that
  // must not change what is rendered, or the editor would disagree with air.
  useEffect(() => {
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  }, [canvas, size.width, size.height]);

  // -- Render loop ----------------------------------------------------------

  const pending = useRef(true);
  useEffect(() => {
    pending.current = true;
  }, [revision]);

  useEffect(() => {
    let handle = 0;
    let previous = 0;
    const tick = (now: number) => {
      if (!session.disposed && (session.playing || pending.current)) {
        pending.current = false;
        try {
          session.render();
          // Timed only on frames that DREW. The loop idles when nothing has
          // changed, and counting those would report a stationary editor as
          // running at whatever the display refreshes at — a number that
          // says nothing about whether this machine can cope.
          if (previous !== 0) onFrame(now - previous);
          previous = now;
        } catch {
          // A bad frame must not kill the loop; the next edit will redraw.
        }
      } else {
        previous = 0;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [session, onFrame]);

  // -- Sizing and fit -------------------------------------------------------

  // The observer is installed once, so it must not close over a stale viewport
  // or a stale callback. Refs, rather than re-observing on every pan.
  const measured = useRef({ width: 0, height: 0 });
  // The document frame, so the observer can keep it reachable without closing
  // over a stale document.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const viewportRef = useRef(viewport);
  const onViewportRef = useRef(onViewport);
  viewportRef.current = viewport;
  onViewportRef.current = onViewport;

  useEffect(() => {
    const node = hostRef.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box === undefined) return;
      const next = { width: box.width, height: box.height };
      // Hold the centre rather than refitting — see `recentre`. Skipped on the
      // first measurement, which the fit effect below owns.
      //
      // The previous size is a ref, not the state: notifying the parent from
      // inside a state updater is a render-phase side effect, and React says so
      // on the console. A walkthrough that treats console errors as failures is
      // what caught it.
      const previous = measured.current;
      if (previous.width > 0 && previous.height > 0) {
        onViewportRef.current(recentre(viewportRef.current, previous, next, sizeRef.current));
      }
      measured.current = next;
      setElement(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (element.width > 0 && element.height > 0) onViewport(fit(document_, element));
    // Only on an explicit fit request or the first measurement.
  }, [fitToken, element.width === 0]);

  // FRAME SELECTED. Falls back to framing the whole scene when nothing is
  // selected, which is what every editor does and what makes one key enough:
  // pressing it with an empty selection should still take you somewhere
  // useful rather than doing nothing at all.
  useEffect(() => {
    if (frameToken === 0 || element.width === 0) return;
    const union = selectionBounds(bounds, selection.ids);
    onViewport(union === null ? fit(document_, element) : frame(document_, union, element));
    // Deliberately keyed on the token alone: a selection change must not
    // move the view, or the stage would lurch every time a layer is clicked.
  }, [frameToken]);

  // -- Bounds and picking ---------------------------------------------------

  /**
   * The camera the scene is shot through.
   *
   * Rebuilt with the same dependencies as `bounds`, because a camera that
   * moved and bounds that did not would disagree — and a disagreement here
   * shows up as handles that no longer sit on the graphic.
   */
  const view = useMemo(() => session.cameraView(size), [session, revision, size.width, size.height]);

  const bounds = useMemo<readonly NodeBounds[]>(
    () => nodeBounds(document_, (id) => session.worldMatrixOf(id)),
    // Recomputed when the document changes or a frame moved something.
    [document_, revision, session],
  );

  /**
   * The move gizmo's three arms.
   *
   * Length is solved so they draw at a constant SCREEN size — an arm measured
   * in world units grows and shrinks with the zoom until it is either
   * invisible or swallows the scene.
   *
   * Arms too edge-on to aim at are dropped by `projectAxes`, which is what
   * makes one gizmo correct for both kinds of scene: viewed front on, Z points
   * at the lens and disappears, leaving exactly the two axes a flat graphic
   * can move in. Turn the camera and Z arrives. The gizmo does not have a 2D
   * mode and a 3D mode, for the same reason the product does not.
   */
  const axisOrigin = useMemo<Vec3 | null>(() => {
    const union = selectionBounds(bounds, selection.ids);
    return union === null ? null : { x: union.x, y: union.y, z: 0 };
  }, [bounds, selection.ids]);

  /**
   * Is the camera looking at the scene from an angle?
   *
   * The ground and the axis widget appear when it is, and vanish when the
   * camera returns to Front. A flat graphic seen head on gains nothing from a
   * floor — the grid would project to a single horizontal line across the
   * middle of a lower third, which is worse than drawing nothing.
   *
   * The viewport therefore follows the scene instead of offering a mode to
   * choose, which is the same rule the move gizmo's Z arm follows.
   */
  const dimensional = useMemo(() => {
    if (view === null) return false;
    const position = cameraPosition(view);
    // Off the Z axis by more than a hair in either direction.
    return Math.abs(position.x) > 0.05 || Math.abs(position.y) > 0.05;
  }, [view]);

  const ground = useMemo(
    () => (view === null || !dimensional ? [] : groundGrid(view, { extent: 24, spacing: 1 })),
    [view, dimensional],
  );

  const compass = useMemo(
    () => (view === null || !dimensional ? [] : navigationGizmo(view, 26)),
    [view, dimensional],
  );

  const ARM_PIXELS = 74;
  const arms = useMemo(() => {
    if (view === null || axisOrigin === null) return [];
    // Divided by zoom because the arms are projected into CANVAS space and
    // then scaled by the viewport, so a constant canvas length would still
    // change size on screen as the designer zooms.
    const length = armLength(view, axisOrigin, ARM_PIXELS / viewport.zoom);
    return projectAxes(view, axisOrigin, length);
  }, [view, axisOrigin, viewport.zoom]);


  const pointOf = useCallback((event: { clientX: number; clientY: number }): Point => {
    const box = hostRef.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }, []);

  // -- Interaction ----------------------------------------------------------

  /**
   * Turns a finished resize/rotate into exactly ONE undo entry.
   *
   * Same shape as the move path: rewind to the gesture's start silently, then
   * apply the final state through the recording path, so the stack holds one
   * entry whose inverse is the pre-gesture transform.
   */
  /**
   * Turns the camera about the pivot, silently.
   *
   * Silent for the same reason resize is: a drag that wrote an undo entry per
   * pointer move would fill the history with a hundred steps nobody wants
   * back. `finishDrag` commits the whole turn as one.
   */
  const applyOrbit = (state: DragState, screen: Point) => {
    if (state.startOrbit === undefined || state.pivot === undefined) return;
    if (state.cameraId === undefined) return;

    const turned = orbitBy(
      state.startOrbit,
      screen.x - state.startScreen.x,
      screen.y - state.startScreen.y,
    );
    const position = positionFor(turned, state.pivot);
    const rotation = lookAtRotation(position, state.pivot);

    const turn = setProps(
      session.document,
      state.cameraId,
      new Map<string, unknown>([
        ["transform.position", [round(position.x), round(position.y), round(position.z)]],
        ["transform.rotation", [round(rotation[0]), round(rotation[1]), round(rotation[2])]],
      ]),
      "Orbit",
    );
    if (turn !== null) session.store.applySilently(turn);
  };

  /**
   * Slides the selection along one axis.
   *
   * The distance comes from intersecting the pointer ray with the axis LINE,
   * not from a screen delta. A screen delta has to be divided by some scale to
   * become a world distance, and under perspective there is no single correct
   * scale — which is why editors that do it that way feel like the object is
   * sliding on ice, faster at the far end of the arm than the near.
   */
  const applyAxisDrag = (state: DragState, screen: Point) => {
    if (state.axis === undefined || state.startParam === undefined) return;
    if (state.axisOrigin === undefined || view === null) return;

    const now = axisParameterAt(view, screenToCanvas(viewport, screen), state.axisOrigin, state.axis);
    if (now === null) return;
    const delta = now - state.startParam;
    const direction = state.axis.direction;

    const moved = setPropOnMany(
      session.document,
      [...state.origins.keys()],
      "transform.position",
      (id) => {
        const origin = state.origins.get(id) ?? [0, 0, 0];
        return [
          round(origin[0] + direction.x * delta),
          round(origin[1] + direction.y * delta),
          round(origin[2] + direction.z * delta),
        ];
      },
      "Move",
    );
    if (moved !== null) session.store.applySilently(moved);
  };

  const commitGesture = (state: DragState) => {
    const ids = [...state.origins.keys()];
    const label =
      state.kind === "rotate"
        ? ids.length === 1 ? "Rotate node" : `Rotate ${ids.length} nodes`
        : ids.length === 1 ? "Resize node" : `Resize ${ids.length} nodes`;

    // Capture where the gesture ended, BEFORE rewinding.
    const finalPositions = new Map<string, readonly [number, number, number]>();
    const finalTransforms = new Map<
      string,
      { scale: readonly [number, number, number]; rotation: number }
    >();
    for (const id of ids) {
      const position = findAuthored(session, id);
      const transform = findTransform(session, id);
      if (position !== null) finalPositions.set(id, position);
      if (transform !== null) finalTransforms.set(id, transform);
    }

    const rewindScale = setPropOnMany(session.document, ids, "transform.scale", (id) => [
      ...(state.startScales?.get(id) ?? [1, 1, 1]),
    ], "rewind");
    if (rewindScale !== null) session.store.applySilently(rewindScale);
    const rewindRotation = setPropOnMany(session.document, ids, "transform.rotation", (id) => [
      0,
      0,
      state.startRotations?.get(id) ?? 0,
    ], "rewind");
    if (rewindRotation !== null) session.store.applySilently(rewindRotation);
    const rewindPosition = setPropOnMany(session.document, ids, "transform.position", (id) => [
      ...state.origins.get(id)!,
    ], "rewind");
    if (rewindPosition !== null) session.store.applySilently(rewindPosition);

    // One transaction carrying every axis the gesture touched.
    const operations = [
      setPropOnMany(session.document, ids, "transform.scale", (id) => [
        ...(finalTransforms.get(id)?.scale ?? [1, 1, 1]),
      ], label),
      setPropOnMany(session.document, ids, "transform.rotation", (id) => [
        0,
        0,
        finalTransforms.get(id)?.rotation ?? 0,
      ], label),
      setPropOnMany(session.document, ids, "transform.position", (id) => [
        ...(finalPositions.get(id) ?? state.origins.get(id)!),
      ], label),
    ].flatMap((txn) => (txn === null ? [] : txn.operations));

    if (operations.length > 0) {
      session.store.apply({
        id: `txn_gesture_${Date.now()}`,
        label,
        actorId: "studio",
        operations,
      });
    }
  };

  // -- Resize / rotate application ------------------------------------------
  //
  // Both drive the store SILENTLY during the gesture and write ONE undoable
  // entry on release, exactly as the move path does. A transaction per pointer
  // move would put a hundred entries on the stack for one drag.

  const applyResize = (
    state: DragState,
    result: { x: number; y: number; scaleX: number; scaleY: number },
  ) => {
    const ids = [...state.origins.keys()];
    const rect = state.startRect!;
    const scaled = setPropOnMany(
      session.document,
      ids,
      "transform.scale",
      (id) => {
        const base = state.startScales?.get(id) ?? [1, 1, 1];
        return [base[0]! * result.scaleX, base[1]! * result.scaleY, base[2]!];
      },
      "resize",
    );
    if (scaled !== null) session.store.applySilently(scaled);

    // The box centre moved, so every node moves with it, keeping its offset
    // from the centre scaled by the same factor. A single node's offset is
    // zero, so it simply lands on the new centre.
    const moved = setPropOnMany(
      session.document,
      ids,
      "transform.position",
      (id) => {
        const origin = state.origins.get(id)!;
        return [
          result.x + (origin[0] - rect.x) * result.scaleX,
          result.y + (origin[1] - rect.y) * result.scaleY,
          origin[2],
        ];
      },
      "resize",
    );
    if (moved !== null) session.store.applySilently(moved);
  };

  const applyRotate = (
    state: DragState,
    pivot: Point,
    world: Point,
    snapAngle: boolean,
  ) => {
    const ids = [...state.origins.keys()];
    const rotated = setPropOnMany(
      session.document,
      ids,
      "transform.rotation",
      (id) => {
        const start = state.startRotations?.get(id) ?? 0;
        const next = rotateBox(pivot, state.startWorld, world, start, {
          snap: snapAngle,
        });
        return [0, 0, normaliseDegrees(next)];
      },
      "rotate",
    );
    if (rotated !== null) session.store.applySilently(rotated);

    // Multi-selection orbits the pivot. A single node rotates in place because
    // its offset from the pivot is zero.
    if (ids.length > 1) {
      const delta =
        rotateBox(pivot, state.startWorld, world, 0, { snap: snapAngle }) *
        (Math.PI / 180);
      const cos = Math.cos(-delta);
      const sin = Math.sin(-delta);
      const orbited = setPropOnMany(
        session.document,
        ids,
        "transform.position",
        (id) => {
          const origin = state.origins.get(id)!;
          const ox = origin[0] - pivot.x;
          const oy = origin[1] - pivot.y;
          return [pivot.x + ox * cos - oy * sin, pivot.y + ox * sin + oy * cos, origin[2]];
        },
        "rotate",
      );
      if (orbited !== null) session.store.applySilently(orbited);
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (error !== null) return;
    const screen = pointOf(event);
    const world = screenToWorld(document_, viewport, screen, view ?? undefined);
    (event.target as Element).setPointerCapture?.(event.pointerId);

    // ORBIT — the middle button, on its own, exactly as Blender binds it.
    // Shift with the middle button pans, and Alt-drag still pans for anyone
    // without a middle button at all.
    //
    // It was Shift+middle to begin with, which put the product's defining
    // gesture behind a modifier nobody would guess. A 3D product where
    // looking around needs a chord is a 3D product nobody looks around in.
    //
    // Unlike pan and zoom, this MOVES THE SCENE CAMERA. That is a document
    // edit: it changes what the output frames, so it is undoable and it goes
    // to air. Navigating the stage and aiming the camera are different acts
    // and the product must not blur them.
    // ...and only once the view is already three-dimensional. THE FLAT VIEW
    // IS FIXED. A lower third is designed square-on and stays square-on; a
    // camera that could be nudged off axis by a stray middle-drag would make
    // every subsequent judgement about alignment and letter-spacing wrong,
    // and the designer would have no idea why their work looked off.
    //
    // The way into 3D is the view control, which is deliberate and named. The
    // way back is Front, which is exact rather than approximately-square-on.
    if (view !== null && dimensional && event.button === 1 && !event.shiftKey) {
      const camera = cameraNode(document_);
      if (camera !== null) {
        const position = camera.transform?.position ?? [0, 0, 10];
        // Orbit about what you are looking AT: the selection if there is one,
        // the origin otherwise. Orbiting about the origin while working on a
        // corner of the set is the single most irritating thing a 3D editor
        // can do.
        const union = selectionBounds(bounds, selection.ids);
        const pivot: Vec3 = union === null
          ? { x: 0, y: 0, z: 0 }
          : { x: union.x, y: union.y, z: 0 };
        setDrag({
          kind: "orbit",
          startScreen: screen,
          startWorld: world,
          origins: new Map(),
          startViewport: viewport,
          cameraId: camera.id,
          pivot,
          startOrbit: orbitOf(
            { x: position[0], y: position[1], z: position[2] },
            pivot,
          ),
        });
        return;
      }
    }

    // Shift+middle, or Alt-drag, pans. Panning moves the VIEW and never the
    // scene camera — see the header comment in viewport.ts.
    if (event.button === 1 || event.altKey) {
      setDrag({
        kind: "pan",
        startScreen: screen,
        startWorld: world,
        origins: new Map(),
        startViewport: viewport,
      });
      return;
    }

    // A handle is checked BEFORE picking, because handles sit on the box edge
    // and would otherwise be swallowed by the node underneath them.
    const selectionRect = canAuthor ? selectionBounds(bounds, selection.ids) : null;
    if (selectionRect !== null) {
      // 10 screen px, converted — a handle must be equally grabbable at 10 %
      // and at 800 %, which a fixed world tolerance is not. Shared with the
      // hover test so what lights up is exactly what a press would grab.
      const tolerance = HANDLE_TOLERANCE / (viewport.zoom * ppu);
      const grabbed = handleAt(selectionRect, world, tolerance);
      if (grabbed !== null) {
        const origins = new Map<string, readonly [number, number, number]>();
        const startScales = new Map<string, readonly [number, number, number]>();
        const startRotations = new Map<string, number>();
        for (const id of selection.ids) {
          const position = findAuthored(session, id);
          const transform = findTransform(session, id);
          if (position !== null) origins.set(id, position);
          if (transform !== null) {
            startScales.set(id, transform.scale);
            startRotations.set(id, transform.rotation);
          }
        }
        setDrag({
          kind: grabbed.id === "rotate" ? "rotate" : "resize",
          startScreen: screen,
          startWorld: world,
          origins,
          startViewport: viewport,
          handle: grabbed,
          startRect: selectionRect,
          startScales,
          startRotations,
        });
        return;
      }
    }

    // AXIS ARMS. Checked after the resize handles, which sit on the box edge,
    // and before picking a node, because the arms start at the selection's
    // centre — where a free drag would otherwise begin.
    if (canAuthor && view !== null && axisOrigin !== null && arms.length > 0) {
      const grabbedAxis = pickAxis(arms, screenToCanvas(viewport, screen), HANDLE_TOLERANCE);
      if (grabbedAxis !== null) {
        const startParam = axisParameterAt(
          view,
          screenToCanvas(viewport, screen),
          axisOrigin,
          grabbedAxis,
        );
        if (startParam !== null) {
          const origins = new Map<string, readonly [number, number, number]>();
          for (const id of selection.ids) {
            const position = findAuthored(session, id);
            if (position !== null) origins.set(id, position);
          }
          setDrag({
            kind: "axis",
            startScreen: screen,
            startWorld: world,
            origins,
            startViewport: viewport,
            axis: grabbedAxis,
            startParam,
            axisOrigin,
          });
          return;
        }
      }
    }

    const hit = pick(bounds, world);
    const pickable = hit !== null && !lockedIds.has(hit) ? hit : null;

    if (pickable === null) {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onSelection(EMPTY_SELECTION);
      setDrag({
        kind: "marquee",
        startScreen: screen,
        startWorld: world,
        origins: new Map(),
        startViewport: viewport,
      });
      setMarqueeRect({ a: world, b: world });
      return;
    }

    const next =
      event.metaKey || event.ctrlKey
        ? toggle(selection, pickable)
        : event.shiftKey
          ? add(selection, [pickable])
          : selection.ids.includes(pickable)
            ? selection
            : selectOnly(pickable);
    onSelection(next);

    const origins = new Map<string, readonly [number, number, number]>();
    for (const id of next.ids) {
      const node = findAuthored(session, id);
      if (node !== null) origins.set(id, node);
    }
    if (!canAuthor) return;
    setDrag({
      kind: "move",
      startScreen: screen,
      startWorld: world,
      origins,
      startViewport: viewport,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag === null) {
      // Not dragging: report what is under the pointer. Handles win over
      // nodes, exactly as they do on press, so what lights up is what a click
      // would actually grab — a hover that disagreed with the hit test would
      // be worse than none.
      const screen = pointOf(event);
      const world = screenToWorld(document_, viewport, screen, view ?? undefined);
      const rect = selectionBounds(bounds, selection.ids);
      const tolerance = HANDLE_TOLERANCE / (viewport.zoom * pixelsPerUnit(document_));
      const handle = rect === null ? null : handleAt(rect, world, tolerance);
      // Arms are tested in the same order a press tests them, so the thing
      // that lights up is the thing that would be grabbed.
      const axis =
        handle !== null || arms.length === 0
          ? null
          : pickAxis(arms, screenToCanvas(viewport, screen), HANDLE_TOLERANCE);
      const hit = handle === null && axis === null ? pick(bounds, world) : null;
      const node = hit !== null && !lockedIds.has(hit) ? hit : null;
      if (
        node !== hover.node ||
        (handle?.id ?? null) !== (hover.handle?.id ?? null) ||
        (axis?.id ?? null) !== hover.axis
      ) {
        setHover({ node, handle, axis: axis?.id ?? null });
      }
      return;
    }
    const screen = pointOf(event);
    const world = screenToWorld(document_, viewport, screen, view ?? undefined);

    if (drag.kind === "pan") {
      onViewport(
        pan(
          drag.startViewport,
          screen.x - drag.startScreen.x,
          screen.y - drag.startScreen.y,
        ),
      );
      return;
    }
    if (drag.kind === "orbit") {
      applyOrbit(drag, screen);
      return;
    }
    if (drag.kind === "axis") {
      applyAxisDrag(drag, screen);
      return;
    }
    if (drag.kind === "marquee") {
      setMarqueeRect({ a: drag.startWorld, b: world });
      return;
    }

    if (drag.kind === "resize" && drag.handle && drag.startRect) {
      const result = resizeBox(drag.startRect, drag.handle, world, {
        lockAspect: event.shiftKey,
        fromCentre: event.metaKey || event.ctrlKey,
      });
      applyResize(drag, result);
      return;
    }

    if (drag.kind === "rotate" && drag.startRect) {
      const pivot = { x: drag.startRect.x, y: drag.startRect.y };
      applyRotate(drag, pivot, world, event.shiftKey);
      return;
    }

    // Move. Snapping is applied to the DELTA, so a multi-selection keeps its
    // internal spacing — snapping each node separately would scatter them.
    let dx = world.x - drag.startWorld.x;
    let dy = world.y - drag.startWorld.y;

    const primary = primaryOf(selection);
    let guideX: number | null = null;
    let guideY: number | null = null;

    if (workspace.snapEnabled && primary !== null) {
      const anchor = drag.origins.get(primary);
      const candidates = snapCandidates(bounds, new Set(selection.ids));
      // Threshold in SCREEN pixels, converted here — 8px feels the same at
      // every zoom, and a world-space threshold does not.
      const threshold = 8 / (viewport.zoom * ppu);
      if (anchor !== undefined) {
        const x = snap(anchor[0] + dx, candidates.x, {
          gridStep: workspace.gridStep,
          toGrid: workspace.showGrid,
          thresholdWorld: threshold,
        });
        const y = snap(anchor[1] + dy, candidates.y, {
          gridStep: workspace.gridStep,
          toGrid: workspace.showGrid,
          thresholdWorld: threshold,
        });
        dx = x.value - anchor[0];
        dy = y.value - anchor[1];
        guideX = x.guide;
        guideY = y.guide;
      }
    }
    setGuides({ x: guideX, y: guideY });

    // One transaction per pointer move would put a hundred entries on the undo
    // stack for one drag. Instead the store is driven directly and the undo
    // entry is written on pointer UP, from the drag's start positions — one
    // gesture, one undo step, which is what RFC-002 §6 asks for.
    const transaction = setPropOnMany(
      document_,
      [...drag.origins.keys()],
      "transform.position",
      (id) => {
        const origin = drag.origins.get(id)!;
        return [round(origin[0] + dx), round(origin[1] + dy), origin[2]];
      },
      "Move",
    );
    if (transaction !== null) session.store.applySilently(transaction);
  };

  const finishDrag = () => {
    if (drag === null) return;

    if (drag.kind === "marquee" && marqueeRect !== null) {
      const area = rectFromCorners(marqueeRect.a, marqueeRect.b);
      const hits = marquee(bounds, area).filter((id) => !lockedIds.has(id));
      onSelection(hits.length === 0 ? EMPTY_SELECTION : selectMany(hits));
    }

    if (drag.kind === "axis" && drag.origins.size > 0 && drag.axis !== undefined) {
      // Recorded exactly like a free move — rewind, then one transaction — so
      // an axis drag and a free drag are the same single undo step and neither
      // can leave the stack in a state the other would not.
      const ids = [...drag.origins.keys()];
      // Capture where the drag ENDED before rewinding, then build the
      // recorded transaction from the document as it is AFTER the rewind.
      //
      // Not from the render-time document: `applySilently` advances the
      // revision, so by now `document_` may already hold the dragged
      // positions, and a transaction built from it would record the dragged
      // position as its own previous value — undo would then restore the
      // drag rather than reverse it. That is exactly what this test caught.
      const ended = new Map<string, readonly [number, number, number]>();
      for (const id of ids) {
        const position = findAuthored(session, id);
        if (position !== null) ended.set(id, position);
      }

      const rewind = setPropOnMany(
        session.document,
        ids,
        "transform.position",
        (id) => drag.origins.get(id)!,
        "rewind",
      );
      if (rewind !== null) session.store.applySilently(rewind);

      const undoable = setPropOnMany(
        session.document,
        ids,
        "transform.position",
        (id) => ended.get(id) ?? drag.origins.get(id)!,
        ids.length === 1
          ? `Move along ${drag.axis.id.toUpperCase()}`
          : `Move ${ids.length} nodes along ${drag.axis.id.toUpperCase()}`,
      );
      if (undoable !== null) session.store.apply(undoable);
    }

    if (drag.kind === "move" && drag.origins.size > 0) {
      // Record the whole gesture as ONE undoable step, whose inverse restores
      // the positions the drag started from.
      const undoable = setPropOnMany(
        document_,
        [...drag.origins.keys()],
        "transform.position",
        (id) => findAuthored(session, id) ?? drag.origins.get(id)!,
        drag.origins.size === 1 ? "Move node" : `Move ${drag.origins.size} nodes`,
      );
      if (undoable !== null) {
        // Rewind to the start, then apply once through the recording path, so
        // the stack holds exactly one entry with the correct prior state.
        const rewind = setPropOnMany(
          document_,
          [...drag.origins.keys()],
          "transform.position",
          (id) => drag.origins.get(id)!,
          "rewind",
        );
        if (rewind !== null) session.store.applySilently(rewind);
        session.store.apply(undoable);
      }
    }

    if (drag.kind === "orbit" && drag.cameraId !== undefined && drag.startOrbit !== undefined) {
      // One undo entry for the whole turn, with the camera's starting pose as
      // the prior state. Rewound first, exactly like a move, so the stack
      // records where the camera WAS rather than where the last silent frame
      // left it — the bug that made undo restore only part of a drag.
      const start = positionFor(drag.startOrbit, drag.pivot ?? { x: 0, y: 0, z: 0 });
      const startRotation = lookAtRotation(start, drag.pivot ?? { x: 0, y: 0, z: 0 });
      const endPosition = findAuthored(session, drag.cameraId);
      const endTransform = session.document;
      void endTransform;

      // NOTHING TO COMMIT. An orbit is a change of view, not a change of
      // work, and it does not take a step in the history — see
      // `applySilently`. The silent applies during the drag have already left
      // the camera where the designer put it, and it saves with the graphic.
      //
      // This was wrong the first time: orbit recorded an undo step because it
      // mutates a scene node, which is true and beside the point. Undo belongs
      // to the work.
      void start;
      void startRotation;
      void endPosition;
    }

    if ((drag.kind === "resize" || drag.kind === "rotate") && drag.origins.size > 0) {
      commitGesture(drag);
    }

    setDrag(null);
    setMarqueeRect(null);
    setGuides({ x: null, y: null });
  };

  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey || !event.shiftKey) {
      const factor = Math.pow(0.999, event.deltaY);
      onViewport(zoomAt(viewport, pointOf(event), factor));
    } else {
      onViewport(pan(viewport, -event.deltaX, -event.deltaY));
    }
  };

  // -- Chrome ---------------------------------------------------------------

  const toScreen = (worldX: number, worldY: number) =>
    worldToScreen(document_, viewport, { x: worldX, y: worldY }, view ?? undefined);

  const safe = safeAreas(document_);
  const selectedBounds = bounds.filter((entry) => selection.ids.includes(entry.nodeId));
  const canvasOrigin = canvasToScreen(viewport, { x: 0, y: 0 });
  const canvasExtent = canvasToScreen(viewport, { x: size.width, y: size.height });

  return (
    <div className="scene-view" ref={hostRef} data-testid="scene-view">
      <div
        className="scene-surface"
        ref={surfaceRef}
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          width: size.width,
          height: size.height,
        }}
      >
        {/* The transparency checkerboard belongs to the flat view. In 3D it
            is a flat sheet floating in a perspective scene, and it reads as a
            panel someone forgot to hide — because that is what it is.
            
            HIDDEN WITH A CLASS, NEVER UNMOUNTED. The canvas is appended to
            this element imperatively, so React does not know it is there; a
            sibling that unmounts and remounts is re-inserted AFTER the canvas
            and paints straight over the scene. That is what made a lower
            third lose its background after a trip to the 3/4 view — the
            renderer was drawing all eight calls and fifty-four triangles
            perfectly, and a div was sitting on top of them. */}
        <div className={`scene-checker ${dimensional ? "off" : ""}`} aria-hidden />
      </div>

      <svg
        className="scene-chrome"
        width={element.width}
        height={element.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onContextMenu={(event) => {
          // Right-clicking something that is not selected selects it first.
          // Anything else means the menu acts on a thing the user cannot see
          // they are acting on, which is how people delete the wrong layer.
          const world = screenToWorld(document_, viewport, pointOf(event), view ?? undefined);
          const hit = pick(bounds, world);
          if (hit !== null && !lockedIds.has(hit) && !selection.ids.includes(hit)) {
            onSelection(selectOnly(hit));
          }
          event.preventDefault();
          setMenu(pointOf(event));
        }}
        onWheel={onWheel}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(SCENE_DRAG)) return;
          // Both are required: preventDefault on dragover is what makes an
          // element a drop target at all, and without it `drop` never fires.
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          const templateId = event.dataTransfer.getData(SCENE_DRAG);
          setDropping(false);
          if (templateId === "") return;
          event.preventDefault();
          onDropScene(templateId, screenToCanvas(viewport, pointOf(event)));
        }}
        data-testid="scene-chrome"
        data-dropping={dropping ? "yes" : "no"}
        /* The cursor is the affordance. `handleDirection` rotates it with the
           node, so a box turned 90 degrees shows an east-west cursor on its
           north handle — a hard-coded `ns-resize` would lie the moment
           anything was rotated. */
        style={{ cursor: cursorFor(drag, hover) }}
        /* The gesture in progress. Exposed so a test can assert that a drag
           STARTED as a resize rather than inferring it from pixels — a pixel
           delta cannot tell "the handle was missed" from "the resize was
           small", and that ambiguity hid a real bug. */
        data-drag={drag?.kind ?? "none"}
        /* What the pointer is over. Exposed for the same reason `data-drag`
           is: a cursor assertion alone cannot tell "the handle was missed"
           from "the cursor is wrong", and that ambiguity has already hidden
           one real bug in this component. */
        data-hover={
          hover.axis !== null
            ? `axis-${hover.axis}`
            : (hover.handle?.id ?? (hover.node === null ? "none" : "node"))
        }
      >
        {/* Frame edge. The document's own output rectangle, always drawn: a
            designer needs to know where the picture ends. */}
        <rect
          className="frame-edge"
          x={canvasOrigin.x}
          y={canvasOrigin.y}
          width={canvasExtent.x - canvasOrigin.x}
          height={canvasExtent.y - canvasOrigin.y}
        />

        {/* The flat grid and the safe areas are measured in CANVAS space, so
            in 3D they are not merely unwanted — they are drawn somewhere the
            scene is not. The ground grid replaces them. */}
        {workspace.showGrid && !dimensional ? <Grid document={document_} viewport={viewport} step={workspace.gridStep} element={element} /> : null}

        {workspace.showSafeAreas && !dimensional
          ? (["action", "title"] as const).map((kind) => {
              const rect = kind === "title" ? safe.title : safe.action;
              const topLeft = canvasToScreen(viewport, {
                x: rect.x - rect.width / 2,
                y: rect.y - rect.height / 2,
              });
              return (
                <rect
                  key={kind}
                  className={`safe-area ${kind}`}
                  x={topLeft.x}
                  y={topLeft.y}
                  width={rect.width * viewport.zoom}
                  height={rect.height * viewport.zoom}
                  data-testid={`safe-${kind}`}
                />
              );
            })
          : null}

        {selectedBounds.map((entry) => {
          const topLeft = toScreen(
            entry.rect.x - entry.rect.width / 2,
            entry.rect.y + entry.rect.height / 2,
          );
          const width = entry.rect.width * ppu * viewport.zoom;
          const height = entry.rect.height * ppu * viewport.zoom;
          return (
            <g key={entry.nodeId} className="selection-box" data-testid="selection-box">
              {/* Outline per node so a multi-selection shows what is in it.
                  The HANDLES are drawn once, on the union, below — they must
                  match what `handleAt` hit-tests or the grab misses. */}
              <rect x={topLeft.x} y={topLeft.y} width={width} height={height} />
            </g>
          );
        })}

        {/* THE GROUND. Drawn first, under everything: it is the thing you
            measure against, never the thing you look at. */}
        {ground.length === 0 ? null : (
          <g className="ground" data-testid="ground">
            {ground.map((line, index) => {
              const from = canvasToScreen(viewport, line.from);
              const to = canvasToScreen(viewport, line.to);
              return (
                <line
                  key={index}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={
                    line.axis === "x" ? "#e5484d" : line.axis === "z" ? "#3b82f6" : "currentColor"
                  }
                  strokeOpacity={line.axis === undefined ? line.strength : line.strength * 0.85}
                  strokeWidth={line.axis === undefined ? 1 : 1.5}
                />
              );
            })}
          </g>
        )}

        {/* HOVER. Drawn under the gizmo so selection always reads stronger,
            and suppressed for anything already selected — an outline that
            doubled up on a selected node just made the selection look wrong. */}
        {(() => {
          if (drag !== null || hover.node === null) return null;
          if (selection.ids.includes(hover.node)) return null;
          const box = bounds.find((entry) => entry.nodeId === hover.node);
          if (box === undefined) return null;
          const topLeft = toScreen(box.rect.x - box.rect.width / 2, box.rect.y + box.rect.height / 2);
          const scale = viewport.zoom * ppu;
          return (
            <rect
              className="hover-outline"
              data-testid="hover-outline"
              x={topLeft.x}
              y={topLeft.y}
              width={box.rect.width * scale}
              height={box.rect.height * scale}
            />
          );
        })()}

        {/* THE MOVE GIZMO. Three arms from the selection's centre, each
            constraining a drag to one direction. Free dragging in 3D is a
            guess: the pointer has two dimensions and the scene has three, so
            something has to decide the third, and it will be wrong often
            enough to be maddening. Saying WHICH first makes the drag exact. */}
        {arms.length === 0 || !canAuthor ? null : (
          <g className="axes" data-testid="axes">
            {arms.map((arm) => {
              const from = canvasToScreen(viewport, arm.from);
              const to = canvasToScreen(viewport, arm.to);
              const dragging = drag?.kind === "axis" && drag.axis?.id === arm.axis.id;
              const hovered = hover.axis === arm.axis.id;
              // Faded as it turns towards the lens, and gone before it becomes
              // a stub that cannot be aimed at.
              const usable = arm.foreshortening >= MIN_FORESHORTENING;
              if (!usable && !dragging) return null;
              const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
              return (
                <g
                  key={arm.axis.id}
                  className={`axis ${dragging ? "dragging" : ""} ${hovered ? "hot" : ""}`}
                  data-testid={`axis-${arm.axis.id}`}
                  opacity={dragging || hovered ? 1 : 0.35 + arm.foreshortening * 0.45}
                >
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={arm.axis.colour}
                    strokeWidth={dragging || hovered ? 3 : 2}
                    strokeLinecap="round"
                  />
                  {/* A head, so the arm reads as a direction rather than a
                      line, and so its far end is obvious — the hit test stops
                      there. */}
                  <polygon
                    points="0,0 -9,3.5 -9,-3.5"
                    fill={arm.axis.colour}
                    transform={`translate(${to.x} ${to.y}) rotate(${angle})`}
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* The transform gizmo: eight resize handles and a rotation grip, on
            the union of the selection. Positions come from the same
            `handlesFor` the hit test uses, so what is drawn is what is
            grabbable. */}
        {(() => {
          const union = selectionBounds(bounds, selection.ids);
          if (union === null || !canAuthor) return null;
          return (
            <g className="gizmo" data-testid="gizmo">
              {handlesFor(union).map((h) => {
                const p = toScreen(h.x, h.y);
                if (h.id === "rotate") {
                  const centre = toScreen(union.x, union.y + union.height / 2);
                  return (
                    <g key={h.id}>
                      <line
                        className="gizmo-stem"
                        x1={centre.x}
                        y1={centre.y}
                        x2={p.x}
                        y2={p.y}
                      />
                      <circle
                        className="handle rotate"
                        data-testid="handle-rotate"
                        cx={p.x}
                        cy={p.y}
                        r={4}
                      />
                    </g>
                  );
                }
                return (
                  <rect
                    key={h.id}
                    className="handle"
                    data-testid={`handle-${h.id}`}
                    x={p.x - 3}
                    y={p.y - 3}
                    width={6}
                    height={6}
                  />
                );
              })}
            </g>
          );
        })()}

        {workspace.showGuides && guides.x !== null ? (
          <line
            className="snap-guide"
            x1={toScreen(guides.x, 0).x}
            y1={0}
            x2={toScreen(guides.x, 0).x}
            y2={element.height}
            data-testid="snap-guide-x"
          />
        ) : null}
        {workspace.showGuides && guides.y !== null ? (
          <line
            className="snap-guide"
            x1={0}
            y1={toScreen(0, guides.y).y}
            x2={element.width}
            y2={toScreen(0, guides.y).y}
          />
        ) : null}

        {marqueeRect !== null ? (
          <MarqueeRect a={marqueeRect.a} b={marqueeRect.b} toScreen={toScreen} />
        ) : null}
      </svg>

      {/* Rulers read in flat canvas units. Under a turned camera those units
          no longer run along the screen, so the numbers would be confidently
          wrong rather than merely unhelpful. */}
      {workspace.showRulers && !dimensional ? (
        <Rulers document={document_} viewport={viewport} element={element} />
      ) : null}

      {/* THE AXIS WIDGET. Answers "which way am I facing?" without the
          designer having to work it out, and clicking a ball is the fastest
          way back to a known angle. It reads the same camera everything else
          does, so it cannot disagree with the scene. */}
      {compass.length === 0 ? null : (
        <svg className="compass" width={78} height={78} data-testid="compass" aria-hidden={false}>
          <g transform="translate(39 39)">
            {compass.map((ball) => (
              <g
                key={`${ball.id}${ball.sign}`}
                className="compass-ball"
                data-testid={`compass-${ball.id}${ball.sign > 0 ? "" : "-neg"}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onCompass(ball.id, ball.sign);
                }}
              >
                <line
                  x1={0}
                  y1={0}
                  x2={ball.at.x}
                  y2={ball.at.y}
                  stroke={ball.colour}
                  strokeOpacity={ball.labelled ? 0.9 : 0.3}
                  strokeWidth={1.5}
                />
                <circle
                  cx={ball.at.x}
                  cy={ball.at.y}
                  r={8}
                  fill={ball.labelled ? ball.colour : "var(--panel)"}
                  stroke={ball.colour}
                  strokeWidth={1.5}
                />
                {ball.labelled ? (
                  <text x={ball.at.x} y={ball.at.y + 3.5} textAnchor="middle" className="compass-label">
                    {ball.label}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        </svg>
      )}

      {menu === null ? null : (
        <>
          {/* A full-surface backdrop, so ANY click closes the menu — including
              a click on the menu's own edge. A menu that could be left open
              behind a dialog is a menu that eventually acts on the wrong
              selection. */}
          <div className="menu-scrim" onPointerDown={() => setMenu(null)} aria-hidden />
          <ul
            className="context-menu"
            role="menu"
            data-testid="context-menu"
            style={{
              left: Math.min(menu.x, Math.max(0, element.width - 208)),
              top: Math.min(menu.y, Math.max(0, element.height - 8 - menuCommands.length * 26)),
            }}
          >
            {menuCommands.map((command) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`menu-${command.id}`}
                  disabled={command.enabled === false}
                  onClick={() => {
                    setMenu(null);
                    command.run();
                  }}
                >
                  <span>{command.title}</span>
                  {command.shortcut === undefined ? null : (
                    <kbd>{command.shortcut}</kbd>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error !== null ? (
        <p role="alert" className="scene-error">
          Rendering unavailable: {error}
        </p>
      ) : null}
    </div>
  );
}

/** Six decimals. Sub-micrometre at metre scale, and it kills drift on a drag. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The authored position of a node, for a drag origin. */
/** Authored transform of a node, or null. Mirrors `findAuthored`. */
/** Union of the bounds of every selected node, or null when nothing is boxed. */
function selectionBounds(
  bounds: readonly { nodeId: string; rect: Rect }[],
  ids: readonly string[],
): Rect | null {
  const chosen = bounds.filter((b) => ids.includes(b.nodeId));
  if (chosen.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { rect } of chosen) {
    minX = Math.min(minX, rect.x - rect.width / 2);
    maxX = Math.max(maxX, rect.x + rect.width / 2);
    minY = Math.min(minY, rect.y - rect.height / 2);
    maxY = Math.max(maxY, rect.y + rect.height / 2);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}

function findTransform(
  session: StudioSession,
  nodeId: string,
): { scale: readonly [number, number, number]; rotation: number } | null {
  const stack = [session.document.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) {
      const scale = node.transform?.scale ?? [1, 1, 1];
      const rotation = node.transform?.rotation ?? [0, 0, 0];
      return {
        scale: [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1],
        rotation: rotation[2] ?? 0,
      };
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

function findAuthored(
  session: StudioSession,
  nodeId: string,
): readonly [number, number, number] | null {
  const stack = [session.document.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) {
      const position = node.transform?.position ?? [0, 0, 0];
      return [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0];
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

/** The authored rotation of a node, for the same reason as `findAuthored`. */
function findRotation(
  session: StudioSession,
  nodeId: string,
): readonly [number, number, number] | null {
  const stack = [session.document.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) {
      const rotation = node.transform?.rotation ?? [0, 0, 0];
      return [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0];
    }
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

/** The first node carrying a camera — the one the scene is shot through. */
function cameraNode(document: SceneDocument): SceneNode | null {
  const stack = [document.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if ((node.components ?? []).some((component) => component.type === "camera")) return node;
    for (const child of node.children ?? []) stack.push(child);
  }
  return null;
}

function MarqueeRect({
  a,
  b,
  toScreen,
}: {
  a: Point;
  b: Point;
  toScreen: (x: number, y: number) => Point;
}) {
  const p1 = toScreen(Math.min(a.x, b.x), Math.max(a.y, b.y));
  const p2 = toScreen(Math.max(a.x, b.x), Math.min(a.y, b.y));
  return (
    <rect
      className="marquee"
      x={p1.x}
      y={p1.y}
      width={p2.x - p1.x}
      height={p2.y - p1.y}
      data-testid="marquee"
    />
  );
}

function Grid({
  document: doc,
  viewport,
  step,
  element,
}: {
  document: SceneDocument;
  viewport: Viewport;
  step: number;
  element: { width: number; height: number };
}) {
  const spacing = pixelsPerUnit(doc) * step * viewport.zoom;
  if (spacing < 4) return null; // Denser than this is a grey wash, not a grid.

  const origin = canvasToScreen(viewport, worldToCanvas(doc, { x: 0, y: 0 }));
  const lines: React.ReactElement[] = [];
  for (let x = origin.x % spacing; x < element.width; x += spacing) {
    lines.push(<line key={`x${x}`} className="grid-line" x1={x} y1={0} x2={x} y2={element.height} />);
  }
  for (let y = origin.y % spacing; y < element.height; y += spacing) {
    lines.push(<line key={`y${y}`} className="grid-line" x1={0} y1={y} x2={element.width} y2={y} />);
  }
  return <g data-testid="grid">{lines}</g>;
}

function Rulers({
  document: doc,
  viewport,
  element,
}: {
  document: SceneDocument;
  viewport: Viewport;
  element: { width: number; height: number };
}) {
  const ppu = pixelsPerUnit(doc);
  // A tick every unit, coarsened until the labels stop colliding.
  let unit = 1;
  while (unit * ppu * viewport.zoom < 48) unit *= 2;

  const origin = canvasToScreen(viewport, worldToCanvas(doc, { x: 0, y: 0 }));
  const spacing = unit * ppu * viewport.zoom;
  const ticks: { at: number; label: string }[] = [];
  for (let x = origin.x % spacing; x < element.width; x += spacing) {
    ticks.push({ at: x, label: (((x - origin.x) / (ppu * viewport.zoom))).toFixed(0) });
  }

  return (
    <div className="rulers" aria-hidden data-testid="rulers">
      <div className="ruler horizontal">
        {ticks.map((tick) => (
          <span key={tick.at} style={{ left: tick.at }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
