import { useRef, useState } from "react";
import {
  childrenOf,
  findNode,
  type SceneDocument,
  type SceneNode,
  type Transaction,
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
  type NodeKind,
  type ToolboxSection,
} from "../studio/editing";
import { dropTarget, outline, type OutlineRow } from "../studio/outline";
import type { IdFactory } from "../studio/ids";
import { contentSurface, preflight, type IssueKind } from "../studio/preflight";
import type { SurfaceField } from "../studio/surface";
import { SCENE_DRAG } from "../studio/place";
import { PACKS } from "../studio/packs";
import type { AssetRecord } from "@bracketx/engine-assets";
import { colourTokens, setToken } from "../studio/library";
import {
  FINISHES,
  applyFinishEverywhere,
  applyFinishTo,
  canFinish,
  finishOfAll,
  disableDepthEverywhere,
  enableDepthEverywhere,
  graphicFinish,
  graphicHasDepth,
} from "../studio/finishes";
import {
  LOOKS,
  applyLook,
  exposureOf,
  lightsOf,
  lookOf,
  setExposure,
  setShadows,
  shadowsOn,
} from "../studio/lighting";
import { PRESETS, applyPreset, type AnimationPreset } from "../studio/presets";
import type { IdFactory as PresetIds } from "../studio/ids";
import type { Depth } from "../studio/workspace";
import { resetSurfaceValue, setSurfaceValue } from "../studio/surface";

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

export function Toolbox({
  onCreate,
  installed,
  onPlaceScene,
}: {
  readonly onCreate: (kind: NodeKind) => void;
  readonly installed: ReadonlySet<string>;
  readonly onPlaceScene: (templateId: string) => void;
}) {
  const scenes = PACKS.filter((pack) => installed.has(pack.id)).flatMap((pack) =>
    (pack.templates ?? []).map((template) => ({ pack, template })),
  );
  return (
    <section className="panel toolbox" aria-label="Toolbox">
      {/* SCENES FIRST. The Canva test: the first question is "what are you
          making?", not "what shape would you like?". A designer with packs
          installed starts from a finished graphic and edits it; the shapes
          below are for when nothing in the library is close enough.

          This is also the only place a scene can genuinely be DRAGGED onto
          the stage, because it is the only place both are on screen. */}
      {scenes.length > 0 ? (
        <div className="tool-section">
          <h3>Scenes</h3>
          <div className="scene-strip">
            {scenes.map(({ pack, template }) => (
              <button
                key={template.id}
                type="button"
                className="scene-chip"
                draggable
                data-testid={`dock-scene-${template.id}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SCENE_DRAG, template.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPlaceScene(template.id)}
                title={`Drag onto the stage, or click to add ${template.name}`}
              >
                <span
                  className="chip-art"
                  aria-hidden
                  style={{ background: `linear-gradient(135deg, ${pack.swatch[0]}, ${pack.swatch[1]})` }}
                />
                {template.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
        Build anything from these. A lower third, a scoreboard and a bracket are
        all shapes and words — start from a template in the Marketplace if you
        would rather not begin with a rectangle.
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
    <section className="panel hierarchy" aria-label="Layers">
      <div className="panel-head">
        <h2>Layers</h2>
        <input
          className="field"
          placeholder="Filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter layers"
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
  readonly developerMode: boolean;
}

export function Inspector({ session, selection, onEdit, developerMode }: InspectorProps) {
  const document_ = session.document;
  const nodeId = primaryOf(selection);
  const node = nodeId === null ? null : findNode(document_.root, nodeId);

  if (node === null) {
    return (
      <section className="panel inspector" aria-label="Properties">
        <h2>Properties</h2>
        <p className="note pad">
          {selection.ids.length > 1
            ? `${selection.ids.length} layers selected. Editing shows the last one clicked.`
            : "Select a layer."}
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
  const selectionFinish = finishOfAll(document_, selection.ids);

  return (
    <section className="panel inspector" aria-label="Properties" data-testid="inspector">
      <div className="panel-head">
        <h2>Properties</h2>
        {/* The node's id is a debugging aid, not a fact anyone designing a
            graphic needs — and it was the last engine id left on a surface a
            designer sees. It stays, behind Developer Mode. */}
        {developerMode ? <span className="badge mono">{node.id}</span> : null}
      </div>

      <Group title="Layer">
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
        {/* ALL THREE, for rotation and for scale.
            It was rotation Z and scale X and Y — the two the flat editor's box
            handles could reach. The gizmo now turns about any axis and
            stretches along any axis, and a value a designer can change with the
            pointer but cannot read or type is a value they cannot check
            against a brand sheet. */}
        {(["x", "y", "z"] as const).map((axis, index) => (
          <NumberField
            key={`r${axis}`}
            label={`rotation ${axis}`}
            value={rotation[index] ?? 0}
            step={1}
            onCommit={(next) =>
              set(
                "transform.rotation",
                rotation.map((value, i) => (i === index ? next : value)),
                "Rotate",
              )
            }
          />
        ))}
        {(["x", "y", "z"] as const).map((axis, index) => (
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
            {/* "read from the mirror" shipped in the product UI until Phase 4.
                The FACT is worth showing — this is where the layer actually is,
                after layout and animation — but a broadcaster has no idea what a
                mirror is, and should not have to. */}
            on screen at {mirror.worldMatrix[12]!.toFixed(2)},{" "}
            {mirror.worldMatrix[13]!.toFixed(2)}
            {node.size !== undefined && findNode(document_.root, node.id)?.transform !== undefined
              ? " · after layout and animation"
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

      {/* MATERIALS, BY OUTCOME, ON WHAT IS SELECTED.
          The Content panel's finishes restyle the WHOLE graphic, which is what
          a beginner restyling a lower third means. Dressing a set is the other
          job: the plinth is chrome and the floor is matte, and those are two
          decisions about two objects.

          Same nine finishes, same vocabulary. A set dressed half from here and
          half from there has to match, so there is one table and one meaning
          for the word "Chrome". */}
      {canFinish(document_, selection.ids) ? (
        <Group title="Material">
          <div className="finishes" data-testid="materials">
            {FINISHES.map((finish) => (
              <button
                key={finish.id}
                type="button"
                className={`finish ${selectionFinish?.id === finish.id ? "on" : ""}`}
                data-testid={`material-${finish.id}`}
                aria-pressed={selectionFinish?.id === finish.id}
                title={finish.hint}
                onClick={() => {
                  const txn = applyFinishTo(document_, selection.ids, finish);
                  if (txn) onEdit(txn);
                }}
              >
                {finish.label}
              </button>
            ))}
          </div>
          {/* Null is a real answer: somebody who nudged roughness by hand has a
              surface that is no longer any named finish, and a picker claiming
              otherwise would misdescribe what is being rendered. */}
          {selectionFinish === null ? (
            <p className="note">
              {selection.ids.length > 1
                ? "These surfaces are not all the same. Choosing one makes them match."
                : "Adjusted by hand. Choosing a finish replaces those values."}
            </p>
          ) : (
            <p className="note">{selectionFinish.hint}</p>
          )}
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
  // Phase 3B. A row, not a panel — which is the whole point of describing
  // components rather than hand-writing an inspector per type.
  text: [
    { path: "content", label: "content", kind: "text" },
    { path: "font.size", label: "size", kind: "number", step: 1 },
    { path: "color", label: "colour", kind: "colour" },
    { path: "lineHeight", label: "line height", kind: "number", step: 0.05 },
    { path: "maxLines", label: "max lines", kind: "number", step: 1 },
    { path: "fit.minSize", label: "min size", kind: "number", step: 1 },
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
  text: {
    "fit.mode": ["wrap", "shrink", "truncate", "overflow"],
    align: ["start", "center", "end"],
    verticalAlign: ["top", "middle", "bottom"],
  },
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
          // A bound property must not be shown as an editable literal — typing
          // into it would silently drop the binding. But "bound to {$var: name}"
          // is an engine sentence: it tells a broadcaster nothing about what to
          // do next. Naming the field and the panel does.
          const key = (value as { $var?: unknown }).$var;
          return (
            <p className="note" key={spec.path}>
              {spec.label} comes from the{" "}
              <strong>{typeof key === "string" ? key : "data"}</strong> field.
              Change it in <strong>Data</strong>.
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
        if (spec.kind === "text") {
          // Declared in `FieldKind` since Phase 3A and never implemented —
          // every text field fell through to the number editor below, which
          // rendered a string property as `0`. Nothing had a text field until
          // Phase 3B, so nothing surfaced it until a browser test looked.
          //
          // Committed on blur, not per keystroke: a transaction per character
          // would put a hundred entries on the undo stack for one name.
          return (
            <label className="prop" key={spec.path}>
              <span>{spec.label}</span>
              <input
                className="field"
                defaultValue={String(value ?? "")}
                key={`${component.id}:${spec.path}:${String(value)}`}
                onBlur={(event) => onSet(at(spec.path), event.target.value, `Set ${spec.label}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
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
    <section className="panel variables" aria-label="Data" data-testid="variables">
      <div className="panel-head">
        <h2>Data</h2>
        <input
          className="field"
          placeholder="new field name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || name.trim().length === 0) return;
            onEdit(defineVariable(name.trim(), "string", "", ids).transaction);
            setName("");
          }}
          aria-label="New field name"
        />
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>field</th>
            <th>default (saved)</th>
            <th>live (not saved)</th>
            <th>used by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {document_.variables.length === 0 ? (
            <tr>
              <td colSpan={5} className="note">
                No fields yet. Add one to let a producer change this graphic
                without opening the editor.
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
        A default is saved with the graphic and can be undone. A live value is
        what is on screen right now — it is not saved, which is exactly what an
        operator changing a score on air wants.
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
// Content — the beginner surface, and the pre-air verdict
// ===========================================================================
//
// Both read the ENGINE. `contentSurface` derives the editable fields from the
// document's template parameters (or its variables); `preflight` reads what the
// shaper actually produced via `Projector.textFacts()`. Neither measures
// anything here — a second fit calculation in the UI would be exactly the
// duplicate this phase exists to delete.

export interface ContentProps {
  readonly session: StudioSession;
  readonly assets: readonly AssetRecord[];
  readonly ids: PresetIds;
  readonly depth: Depth;
  readonly onDepth: (depth: Depth) => void;
  /** True when this graphic is currently on air. */
  readonly onAir: boolean;
  /** Take to air, or take off — the beginner's one click for both. */
  readonly onGoLive: () => void;
  readonly onEdit: (transaction: Transaction) => void;
}

const ISSUE_TONE: Record<IssueKind, string> = {
  overflow: "warn",
  truncated: "warn",
  unbreakable: "warn",
  missing: "warn",
};

/**
 * One field, rendered as what it IS.
 *
 * A beginner must never see `ast_sponsor_mark`. An asset field is a list of
 * things they recognise by name; a yes/no is a switch; a colour is a colour.
 * The engine keeps its ids — this is the only place they are translated.
 */
function ContentField({
  field,
  assets,
  onValue,
}: {
  readonly field: SurfaceField;
  readonly assets: readonly AssetRecord[];
  readonly onValue: (value: unknown) => void;
}) {
  const text = field.value === null || field.value === undefined ? "" : String(field.value);

  if (field.type === "asset") {
    const images = assets.filter((asset) => asset.kind === "image");
    return (
      <select
        className="field"
        value={text}
        onChange={(event) => onValue(event.target.value)}
        aria-label={field.label}
        data-testid={`asset-${field.key}`}
      >
        <option value="">None</option>
        {images.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name}
          </option>
        ))}
        {/* What the scene already points at, when it is not in the library
            yet — a downloaded scene brings its own. Named, never as an id. */}
        {text !== "" && !images.some((asset) => asset.id === text) ? (
          <option value={text}>From this scene</option>
        ) : null}
      </select>
    );
  }

  if (field.type === "boolean") {
    return (
      <input
        className="field switch"
        type="checkbox"
        checked={field.value === true}
        onChange={(event) => onValue(event.target.checked)}
        aria-label={field.label}
      />
    );
  }

  if (field.type === "color") {
    return (
      <input
        className="field swatch-input"
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(text) ? text : "#ffffff"}
        onChange={(event) => onValue(event.target.value)}
        aria-label={field.label}
      />
    );
  }

  if (field.type === "number") {
    return (
      <input
        className="field"
        type="number"
        value={text}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onValue(next);
        }}
        aria-label={field.label}
      />
    );
  }

  return (
    <input
      className="field"
      value={text}
      onChange={(event) => onValue(event.target.value)}
      aria-label={field.label}
    />
  );
}

export function Content({
  session,
  assets,
  ids,
  depth,
  onDepth,
  onAir,
  onGoLive,
  onEdit,
}: ContentProps) {
  const document_ = session.document;
  const fields = contentSurface(session.host);
  const report = preflight(session.host);
  const colours = colourTokens(document_);
  const solid = graphicHasDepth(document_);
  const current = graphicFinish(document_);
  const currentLook = lookOf(document_);
  const lights = lightsOf(document_);
  /** Is there anything in this scene that a light would change? */
  const needsLight = solid || hasSolids(document_);
  const exposure = exposureOf(document_);
  const shadows = shadowsOn(document_);

  return (
    <section className="panel content" aria-label="Content" data-testid="content">
      <div className="panel-head">
        <h2>Content</h2>
        <span className="dim">{fields.length} fields</span>
      </div>

      {fields.length === 0 ? (
        // Law 7: never a blank panel. This state is reachable and says why.
        <p className="empty" data-testid="content-empty">
          This graphic has no data fields yet. Add one in Data, and it becomes
          editable here.
        </p>
      ) : (
        <div className="fgrp">
          <div className="lbl">Fields<span className="ln" /></div>
          <div className="content-fields">
          {fields.map((field) => (
            <label className="content-row" key={field.key}>
              <span className="content-label">
                {field.label}
                {field.required ? <span className="req" aria-label="required"> *</span> : null}
                {field.overridden ? (
                  <button
                    type="button"
                    className="reset"
                    title="Reset to the template default"
                    onClick={() => {
                      const txn = resetSurfaceValue(document_, field.key);
                      if (txn) onEdit(txn);
                    }}
                  >
                    reset
                  </button>
                ) : null}
              </span>
              <ContentField
                field={field}
                assets={assets}
                onValue={(value) => {
                  const txn = setSurfaceValue(document_, field.key, value);
                  if (txn) onEdit(txn);
                }}
              />
            </label>
          ))}
          </div>
        </div>
      )}

      {/* COLOUR — brand tokens, by name. Volume One L8: the operator picks an
          identity role, not a hex value, and the engine resolves it. Free
          colours remain available to a Designer through the Inspector. */}
      {colours.length > 0 ? (
        <div className="fgrp" data-testid="content-colour">
          <div className="lbl">Colour<span className="ln" /></div>
          {/* THE SWATCHES WERE DEAD.
              Each one wrote the token's OWN VALUE straight back — a guaranteed
              no-op, and `setToken` refuses an unchanged value anyway, so
              clicking a colour did nothing at all. It looked like a picker and
              it was a decoration.

              A swatch is a colour INPUT now. Changing one rewrites the token,
              and every layer bound to that token restyles — which is the whole
              mechanism behind installing a theme, reached directly. The name
              is on screen rather than in a tooltip, because the point of
              tokens is that a person picks an identity role and not a hex. */}
          <div className="swatches">
            {colours.map((token) => (
              <label className="swatch" key={token.name} title={`${token.name} — ${String(token.value)}`}>
                <input
                  type="color"
                  value={hexOf(token.value)}
                  aria-label={token.name}
                  data-testid={`token-${token.name}`}
                  onChange={(event) => {
                    const txn = setToken(document_, { ...token, value: event.target.value });
                    if (txn) onEdit(txn);
                  }}
                />
                <span className="swatch-name">{token.name.replace(/^brand\./, "")}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* ==================================================================
          3D — THE GOLDEN RULE, AS ONE BUTTON
          ==================================================================
          "Enable 3D → Engine creates camera, lighting, environment, default
          material, shadows, perspective. The user presses ONE button. The
          engine performs hundreds of decisions."

          It acts on the whole graphic rather than on a selection, because a
          beginner has no selection and because a lower third whose plate went
          solid while its accent bar stayed flat is not a 3D lower third.

          The finishes are named by what they LOOK like. Metalness and
          roughness are generated and are visible to an advanced user in
          Properties — never here. */}
      <div className="fgrp" data-testid="content-depth">
        <div className="lbl">3D<span className="ln" /></div>
        <button
          type="button"
          className={`depth-toggle-3d ${solid ? "on" : ""}`}
          data-testid="enable-3d"
          data-on={solid ? "yes" : "no"}
          disabled={onAir}
          title={
            onAir
              ? "The graphic is on air. Take it off before changing its shape."
              : solid
                ? "Return the graphic to flat"
                : "Give the graphic depth. Lighting is set up for you."
          }
          onClick={() => {
            const txn = solid
              ? disableDepthEverywhere(document_)
              : enableDepthEverywhere(document_, ids);
            if (txn) onEdit(txn);
          }}
        >
          {solid ? "Back to flat" : "Enable 3D"}
        </button>

        {solid ? (
          <div className="finishes" data-testid="finishes">
            {FINISHES.map((finish) => (
              <button
                key={finish.id}
                type="button"
                className={`finish ${current?.id === finish.id ? "on" : ""}`}
                data-testid={`finish-${finish.id}`}
                aria-pressed={current?.id === finish.id}
                title={finish.hint}
                disabled={onAir}
                onClick={() => {
                  const txn = applyFinishEverywhere(document_, finish);
                  if (txn) onEdit(txn);
                }}
              >
                {finish.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ==================================================================
          LIGHTING — A LOOK, NOT SIX NUMBERS
          ==================================================================
          Lighting a set properly means choosing positions, angles, colour
          temperatures and relative intensities for three or four sources.
          That is a craft, and not one somebody building a strap at 14:50 for
          a 15:00 transmission has time to practise.

          So the unit is a LOOK, and every one compiles to ordinary light
          nodes — the same nodes a person could have placed by hand, which the
          layer tree lists, the timeline animates and the gizmos move.

          Exposure and shadows sit beside them but are NOT lights: they are
          properties of the picture. Raising exposure does not make the key
          brighter, it makes the photograph brighter. */}
      <div className="fgrp" data-testid="lighting">
        <div className="lbl">Lighting<span className="ln" /></div>
        <div className="finishes">
          {LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              className={`finish ${currentLook?.id === look.id ? "on" : ""}`}
              data-testid={`look-${look.id}`}
              aria-pressed={currentLook?.id === look.id}
              title={look.hint}
              disabled={onAir}
              onClick={() => {
                const txn = applyLook(document_, look, ids);
                if (txn) onEdit(txn);
              }}
            >
              {look.label}
            </button>
          ))}
        </div>

        <label className="prop inline">
          <span>Exposure</span>
          <input
            className="field number tiny"
            type="number"
            step={0.05}
            min={0.05}
            max={4}
            data-testid="exposure"
            aria-label="Exposure"
            defaultValue={exposure}
            key={`exposure:${exposure}`}
            disabled={onAir}
            onBlur={(event) => onEdit(setExposure(document_, Number(event.target.value)))}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>

        <label className="prop check">
          <span>Shadows</span>
          <input
            type="checkbox"
            data-testid="shadows"
            checked={shadows}
            disabled={onAir}
            onChange={(event) => onEdit(setShadows(document_, event.target.checked))}
          />
        </label>

        {/* Said on screen, because the absence is a decision. A designer who
            looks for an HDRI should know why there is none rather than assume
            they have failed to find it. */}
        {/* SAID ONLY WHEN IT MATTERS.
            "Nothing is lit. A solid object with no light renders black" was
            printed under every flat lower third — a warning about a situation
            that could not arise, in a panel where everything else is calm. A
            product that raises its voice about nothing is one you stop
            listening to. */}
        <p className={`note${lights.length === 0 && needsLight ? " warn" : ""}`}>
          {lights.length === 0
            ? needsLight
              ? "Nothing is lit, and this scene has solid objects in it. Choose a look."
              : "Flat graphics need no lighting. Choose a look if you add depth."
            : `${lights.length} ${lights.length === 1 ? "light" : "lights"}. Move or re-aim any of them in the layer tree.`}
        </p>
      </div>

      {/* ANIMATION — Volume One L8 and Blueprint M-0. One choice generates the
          keyframes, the easing and the timing. The generated timeline is an
          ordinary one; nothing here is a special case downstream. */}
      <div className="fgrp" data-testid="content-motion">
        <div className="lbl">Animation<span className="ln" /></div>
        <div className="motion-picks">
          {ENTRANCES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="motion-pick"
              onClick={() => {
                const targets = topLevelIds(document_);
                if (targets.length === 0) return;
                const txn = applyPreset(document_, targets, preset, ids);
                if (txn) onEdit(txn);
              }}
            >
              {preset.label.replace(/^Slide in from /, "From ").replace(/ in$/, "")}
            </button>
          ))}
        </div>
      </div>

      <div className="preflight" data-testid="preflight">
        {report.clear ? (
          <p className="verdict ok">Ready. Nothing to report.</p>
        ) : (
          <>
            {report.issues.map((issue, index) => (
              <p className={`verdict ${ISSUE_TONE[issue.kind]}`} key={`${issue.kind}-${issue.nodeId ?? issue.label}-${index}`}>
                <b>{issue.label}</b> — {issue.detail}
              </p>
            ))}
            {report.unchecked.map((note) => (
              <p className="verdict unchecked" key={note}>
                {note}
              </p>
            ))}
          </>
        )}
      </div>

      {/* GOING TO AIR — the one-click version of the professional feature.
          The Program row is where an operator cues and takes deliberately;
          this is the beginner's version of the same act, on the same bus, and
          it is HERE because the beginner never opens the bottom dock. A
          product whose whole point is broadcast cannot hide the way to
          broadcast behind a depth setting. */}
      <div className="air-foot">
        <button
          type="button"
          className={`air ${onAir ? "on" : ""}`}
          data-testid="go-live"
          onClick={onGoLive}
          title="Cue and take happen in Production"
        >
          {onAir ? "On air — open Production" : "Go live"}
        </button>
        {report.clear ? null : (
          <span className="dim tiny">Checks above are worth reading first.</span>
        )}
      </div>

    </section>
  );
}

/** The entrances a beginner chooses from. Exits and emphasis are expert. */
const ENTRANCES: readonly AnimationPreset[] = PRESETS.filter(
  (p) => p.kind === "entrance",
).slice(0, 5);

/**
 * The graphic's own top-level layers.
 *
 * A beginner picking "Fade" means the graphic, not whichever layer happens to
 * be selected — they have no selection, because they have no layer tree.
 */
function topLevelIds(document_: SceneDocument): readonly string[] {
  return (document_.root.children ?? []).map((child) => child.id);
}

/**
 * The dock's foot.
 *
 * ==========================================================================
 * IT BELONGS TO THE DOCK, NOT TO A PANEL INSIDE IT
 * ==========================================================================
 * This lived at the bottom of the Content panel, which was fine while Content
 * was the whole dock and absurd the moment Layers and Properties appeared
 * under it: the sentence that describes the WHOLE dock sat halfway down it,
 * with two more panels below saying nothing.
 *
 * The prototype puts a rule and a hint at the foot of the dock, once, and it
 * states the bargain in one line that differs by side. A toggle with two
 * states can do that; the three-state version could not, because every
 * attempt to write the middle one came out as "some of the things".
 */
export function LevelFoot({
  depth,
  onDepth,
}: {
  readonly depth: Depth;
  readonly onDepth: (depth: Depth) => void;
}) {
  return (
    <div className="dock-foot" data-testid="depth">
      <span className="depth-label">
        {depth === "beginner"
          ? "Everything else is decided for you."
          : "Layers, properties and frames."}
      </span>
      <button
        type="button"
        className="depth-toggle"
        data-testid="depth-toggle"
        title={
          depth === "beginner"
            ? "Show how this graphic is built"
            : "Hide everything but the content"
        }
        onClick={() => onDepth(depth === "beginner" ? "expert" : "beginner")}
      >
        {depth === "beginner" ? "See how" : "Hide"}
        <span className="kbd-inline">⌥E</span>
      </button>
    </div>
  );
}

/**
 * Does this scene contain anything a light would change?
 *
 * A mesh is lit; a flat rect is not, unless somebody gave it depth. The
 * Lighting panel uses this to decide whether "nothing is lit" is a warning or
 * simply a fact — a lower third needs no lighting and should not be told off
 * for lacking it.
 */
function hasSolids(document_: SceneDocument): boolean {
  const visit = (node: SceneNode): boolean => {
    for (const component of node.components ?? []) {
      if (component.type === "meshRenderer") return true;
    }
    for (const child of childrenOf(node)) if (visit(child)) return true;
    return false;
  };
  return visit(document_.root);
}

/**
 * A token's value as something `<input type="color">` will accept.
 *
 * The format allows `#rgb`, `#rrggbb` and `#rrggbbaa`; the control accepts
 * exactly `#rrggbb` and silently shows black for anything else — which is how
 * a picker ends up claiming every brand colour is black.
 */
function hexOf(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{8}$/i.test(text)) return text.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]!}${text[1]!}${text[2]!}${text[2]!}${text[3]!}${text[3]!}`;
  }
  return "#000000";
}
