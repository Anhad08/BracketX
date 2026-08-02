import { useMemo, useRef, useState } from "react";
import {
  findNode,
  makeSetDocProp,
  type SceneDocument,
  type SceneNode,
  type Timeline,
} from "@bracketx/engine-scene";

import type { StudioSession } from "../studio/session";
import type { Selection } from "../studio/selection";
import { primaryOf, selectOnly, selectRange, toggle } from "../studio/selection";
import {
  TOOLBOX,
  bindProperty,
  clearBinding,
  defineVariable,
  removeVariable,
  setProp,
  setVariableDefault,
  transaction,
  type NodeKind,
} from "../studio/editing";
import { dropTarget, outline, type OutlineRow } from "../studio/outline";
import type { IdFactory } from "../studio/ids";

/**
 * The docked panels.
 *
 * Every one of these renders a model computed elsewhere and turns a gesture
 * into a transaction. None of them holds document state, and none of them talks
 * to the engine except through the session — which is what keeps "the inspector
 * reflects runtime state" a property rather than a hope.
 */

// ===========================================================================
// Toolbox
// ===========================================================================

export function Toolbox({ onCreate }: { onCreate: (kind: NodeKind) => void }) {
  return (
    <section className="panel toolbox" aria-label="Toolbox">
      <h2>Create</h2>
      <div className="tool-grid">
        {TOOLBOX.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className="tool"
            onClick={() => onCreate(entry.kind)}
            title={entry.hint}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {/* Stated on screen, not just in a doc: there is no lower-third tool and
          there must not be one. A lower third is a group with a rectangle. */}
      <p className="note">
        General primitives only. A lower third, scoreboard or bracket is built
        from these — the engine has no special case for any of them and neither
        does Studio.
      </p>
    </section>
  );
}

// ===========================================================================
// Hierarchy
// ===========================================================================

export interface HierarchyProps {
  readonly session: StudioSession;
  readonly selection: Selection;
  readonly onSelection: (selection: Selection) => void;
  readonly expanded: ReadonlySet<string>;
  readonly onExpanded: (next: ReadonlySet<string>) => void;
  readonly locked: ReadonlySet<string>;
  readonly onToggleLock: (nodeId: string) => void;
  readonly onMove: (nodeId: string, parentId: string, index: number) => void;
  readonly onRename: (nodeId: string, name: string) => void;
  readonly onToggleVisible: (nodeId: string) => void;
}

export function Hierarchy({
  session,
  selection,
  onSelection,
  expanded,
  onExpanded,
  locked,
  onToggleLock,
  onMove,
  onRename,
  onToggleVisible,
}: HierarchyProps) {
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; where: "before" | "after" | "inside" } | null>(null);
  const dragged = useRef<string | null>(null);

  const rows = outline(session.document, { expanded, locked, filter });
  const flattened = rows.map((row) => row.id);

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onExpanded(next);
  };

  const onRowClick = (event: React.MouseEvent, row: OutlineRow) => {
    if (event.shiftKey) {
      onSelection(selectRange(flattened, primaryOf(selection), row.id));
    } else if (event.metaKey || event.ctrlKey) {
      onSelection(toggle(selection, row.id));
    } else {
      onSelection(selectOnly(row.id));
    }
  };

  return (
    <section className="panel hierarchy" aria-label="Hierarchy">
      <div className="panel-head">
        <h2>Hierarchy</h2>
        <input
          className="field"
          placeholder="Filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter hierarchy"
        />
      </div>

      <ol className="outline" data-testid="outline">
        {rows.map((row) => (
          <li
            key={row.id}
            className={[
              selection.ids.includes(row.id) ? "selected" : "",
              row.hiddenByAncestor || !row.visible ? "dim" : "",
              dragOver?.id === row.id ? `drop-${dragOver.where}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ paddingLeft: `${row.depth * 14}px` }}
            draggable={row.parentId !== null}
            onDragStart={() => {
              dragged.current = row.id;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              const offset = (event.clientY - box.top) / box.height;
              // Three zones. Reparenting and reordering are different
              // intentions, and two zones gets one of them wrong half the time.
              setDragOver({
                id: row.id,
                where: offset < 0.28 ? "before" : offset > 0.72 ? "after" : "inside",
              });
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => {
              event.preventDefault();
              const source = dragged.current;
              const target = dragOver;
              dragged.current = null;
              setDragOver(null);
              if (source === null || target === null) return;
              const destination = dropTarget(session.document, rows, target.id, target.where);
              if (destination !== null) onMove(source, destination.parentId, destination.index);
            }}
          >
            <button
              type="button"
              className="twisty"
              onClick={() => toggleExpand(row.id)}
              disabled={!row.expandable}
              aria-label={row.expanded ? "Collapse" : "Expand"}
            >
              {!row.expandable ? "·" : row.expanded ? "▾" : "▸"}
            </button>

            {renaming === row.id ? (
              <input
                className="field inline"
                autoFocus
                defaultValue={row.name}
                onBlur={(event) => {
                  onRename(row.id, event.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenaming(null);
                }}
                aria-label="Node name"
              />
            ) : (
              <button
                type="button"
                className="row-name"
                onClick={(event) => onRowClick(event, row)}
                onDoubleClick={() => setRenaming(row.id)}
              >
                <span>{row.name}</span>
                <span className="badge">{row.kind}</span>
                {row.repeats ? <span className="badge repeat">repeat</span> : null}
              </button>
            )}

            <button
              type="button"
              className={`row-toggle ${row.visible ? "" : "off"}`}
              onClick={() => onToggleVisible(row.id)}
              aria-label={row.visible ? "Hide node" : "Show node"}
              title="Visibility is a document property — this is an undoable edit"
            >
              {row.visible ? "◉" : "○"}
            </button>
            <button
              type="button"
              className={`row-toggle ${row.locked ? "on" : ""}`}
              onClick={() => onToggleLock(row.id)}
              aria-label={row.locked ? "Unlock node" : "Lock node"}
              title="Lock is editor state — it never enters the document"
            >
              {row.locked ? "▣" : "▢"}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ===========================================================================
// Inspector
// ===========================================================================

function NumberField({
  label,
  value,
  step = 0.1,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="prop">
      <span>{label}</span>
      <input
        className="field number"
        type="number"
        step={step}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        // Committed on blur and on Enter, never on every keystroke: a
        // transaction per character would make undo useless and would put a
        // hundred entries on the stack for one number.
        onBlur={() => {
          if (draft !== null) {
            const parsed = Number(draft);
            if (Number.isFinite(parsed)) onCommit(parsed);
            setDraft(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export interface InspectorProps {
  readonly session: StudioSession;
  readonly selection: Selection;
  readonly onEdit: (transaction: ReturnType<typeof setProp>) => void;
  readonly ids: IdFactory;
}

export function Inspector({ session, selection, onEdit }: InspectorProps) {
  const document_ = session.document;
  const nodeId = primaryOf(selection);
  const node = nodeId === null ? null : findNode(document_.root, nodeId);

  if (node === null) {
    return (
      <section className="panel inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        <p className="note pad">
          {selection.ids.length > 1
            ? `${selection.ids.length} nodes selected. Editing shows the last one clicked.`
            : "Select a node."}
        </p>
      </section>
    );
  }

  const set = (path: string, value: unknown, label?: string) =>
    onEdit(setProp(document_, node.id, path, value, label));

  const position = node.transform?.position ?? [0, 0, 0];
  const rotation = node.transform?.rotation ?? [0, 0, 0];
  const scale = node.transform?.scale ?? [1, 1, 1];
  const rect = (node.components ?? []).find((component) => component.type === "rect");
  // `props` is a discriminated union across component types; the inspector
  // edits by dot PATH, which is untyped by design (SCENE_FORMAT §7 makes any
  // property animatable and bindable without a per-type vocabulary).
  const rectProps = (rect?.props ?? {}) as Record<string, unknown>;
  const mirror = session.host.reconciler.mirror.get(node.id);

  return (
    <section className="panel inspector" aria-label="Inspector" data-testid="inspector">
      <div className="panel-head">
        <h2>Inspector</h2>
        <span className="badge mono">{node.id}</span>
      </div>

      <Group title="Node">
        <label className="prop">
          <span>name</span>
          <input
            className="field"
            defaultValue={node.name}
            key={`${node.id}:${node.name}`}
            onBlur={(event) => set("name", event.target.value, "Rename")}
            aria-label="Name"
          />
        </label>
        <label className="prop check">
          <span>visible</span>
          <input
            type="checkbox"
            checked={node.visible !== false}
            onChange={(event) => set("visible", event.target.checked, "Set visibility")}
          />
        </label>
      </Group>

      <Group title="Transform">
        {(["x", "y", "z"] as const).map((axis, index) => (
          <NumberField
            key={`p${axis}`}
            label={`position ${axis}`}
            value={position[index] ?? 0}
            onCommit={(next) =>
              set(
                "transform.position",
                position.map((value, i) => (i === index ? next : value)),
                "Move",
              )
            }
          />
        ))}
        <NumberField
          label="rotation z"
          value={rotation[2] ?? 0}
          step={1}
          onCommit={(next) =>
            set("transform.rotation", [rotation[0] ?? 0, rotation[1] ?? 0, next], "Rotate")
          }
        />
        {(["x", "y"] as const).map((axis, index) => (
          <NumberField
            key={`s${axis}`}
            label={`scale ${axis}`}
            value={scale[index] ?? 1}
            onCommit={(next) =>
              set(
                "transform.scale",
                scale.map((value, i) => (i === index ? next : value)),
                "Scale",
              )
            }
          />
        ))}
        {mirror !== undefined ? (
          <p className="note" data-testid="world-readout">
            world {mirror.worldMatrix[12]!.toFixed(3)}, {mirror.worldMatrix[13]!.toFixed(3)}
            {node.size !== undefined && findNode(document_.root, node.id)?.transform !== undefined
              ? " · read from the mirror, so layout and animation are included"
              : ""}
          </p>
        ) : null}
      </Group>

      {node.size !== undefined ? (
        <Group title="Size">
          <NumberField
            label="width"
            value={node.size.width}
            onCommit={(next) => set("size.width", next, "Resize")}
          />
          <NumberField
            label="height"
            value={node.size.height}
            onCommit={(next) => set("size.height", next, "Resize")}
          />
        </Group>
      ) : null}

      {rect !== undefined ? (
        <Group title="Appearance">
          <label className="prop">
            <span>fill</span>
            <input
              className="field colour"
              type="color"
              value={typeof rectProps.fill === "string" ? rectProps.fill : "#2f6feb"}
              onChange={(event) =>
                set(
                  `components.${(node.components ?? []).indexOf(rect)}.props.fill`,
                  event.target.value,
                  "Set fill",
                )
              }
              aria-label="Fill"
            />
          </label>
          {typeof rectProps.fill === "object" && rectProps.fill !== null ? (
            <p className="note">
              Bound to <span className="mono">{JSON.stringify(rectProps.fill)}</span>. The
              value comes from a variable at runtime.
            </p>
          ) : null}
        </Group>
      ) : null}

      <Group title="Layout">
        <label className="prop">
          <span>mode</span>
          <select
            className="field"
            value={node.layout?.mode ?? "none"}
            onChange={(event) =>
              set(
                "layout",
                event.target.value === "none"
                  ? undefined
                  : { ...node.layout, mode: event.target.value, gap: node.layout?.gap ?? 0.1 },
                "Set layout",
              )
            }
            aria-label="Layout mode"
          >
            {["none", "horizontal", "vertical", "grid", "stack"].map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        {node.layout !== undefined ? (
          <NumberField
            label="gap"
            value={node.layout.gap ?? 0}
            step={0.05}
            onCommit={(next) => set("layout.gap", next, "Set gap")}
          />
        ) : null}
      </Group>

      <Group title="States">
        {node.states === undefined || Object.keys(node.states).length === 0 ? (
          <p className="note">No state overrides declared on this node.</p>
        ) : (
          <p>
            {Object.keys(node.states).map((state) => (
              <span
                key={state}
                className={`badge ${session.host.activeStates.includes(state) ? "on" : ""}`}
              >
                {state}
              </span>
            ))}
          </p>
        )}
      </Group>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="prop-group">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ===========================================================================
// Variables
// ===========================================================================

export interface VariablesProps {
  readonly session: StudioSession;
  readonly selection: Selection;
  readonly ids: IdFactory;
  readonly onEdit: (transaction: ReturnType<typeof setProp>) => void;
}

export function Variables({ session, selection, ids, onEdit }: VariablesProps) {
  const document_ = session.document;
  const [name, setName] = useState("");
  const nodeId = primaryOf(selection);

  return (
    <section className="panel variables" aria-label="Variables" data-testid="variables">
      <div className="panel-head">
        <h2>Variables</h2>
        <input
          className="field"
          placeholder="new variable key"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || name.trim().length === 0) return;
            onEdit(defineVariable(name.trim(), "string", "", ids).transaction);
            setName("");
          }}
          aria-label="New variable key"
        />
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>key</th>
            <th>default</th>
            <th>runtime</th>
            <th>readers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {document_.variables.length === 0 ? (
            <tr>
              <td colSpan={5} className="note">
                No variables. Bind a property to one to make it data-driven.
              </td>
            </tr>
          ) : (
            document_.variables.map((variable) => {
              const runtime = session.host.runtime.state.variables.get(variable.key);
              const readers = session.host.reconciler.projector.dependencies.dependents(
                variable.key,
              ).size;
              return (
                <tr key={variable.id}>
                  <td className="mono">{variable.key}</td>
                  <td>
                    <input
                      className="field"
                      defaultValue={String(variable.default ?? "")}
                      key={`${variable.id}:${String(variable.default)}`}
                      onBlur={(event) =>
                        onEdit(setVariableDefault(document_, variable.id, event.target.value))
                      }
                      aria-label={`Default for ${variable.key}`}
                    />
                  </td>
                  {/* The runtime value, shown and NOT editable here. Editing it
                      would be a command, not an operation — not undoable, not
                      saved. Mixing the two in one cell is how a designer loses
                      work believing they had changed the document. */}
                  <td className="mono dim">{String(runtime ?? "—")}</td>
                  <td className="num">{readers}</td>
                  <td>
                    {nodeId !== null ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          const node = findNode(document_.root, nodeId);
                          const index = (node?.components ?? []).findIndex(
                            (component) => component.type === "rect",
                          );
                          if (index < 0) return;
                          onEdit(
                            bindProperty(
                              document_,
                              nodeId,
                              `components.${index}.props.fill`,
                              variable.key,
                            ),
                          );
                        }}
                        title="Bind the selected node's fill to this variable"
                      >
                        bind fill
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => onEdit(removeVariable(document_, variable.id))}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <p className="note">
        Defaults are document state and undoable. The runtime column is live and is
        neither — RFC-002 §4.3.
      </p>
    </section>
  );
}

/** Clears a binding back to a literal. Exported for the palette. */
export function makeClearBinding(
  document_: SceneDocument,
  nodeId: string,
  path: string,
  value: unknown,
) {
  return clearBinding(document_, nodeId, path, value);
}

// ===========================================================================
// Timeline
// ===========================================================================

export interface TimelinePanelProps {
  readonly session: StudioSession;
  readonly revision: number;
  readonly onEdit: (transaction: ReturnType<typeof setProp>) => void;
}

/**
 * The timeline.
 *
 * Reads the engine's ONE timeline model and edits it through the operation
 * system. There is no second timeline here: the playhead is
 * `Animator.clipState(...).seconds`, scrubbing is `playback.seek`, and dragging
 * a keyframe is a `doc.setMeta` on `animations.i.tracks.j.keyframes.k.time` —
 * which means it is undoable and saved like every other edit.
 */
export function TimelinePanel({ session, revision, onEdit }: TimelinePanelProps) {
  const document_ = session.document;
  const timelines = (document_.animations ?? []) as readonly Timeline[];
  const rate = 60;
  const [dragging, setDragging] = useState<{
    timeline: number;
    track: number;
    keyframe: number;
  } | null>(null);

  const states = useMemo(
    () => new Map(session.host.animator.clipStates().map((state) => [state.clipId, state])),
    [session, revision, session.frame],
  );

  if (timelines.length === 0) {
    return (
      <section className="panel timeline" aria-label="Timeline">
        <p className="note pad">
          This scene declares no timelines. A timeline is document data —
          `animations` in SCENE_FORMAT — so adding one is an edit like any other.
        </p>
      </section>
    );
  }

  return (
    <section className="panel timeline" aria-label="Timeline" data-testid="timeline">
      {timelines.map((timeline, timelineIndex) => {
        const state = states.get(timeline.id);
        const span = timeline.duration > 0 ? timeline.duration : 1;
        const progress = state === undefined ? 0 : Math.min(1, state.seconds / span);

        return (
          <div className="clip" key={timeline.id}>
            <header>
              <strong>{timeline.name}</strong>
              <span className="dim">
                {timeline.duration}s{timeline.loop ? " · loop" : ""}
                {state === undefined ? "" : ` · ${state.seconds.toFixed(2)}s`}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="link"
                onClick={() => session.playClip(timeline.id)}
              >
                play
              </button>
              <button
                type="button"
                className="link"
                onClick={() => session.stopClip(timeline.id)}
              >
                stop
              </button>
            </header>

            <div
              className="ruler"
              onPointerDown={(event) => {
                // Scrubbing seeks the ENGINE clock. The timeline never advances
                // anything itself — a second clock would drift from the first.
                const box = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - box.left) / box.width;
                session.seek(Math.round(ratio * span * rate));
              }}
              onPointerMove={(event) => {
                if (dragging === null || event.buttons === 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
                const time = Math.round(ratio * span * 1000) / 1000;
                onEdit(
                  transaction("Move keyframe", [
                    makeSetDocProp(
                      document_,
                      `animations.${dragging.timeline}.tracks.${dragging.track}.keyframes.${dragging.keyframe}.time`,
                      time,
                    ),
                  ]),
                );
              }}
              onPointerUp={() => setDragging(null)}
            >
              {timeline.tracks.map((track, trackIndex) => (
                <div className="track" key={`${track.target}:${track.path}`}>
                  <span className="track-name mono">
                    {track.path}
                    {track.delay ? <span className="badge">+{track.delay}s</span> : null}
                    {track.stagger ? <span className="badge">stagger</span> : null}
                  </span>
                  {track.keyframes.map((keyframe, keyframeIndex) => (
                    <button
                      key={keyframeIndex}
                      type="button"
                      className="keyframe"
                      style={{ left: `${((keyframe.time + (track.delay ?? 0)) / span) * 100}%` }}
                      title={`${keyframe.time}s — drag to move`}
                      data-testid="keyframe"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setDragging({
                          timeline: timelineIndex,
                          track: trackIndex,
                          keyframe: keyframeIndex,
                        });
                      }}
                    />
                  ))}
                </div>
              ))}

              {(timeline.markers ?? []).map((marker) => (
                <span
                  key={marker.id}
                  className={`marker ${marker.kind}`}
                  style={{ left: `${(marker.time / span) * 100}%` }}
                  title={`${marker.id} · ${marker.kind} @ ${marker.time}s`}
                  data-testid="timeline-marker"
                />
              ))}

              {state !== undefined ? (
                <div
                  className="playhead"
                  style={{ left: `${progress * 100}%` }}
                  data-testid="playhead"
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <p className="note">
        Dragging a keyframe is a document operation, so it is undoable and saved.
        The playhead is the engine&apos;s — this panel owns no clock.
      </p>
    </section>
  );
}

/** Exported so the shell can offer "add a timeline" without a second model. */
export function makeTimeline(node: SceneNode | null, ids: IdFactory): Timeline {
  const target = node?.id ?? "nod_root";
  return {
    id: ids("timeline"),
    name: "Timeline",
    duration: 1,
    tracks: [
      {
        target,
        path: "transform.position.0",
        keyframes: [
          { time: 0, value: -4, easing: "easeOutCubic" },
          { time: 1, value: 0 },
        ],
      },
    ],
  };
}
