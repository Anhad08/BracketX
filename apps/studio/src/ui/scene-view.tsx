import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SceneDocument } from "@bracketx/engine-scene";

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
import { setPropOnMany } from "../studio/editing";
import {
  handleAt,
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
  marquee,
  nodeBounds,
  pan,
  pick,
  pixelsPerUnit,
  rectFromCorners,
  safeAreas,
  screenToCanvas,
  screenToWorld,
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
  /**
   * A scene was dropped on the stage, at this point in canvas coordinates.
   *
   * The Stage does not know what a template is — it reports WHERE, and the
   * shell decides what to place. Keeping instantiation out of the viewport is
   * what stops this becoming a second, half-informed copy of the shell.
   */
  readonly onDropScene: (templateId: string, at: Point) => void;
}

interface DragState {
  readonly kind: "pan" | "move" | "marquee" | "resize" | "rotate";
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
  onDropScene,
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
    const tick = () => {
      if (!session.disposed && (session.playing || pending.current)) {
        pending.current = false;
        try {
          session.render();
        } catch {
          // A bad frame must not kill the loop; the next edit will redraw.
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [session]);

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

  // -- Bounds and picking ---------------------------------------------------

  const bounds = useMemo<readonly NodeBounds[]>(
    () => nodeBounds(document_, (id) => session.worldMatrixOf(id)),
    // Recomputed when the document changes or a frame moved something.
    [document_, revision, session],
  );

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
    const world = screenToWorld(document_, viewport, screen);
    (event.target as Element).setPointerCapture?.(event.pointerId);

    // Middle button or space-drag pans. Never the scene camera — see viewport.ts.
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
    const selectionRect = selectionBounds(bounds, selection.ids);
    if (selectionRect !== null) {
      // 10 screen px, converted — a handle must be equally grabbable at 10 %
      // and at 800 %, which a fixed world tolerance is not.
      const tolerance = 10 / (viewport.zoom * ppu);
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
    setDrag({
      kind: "move",
      startScreen: screen,
      startWorld: world,
      origins,
      startViewport: viewport,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag === null) return;
    const screen = pointOf(event);
    const world = screenToWorld(document_, viewport, screen);

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
    canvasToScreen(viewport, worldToCanvas(document_, { x: worldX, y: worldY }));

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
        <div className="scene-checker" aria-hidden />
      </div>

      <svg
        className="scene-chrome"
        width={element.width}
        height={element.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
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
        /* The gesture in progress. Exposed so a test can assert that a drag
           STARTED as a resize rather than inferring it from pixels — a pixel
           delta cannot tell "the handle was missed" from "the resize was
           small", and that ambiguity hid a real bug. */
        data-drag={drag?.kind ?? "none"}
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

        {workspace.showGrid ? <Grid document={document_} viewport={viewport} step={workspace.gridStep} element={element} /> : null}

        {workspace.showSafeAreas
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

        {/* The transform gizmo: eight resize handles and a rotation grip, on
            the union of the selection. Positions come from the same
            `handlesFor` the hit test uses, so what is drawn is what is
            grabbable. */}
        {(() => {
          const union = selectionBounds(bounds, selection.ids);
          if (union === null) return null;
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

      {workspace.showRulers ? (
        <Rulers document={document_} viewport={viewport} element={element} />
      ) : null}

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
