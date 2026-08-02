import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findNode, type Timeline, type Transaction } from "@bracketx/engine-scene";

import type { StudioSession } from "../studio/session";
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
  removeTrack,
  renameTimeline,
  scaleTiming,
  setEasing,
  setKeyframe,
  setKeyframeValue,
  setTimelineDuration,
  setTimelineLoop,
  setTrackDelay,
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

/** Paths a designer can key from the panel without touching the inspector. */
const KEYABLE = [
  "transform.position.0",
  "transform.position.1",
  "transform.position.2",
  "transform.rotation.2",
  "transform.scale.0",
  "transform.scale.1",
  "visible",
] as const;

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
  const drag = useRef<{ startX: number; width: number; span: number } | null>(null);

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

  const isPicked = useCallback(
    (track: number, index: number) =>
      picked.some((ref) => ref.track === track && ref.index === index),
    [picked],
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
          This scene declares no timelines. A timeline is document data —{" "}
          <span className="mono">animations</span> in SCENE_FORMAT — so adding one
          is an edit like any other, and undoing it removes it.
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
          title={nodeId === null ? "Select a node first" : "Key this property at the playhead"}
        >
          <option value="">key property…</option>
          {KEYABLE.map((path) => (
            <option key={path} value={path}>
              {path}
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
        ) : null}

        {active.tracks.map((track, trackIndex) => (
          <div className="track-row" key={`${track.target}:${track.path}`}>
            <div className="track-label">
              <span className="mono" title={track.target}>
                {track.path}
              </span>
              <span className="dim mono">
                {findNode(document_.root, track.target)?.name ?? track.target}
              </span>
              <input
                className="field number tiny"
                type="number"
                step={0.05}
                min={0}
                key={`${active.id}:${trackIndex}:${track.delay ?? 0}`}
                defaultValue={track.delay ?? 0}
                onBlur={(event) =>
                  onEdit(
                    setTrackDelay(document_, active.id, trackIndex, Number(event.target.value)),
                  )
                }
                aria-label={`Delay for ${track.path}`}
                title="Delay, in seconds"
              />
              {track.stagger !== undefined ? <span className="badge">stagger</span> : null}
              <button
                type="button"
                className="link danger"
                onClick={() => editAndKeep(removeTrack(document_, active.id, trackIndex))}
                aria-label={`Remove ${track.path}`}
              >
                ×
              </button>
            </div>

            <div
              className="lane"
              data-testid="lane"
              onPointerDown={(event) => {
                // A click on empty lane scrubs. Seeking, not playing — so it
                // crosses no markers and fires no cues.
                const box = event.currentTarget.getBoundingClientRect();
                session.seek(Math.round(timeAt(event.clientX, box) * rate));
                setPicked([]);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (current === null || event.buttons === 0) return;
                const delta = ((event.clientX - current.startX) / current.width) * current.span;
                if (Math.abs(delta) < 1 / rate) return;
                drag.current = { ...current, startX: event.clientX };
                onEdit(moveKeyframes(document_, active.id, picked, delta));
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
            >
              {track.keyframes.map((keyframe, keyframeIndex) => {
                const left = ((keyframe.time + (track.delay ?? 0)) / span) * 100;
                if (left > 100) return null;
                return (
                  <button
                    key={keyframeIndex}
                    type="button"
                    className={`keyframe ${isPicked(trackIndex, keyframeIndex) ? "picked" : ""}`}
                    style={{ left: `${left}%` }}
                    data-testid="keyframe"
                    title={`${keyframe.time.toFixed(3)}s · ${String(keyframe.value)}${
                      keyframe.easing === undefined ? "" : ` · ${String(keyframe.easing)}`
                    }`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const ref = { track: trackIndex, index: keyframeIndex };
                      const next =
                        event.shiftKey || event.metaKey || event.ctrlKey
                          ? isPicked(trackIndex, keyframeIndex)
                            ? picked.filter((p) => !(p.track === ref.track && p.index === ref.index))
                            : [...picked, ref]
                          : [ref];
                      setPicked(next);
                      const box = event.currentTarget.parentElement!.getBoundingClientRect();
                      drag.current = { startX: event.clientX, width: box.width, span };
                      (event.target as Element).setPointerCapture(event.pointerId);
                    }}
                    onDoubleClick={() => {
                      const raw = window.prompt("Value", String(keyframe.value));
                      if (raw === null) return;
                      const parsed = Number(raw);
                      onEdit(
                        setKeyframeValue(
                          document_,
                          active.id,
                          { track: trackIndex, index: keyframeIndex },
                          Number.isFinite(parsed) && raw.trim() !== "" ? parsed : raw,
                        ),
                      );
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}

        <div className="lane ruler-lane" aria-hidden>
          {(active.markers ?? []).map((marker) =>
            marker.time / span > 1 ? null : (
              <span
                key={marker.id}
                className={`marker ${marker.kind}`}
                style={{ left: `${(marker.time / span) * 100}%` }}
                title={`${marker.id} · ${marker.kind} @ ${marker.time}s`}
                data-testid="timeline-marker"
              />
            ),
          )}
          {/* Always drawn. Hiding it until a clip is cued would leave a
              designer keying against a playhead they cannot see. */}
          <div
            className="playhead"
            style={{ left: `${Math.min(100, (playSeconds / span) * 100)}%` }}
            data-testid="playhead"
          />
          {ticks(span, rate).map((tick) => (
            <span key={tick} className="tick" style={{ left: `${(tick / span) * 100}%` }}>
              {tick.toFixed(1)}
            </span>
          ))}
        </div>
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
function ticks(span: number, rate: number): readonly number[] {
  const rough = span / 6;
  const step = Math.max(1, Math.round(rough * rate)) / rate;
  const out: number[] = [];
  for (let time = 0; time <= span + 1e-9; time += step) out.push(time);
  return out;
}

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
