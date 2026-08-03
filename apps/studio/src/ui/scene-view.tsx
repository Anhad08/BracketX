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
  screenToWorld,
  snap,
  snapCandidates,
  worldToCanvas,
  zoomAt,
  type NodeBounds,
  type Point,
  recentre,
  type Viewport,
} from "../studio/viewport";
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
}

interface DragState {
  readonly kind: "pan" | "move" | "marquee";
  readonly startScreen: Point;
  readonly startWorld: Point;
  /** World positions of the nodes being moved, at drag start. */
  readonly origins: ReadonlyMap<string, readonly [number, number, number]>;
  readonly startViewport: Viewport;
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
}: SceneViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [element, setElement] = useState({ width: 0, height: 0 });
  // Set by the shell when the backend refuses to start. The scene view itself
  // never creates a backend, so it can only report a failure, not cause one.
  const [error] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ a: Point; b: Point } | null>(null);
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
        onViewportRef.current(recentre(viewportRef.current, previous, next));
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
        data-testid="scene-chrome"
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
              <rect x={topLeft.x} y={topLeft.y} width={width} height={height} />
              {/* Corner handles. Move-only in Phase 1 — a resize gizmo that
                  wrote `size` would fight layout, and layout wins. */}
              {[
                [topLeft.x, topLeft.y],
                [topLeft.x + width, topLeft.y],
                [topLeft.x, topLeft.y + height],
                [topLeft.x + width, topLeft.y + height],
              ].map(([hx, hy], index) => (
                <rect key={index} className="handle" x={hx! - 3} y={hy! - 3} width={6} height={6} />
              ))}
            </g>
          );
        })}

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
