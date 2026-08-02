/**
 * Workbench data model.
 *
 * Every tool's data is extracted here, as plain functions over a
 * `ShowcaseSession`. The React panels render these and compute nothing.
 *
 * The split matters for the same reason it did in Phase 1: a test that needs a
 * browser to check that the inspector shows the right parent is a test that
 * will be skipped. All of this is verified headlessly.
 *
 * ============================================================================
 * THE COST RULE THIS FILE OBEYS
 * ============================================================================
 * Functions here fall into two classes, and mixing them is what made V2 fail
 * its own scalability requirement:
 *
 *   SAMPLED — called on the 10Hz tick while a tool is open. Must be O(visible)
 *             or O(1). Never O(scene).
 *   INVOKED — called when a human does something: types a query, selects a
 *             node, opens a report. May be O(scene); a human typing tolerates
 *             a few milliseconds and cannot tell the difference.
 *
 * Every exported function below says which it is.
 */
import { timelineSpan, type AnimationClip, type Mat4 } from "@bracketx/engine-scene";
import type { ClipState, LiveCommandRecord, ProjectionReport } from "@bracketx/engine-host";

import type { ShowcaseSession } from "../engine/session";
import { sceneIndex, splitInstanceId, type SceneIndex } from "./scene-index";
import { rank, type Ranked } from "./search";

/** The index for the session's current document, or null before load. */
function indexOf(session: ShowcaseSession): SceneIndex | null {
  const document = session.host.document;
  return document === null ? null : sceneIndex(document);
}

// ---------------------------------------------------------------------------
// Scene Inspector — the tree
// ---------------------------------------------------------------------------

export interface InspectorRow {
  readonly id: string;
  readonly depth: number;
  readonly parentId: string | null;
  readonly childCount: number;
  readonly name: string;
  readonly componentTypes: readonly string[];
  /** True when the node was produced by a repeat rather than authored. */
  readonly instance: boolean;
  readonly visible: boolean;
  readonly effectiveVisible: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export interface TreeOptions {
  /** Node ids whose children are shown. Everything else stays collapsed. */
  readonly expanded: ReadonlySet<string>;
  /** Rows to emit before giving up. Guards a pathological expand-all. */
  readonly limit?: number;
  /** Extra ids to force-expand — the path to a selected or searched node. */
  readonly reveal?: ReadonlySet<string>;
}

export interface TreeResult {
  readonly rows: readonly InspectorRow[];
  /** True when `limit` cut the walk short. The UI must say so. */
  readonly truncated: boolean;
}

/**
 * SAMPLED. The visible rows of the mirror hierarchy.
 *
 * ========================================================================
 * WHY THIS IS LAZY AND V2's WAS NOT
 * ========================================================================
 * V2 flattened the ENTIRE mirror on every sample and then hid rows in the
 * component. On the thirty-five-node showcase scenes that was invisible. The
 * workbench is required to stay usable at hundreds of thousands of nodes, where
 * it is a full traversal plus a full array allocation ten times a second — the
 * tool becoming the load.
 *
 * This descends only into expanded nodes, so cost is proportional to what is on
 * screen. A collapsed hundred-thousand-node collection costs one row.
 *
 * Read from the MIRROR, not the document, and that choice is the point: the
 * document says what was authored, the mirror says what exists. Collection
 * instances appear only in the mirror, and an inspector showing the document
 * would be missing exactly the nodes hardest to reason about.
 */
export function inspectorRows(
  session: ShowcaseSession,
  options: TreeOptions,
): TreeResult {
  const mirror = session.host.reconciler.mirror;
  const index = indexOf(session);
  if (index === null || mirror.rootId === null) return { rows: [], truncated: false };

  const limit = options.limit ?? 400;
  const rows: InspectorRow[] = [];

  // Explicit stack, in reverse order so siblings emerge in document order.
  const stack: { id: string; depth: number }[] = [{ id: mirror.rootId, depth: 0 }];
  let truncated = false;

  while (stack.length > 0) {
    if (rows.length >= limit) {
      truncated = true;
      break;
    }
    const { id, depth } = stack.pop()!;
    const node = mirror.get(id);
    if (node === undefined) continue;

    const source = index.sourceFor(id);
    const expanded = options.expanded.has(id) || options.reveal?.has(id) === true;

    rows.push({
      id,
      depth,
      parentId: node.parentId,
      childCount: node.childIds.length,
      name: source?.name ?? id,
      componentTypes: (source?.components ?? []).map((component) => component.type),
      instance: index.isInstance(id),
      visible: node.visible,
      effectiveVisible: node.effectiveVisible,
      expandable: node.childIds.length > 0,
      expanded,
    });

    if (!expanded) continue;
    for (let i = node.childIds.length - 1; i >= 0; i -= 1) {
      stack.push({ id: node.childIds[i]!, depth: depth + 1 });
    }
  }

  return { rows, truncated };
}

export interface NodeHit {
  readonly id: string;
  readonly name: string;
  readonly instance: boolean;
  /** Ancestor ids, root first. What the tree must expand to reveal it. */
  readonly path: readonly string[];
}

export interface SearchResult {
  readonly hits: readonly Ranked<NodeHit>[];
  /** Mirror nodes examined. Shown so a truncated search is never silent. */
  readonly scanned: number;
}

/**
 * INVOKED. Global search across the scene graph.
 *
 * One full pass over the mirror per query, which is exactly the cost class the
 * tree avoids — and correct here, because a human pressed a key. Debounced by
 * the caller. Results are ranked, not filtered: the twenty best of a hundred
 * thousand is a usable answer, and "1,412 matches" is not.
 */
export function searchNodes(
  session: ShowcaseSession,
  query: string,
  limit = 30,
): SearchResult {
  const mirror = session.host.reconciler.mirror;
  const index = indexOf(session);
  if (index === null || query.trim().length === 0) return { hits: [], scanned: 0 };

  let scanned = 0;
  const candidates: NodeHit[] = [];

  for (const id of mirror.nodeIds()) {
    scanned += 1;
    const source = index.sourceFor(id);
    candidates.push({
      id,
      name: source?.name ?? id,
      instance: index.isInstance(id),
      // Deferred: computing an ancestor chain for every node would make the
      // scan quadratic. Only the ranked survivors need one.
      path: [],
    });
  }

  const ranked = rank(
    candidates,
    query,
    (hit) => [hit.name, hit.id, ...componentTypesOf(index, hit.id)],
    limit,
  );

  return {
    scanned,
    hits: ranked.map((entry) => ({
      ...entry,
      item: { ...entry.item, path: mirror.ancestorsOf(entry.item.id) },
    })),
  };
}

function componentTypesOf(index: SceneIndex, id: string): readonly string[] {
  const source = index.sourceFor(id);
  return (source?.components ?? []).map((component) => component.type);
}

/** INVOKED. Ancestor ids of a node, root first. What the tree expands to reveal. */
export function pathTo(session: ShowcaseSession, nodeId: string): readonly string[] {
  return session.host.reconciler.mirror.ancestorsOf(nodeId);
}

// ---------------------------------------------------------------------------
// Scene Inspector — the detail
// ---------------------------------------------------------------------------

/**
 * Where a value a node reads actually comes from.
 *
 * This is the field that answers the question the inspector exists for. A panel
 * showing `fill: #1f6feb` tells you nothing you could not see; a panel showing
 * "`item.color`, from row `t8` of collection `entries`, last written by
 * collection.patch from `feed` at frame 4,102" ends the investigation.
 */
export interface VariableOrigin {
  readonly key: string;
  readonly value: unknown;
  readonly kind: "variable" | "scope" | "token" | "unresolved";
  /**
   * For `scope`: the repeat that introduced the name.
   *
   * DERIVED by the workbench, not read from the engine. The engine's scopes are
   * transient — one per instance per projection — and retaining them so a tool
   * could read them is memory the engine should not spend. The derivation is
   * the documented keyed-identity rule and nothing more, and it is asserted
   * against the rendered instance in the test suite.
   */
  readonly via?: {
    readonly containerId: string;
    readonly source: string;
    readonly identity: string;
  };
  /** The last accepted command that wrote this key, while the log still holds it. */
  readonly lastWrite?: {
    readonly sequence: number;
    readonly type: string;
    readonly source: string;
    readonly frame: number;
  };
}

export interface AnimationContributor {
  readonly clipId: string;
  readonly clipName: string;
  readonly path: string;
  readonly playing: boolean;
  readonly held: boolean;
  /** True when this path is currently overriding the node's authored value. */
  readonly driving: boolean;
}

export interface LayoutContributor {
  readonly containerId: string;
  readonly containerName: string;
  readonly mode: string;
  readonly gap: number | null;
}

export interface StateContributor {
  readonly state: string;
  readonly active: boolean;
}

export interface NodeDetail {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly componentTypes: readonly string[];
  readonly visible: boolean;
  readonly effectiveVisible: boolean;
  readonly localMatrix: Mat4;
  readonly worldMatrix: Mat4;
  /** Position extracted from the world matrix, for readability. */
  readonly worldPosition: readonly [number, number, number];
  readonly size: { width: number; height: number } | null;
  readonly layout: string | null;
  readonly anchor: string | null;

  /** Breadcrumbs, root first. */
  readonly ancestors: readonly { id: string; name: string }[];

  /** Set when this node is a repeat instance. */
  readonly instanceOf: { templateId: string; identity: string } | null;

  /** Every variable this node reads, and where each one came from. */
  readonly origins: readonly VariableOrigin[];
  readonly animation: readonly AnimationContributor[];
  readonly layoutFrom: LayoutContributor | null;
  readonly states: readonly StateContributor[];
  /** Outputs this node is the camera for. Empty for everything that is not one. */
  readonly outputs: readonly string[];
}

/**
 * INVOKED. Everything known about one node, and where each of it came from.
 *
 * O(depth + dependencies + clips), not O(scene): the document lookup goes
 * through the cached index rather than V2's recursive search, which was a full
 * traversal per selection.
 */
export function nodeDetail(
  session: ShowcaseSession,
  nodeId: string,
): NodeDetail | null {
  const mirror = session.host.reconciler.mirror.get(nodeId);
  if (mirror === undefined) return null;

  const index = indexOf(session);
  const source = index?.sourceFor(nodeId) ?? null;
  const { templateId, identity } = splitInstanceId(nodeId);
  const isInstance = index?.isInstance(nodeId) ?? false;

  // dependenciesOf is the engine's own reverse index — recomputing it here
  // would be a second answer to a question the engine already answers.
  const dependencies = [
    ...session.host.reconciler.projector.dependencies.dependenciesOf(nodeId),
  ].sort();

  const writers = variableWriters(session.host.log.entries());
  const origins = dependencies.map((key) =>
    resolveOrigin(session, index, key, nodeId, templateId, identity, writers),
  );

  const animatedPaths = session.host.animator.values.get(nodeId);
  const playing = new Set(session.host.animator.playing);
  const animation: AnimationContributor[] = [];
  for (const clip of session.host.animator.clips) {
    for (const track of clip.tracks) {
      if (track.target !== nodeId && track.target !== templateId) continue;
      animation.push({
        clipId: clip.id,
        clipName: clip.name,
        path: track.path,
        playing: playing.has(clip.id),
        held: session.host.animator.isHeld(clip.id),
        driving: animatedPaths?.has(track.path) === true,
      });
    }
  }

  const parentSource =
    index === null ? null : (index.ancestorsOf(templateId).at(-1) ?? null);
  const layoutFrom: LayoutContributor | null =
    parentSource?.layout === undefined || parentSource === null
      ? null
      : {
          containerId: isInstance ? `${parentSource.id}` : parentSource.id,
          containerName: parentSource.name,
          mode: parentSource.layout.mode,
          gap: parentSource.layout.gap ?? null,
        };

  const activeStates = new Set(session.host.activeStates);
  const states = Object.keys(source?.states ?? {}).map((state) => ({
    state,
    active: activeStates.has(state),
  }));

  const ancestorIds = session.host.reconciler.mirror.ancestorsOf(nodeId);

  return {
    id: nodeId,
    name: source?.name ?? nodeId,
    parentId: mirror.parentId,
    childIds: [...mirror.childIds],
    componentTypes: (source?.components ?? []).map((component) => component.type),
    visible: mirror.visible,
    effectiveVisible: mirror.effectiveVisible,
    localMatrix: mirror.localMatrix,
    worldMatrix: mirror.worldMatrix,
    worldPosition: [
      mirror.worldMatrix[12]!,
      mirror.worldMatrix[13]!,
      mirror.worldMatrix[14]!,
    ],
    size: source?.size ? { ...source.size } : null,
    layout: source?.layout
      ? `${source.layout.mode}${source.layout.gap ? ` gap ${source.layout.gap}` : ""}`
      : null,
    anchor: source?.anchor
      ? `${source.anchor.x ?? "—"} / ${source.anchor.y ?? "—"}`
      : null,

    ancestors: ancestorIds.map((id) => ({
      id,
      name: index?.sourceFor(id)?.name ?? id,
    })),
    instanceOf: isInstance && identity !== null ? { templateId, identity } : null,

    origins,
    animation,
    layoutFrom,
    states,
    outputs: session.host.outputs
      .filter((output) => output.cameraNodeId === nodeId)
      .map((output) => output.id),
  };
}

function resolveOrigin(
  session: ShowcaseSession,
  index: SceneIndex | null,
  key: string,
  _nodeId: string,
  templateId: string,
  identity: string | null,
  writers: ReadonlyMap<string, LiveCommandRecord>,
): VariableOrigin {
  const lastWriteRecord = writers.get(key);
  const lastWrite =
    lastWriteRecord === undefined
      ? undefined
      : {
          sequence: lastWriteRecord.sequence,
          type: lastWriteRecord.command.type,
          source: lastWriteRecord.source,
          frame: lastWriteRecord.frame,
        };

  const variables = session.host.runtime.state.variables;
  if (variables.has(key)) {
    return {
      key,
      value: variables.get(key),
      kind: "variable",
      ...(lastWrite === undefined ? {} : { lastWrite }),
    };
  }

  // Not a document variable. The only other name a binding can see is a repeat
  // scope, so find the container that introduced it and read the item back out
  // of the collection by the identity in this node's id.
  if (index !== null && identity !== null) {
    for (const ancestor of [...index.ancestorsOf(templateId)].reverse()) {
      if (ancestor.repeat?.as !== key) continue;
      const collection = variables.get(ancestor.repeat.source);
      const keyField = ancestor.repeat.key;
      const item = Array.isArray(collection)
        ? collection.find((entry, position) =>
            keyField === undefined
              ? String(position) === identity
              : String((entry as Record<string, unknown>)?.[keyField]) === identity,
          )
        : undefined;

      const writer = writers.get(ancestor.repeat.source);
      return {
        key,
        value: item,
        kind: "scope",
        via: {
          containerId: ancestor.id,
          source: ancestor.repeat.source,
          identity,
        },
        ...(writer === undefined
          ? {}
          : {
              lastWrite: {
                sequence: writer.sequence,
                type: writer.command.type,
                source: writer.source,
                frame: writer.frame,
              },
            }),
      };
    }
  }

  const token = session.host.document?.tokens?.find((entry) => entry.name === key);
  if (token !== undefined) {
    return { key, value: token.value, kind: "token" };
  }

  return { key, value: undefined, kind: "unresolved" };
}

// ---------------------------------------------------------------------------
// Command Console
// ---------------------------------------------------------------------------

export interface ConsoleFilter {
  readonly text: string;
  readonly acceptedOnly: boolean;
  readonly source: string | null;
  /** Only commands that projected something. */
  readonly changedOnly?: boolean;
}

/** The command target, for a log column. Derived, never guessed. */
export function commandTarget(record: LiveCommandRecord): string {
  const command = record.command as Record<string, unknown>;
  if (typeof command.key === "string") return command.key;
  if (typeof command.clipId === "string") return command.clipId;
  if (typeof command.id === "string") return command.id;
  if (typeof command.state === "string") return command.state;
  if (typeof command.sceneId === "string") return command.sceneId;
  if (Array.isArray(command.states)) return command.states.join(", ") || "—";
  if (typeof command.output === "object" && command.output !== null) {
    return String((command.output as { id?: unknown }).id ?? "—");
  }
  if (typeof command.frame === "number") return `f${command.frame}`;
  return "—";
}

/**
 * INVOKED. The last accepted command that wrote each variable key.
 *
 * One backward pass, so the first hit per key is the most recent. This is the
 * index behind "where did this value come from", and it is built from the log
 * rather than maintained incrementally because the log is already the truth and
 * a second copy would be a second thing that can be wrong.
 */
export function variableWriters(
  records: readonly LiveCommandRecord[],
): ReadonlyMap<string, LiveCommandRecord> {
  const out = new Map<string, LiveCommandRecord>();
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (!record.accepted) continue;
    const key = (record.command as Record<string, unknown>).key;
    if (typeof key !== "string" || out.has(key)) continue;
    out.set(key, record);
  }
  return out;
}

export function filterCommands(
  records: readonly LiveCommandRecord[],
  filter: ConsoleFilter,
  session?: ShowcaseSession,
): readonly LiveCommandRecord[] {
  const needle = filter.text.toLowerCase();
  return records.filter((record) => {
    if (filter.acceptedOnly && !record.accepted) return false;
    if (filter.source !== null && record.source !== filter.source) return false;
    if (
      filter.changedOnly === true &&
      session?.attributionFor(record.sequence) === undefined
    ) {
      return false;
    }
    if (needle.length === 0) return true;
    return (
      record.command.type.toLowerCase().includes(needle) ||
      commandTarget(record).toLowerCase().includes(needle) ||
      record.source.toLowerCase().includes(needle)
    );
  });
}

/** Distinct sources seen, for a filter dropdown. */
export function commandSources(
  records: readonly LiveCommandRecord[],
): readonly string[] {
  return [...new Set(records.map((record) => record.source))].sort();
}

export interface CommandImpact {
  readonly dirtyNodes: number;
  readonly backendWrites: number;
  readonly created: number;
  readonly destroyed: number;
}

/** What one command actually changed. Undefined when it changed nothing. */
export function commandImpact(
  session: ShowcaseSession,
  record: LiveCommandRecord,
): CommandImpact | undefined {
  const report = session.attributionFor(record.sequence);
  return report === undefined ? undefined : impactOf(report);
}

function impactOf(report: ProjectionReport): CommandImpact {
  return {
    dirtyNodes:
      report.dirty.transform +
      report.dirty.material +
      report.dirty.hierarchy +
      report.dirty.visibility +
      report.dirty.camera,
    backendWrites: report.backendWrites,
    created: report.nodesCreated,
    destroyed: report.nodesDestroyed,
  };
}

export interface DirtyOrigin {
  readonly commandType: string;
  readonly source: string;
  readonly commands: number;
  readonly dirtyNodes: number;
  readonly backendWrites: number;
}

/**
 * INVOKED. Which commands the recent scene churn came from.
 *
 * The whole point of the attribution ledger: "dirty nodes: 42" becomes "42 from
 * collection.patch, sent by feed, across 6 commands". A diagnostic that names a
 * cause is a diagnostic somebody can act on.
 */
export function dirtyOrigins(
  session: ShowcaseSession,
  records: readonly LiveCommandRecord[],
  window = 200,
): readonly DirtyOrigin[] {
  const buckets = new Map<string, { type: string; source: string; commands: number; dirty: number; writes: number }>();

  for (const record of records.slice(-window)) {
    const impact = commandImpact(session, record);
    if (impact === undefined) continue;
    const bucketKey = `${record.command.type} ${record.source}`;
    const bucket = buckets.get(bucketKey) ?? {
      type: record.command.type,
      source: record.source,
      commands: 0,
      dirty: 0,
      writes: 0,
    };
    bucket.commands += 1;
    bucket.dirty += impact.dirtyNodes;
    bucket.writes += impact.backendWrites;
    buckets.set(bucketKey, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      commandType: bucket.type,
      source: bucket.source,
      commands: bucket.commands,
      dirtyNodes: bucket.dirty,
      backendWrites: bucket.writes,
    }))
    .sort((a, b) => b.dirtyNodes - a.dirtyNodes);
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineTrack {
  readonly target: string;
  readonly path: string;
  readonly keyframes: readonly { time: number; easing: string }[];
  /** Seconds this track waits. Drawn as a lead-in on the ruler. */
  readonly delay: number;
  /** Present when the track fans across a collection's instances. */
  readonly stagger: { interval: number | null; total: number | null; direction: string } | null;
}

export type MarkerKind = "command" | "checkpoint" | "state" | "seek";

export interface TimelineMarker {
  readonly kind: MarkerKind;
  /** Seconds into the clip. */
  readonly time: number;
  readonly label: string;
  readonly detail: string;
}

export interface TimelineClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly tracks: readonly TimelineTrack[];
  readonly events: readonly { time: number; name: string }[];
  /** Undefined when the clip is neither playing nor held. */
  readonly state: ClipState | undefined;
  /** True when this timeline was compiled rather than authored — a transition. */
  readonly transient: boolean;
  /**
   * When the timeline is actually finished.
   *
   * Not `duration`: a staggered track is still moving after the nominal end,
   * and a ruler drawn to `duration` would show the playhead leaving the track
   * while rows were still arriving.
   */
  readonly span: number;
  /** What happened while this clip was running. The debugging part. */
  readonly markers: readonly TimelineMarker[];
}

/**
 * SAMPLED (cheap) / INVOKED (with markers).
 *
 * A VISUALIZATION of the runtime. It does not own playback and cannot: the
 * playhead comes from the clip's own state, so a timeline that disagreed with
 * the engine would be showing a second, wrong clock.
 *
 * Markers are what turn it from a display into a debugging tool. A clip that
 * "looks wrong at about a second in" is unactionable; the same clip with a
 * `collection.replace` marker at 0.98s is solved.
 */
/** Instances of a repeat template, for drawing a stagger's true extent. */
function instanceCount(session: ShowcaseSession, templateId: string): number {
  const document = session.host.document;
  if (document === null) return 0;
  const index = sceneIndex(document);
  const source = index.sourceFor(templateId);
  if (source === null) return 0;

  for (const ancestor of [...index.ancestorsOf(templateId)].reverse()) {
    if (ancestor.repeat === undefined) continue;
    const collection = session.host.runtime.state.variables.get(ancestor.repeat.source);
    return Array.isArray(collection) ? collection.length : 0;
  }
  return 0;
}

export function timeline(
  session: ShowcaseSession,
  options: { markers?: boolean; rate?: number } = {},
): readonly TimelineClip[] {
  const rate = options.rate ?? 60;
  const records = options.markers === true ? session.host.log.entries() : [];

  return session.host.animator.clips.map((clip: AnimationClip) => {
    const state = session.host.animator.clipState(clip.id);
    return {
      id: clip.id,
      name: clip.name,
      duration: clip.duration,
      loop: clip.loop === true,
      tracks: clip.tracks.map((track) => ({
        target: track.target,
        path: track.path,
        delay: track.delay ?? 0,
        stagger:
          track.stagger === undefined
            ? null
            : {
                interval: track.stagger.interval ?? null,
                total: track.stagger.total ?? null,
                direction: track.stagger.direction ?? "forward",
              },
        keyframes: track.keyframes.map((keyframe) => ({
          time: keyframe.time,
          easing:
            keyframe.easing === undefined
              ? "linear"
              : Array.isArray(keyframe.easing)
                ? "bezier"
                : String(keyframe.easing),
        })),
      })),
      // Read from MARKERS, not from `events`. Authored events are folded into
      // markers at load, so a panel reading `events` would show nothing for
      // every document the engine has actually loaded.
      events: (clip.markers ?? [])
        .filter((marker) => marker.kind === "event")
        .map((marker) => ({ time: marker.time, name: marker.id })),
      transient: session.host.animator.isTransient(clip.id),
      span: timelineSpan(clip, (templateId) => instanceCount(session, templateId)),
      state,
      markers: state === undefined ? [] : clipMarkers(records, state, clip.duration, rate),
    };
  });
}

/**
 * Places commands on a clip's own time axis.
 *
 * The mapping is the inverse of the animator's: a command recorded at frame f
 * sits at `(f - startFrame) * speed / rate` seconds. Derived from the clip's
 * OWN state rather than a wall clock, because the playhead is
 * `(frame - startFrame) / rate` and anything else would be a second clock.
 */
export function clipMarkers(
  records: readonly LiveCommandRecord[],
  state: ClipState,
  duration: number,
  rate: number,
): readonly TimelineMarker[] {
  if (duration <= 0 || rate <= 0) return [];
  const out: TimelineMarker[] = [];

  for (const record of records) {
    if (!record.accepted) continue;
    const seconds = ((record.frame - state.startFrame) * state.speed) / rate;
    if (seconds < 0 || seconds > duration) continue;
    out.push({
      kind: record.command.type === "playback.seek" ? "seek" : "command",
      time: seconds,
      label: record.command.type,
      detail: `#${record.sequence} · ${record.source} · f${record.frame}`,
    });
  }
  return out;
}

/** Frame a clip time maps to, for seeking from a timeline click. */
export function frameForClipTime(
  state: ClipState | undefined,
  seconds: number,
  rate: number,
): number {
  if (state === undefined || state.speed === 0) return 0;
  return Math.max(0, Math.round(state.startFrame + (seconds * rate) / state.speed));
}

// ---------------------------------------------------------------------------
// Debug layers
// ---------------------------------------------------------------------------

export interface DebugBox {
  readonly nodeId: string;
  /** Screen-space centre and extent, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: "bounds" | "layout" | "anchor";
  readonly selected: boolean;
}

export interface DebugBoxOptions {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly orthographicSize: number;
  /** Drawn with emphasis. The selected node, and any pinned ones. */
  readonly highlight?: ReadonlySet<string>;
  /** Stop after this many boxes. An overlay of 100,000 rectangles helps nobody. */
  readonly limit?: number;
}

/**
 * SAMPLED. Projects node boxes into canvas pixels.
 *
 * The camera is orthographic in every showcase scene, so the projection is a
 * uniform scale about the centre — worth stating, because this would be wrong
 * for a perspective camera and the overlay would be subtly, plausibly off.
 *
 * Walks the MIRROR, capped. V2 walked the whole document every sample, which
 * is the same scalability defect the tree had: correct at thirty-five nodes,
 * ruinous at a hundred thousand — and an SVG with a hundred thousand rects is
 * not a readable overlay in any case, so the cap costs nothing real.
 */
export function debugBoxes(
  session: ShowcaseSession,
  options: DebugBoxOptions,
): readonly DebugBox[] {
  const index = indexOf(session);
  if (index === null) return [];

  const mirror = session.host.reconciler.mirror;
  const limit = options.limit ?? 500;
  const pixelsPerUnit = options.canvasHeight / (options.orthographicSize * 2);
  const boxes: DebugBox[] = [];

  for (const id of mirror.nodeIds()) {
    if (boxes.length >= limit) break;
    const node = mirror.get(id);
    const source = index.sourceFor(id);
    if (node === undefined || source?.size === undefined) continue;

    const worldX = node.worldMatrix[12]!;
    const worldY = node.worldMatrix[13]!;

    boxes.push({
      nodeId: id,
      x: options.canvasWidth / 2 + worldX * pixelsPerUnit,
      // Y-up in the scene, Y-down on a canvas.
      y: options.canvasHeight / 2 - worldY * pixelsPerUnit,
      width: source.size.width * pixelsPerUnit,
      height: source.size.height * pixelsPerUnit,
      kind:
        source.layout !== undefined
          ? "layout"
          : source.anchor !== undefined
            ? "anchor"
            : "bounds",
      selected: options.highlight?.has(id) ?? false,
    });
  }

  return boxes;
}

// ---------------------------------------------------------------------------
// Output monitor
// ---------------------------------------------------------------------------

export interface OutputRow {
  readonly id: string;
  readonly resolution: string;
  readonly cadence: number;
  readonly rendered: number;
  readonly skipped: number;
  readonly missed: number;
  /** Effective frames per second for this output, given the cadence. */
  readonly effectiveFps: number;
  readonly alpha: string;
  readonly cameraNodeId: string | null;
}

/** SAMPLED. One row per bound output, straight from `outputStats()`. */
export function outputRows(
  session: ShowcaseSession,
  fps: number,
): readonly OutputRow[] {
  const stats = session.host.outputStats();
  return session.host.outputs.map((output) => {
    const stat = stats.find((entry) => entry.id === output.id);
    return {
      id: output.id,
      resolution: `${output.width}×${output.height}`,
      cadence: output.cadence,
      rendered: stat?.framesRendered ?? 0,
      skipped: stat?.framesSkipped ?? 0,
      missed: stat?.framesMissed ?? 0,
      effectiveFps: fps / output.cadence,
      alpha: output.alpha,
      cameraNodeId: output.cameraNodeId,
    };
  });
}

// ---------------------------------------------------------------------------
// Variable watch
// ---------------------------------------------------------------------------

export interface WatchRow {
  readonly key: string;
  readonly value: unknown;
  /** Compact preview. A 3,000-row collection must not be stringified into a cell. */
  readonly preview: string;
  /** How many mirror nodes read this variable, from the engine's own index. */
  readonly dependents: number;
  readonly lastWrite?: VariableOrigin["lastWrite"];
  readonly changed: boolean;
}

/** A short, honest rendering of any runtime value. */
export function previewValue(value: unknown, maxLength = 60): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * SAMPLED. The watch window.
 *
 * `dependents` comes from the engine's reverse index, so it answers "if I
 * change this, what redraws" without the workbench keeping its own graph.
 */
export function watchRows(
  session: ShowcaseSession,
  keys: readonly string[],
  previous?: ReadonlyMap<string, unknown>,
): readonly WatchRow[] {
  const variables = session.host.runtime.state.variables;
  const dependencies = session.host.reconciler.projector.dependencies;
  const writers = variableWriters(session.host.log.entries());

  return keys.map((key) => {
    const value = variables.get(key);
    const writer = writers.get(key);
    return {
      key,
      value,
      preview: previewValue(value),
      dependents: dependencies.dependents(key).size,
      ...(writer === undefined
        ? {}
        : {
            lastWrite: {
              sequence: writer.sequence,
              type: writer.command.type,
              source: writer.source,
              frame: writer.frame,
            },
          }),
      changed: previous !== undefined && previous.has(key) && previous.get(key) !== value,
    };
  });
}

/** SAMPLED. Every variable key the runtime holds, sorted. */
export function variableKeys(session: ShowcaseSession): readonly string[] {
  return [...session.host.runtime.state.variables.keys()].sort();
}
