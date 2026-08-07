import { useCallback, useEffect, useRef, useState } from "react";

import type { StudioSession } from "../studio/session";
import { nodeBounds } from "../studio/viewport";
import { checkFormats, primaryFormat, type FormatCheck } from "../studio/formats";

/**
 * The confidence strip.
 *
 * ============================================================================
 * EVERY FORMAT YOU WILL DELIVER IN, AT ONCE, AND THE ONE THAT BREAKS SAYS SO
 * ============================================================================
 * Not a status line. A column of the actual graphic, one tile per delivery
 * format, each at that format's aspect ratio, each carrying a lamp that lights
 * when the words leave title safe or the frame in THAT format.
 *
 * The primary sits at the top of the same column and is checked on the same
 * terms as the rest — see the note in `formats.ts` about the clipped name that
 * nothing warned about.
 *
 * ============================================================================
 * THE PIXELS ARE THE ENGINE'S OWN
 * ============================================================================
 * Nothing here draws the graphic. Every format is shot at the same world
 * HEIGHT, so a narrower format is a window on the frame the engine has already
 * drawn — `cropFor` says which part — and a tile is one `drawImage` from the
 * live canvas. That is the difference between a preview and a second renderer
 * that slowly stops agreeing with the first.
 *
 * The canvas can be read back at all because it is created with
 * `preserveDrawingBuffer: true`, which `canvas-backend.ts` sets for exactly
 * this: "reading pixels back — for verification, for thumbnails, for output".
 *
 * ============================================================================
 * A CHECK, NOT A MONITOR
 * ============================================================================
 * Tiles repaint at `REPAINT_MS`, not every frame. Reading back a WebGL canvas
 * costs a synchronous texture fetch, and paying it five times per frame to
 * animate a 96-pixel thumbnail would take frame budget away from the thing
 * being checked. `OutputDescriptor.cadence` exists in the engine for the same
 * reason and with the same argument.
 */

/** Backing-store width of a tile, in pixels. Height follows the aspect. */
const TILE_WIDTH = 96;

/** How often tiles repaint. A check does not need sixty of these a second. */
const REPAINT_MS = 200;

export interface ConfidenceStripProps {
  readonly session: StudioSession;
  /** The live preview canvas. Null before boot. */
  readonly canvas: HTMLCanvasElement | null;
  /** Bumped on every document edit, so the checks re-run. */
  readonly revision: number;
  /** Selects the layer a warning is about. */
  readonly onSelect: (nodeId: string) => void;
}

export function ConfidenceStrip({
  session,
  canvas,
  revision,
  onSelect,
}: ConfidenceStripProps) {
  const document_ = session.document;
  const tiles = useRef(new Map<string, HTMLCanvasElement>());

  /**
   * Repainting is DEMAND-DRIVEN, not a loop.
   *
   * ========================================================================
   * A LOOP HERE NEVER LETS THE EDITOR REACH A STILL FRAME
   * ========================================================================
   * The first version ran `requestAnimationFrame` forever and copied the
   * scene canvas every 200ms. That is wrong twice over. Reading back a WebGL
   * canvas forces the compositor to re-present it, so an idle editor — paused
   * clock, untouched document, nothing moving — repainted five times a second
   * for ever and never produced two identical frames. It cost GPU time on a
   * still picture, and it meant no part of the product could ever say "the
   * view has settled".
   *
   * It was found by a test that compares the stage to itself, which sat there
   * taking twenty-five consecutive screenshots and finding all of them
   * different. That test exists because of a bug the strip did not cause; it
   * caught this one for free.
   *
   * So the strip repaints when the ENGINE SAYS SOMETHING CHANGED, throttled,
   * and then stops. A paused scene reaches a still frame and stays there.
   */
  const [, bump] = useState(0);
  const bounds = nodeBounds(document_, (id) => session.worldMatrixOf(id));
  const facts = session.host.reconciler.projector.textFacts();
  const checks = checkFormats(document_, bounds, facts);

  // The painter reads the CURRENT checks without being rebuilt whenever they
  // change identity — which is every render.
  const current = useRef(checks);
  current.current = checks;

  const paint = useCallback(() => {
    if (canvas === null || canvas.width === 0 || canvas.height === 0) return;
    for (const check of current.current) {
      const tile = tiles.current.get(check.format.id);
      if (tile === undefined) continue;
      const context = tile.getContext("2d");
      if (context === null) continue;

      const { source, covers } = check.crop;
      context.clearRect(0, 0, tile.width, tile.height);
      const destinationWidth = tile.width * covers;
      try {
        context.drawImage(
          canvas,
          (canvas.width * (1 - source)) / 2,
          0,
          canvas.width * source,
          canvas.height,
          (tile.width - destinationWidth) / 2,
          0,
          destinationWidth,
          tile.height,
        );
      } catch {
        // A canvas that has not produced a frame yet throws rather than
        // drawing nothing. The tile stays empty, which is the truth.
      }
    }
  }, [canvas]);

  // The engine stepped, or the document changed. Coalesced onto one timer, so
  // sixty notifications a second become one repaint every `REPAINT_MS` — and
  // then silence, until something else happens.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const request = (): void => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        paint();
        // Re-check on the same beat as the repaint. A graphic whose entrance
        // animates a name off the edge is only wrong for part of its
        // timeline, and a strip that read the document alone would be green
        // throughout.
        bump((value) => value + 1);
      }, REPAINT_MS);
    };

    request();
    const stop = session.subscribe(request);
    return () => {
      stop();
      if (timer !== null) clearTimeout(timer);
    };
  }, [session, paint, revision]);

  const primary = primaryFormat(document_);
  const unclear = checks.filter((check) => !check.clear).length;

  return (
    <aside className="conf-strip" data-testid="conf-strip" aria-label="Delivery formats">
      {/* IT HAS TO SAY WHAT IT IS.
          A row of small pictures labelled with ratios, and nothing else, is a
          row somebody has to ask about — which is exactly what happened. The
          heading states the job in the words the job is done in, and the
          verdict beside it means the row can be ignored at a glance when there
          is nothing to act on. */}
      <header className="conf-head">
        <span className="conf-title">Delivers in</span>
        <span className={`conf-verdict ${unclear === 0 ? "ok" : "warn"}`} data-testid="conf-verdict">
          {unclear === 0
            ? "all clear"
            : `${unclear} ${unclear === 1 ? "shape needs" : "shapes need"} a look`}
        </span>
      </header>
      {checks.map((check) => (
        <Tile
          key={check.format.id}
          check={check}
          isPrimary={check.format.id === primary.id}
          onMount={(element) => {
            if (element === null) tiles.current.delete(check.format.id);
            else tiles.current.set(check.format.id, element);
          }}
          onSelect={onSelect}
        />
      ))}
    </aside>
  );
}

function Tile({
  check,
  isPrimary,
  onMount,
  onSelect,
}: {
  readonly check: FormatCheck;
  readonly isPrimary: boolean;
  readonly onMount: (element: HTMLCanvasElement | null) => void;
  readonly onSelect: (nodeId: string) => void;
}) {
  const { format, issues, clear } = check;
  const aspect = format.width / format.height;
  const height = Math.max(1, Math.round(TILE_WIDTH / aspect));

  // Each finding named, in the words the pre-flight uses. A lamp that lights
  // without saying what is wrong sends somebody hunting through five formats.
  const title = clear
    ? `${format.name} — nothing to report`
    : issues.map((issue) => `${issue.label}: ${issue.detail}`).join("\n");

  return (
    <button
      type="button"
      className={`conf-tile ${clear ? "" : "warn"} ${isPrimary ? "primary" : ""}`}
      data-testid={`conf-${format.id}`}
      data-warn={clear ? "no" : "yes"}
      title={title}
      /* Clicking a warning selects the layer it is about. A warning you cannot
         act on from where you read it is a warning you read twice. */
      onClick={() => {
        const first = issues[0];
        if (first !== undefined) onSelect(first.nodeId);
      }}
    >
      <canvas
        ref={onMount}
        width={TILE_WIDTH}
        height={height}
        style={{ aspectRatio: `${format.width} / ${format.height}` }}
      />
      <span className="conf-foot">
        <span className={`lamp ${clear ? "ok" : "warn"}`} aria-hidden />
        <span className="conf-name">{format.name}</span>
      </span>
    </button>
  );
}
