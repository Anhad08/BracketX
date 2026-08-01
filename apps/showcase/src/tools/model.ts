/**
 * Workbench data model.
 *
 * Every tool's data is extracted here, as plain functions over a
 * `ShowcaseSession`. The React panels below render these and nothing more.
 *
 * The split matters for the same reason it did in Phase 1: a test that needs a
 * browser to check that the inspector shows the right parent is a test that
 * will be skipped. All of this is verified headlessly.
 */
import type {
  AnimationClip,
  SceneNode,
  Mat4,
} from "@bracketx/engine-scene";
import type { ClipState, LiveCommandRecord } from "@bracketx/engine-host";

import type { ShowcaseSession } from "../engine/session";

// ---------------------------------------------------------------------------
// Scene Inspector
// ---------------------------------------------------------------------------

export interface InspectorNode {
  readonly id: string;
  readonly depth: number;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly name: string;
  readonly componentTypes: readonly string[];
  /** True when the node was produced by a repeat rather than authored. */
  readonly instance: boolean;
  readonly visible: boolean;
  readonly effectiveVisible: boolean;
}

/**
 * The mirror hierarchy, flattened for a tree view.
 *
 * Read from the MIRROR, not the document, and that choice is the point: the
 * document says what was authored, the mirror says what exists. Collection
 * instances appear only in the mirror, and an inspector showing the document
 * would be missing exactly the nodes hardest to reason about.
 */
export function inspectorTree(session: ShowcaseSession): readonly InspectorNode[] {
  const mirror = session.host.reconciler.mirror;
  const document = session.host.document;
  if (document === null) return [];

  const authored = new Map<string, SceneNode>();
  const collect = (node: SceneNode): void => {
    authored.set(node.id, node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(document.root);

  const out: InspectorNode[] = [];

  const walk = (id: string, depth: number): void => {
    const node = mirror.get(id);
    if (node === undefined) return;

    // An instance id is `<templateId>#<identity>`; its authored shape is the
    // template's, which is where its components live.
    const hash = id.lastIndexOf("#");
    const templateId = hash > 0 ? id.slice(0, hash) : id;
    const source = authored.get(id) ?? authored.get(templateId);

    out.push({
      id,
      depth,
      parentId: node.parentId,
      childIds: [...node.childIds],
      name: source?.name ?? id,
      componentTypes: (source?.components ?? []).map((c) => c.type),
      instance: hash > 0 && authored.has(templateId),
      visible: node.visible,
      effectiveVisible: node.effectiveVisible,
    });

    for (const childId of node.childIds) walk(childId, depth + 1);
  };

  if (mirror.rootId !== null) walk(mirror.rootId, 0);
  return out;
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
  readonly states: readonly string[];
  /** Variables this node reads, from the dependency index. */
  readonly dependencies: readonly string[];
  /** Their current values. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Animation paths currently driving this node. */
  readonly animatedPaths: readonly string[];
}

export function nodeDetail(
  session: ShowcaseSession,
  nodeId: string,
): NodeDetail | null {
  const mirror = session.host.reconciler.mirror.get(nodeId);
  if (mirror === undefined) return null;

  const document = session.host.document;
  const hash = nodeId.lastIndexOf("#");
  const templateId = hash > 0 ? nodeId.slice(0, hash) : nodeId;

  let source: SceneNode | null = null;
  if (document !== null) {
    const find = (node: SceneNode): SceneNode | null => {
      if (node.id === nodeId || node.id === templateId) return node;
      for (const child of node.children ?? []) {
        const found = find(child);
        if (found !== null) return found;
      }
      return null;
    };
    source = find(document.root);
  }

  // dependenciesOf is the engine's own reverse index — recomputing it here
  // would be a second answer to a question the engine already answers.
  const dependencies = [
    ...session.host.reconciler.projector.dependencies.dependenciesOf(nodeId),
  ].sort();

  const values: Record<string, unknown> = {};
  for (const key of dependencies) {
    values[key] = session.host.runtime.state.variables.get(key);
  }

  const animated = session.host.animator.values.get(nodeId);

  return {
    id: nodeId,
    name: source?.name ?? nodeId,
    parentId: mirror.parentId,
    childIds: [...mirror.childIds],
    componentTypes: (source?.components ?? []).map((c) => c.type),
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
    states: source?.states ? Object.keys(source.states) : [],
    dependencies,
    values,
    animatedPaths: animated ? [...animated.keys()] : [],
  };
}

/** Case-insensitive match on id, name, or component type. */
export function matchesFilter(node: InspectorNode, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    node.id.toLowerCase().includes(needle) ||
    node.name.toLowerCase().includes(needle) ||
    node.componentTypes.some((type) => type.toLowerCase().includes(needle))
  );
}

/**
 * Filters a tree while keeping ancestors of matches.
 *
 * A filtered tree that drops the parents of its matches is a list, and a list
 * loses the one thing a tree view is for.
 */
export function filterTree(
  nodes: readonly InspectorNode[],
  query: string,
): readonly InspectorNode[] {
  if (query.length === 0) return nodes;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const keep = new Set<string>();

  for (const node of nodes) {
    if (!matchesFilter(node, query)) continue;
    keep.add(node.id);
    let parentId = node.parentId;
    while (parentId !== null && !keep.has(parentId)) {
      keep.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return nodes.filter((node) => keep.has(node.id));
}

// ---------------------------------------------------------------------------
// Command Console
// ---------------------------------------------------------------------------

export interface ConsoleFilter {
  readonly text: string;
  readonly acceptedOnly: boolean;
  readonly source: string | null;
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

export function filterCommands(
  records: readonly LiveCommandRecord[],
  filter: ConsoleFilter,
): readonly LiveCommandRecord[] {
  const needle = filter.text.toLowerCase();
  return records.filter((record) => {
    if (filter.acceptedOnly && !record.accepted) return false;
    if (filter.source !== null && record.source !== filter.source) return false;
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

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineTrack {
  readonly target: string;
  readonly path: string;
  readonly keyframes: readonly { time: number; easing: string }[];
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
}

/**
 * Everything a timeline view needs.
 *
 * A VISUALIZATION of the runtime. It does not own playback and cannot: the
 * playhead comes from the clip's own state, so a timeline that disagreed with
 * the engine would be showing a second, wrong clock.
 */
export function timeline(session: ShowcaseSession): readonly TimelineClip[] {
  return session.host.animator.clips.map((clip: AnimationClip) => ({
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    loop: clip.loop === true,
    tracks: clip.tracks.map((track) => ({
      target: track.target,
      path: track.path,
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
    events: (clip.events ?? []).map((event) => ({
      time: event.time,
      name: event.name,
    })),
    state: session.host.animator.clipState(clip.id),
  }));
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
  readonly dirty: boolean;
}

/**
 * Projects node boxes into canvas pixels.
 *
 * The camera is orthographic in every showcase scene, so the projection is a
 * uniform scale about the centre — worth stating, because this would be wrong
 * for a perspective camera and the overlay would be subtly, plausibly off.
 */
export function debugBoxes(
  session: ShowcaseSession,
  options: {
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly orthographicSize: number;
    readonly dirtyIds?: ReadonlySet<string>;
  },
): readonly DebugBox[] {
  const document = session.host.document;
  if (document === null) return [];

  const pixelsPerUnit = options.canvasHeight / (options.orthographicSize * 2);
  const boxes: DebugBox[] = [];

  const visit = (node: SceneNode): void => {
    const mirror = session.host.reconciler.mirror.get(node.id);
    if (mirror !== undefined && node.size !== undefined) {
      const worldX = mirror.worldMatrix[12]!;
      const worldY = mirror.worldMatrix[13]!;

      boxes.push({
        nodeId: node.id,
        x: options.canvasWidth / 2 + worldX * pixelsPerUnit,
        // Y-up in the scene, Y-down on a canvas.
        y: options.canvasHeight / 2 - worldY * pixelsPerUnit,
        width: node.size.width * pixelsPerUnit,
        height: node.size.height * pixelsPerUnit,
        kind:
          node.layout !== undefined
            ? "layout"
            : node.anchor !== undefined
              ? "anchor"
              : "bounds",
        dirty: options.dirtyIds?.has(node.id) ?? false,
      });
    }
    for (const child of node.children ?? []) visit(child);
  };

  visit(document.root);
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
}

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
    };
  });
}
