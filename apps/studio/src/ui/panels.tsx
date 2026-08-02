import { useRef, useState } from "react";
import { findNode, type SceneDocument } from "@bracketx/engine-scene";

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
  type NodeKind,
  type ToolboxSection,
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

const TOOLBOX_SECTIONS: readonly { section: ToolboxSection; title: string }[] = [
  { section: "shape", title: "Shapes" },
  { section: "3d", title: "3D" },
  { section: "layout", title: "Structure" },
  { section: "scene", title: "Scene" },
];

export function Toolbox({ onCreate }: { onCreate: (kind: NodeKind) => void }) {
  return (
    <section className="panel toolbox" aria-label="Toolbox">
      <h2>Create</h2>
      {TOOLBOX_SECTIONS.map(({ section, title }) => (
        <div className="tool-section" key={section}>
          <h3>{title}</h3>
          <div className="tool-grid">
            {TOOLBOX.filter((entry) => entry.section === section).map((entry) => (
              <button
                key={entry.kind}
                type="button"
                className="tool"
                onClick={() => onCreate(entry.kind)}
                title={entry.hint}
                data-testid={`tool-${entry.kind}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* Both rules stated on screen, not just in a doc: nothing here is a
          broadcast noun, and nothing here is a promise the engine cannot keep. */}
      <p className="note">
        General primitives only. A lower third, scoreboard or bracket is built
        from these — the engine has no special case for any of them and neither
        does Studio.
      </p>
      <p className="note">
        Text, Image and SVG are absent because the engine cannot draw them yet
        (IF-003). A tool that produced an invisible node would teach you to
        distrust the rest of this palette.
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

      {/* One editor per component, driven by a DESCRIPTION of the component's
          properties rather than by a hand-written panel per type. That is what
          makes the inspector generic: a component type nobody has written a
          panel for still gets every field the schema below can describe, and a
          future text node needs a row in COMPONENT_FIELDS, not a new panel. */}
      {(node.components ?? []).map((component, index) => (
        <ComponentEditor
          key={component.id}
          component={component}
          index={index}
          onSet={set}
        />
      ))}
      {rect !== undefined && typeof rectProps.fill === "object" && rectProps.fill !== null ? (
        <p className="note">
          Fill is bound to <span className="mono">{JSON.stringify(rectProps.fill)}</span>.
          The value comes from a variable at runtime.
        </p>
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

// ---------------------------------------------------------------------------
// Component editing — described, not hand-written
// ---------------------------------------------------------------------------

type FieldKind = "number" | "colour" | "text" | "checkbox";

interface FieldSpec {
  /** Dot path WITHIN the component's props. */
  readonly path: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly step?: number;
  readonly options?: readonly string[];
}

/**
 * What each component type exposes.
 *
 * A table rather than a component per type, and the reason is the phase brief's
 * hardest requirement: *"the authoring tools must treat every node generically
 * so that a future TextNode automatically gains every editor capability without
 * Studio modifications."* A hand-written `<TextInspector>` would be one more
 * place to remember. A row here is a declaration, and everything that reads the
 * table — the inspector, and anything later that wants to know what is editable
 * — gains the type at once.
 *
 * A component type absent from this table still renders: every property it has
 * appears as a raw field, because the underlying edit is a dot path and the
 * engine makes every property animatable and bindable without a per-type
 * vocabulary (SCENE_FORMAT §7).
 */
const COMPONENT_FIELDS: Record<string, readonly FieldSpec[]> = {
  rect: [
    { path: "width", label: "width", kind: "number" },
    { path: "height", label: "height", kind: "number" },
    { path: "fill", label: "fill", kind: "colour" },
  ],
  meshRenderer: [
    { path: "primitive.width", label: "width", kind: "number" },
    { path: "primitive.height", label: "height", kind: "number" },
    { path: "primitive.depth", label: "depth", kind: "number" },
    { path: "primitive.radius", label: "radius", kind: "number", step: 0.05 },
    { path: "primitive.segments", label: "segments", kind: "number", step: 1 },
    { path: "material.baseColor", label: "colour", kind: "colour" },
    { path: "material.opacity", label: "opacity", kind: "number", step: 0.05 },
    { path: "material.metallic", label: "metallic", kind: "number", step: 0.05 },
    { path: "material.roughness", label: "roughness", kind: "number", step: 0.05 },
  ],
  camera: [
    { path: "orthographicSize", label: "ortho size", kind: "number", step: 0.25 },
    { path: "focalLength", label: "focal length", kind: "number", step: 1 },
    { path: "near", label: "near", kind: "number", step: 0.01 },
    { path: "far", label: "far", kind: "number", step: 1 },
  ],
  light: [
    { path: "color", label: "colour", kind: "colour" },
    { path: "intensity", label: "intensity", kind: "number", step: 0.1 },
    { path: "distance", label: "distance", kind: "number", step: 0.5 },
    { path: "angle", label: "cone angle", kind: "number", step: 0.05 },
    { path: "penumbra", label: "penumbra", kind: "number", step: 0.05 },
    { path: "decay", label: "decay", kind: "number", step: 0.1 },
  ],
};

/** Enumerations, where the format constrains a value to a set. */
const COMPONENT_CHOICES: Record<string, Record<string, readonly string[]>> = {
  camera: { projection: ["orthographic", "perspective"] },
  light: { kind: ["ambient", "directional", "point", "spot"] },
  meshRenderer: {
    "primitive.shape": ["box", "plane", "sphere", "cylinder", "disc"],
  },
};

function readAt(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function ComponentEditor({
  component,
  index,
  onSet,
}: {
  component: { readonly id: string; readonly type: string; readonly props: unknown };
  index: number;
  onSet: (path: string, value: unknown, label?: string) => void;
}) {
  const props = (component.props ?? {}) as Record<string, unknown>;
  const specs = COMPONENT_FIELDS[component.type] ?? [];
  const choices = COMPONENT_CHOICES[component.type] ?? {};

  const at = (path: string) => `components.${index}.props.${path}`;

  // Only fields the component actually carries. A sphere has a radius and no
  // depth; showing every field of every primitive would put six meaningless
  // boxes in front of a designer editing a cube.
  const present = specs.filter((spec) => readAt(props, spec.path) !== undefined);
  const described = new Set([
    ...specs.map((spec) => spec.path),
    ...Object.keys(choices),
  ]);
  const undescribed = Object.keys(props).filter(
    (key) => !described.has(key) && !described.has(`${key}.shape`) && typeof props[key] !== "object",
  );

  return (
    <Group title={component.type}>
      {Object.entries(choices).map(([path, options]) =>
        readAt(props, path) === undefined ? null : (
          <label className="prop" key={path}>
            <span>{path.split(".").at(-1)}</span>
            <select
              className="field"
              value={String(readAt(props, path))}
              onChange={(event) => onSet(at(path), event.target.value, `Set ${path}`)}
              aria-label={path}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ),
      )}

      {present.map((spec) => {
        const value = readAt(props, spec.path);
        // A bound property is `{ $var: "key" }` and must not be shown as an
        // editable literal — typing into it would silently drop the binding.
        if (value !== null && typeof value === "object") {
          return (
            <p className="note" key={spec.path}>
              {spec.label} is bound to{" "}
              <span className="mono">{JSON.stringify(value)}</span>
            </p>
          );
        }
        if (spec.kind === "colour") {
          return (
            <label className="prop" key={spec.path}>
              <span>{spec.label}</span>
              <input
                className="field colour"
                type="color"
                // A `#RRGGBBAA` colour is legal in the format and illegal in an
                // `<input type=color>`, which silently shows black. Truncated
                // for display; the alpha survives because the edit writes a
                // whole new value only when the designer picks one.
                value={String(value).slice(0, 7)}
                onChange={(event) => onSet(at(spec.path), event.target.value, `Set ${spec.label}`)}
                aria-label={spec.label}
              />
            </label>
          );
        }
        if (spec.kind === "checkbox") {
          return (
            <label className="prop check" key={spec.path}>
              <span>{spec.label}</span>
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) =>
                  onSet(at(spec.path), event.target.checked, `Set ${spec.label}`)
                }
              />
            </label>
          );
        }
        return (
          <NumberField
            key={spec.path}
            label={spec.label}
            step={spec.step ?? 0.1}
            value={typeof value === "number" ? value : 0}
            onCommit={(next) => onSet(at(spec.path), next, `Set ${spec.label}`)}
          />
        );
      })}

      {undescribed.map((key) => (
        <label className="prop" key={key}>
          <span>{key}</span>
          <input
            className="field"
            defaultValue={String(props[key])}
            key={`${component.id}:${key}:${String(props[key])}`}
            onBlur={(event) => {
              const parsed = Number(event.target.value);
              onSet(
                at(key),
                Number.isFinite(parsed) && event.target.value.trim() !== ""
                  ? parsed
                  : event.target.value,
                `Set ${key}`,
              );
            }}
            aria-label={key}
          />
        </label>
      ))}
    </Group>
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
            <th>default (saved)</th>
            <th>live (not saved)</th>
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
              const overridden = session.isOverridden(variable.key);
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
                  {/* The runtime value, editable — and visibly a DIFFERENT act.
                      Setting it is a command, not an operation: not undoable,
                      not saved, exactly what an operator does on air. Kept in
                      its own column with its own reset, because a designer who
                      cannot tell which of the two they just changed will lose
                      work believing they had edited the document. */}
                  <td>
                    <span className={overridden ? "override" : ""}>
                      <input
                        className="field"
                        value={String(runtime ?? "")}
                        onChange={(event) =>
                          session.overrideVariable(variable.key, event.target.value)
                        }
                        aria-label={`Runtime value for ${variable.key}`}
                        title="Live. Not undoable and not saved — RFC-002 §4.3"
                      />
                      {overridden ? (
                        <button
                          type="button"
                          className="link"
                          onClick={() => session.resetVariable(variable.key)}
                          title="Back to the document's default"
                        >
                          reset
                        </button>
                      ) : null}
                    </span>
                  </td>
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
