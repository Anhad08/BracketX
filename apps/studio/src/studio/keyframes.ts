/**
 * Timeline and keyframe authoring.
 *
 * ============================================================================
 * THE ENGINE NEEDED NO NEW OPERATION FOR THIS
 * ============================================================================
 * `doc.setMeta` has always addressed the whole document by path, so
 * `animations.0` is a legal target and a timeline edit is an ordinary undoable
 * operation. Studio adds no second mutation mechanism, no timeline-specific
 * command, and no editor-side model that has to be reconciled with the
 * document's. Every function here returns a `Transaction` and applies nothing.
 *
 * ============================================================================
 * ONE OPERATION REPLACES THE WHOLE TIMELINE. DELIBERATELY
 * ============================================================================
 * A five-keyframe drag could be five `animations.0.tracks.2.keyframes.N.time`
 * sets. It must not be, and the reason is not tidiness:
 *
 *   1. Keyframes are addressed by INDEX and every mutation re-sorts. The second
 *      operation in such a transaction would address a keyframe the first one
 *      moved. The bug is silent and depends on drag direction.
 *   2. The inverse of a whole-timeline set is exact and needs no reasoning.
 *
 * The cost is that an undo record holds two copies of one timeline. A timeline
 * is tens of tracks of tens of keyframes; the copy is kilobytes and the
 * correctness is unconditional.
 *
 * ============================================================================
 * KEYFRAMES MUST LEAVE HERE SORTED
 * ============================================================================
 * The engine sorts keyframes ONCE, at load (`normalizeTimeline`), and never
 * again — that was a deliberate performance change (`d473e6e`), and sampling
 * relies on it. So an editor that leaves a track out of order produces a scene
 * that animates wrongly in the session and correctly after a save and reload,
 * which is the worst possible way to find out. Every mutation here re-sorts, and
 * the verification suite asserts it after a drag that crosses a neighbour.
 */
import {
  makeSetDocProp,
  type Keyframe,
  type Easing,
  type SceneDocument,
  type Timeline,
  type TimelineMarker,
  type TimelineStagger,
  type TimelineTrack,
  type Transaction,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";
import type { IdFactory } from "./ids";

/** A keyframe's address within a timeline, for the duration of one edit. */
export interface KeyframeRef {
  readonly track: number;
  readonly index: number;
}

export function timelinesOf(document: SceneDocument): readonly Timeline[] {
  return document.animations ?? [];
}

export function timelineIndexOf(document: SceneDocument, timelineId: string): number {
  return timelinesOf(document).findIndex((timeline) => timeline.id === timelineId);
}

export function timelineById(
  document: SceneDocument,
  timelineId: string,
): Timeline | undefined {
  return timelinesOf(document).find((timeline) => timeline.id === timelineId);
}

export function trackIndexOf(timeline: Timeline, target: string, path: string): number {
  return timeline.tracks.findIndex(
    (track) => track.target === target && track.path === path,
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Snaps a time to the frame grid.
 *
 * A designer drags on a pixel grid, and a pixel is not a frame. Without this a
 * keyframe lands at 0.416673 s, the value at frame 25 is a fraction of the way
 * into the segment, and nobody can key the same thing twice. Frames are also
 * what the transport addresses, so a keyframe between two frames is a keyframe
 * the playhead can never sit exactly on.
 */
export function quantize(seconds: number, rate: number): number {
  if (!Number.isFinite(seconds) || rate <= 0) return 0;
  return Math.max(0, Math.round(seconds * rate) / rate);
}

/** Frame rate of a document, for quantisation. The output's, not a constant. */
export function rateOf(document: SceneDocument): number {
  const rate = document.world.output.fps;
  return Number.isFinite(rate) && rate > 0 ? rate : 60;
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/** Keyframes ascending by time, with duplicate times collapsed to the last write. */
function normalize(keyframes: readonly Keyframe[]): readonly Keyframe[] {
  const byTime = new Map<number, Keyframe>();
  // Two keyframes at one time makes the value at that time depend on iteration
  // order. Later wins, which is what a drag onto an existing key means.
  for (const keyframe of keyframes) byTime.set(keyframe.time, keyframe);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** The last time anything in the timeline happens, ignoring stagger. */
function contentEnd(timeline: Timeline): number {
  let end = 0;
  for (const track of timeline.tracks) {
    const last = track.keyframes[track.keyframes.length - 1]?.time ?? 0;
    const total = (track.delay ?? 0) + last;
    if (total > end) end = total;
  }
  for (const marker of timeline.markers ?? []) {
    if (marker.time > end) end = marker.time;
  }
  return end;
}

/**
 * Replaces a timeline, growing its duration to contain its content.
 *
 * Grows, never shrinks. Dragging a keyframe past the end must not have the
 * timeline clamp it away — the keyframe would still be in the document and
 * would never be reached, which looks like the drag was ignored. Shrinking is
 * not automatic because trailing empty time is something an author chooses:
 * a graphic that holds for two seconds after its last move is a hold, not slack.
 */
function replace(
  document: SceneDocument,
  timelineId: string,
  label: string,
  rewrite: (timeline: Timeline) => Timeline | null,
): Transaction | null {
  const index = timelineIndexOf(document, timelineId);
  if (index < 0) return null;
  const current = timelinesOf(document)[index]!;

  const next = rewrite(current);
  if (next === null) return null;

  const end = contentEnd(next);
  const grown: Timeline =
    end > next.duration ? { ...next, duration: round(end) } : next;

  return transaction(label, [
    makeSetDocProp(document, `animations.${index}`, grown),
  ]);
}

function withTracks(timeline: Timeline, tracks: readonly TimelineTrack[]): Timeline {
  return { ...timeline, tracks };
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

export interface CreateTimelineOptions {
  readonly duration?: number;
  readonly loop?: boolean;
}

export function createTimeline(
  document: SceneDocument,
  name: string,
  ids: IdFactory,
  options: CreateTimelineOptions = {},
): { transaction: Transaction; timelineId: string } {
  const timeline: Timeline = {
    id: ids("timeline"),
    name,
    duration: options.duration ?? 1,
    tracks: [],
    ...(options.loop === true ? { loop: true } : {}),
  };
  return {
    timelineId: timeline.id,
    transaction: transaction(`Add timeline ${name}`, [
      makeSetDocProp(document, "animations", [...timelinesOf(document), timeline]),
    ]),
  };
}

export function removeTimeline(
  document: SceneDocument,
  timelineId: string,
): Transaction | null {
  const existing = timelinesOf(document);
  const index = timelineIndexOf(document, timelineId);
  if (index < 0) return null;
  const remaining = existing.filter((_, at) => at !== index);
  // The whole array, not `animations.N`, because removing an element shifts
  // every index after it and a path-set cannot express that.
  return transaction(`Remove ${existing[index]!.name}`, [
    makeSetDocProp(document, "animations", remaining),
  ]);
}

export function renameTimeline(
  document: SceneDocument,
  timelineId: string,
  name: string,
): Transaction | null {
  return replace(document, timelineId, "Rename timeline", (timeline) =>
    timeline.name === name ? null : { ...timeline, name },
  );
}

export function setTimelineDuration(
  document: SceneDocument,
  timelineId: string,
  duration: number,
): Transaction | null {
  const value = Math.max(0, round(duration));
  return replace(document, timelineId, "Set duration", (timeline) =>
    timeline.duration === value ? null : { ...timeline, duration: value },
  );
}

export function setTimelineLoop(
  document: SceneDocument,
  timelineId: string,
  loop: boolean,
): Transaction | null {
  return replace(document, timelineId, loop ? "Loop" : "Stop looping", (timeline) => {
    if ((timeline.loop ?? false) === loop) return null;
    if (!loop) {
      // Omit rather than write `false`: canonical form drops a default, and a
      // document carrying an explicit default fails to round-trip byte for byte.
      const { loop: _dropped, ...rest } = timeline;
      return rest as Timeline;
    }
    return { ...timeline, loop: true };
  });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function removeTrack(
  document: SceneDocument,
  timelineId: string,
  track: number,
): Transaction | null {
  return replace(document, timelineId, "Remove track", (timeline) =>
    timeline.tracks[track] === undefined
      ? null
      : withTracks(
          timeline,
          timeline.tracks.filter((_, index) => index !== track),
        ),
  );
}

export function setTrackDelay(
  document: SceneDocument,
  timelineId: string,
  track: number,
  delay: number,
): Transaction | null {
  const value = Math.max(0, round(delay));
  return replace(document, timelineId, "Set delay", (timeline) => {
    const current = timeline.tracks[track];
    if (current === undefined || (current.delay ?? 0) === value) return null;
    const { delay: _dropped, ...rest } = current;
    const next = value === 0 ? (rest as TimelineTrack) : { ...rest, delay: value };
    return withTracks(
      timeline,
      timeline.tracks.map((entry, index) => (index === track ? next : entry)),
    );
  });
}

export function setTrackStagger(
  document: SceneDocument,
  timelineId: string,
  track: number,
  stagger: TimelineStagger | null,
): Transaction | null {
  return replace(document, timelineId, "Set stagger", (timeline) => {
    const current = timeline.tracks[track];
    if (current === undefined) return null;
    const { stagger: _dropped, ...rest } = current;
    const next =
      stagger === null ? (rest as TimelineTrack) : { ...rest, stagger };
    return withTracks(
      timeline,
      timeline.tracks.map((entry, index) => (index === track ? next : entry)),
    );
  });
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/**
 * Inserts or replaces a keyframe, creating the track if there is none.
 *
 * This is the whole recording gesture: a designer moves the playhead, changes a
 * property, and a keyframe exists. Insert-or-replace-by-time rather than
 * always-insert, because keying the same property twice at one time is the
 * gesture "no, like THIS" and must not leave the earlier value behind.
 *
 * The track's target and path are what the runtime samples; nothing here knows
 * what kind of node it is addressing, which is exactly what lets a future text
 * node be keyframed by this code unchanged.
 */
export function setKeyframe(
  document: SceneDocument,
  timelineId: string,
  target: string,
  path: string,
  time: number,
  value: unknown,
  easing?: Easing,
): Transaction | null {
  const at = quantize(time, rateOf(document));
  const keyframe: Keyframe = {
    time: at,
    value,
    ...(easing === undefined ? {} : { easing }),
  };

  return replace(document, timelineId, "Set keyframe", (timeline) => {
    const index = trackIndexOf(timeline, target, path);
    if (index < 0) {
      return withTracks(timeline, [
        ...timeline.tracks,
        { target, path, keyframes: [keyframe] },
      ]);
    }
    const track = timeline.tracks[index]!;
    const existing = track.keyframes.find((entry) => entry.time === at);
    if (
      existing !== undefined &&
      Object.is(existing.value, value) &&
      existing.easing === keyframe.easing
    ) {
      // Nothing changed. Property panels fire on every keystroke; without this
      // the undo stack fills with keyframes identical to their predecessors.
      return null;
    }
    return withTracks(
      timeline,
      timeline.tracks.map((entry, at2) =>
        at2 === index
          ? { ...entry, keyframes: normalize([...entry.keyframes, keyframe]) }
          : entry,
      ),
    );
  });
}

/** Groups refs by track, descending by index, so splices do not shift. */
function byTrack(refs: readonly KeyframeRef[]): Map<number, number[]> {
  const grouped = new Map<number, number[]>();
  for (const ref of refs) {
    const list = grouped.get(ref.track);
    if (list === undefined) grouped.set(ref.track, [ref.index]);
    else list.push(ref.index);
  }
  for (const list of grouped.values()) list.sort((a, b) => b - a);
  return grouped;
}

/**
 * Deletes keyframes, and any track they empty.
 *
 * A track with no keyframes is invalid (`validateTimeline` says so) and drives
 * nothing, so leaving one behind would put a document on disk the engine
 * refuses to load. Deleting the last keyframe of a track deletes the track.
 */
export function deleteKeyframes(
  document: SceneDocument,
  timelineId: string,
  refs: readonly KeyframeRef[],
): Transaction | null {
  if (refs.length === 0) return null;
  const grouped = byTrack(refs);

  return replace(
    document,
    timelineId,
    refs.length === 1 ? "Delete keyframe" : `Delete ${refs.length} keyframes`,
    (timeline) => {
      let changed = false;
      const tracks: TimelineTrack[] = [];
      timeline.tracks.forEach((track, index) => {
        const remove = grouped.get(index);
        if (remove === undefined) {
          tracks.push(track);
          return;
        }
        const keep = track.keyframes.filter((_, at) => !remove.includes(at));
        if (keep.length !== track.keyframes.length) changed = true;
        if (keep.length > 0) tracks.push({ ...track, keyframes: keep });
      });
      return changed ? withTracks(timeline, tracks) : null;
    },
  );
}

/**
 * Shifts keyframes in time. The drag gesture.
 *
 * Every selected keyframe moves by the same delta, which is what makes dragging
 * a group preserve its internal spacing — the thing a designer is actually
 * protecting when they select several at once. Times clamp at zero rather than
 * going negative, and the group's leading edge is what clamps, so the spacing
 * survives being dragged into the start of the timeline.
 */
export function moveKeyframes(
  document: SceneDocument,
  timelineId: string,
  refs: readonly KeyframeRef[],
  deltaSeconds: number,
): Transaction | null {
  if (refs.length === 0) return null;
  const rate = rateOf(document);
  const grouped = byTrack(refs);

  return replace(document, timelineId, "Move keyframes", (timeline) => {
    let earliest = Infinity;
    for (const [track, indices] of grouped) {
      const keyframes = timeline.tracks[track]?.keyframes;
      if (keyframes === undefined) continue;
      for (const index of indices) {
        const time = keyframes[index]?.time;
        if (time !== undefined && time < earliest) earliest = time;
      }
    }
    if (!Number.isFinite(earliest)) return null;

    // Clamp the whole move by its leading edge, not per keyframe. Clamping each
    // one independently would pile the group up on zero and destroy its timing.
    const delta = quantize(Math.max(deltaSeconds, -earliest), rate);
    if (delta === 0 && deltaSeconds >= 0) return null;

    let changed = false;
    const tracks = timeline.tracks.map((track, index) => {
      const indices = grouped.get(index);
      if (indices === undefined) return track;
      changed = true;
      const moved = track.keyframes.map((keyframe, at) =>
        indices.includes(at)
          ? { ...keyframe, time: quantize(keyframe.time + delta, rate) }
          : keyframe,
      );
      return { ...track, keyframes: normalize(moved) };
    });
    return changed ? withTracks(timeline, tracks) : null;
  });
}

export function setKeyframeValue(
  document: SceneDocument,
  timelineId: string,
  ref: KeyframeRef,
  value: unknown,
): Transaction | null {
  return replace(document, timelineId, "Set keyframe value", (timeline) => {
    const keyframe = timeline.tracks[ref.track]?.keyframes[ref.index];
    if (keyframe === undefined || Object.is(keyframe.value, value)) return null;
    return withTracks(
      timeline,
      timeline.tracks.map((track, index) =>
        index !== ref.track
          ? track
          : {
              ...track,
              keyframes: track.keyframes.map((entry, at) =>
                at === ref.index ? { ...entry, value } : entry,
              ),
            },
      ),
    );
  });
}

/** Easing applies to the segment LEAVING each keyframe (SCENE_FORMAT §10.2). */
export function setEasing(
  document: SceneDocument,
  timelineId: string,
  refs: readonly KeyframeRef[],
  easing: Easing | null,
): Transaction | null {
  if (refs.length === 0) return null;
  const grouped = byTrack(refs);

  return replace(document, timelineId, "Set easing", (timeline) => {
    let changed = false;
    const tracks = timeline.tracks.map((track, index) => {
      const indices = grouped.get(index);
      if (indices === undefined) return track;
      const keyframes = track.keyframes.map((keyframe, at) => {
        if (!indices.includes(at)) return keyframe;
        if (easing === null) {
          if (keyframe.easing === undefined) return keyframe;
          changed = true;
          const { easing: _dropped, ...rest } = keyframe;
          return rest as Keyframe;
        }
        if (keyframe.easing === easing) return keyframe;
        changed = true;
        return { ...keyframe, easing };
      });
      return { ...track, keyframes };
    });
    return changed ? withTracks(timeline, tracks) : null;
  });
}

/**
 * Retimes a whole timeline by a factor. "Make this twice as fast."
 *
 * Scales keyframe times, track delays, marker positions AND the duration
 * together, because scaling any subset changes the shape of the animation
 * rather than its speed. A stagger's interval is scaled too — a reveal that kept
 * its interval while its keyframes halved would stop reading as one gesture.
 */
export function scaleTiming(
  document: SceneDocument,
  timelineId: string,
  factor: number,
): Transaction | null {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return null;
  const rate = rateOf(document);
  const at = (time: number): number => quantize(time * factor, rate);

  return replace(document, timelineId, "Retime", (timeline) => {
    const tracks = timeline.tracks.map((track) => {
      const stagger = track.stagger;
      return {
        ...track,
        ...(track.delay === undefined ? {} : { delay: at(track.delay) }),
        ...(stagger === undefined
          ? {}
          : {
              stagger: {
                ...stagger,
                ...(stagger.interval === undefined
                  ? {}
                  : { interval: round(stagger.interval * factor) }),
                ...(stagger.total === undefined
                  ? {}
                  : { total: round(stagger.total * factor) }),
              },
            }),
        keyframes: normalize(
          track.keyframes.map((keyframe) => ({ ...keyframe, time: at(keyframe.time) })),
        ),
      };
    });
    const markers = timeline.markers?.map((marker) => ({
      ...marker,
      time: at(marker.time),
    }));
    return {
      ...timeline,
      duration: round(timeline.duration * factor),
      tracks,
      ...(markers === undefined ? {} : { markers }),
    };
  });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export interface KeyframeClipboard {
  /** Times are relative to the earliest copied keyframe, so paste is positional. */
  readonly tracks: readonly {
    readonly target: string;
    readonly path: string;
    readonly keyframes: readonly Keyframe[];
  }[];
}

/**
 * Copies keyframes, rebased to their own start.
 *
 * Relative times are what make paste mean "here", which is the only thing a
 * paste can usefully mean on a timeline. Absolute times would make pasting a
 * no-op whenever the playhead had not moved, and a designer copying a bar's
 * animation onto the next bar would see nothing happen.
 */
export function copyKeyframes(
  timeline: Timeline,
  refs: readonly KeyframeRef[],
): KeyframeClipboard | null {
  const grouped = byTrack(refs);
  let earliest = Infinity;
  for (const [track, indices] of grouped) {
    for (const index of indices) {
      const time = timeline.tracks[track]?.keyframes[index]?.time;
      if (time !== undefined && time < earliest) earliest = time;
    }
  }
  if (!Number.isFinite(earliest)) return null;

  const tracks: KeyframeClipboard["tracks"] = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([index, indices]) => {
      const track = timeline.tracks[index];
      if (track === undefined) return [];
      const keyframes = [...indices]
        .sort((a, b) => a - b)
        .flatMap((at) => {
          const keyframe = track.keyframes[at];
          return keyframe === undefined
            ? []
            : [{ ...keyframe, time: round(keyframe.time - earliest) }];
        });
      return keyframes.length === 0
        ? []
        : [{ target: track.target, path: track.path, keyframes }];
    });

  return tracks.length === 0 ? null : { tracks };
}

/**
 * Pastes a clipboard at a time, optionally onto different nodes.
 *
 * `targets` is what makes "animate one row, apply to all eight" a two-gesture
 * operation instead of eight. The paths are unchanged — a path is a property,
 * and pasting a position track onto a node that has no position is not a case
 * that can arise, because every node has a transform.
 */
export function pasteKeyframes(
  document: SceneDocument,
  timelineId: string,
  clipboard: KeyframeClipboard,
  atSeconds: number,
  targets?: readonly string[],
): Transaction | null {
  const rate = rateOf(document);
  const base = quantize(atSeconds, rate);
  const retarget = targets === undefined || targets.length === 0 ? null : targets;

  return replace(document, timelineId, "Paste keyframes", (timeline) => {
    const tracks = [...timeline.tracks];
    let changed = false;

    for (const source of clipboard.tracks) {
      for (const target of retarget ?? [source.target]) {
        const shifted = source.keyframes.map((keyframe) => ({
          ...keyframe,
          time: quantize(keyframe.time + base, rate),
        }));
        const index = tracks.findIndex(
          (track) => track.target === target && track.path === source.path,
        );
        changed = true;
        if (index < 0) {
          tracks.push({ target, path: source.path, keyframes: normalize(shifted) });
        } else {
          const existing = tracks[index]!;
          tracks[index] = {
            ...existing,
            // Pasted keyframes WIN a time collision. `normalize` keeps the last
            // write, and a paste is the more recent intent.
            keyframes: normalize([...existing.keyframes, ...shifted]),
          };
        }
      }
    }
    return changed ? withTracks(timeline, tracks) : null;
  });
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export function setMarker(
  document: SceneDocument,
  timelineId: string,
  marker: TimelineMarker,
): Transaction | null {
  const at = quantize(marker.time, rateOf(document));
  return replace(document, timelineId, `Set marker ${marker.id}`, (timeline) => {
    const markers = [...(timeline.markers ?? [])];
    const index = markers.findIndex((entry) => entry.id === marker.id);
    const next = { ...marker, time: at };
    // Ids are addresses; two markers with one id makes "seek to `midpoint`"
    // ambiguous, so setting an existing id replaces rather than appends.
    if (index < 0) markers.push(next);
    else markers[index] = next;
    markers.sort((a, b) => a.time - b.time);
    return { ...timeline, markers };
  });
}

export function removeMarker(
  document: SceneDocument,
  timelineId: string,
  markerId: string,
): Transaction | null {
  return replace(document, timelineId, "Remove marker", (timeline) => {
    const markers = (timeline.markers ?? []).filter((entry) => entry.id !== markerId);
    if (markers.length === (timeline.markers ?? []).length) return null;
    if (markers.length === 0) {
      const { markers: _dropped, ...rest } = timeline;
      return rest as Timeline;
    }
    return { ...timeline, markers };
  });
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
