import { useCallback, useEffect, useMemo, useState } from "react";
import { findNode, type Timeline, type Transaction } from "@bracketx/engine-scene";

import type { StudioSession } from "../studio/session";
import { TimelineGrid } from "./timeline-grid";
import type { Selection } from "../studio/selection";
import { primaryOf } from "../studio/selection";
import type { IdFactory } from "../studio/ids";
import {
  copyKeyframes,
  createTimeline,
  deleteKeyframes,
  moveKeyframes,
  pasteKeyframes,
  rateOf,
  removeTimeline,
  renameTimeline,
  scaleTiming,
  setEasing,
  setKeyframe,
  setTimelineDuration,
  setTimelineLoop,
  timelineById,
  timelinesOf,
  type KeyframeClipboard,
  type KeyframeRef,
} from "../studio/keyframes";

/**
 * The timeline editor.
 *
 * ============================================================================
 * IT OWNS NO CLOCK AND NO MODEL
 * ============================================================================
 * The playhead is `Animator.clipState(...).seconds`. Scrubbing is
 * `playback.seek`. Every edit is a function in `keyframes.ts` returning a
 * `Transaction`, so dragging a keyframe is undoable and saved exactly like
 * renaming a node. This component holds three things and only three: which
 * keyframes are selected, what is on the clipboard, and what is being dragged.
 *
 * ============================================================================
 * NOTHING HERE KNOWS WHAT A NODE IS
 * ============================================================================
 * A track is a target id and a dot path. That is the whole vocabulary, and it is
 * why a future text node will be keyframable by this panel with no change: the
 * editor never asks what kind of thing it is animating.
 */

const EASINGS = [
  "linear",
  "step",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
] as const;

/**
 * Paths a designer can key, and what to CALL them.
 *
 * `transform.position.0` is the engine's name for it. A designer animating a
 * lower third is moving it left and right, and reading a dot-path off a track
 * row is work the product exists to remove. The path stays as the key — it is
 * what the operation addresses — and never as the label.
 */
const KEYABLE = [
  { path: "transform.position.0", label: "Left and right" },
  { path: "transform.position.1", label: "Up and down" },
  { path: "transform.position.2", label: "Towards and away" },
  { path: "transform.rotation.2", label: "Rotation" },
  { path: "transform.scale.0", label: "Width" },
  { path: "transform.scale.1", label: "Height" },
  { path: "visible", label: "Visible" },
] as const;

/** The designer's name for a path, or the path when nothing is known. */
export function propertyLabel(path: string): string {
  return KEYABLE.find((entry) => entry.path === path)?.label ?? path;
}

export interface TimelineEditorProps {
  readonly session: StudioSession;
  readonly revision: number;
  readonly selection: Selection;
  readonly ids: IdFactory;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly onEdit: (transaction: Transaction | null) => void;
}

export function TimelineEditor({
  session,
  revision,
  selection,
  ids,
  zoom,
  onZoom,
  onEdit,
}: TimelineEditorProps) {
  const document_ = session.document;
  const timelines = timelinesOf(document_);
  const rate = rateOf(document_);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly KeyframeRef[]>([]);
  const [clipboard, setClipboard] = useState<KeyframeClipboard | null>(null);

  const active =
    (activeId === null ? undefined : timelineById(document_, activeId)) ?? timelines[0];

  // A timeline that was removed must not leave the panel pointing at nothing —
  // the same rule the shell applies to selection after a delete.
  useEffect(() => {
    if (activeId !== null && timelineById(document_, activeId) === undefined) {
      setActiveId(null);
      setPicked([]);
    }
  }, [document_, activeId, revision]);

  const states = useMemo(
    () => new Map(session.host.animator.clipStates().map((state) => [state.clipId, state])),
    [session, revision, session.frame],
  );


  const editAndKeep = useCallback(
    (candidate: Transaction | null) => {
      onEdit(candidate);
      // The selection is by INDEX and every edit re-sorts, so a drag that
      // crossed a neighbour would leave the wrong keyframes highlighted.
      // Clearing is honest; guessing which index a keyframe moved to is not.
      setPicked([]);
    },
    [onEdit],
  );

  if (timelines.length === 0 || active === undefined) {
    return (
      <section className="panel timeline" aria-label="Timeline">
        <div className="panel-head">
          <h2>Timeline</h2>
          <button
            type="button"
            className="chip"
            onClick={() => {
              const created = createTimeline(document_, "Timeline", ids);
              onEdit(created.transaction);
              setActiveId(created.timelineId);
            }}
          >
            New timeline
          </button>
        </div>
        <p className="note pad">
          This graphic has no animation yet. Adding one is an edit like any
          other, so it saves with the graphic and undo removes it.
        </p>
      </section>
    );
  }

  const span = Math.max(active.duration, 0.001) / zoom;
  const state = states.get(active.id);
  const nodeId = primaryOf(selection);

  /**
   * Where the editor is looking, in seconds.
   *
   * A cued clip reports its own position, which accounts for the frame it was
   * anchored at. With NO clip cued there is no cursor at all, and reading
   * `state?.seconds ?? 0` — which this did — meant every recorded keyframe
   * landed at time zero however far the playhead had been scrubbed. The whole
   * recording gesture silently produced one keyframe.
   *
   * The fallback is the engine's own frame divided by the rate, because
   * scrubbing seeks the engine to exactly `seconds × rate`. So both branches
   * derive from the one clock and Studio still owns none.
   */
  const playSeconds = state?.seconds ?? session.frame / rate;

  const timeAt = (clientX: number, box: DOMRect): number =>
    Math.max(0, ((clientX - box.left) / box.width) * span);

  return (
    <section className="panel timeline" aria-label="Timeline" data-testid="timeline">
      <div className="panel-head timeline-head">
        <select
          className="field"
          value={active.id}
          onChange={(event) => {
            setActiveId(event.target.value);
            setPicked([]);
          }}
          aria-label="Timeline"
        >
          {timelines.map((timeline) => (
            <option key={timeline.id} value={timeline.id}>
              {timeline.name}
            </option>
          ))}
        </select>

        <input
          className="field"
          key={`${active.id}:${active.name}`}
          defaultValue={active.name}
          onBlur={(event) => onEdit(renameTimeline(document_, active.id, event.target.value))}
          aria-label="Timeline name"
        />

        <label className="prop inline">
          <span>dur</span>
          <input
            className="field number"
            type="number"
            step={0.1}
            min={0}
            key={`${active.id}:${active.duration}`}
            defaultValue={active.duration}
            onBlur={(event) =>
              onEdit(setTimelineDuration(document_, active.id, Number(event.target.value)))
            }
            aria-label="Duration"
          />
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={active.loop === true}
            onChange={(event) =>
              onEdit(setTimelineLoop(document_, active.id, event.target.checked))
            }
          />
          loop
        </label>

        <span className="spacer" />

        <button type="button" className="chip" onClick={() => session.playClip(active.id)}>
          play
        </button>
        <button type="button" className="chip" onClick={() => session.stopClip(active.id)}>
          stop
        </button>

        {/* Retiming is a whole-timeline operation, so it belongs on the header
            rather than on a selection. "Twice as fast" is what a designer means
            and it has to scale delays and staggers too, or the shape changes. */}
        <button
          type="button"
          className="chip"
          onClick={() => onEdit(scaleTiming(document_, active.id, 0.5))}
          title="Halve every time in this timeline"
        >
          ×2 fast
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => onEdit(scaleTiming(document_, active.id, 2))}
          title="Double every time in this timeline"
        >
          ×2 slow
        </button>

        <label className="prop inline">
          <span>zoom</span>
          <input
            type="range"
            min={0.1}
            max={8}
            step={0.1}
            value={zoom}
            onChange={(event) => onZoom(Number(event.target.value))}
            aria-label="Timeline zoom"
          />
        </label>

        <button
          type="button"
          className="chip"
          onClick={() => {
            const created = createTimeline(document_, "Timeline", ids);
            onEdit(created.transaction);
            setActiveId(created.timelineId);
          }}
        >
          +
        </button>
        <button
          type="button"
          className="chip danger"
          onClick={() => onEdit(removeTimeline(document_, active.id))}
          aria-label="Remove timeline"
        >
          ×
        </button>
      </div>

      <div className="timeline-actions">
        <span className="dim">{picked.length} keyframes</span>
        <button
          type="button"
          className="link"
          disabled={picked.length === 0}
          onClick={() => setClipboard(copyKeyframes(active, picked))}
        >
          copy
        </button>
        <button
          type="button"
          className="link"
          disabled={clipboard === null}
          onClick={() =>
            editAndKeep(
              pasteKeyframes(
                document_,
                active.id,
                clipboard!,
                playSeconds,
                // Pasted onto the SELECTED nodes when there are any. This is
                // "animate one row, apply to the other seven" in two gestures.
                selection.ids.length > 0 ? selection.ids : undefined,
              ),
            )
          }
          title="Pastes at the playhead, onto the selected nodes"
        >
          paste
        </button>
        <button
          type="button"
          className="link danger"
          disabled={picked.length === 0}
          onClick={() => editAndKeep(deleteKeyframes(document_, active.id, picked))}
        >
          delete
        </button>

        <select
          className="field"
          value=""
          disabled={picked.length === 0}
          onChange={(event) =>
            editAndKeep(
              setEasing(
                document_,
                active.id,
                picked,
                event.target.value === "" ? null : (event.target.value as (typeof EASINGS)[number]),
              ),
            )
          }
          aria-label="Easing"
        >
          <option value="">easing…</option>
          {EASINGS.map((easing) => (
            <option key={easing} value={easing}>
              {easing}
            </option>
          ))}
        </select>

        <span className="spacer" />

        {/* Recording a keyframe: the playhead's time, the selected node, the
            chosen path, and the node's CURRENT authored value. Nothing here
            asks what kind of node it is. */}
        <select
          className="field"
          value=""
          disabled={nodeId === null}
          onChange={(event) => {
            if (nodeId === null || event.target.value === "") return;
            const path = event.target.value;
            const node = findNode(document_.root, nodeId);
            if (node === null) return;
            onEdit(
              setKeyframe(document_, active.id, nodeId, path, playSeconds, readPath(node, path)),
            );
            event.target.value = "";
          }}
          aria-label="Add keyframe"
          title={nodeId === null ? "Select a layer first" : "Animate this at the playhead"}
        >
          <option value="">Animate…</option>
          {KEYABLE.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tracks" data-testid="tracks">
      {active.tracks.length === 0 ? (
        <p className="note pad">
          No tracks. Select a node and key a property — the track is created by
          the first keyframe, and removed by the last one deleted.
        </p>
      ) : (
        /* THE TIMELINE ITSELF.
           A ruler you can scrub, a playhead you can drag, tracks named by the
           layer they belong to, and keyframes you move with the pointer or the
           arrow keys. What stood here was a keyframe table: no ruler, so you
           could not tell when anything happened; no playhead, so you could not
           go to a moment and look at it.

           The loop everyone who edits motion actually works in is
           scrub-look-adjust, and all three of those were missing. */
        <TimelineGrid
          timeline={active}
          rate={rate}
          time={playSeconds}
          onScrub={(seconds) => session.seek(Math.round(seconds * rate))}
          labelOf={(index) => {
            const track = active.tracks[index];
            return {
              layer:
                track === undefined
                  ? ""
                  : (findNode(document_.root, track.target)?.name ?? track.target),
              property: track === undefined ? "" : propertyLabel(track.path),
            };
          }}
          picked={picked}
          onPick={setPicked}
          onMove={(refs, delta) => onEdit(moveKeyframes(document_, active.id, refs, delta))}
          onDelete={() => {
            onEdit(deleteKeyframes(document_, active.id, picked));
            setPicked([]);
          }}
        />
      )}
      </div>

      <p className="note">
        Every gesture here is a document operation, so it is undoable and saved.
        Times snap to the frame grid at {rate} fps — a keyframe between two frames
        is one the playhead can never sit on.
      </p>
    </section>
  );
}

/** Roughly six labelled divisions, on a round number of frames. */

function readPath(node: unknown, path: string): unknown {
  let current: unknown = node;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Exported so the shell can offer "add a timeline" without a second model. */
export function firstTimelineOf(
  session: StudioSession,
): Timeline | undefined {
  return timelinesOf(session.document)[0];
}
