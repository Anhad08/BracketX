import { useCallback, useEffect, useRef, useState } from "react";
import type { Timeline } from "@bracketx/engine-scene";

import type { KeyframeRef } from "../studio/keyframes";

/**
 * The timeline, as an instrument.
 *
 * ============================================================================
 * WHAT WAS THERE, AND WHY IT WAS NOT A TIMELINE
 * ============================================================================
 * A list of rows, each with a truncated layer name, a number box and a strip
 * of diamonds. No ruler, so you could not tell WHEN anything happened. No
 * playhead, so you could not go to a moment and look at it. No scrubbing, so
 * the only way to see the animation was to press play and watch it go past.
 * Keyframes could be typed at but not dragged.
 *
 * That is a keyframe table. Everyone who edits motion for a living — Resolve,
 * Premiere, After Effects, Flame — works the same way, and it is not habit:
 * you scrub to a moment, you look at the frame, you drag a key, you scrub
 * again. The loop is scrub-look-adjust, and every one of those three was
 * missing.
 *
 * ============================================================================
 * WHY IT IS DRAWN THE WAY IT IS
 * ============================================================================
 * Nothing here re-renders React while a drag is in flight. The playhead moves
 * by writing one CSS custom property; a keyframe moves by writing a transform
 * on the element under the pointer. React sees a drag when it STARTS and when
 * it ENDS, and that is the whole reason this feels like an instrument rather
 * than a form — a fifty-keyframe timeline re-rendering per pointer move cannot
 * hold sixty frames a second, and a timeline that stutters is one you stop
 * trusting to tell you where you are.
 *
 * The same rule the viewport's gizmos follow: silent during the gesture, one
 * transaction on release, so a drag is one undo step.
 */

export interface TimelineGridProps {
  readonly timeline: Timeline;
  /** Frames per second, from the document. */
  readonly rate: number;
  /** Where the playhead is, in seconds. */
  readonly time: number;
  /** Scrubbing. Called continuously during a drag — it drives the picture. */
  readonly onScrub: (seconds: number) => void;
  readonly labelOf: (track: number) => { readonly layer: string; readonly property: string };
  readonly picked: readonly KeyframeRef[];
  readonly onPick: (refs: readonly KeyframeRef[]) => void;
  /** Commits a move. One transaction, one undo step. */
  readonly onMove: (refs: readonly KeyframeRef[], deltaSeconds: number) => void;
  readonly onDelete: () => void;
}

/** Header width, in pixels. The lanes start here. */
const HEADER = 168;
const ROW = 26;

export function TimelineGrid({
  timeline,
  rate,
  time,
  onScrub,
  labelOf,
  picked,
  onPick,
  onMove,
  onDelete,
}: TimelineGridProps) {
  const host = useRef<HTMLDivElement | null>(null);

  /**
   * The window on time: where it starts and how wide it is, in seconds.
   *
   * State rather than props because it is a VIEW, not the document — panning a
   * timeline is not an edit and must never touch history, the same rule the
   * viewport applies to pan and zoom.
   */
  const [view, setView] = useState({ start: 0, span: Math.max(1, timeline.duration * 1.1) });

  // A timeline that got longer must not leave the view showing nothing.
  useEffect(() => {
    setView((current) =>
      current.span <= 0 || timeline.duration > current.start + current.span
        ? { start: 0, span: Math.max(1, timeline.duration * 1.1) }
        : current,
    );
  }, [timeline.duration]);

  const width = useCallback(
    () => (host.current?.clientWidth ?? 800) - HEADER,
    [],
  );

  const xOf = useCallback(
    (seconds: number) => ((seconds - view.start) / view.span) * width(),
    [view, width],
  );
  const timeOf = useCallback(
    (x: number) => view.start + (x / Math.max(1, width())) * view.span,
    [view, width],
  );

  /** Pointer x, relative to the start of the lanes. */
  const laneX = useCallback((clientX: number) => {
    const box = host.current?.getBoundingClientRect();
    return clientX - (box?.left ?? 0) - HEADER;
  }, []);

  // -- The playhead ---------------------------------------------------------
  //
  // Written as a custom property so moving it costs one style write on one
  // element, not a render of every track.
  useEffect(() => {
    host.current?.style.setProperty("--play", `${Math.round(xOf(time))}px`);
  }, [time, xOf]);

  const scrubbing = useRef(false);
  const scrub = useCallback(
    (clientX: number) => {
      const seconds = Math.max(0, timeOf(laneX(clientX)));
      // Snapped to a frame, because a broadcast timeline is counted in frames
      // and a playhead between two of them is a position that cannot be
      // returned to.
      onScrub(Math.round(seconds * rate) / rate);
    },
    [timeOf, laneX, onScrub, rate],
  );

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (!scrubbing.current) return;
      scrub(event.clientX);
    };
    const up = (): void => {
      scrubbing.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [scrub]);

  // -- Zoom and pan ---------------------------------------------------------

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      if (event.shiftKey) {
        // Pan. A tenth of the visible span per notch, so a flick crosses the
        // timeline and a nudge moves a frame or two.
        setView((current) => ({
          ...current,
          start: Math.max(0, current.start + (event.deltaY / 400) * current.span),
        }));
        return;
      }
      // Zoom ABOUT THE POINTER, so the frame under the cursor stays there.
      // Zooming about the left edge is the single most disorienting thing a
      // timeline can do — you lose the thing you were looking at every time.
      const anchor = timeOf(laneX(event.clientX));
      setView((current) => {
        const span = Math.min(
          Math.max(0.1, current.span * Math.pow(1.0016, event.deltaY)),
          Math.max(2, timeline.duration * 8),
        );
        const ratio = (anchor - current.start) / current.span;
        return { start: Math.max(0, anchor - ratio * span), span };
      });
    },
    [timeOf, laneX, timeline.duration],
  );

  // -- Dragging keyframes ---------------------------------------------------

  const dragging = useRef<{
    readonly refs: readonly KeyframeRef[];
    readonly startX: number;
    delta: number;
  } | null>(null);

  const beginDrag = useCallback(
    (event: React.PointerEvent, ref: KeyframeRef) => {
      event.stopPropagation();
      const already = picked.some((k) => k.track === ref.track && k.index === ref.index);
      const refs =
        event.shiftKey || event.metaKey || event.ctrlKey
          ? already
            ? picked.filter((k) => !(k.track === ref.track && k.index === ref.index))
            : [...picked, ref]
          : already
            ? picked
            : [ref];
      onPick(refs);
      dragging.current = { refs, startX: event.clientX, delta: 0 };
      (event.target as Element).setPointerCapture?.(event.pointerId);
    },
    [picked, onPick],
  );

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const state = dragging.current;
      if (state === null || host.current === null) return;
      const seconds = ((event.clientX - state.startX) / Math.max(1, width())) * view.span;
      // Quantised to frames while dragging, so what you see under the pointer
      // is what will be committed. A drag that previews a smooth position and
      // then snaps on release is a drag you cannot aim.
      state.delta = Math.round(seconds * rate) / rate;
      const offset = Math.round(xOf(state.delta) - xOf(0));
      host.current.style.setProperty("--nudge", `${offset}px`);
    };
    const up = (): void => {
      const state = dragging.current;
      dragging.current = null;
      host.current?.style.setProperty("--nudge", "0px");
      if (state === null || state.delta === 0) return;
      onMove(state.refs, state.delta);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [view.span, width, xOf, rate, onMove]);

  // Delete and nudge, the two things hands do without looking.
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      if (picked.length === 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onDelete();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const frames = event.shiftKey ? 10 : 1;
        onMove(picked, ((event.key === "ArrowRight" ? 1 : -1) * frames) / rate);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picked, onDelete, onMove, rate]);

  const marks = ruler(view.start, view.span);

  return (
    <div
      className="tl-grid"
      ref={host}
      data-testid="timeline-grid"
      onWheel={onWheel}
      style={{ ["--header" as string]: `${HEADER}px` }}
    >
      {/* THE RULER. Click anywhere on it to go there; drag to scrub. It is the
          one control that turns a list of keys into a timeline. */}
      <div
        className="tl-ruler"
        data-testid="timeline-ruler"
        onPointerDown={(event) => {
          scrubbing.current = true;
          scrub(event.clientX);
        }}
      >
        {marks.map((mark) => (
          <span key={mark} className="tl-tick" style={{ left: `${xOf(mark)}px` }}>
            {timecode(mark)}
          </span>
        ))}
      </div>

      <div className="tl-body">
        {timeline.tracks.map((track, index) => {
          const label = labelOf(index);
          return (
            <div className="tl-row" key={`${track.target}:${track.path}`} style={{ height: ROW }}>
              <div className="tl-head" title={`${label.layer} · ${label.property}`}>
                <span className="tl-layer">{label.layer}</span>
                <span className="tl-prop">{label.property}</span>
              </div>
              <div
                className="tl-lane"
                data-testid="lane"
                data-track={index}
                /* Empty lane space SCRUBS, and clears the selection. The
                   ruler is not the only place you want to move the playhead
                   from — your pointer is already down here, over the track you
                   are working on, and reaching up to a 24px strip to move time
                   is the sort of small tax that adds up over a day. */
                onPointerDown={(event) => {
                  onPick([]);
                  scrubbing.current = true;
                  scrub(event.clientX);
                }}
              >
                {/* The span a track occupies, so an empty stretch reads as
                    empty rather than as a row that failed to load. */}
                {track.keyframes.length > 1 ? (
                  <span
                    className="tl-span"
                    style={{
                      left: `${xOf(track.keyframes[0]!.time)}px`,
                      width: `${Math.max(
                        1,
                        xOf(track.keyframes.at(-1)!.time) - xOf(track.keyframes[0]!.time),
                      )}px`,
                    }}
                  />
                ) : null}
                {track.keyframes.map((keyframe, at) => {
                  const on = picked.some((k) => k.track === index && k.index === at);
                  return (
                    <button
                      type="button"
                      key={at}
                      className={`tl-key ${on ? "on" : ""}`}
                      /* The generic id is what everything already looks for —
                         "two keyframes exist" is the common question. The
                         coordinates are attributes beside it, for the rarer
                         question of which one. */
                      data-testid="keyframe"
                      data-track={index}
                      data-index={at}
                      style={{ left: `${xOf(keyframe.time)}px` }}
                      title={`${timecode(keyframe.time)} · ${label.property}`}
                      onPointerDown={(event) => beginDrag(event, { track: index, index: at })}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drawn over everything, and never in the way: it is one pixel wide and
          it is the thing you are always looking for. */}
      <div className="tl-playhead" data-testid="timeline-playhead" aria-hidden />
    </div>
  );
}

/**
 * Where the ruler puts its marks.
 *
 * The interval is chosen so labels never collide: as the view zooms in, the
 * step falls through a 1-2-5 sequence. A fixed step either crowds into an
 * unreadable smear when zoomed out or leaves a bare ruler when zoomed in, and
 * a ruler you cannot read is decoration.
 */
function ruler(start: number, span: number): readonly number[] {
  const target = span / 8;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1e-3, target))));
  const step = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= target) ?? magnitude * 10;

  const out: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) {
    out.push(Math.round(t * 1000) / 1000);
  }
  return out;
}

/** Seconds as a broadcaster reads them. */
function timecode(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  }
  return `${seconds.toFixed(seconds < 1 ? 2 : 1)}s`;
}
