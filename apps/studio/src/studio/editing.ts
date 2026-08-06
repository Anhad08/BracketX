/**
 * Editing intents → transactions.
 *
 * ============================================================================
 * EVERY EDIT IS A TRANSACTION, AND NOTHING HERE TOUCHES THE ENGINE
 * ============================================================================
 * These are pure functions from (document, intent) to a `Transaction`. They do
 * not apply anything. That split is what makes undo free — the engine already
 * knows how to invert a transaction (`invertTransaction`), so Studio needs no
 * undo implementation of its own, only a stack.
 *
 * It is also what makes every edit testable without a backend: an assertion
 * about "duplicate preserves structure" is an assertion about the transaction,
 * not about a rendered frame.
 *
 * ONE TRANSACTION IS ONE UNDO STEP (RFC-002 §6). Deleting four nodes is one
 * step, not four, because that is what the person doing it meant.
 */
import {
  OperationError,
  childrenOf,
  findNode,
  generateKeyBetween,
  makeMoveNode,
  makeRemoveNode,
  makeSetProp,
  parentOf,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type SceneVariable,
  type Transaction,
  type VariableType,
} from "@bracketx/engine-scene";

import type { IdFactory } from "./ids";

/** Studio is the actor. Present from the start so actor-filtered undo is possible. */
export const ACTOR = "studio";

let sequence = 0;

export function transaction(
  label: string,
  operations: readonly SceneOperation[],
): Transaction {
  return { id: `txn_${(sequence += 1)}`, label, actorId: ACTOR, operations };
}

/** Test-only: makes transaction ids reproducible across runs. */
export function resetTransactionIds(): void {
  sequence = 0;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * An order key placing a node last among a parent's children.
 *
 * Fractional indexing, so inserting never renumbers a sibling — which is what
 * keeps a reorder from touching every node in the list and churning the mirror.
 */
export function orderAfterLast(document: SceneDocument, parentId: string): string {
  const parent = findNode(document.root, parentId);
  const siblings = parent === null ? [] : childrenOf(parent);
  const last = siblings.at(-1)?.order ?? null;
  return generateKeyBetween(last, null);
}

/** An order key placing a node between two siblings, by index. */
export function orderAtIndex(
  document: SceneDocument,
  parentId: string,
  index: number,
  excluding?: string,
): string {
  const parent = findNode(document.root, parentId);
  const siblings = (parent === null ? [] : childrenOf(parent)).filter(
    (child) => child.id !== excluding,
  );
  const clamped = Math.max(0, Math.min(siblings.length, index));
  const before = clamped === 0 ? null : siblings[clamped - 1]!.order;
  const after = clamped >= siblings.length ? null : siblings[clamped]!.order;
  return generateKeyBetween(before, after);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type NodeKind =
  | "group"
  | "text"
  | "rect"
  | "ellipse"
  | "box"
  | "sphere"
  | "cylinder"
  | "plane"
  | "camera"
  | "light";

export type ToolboxSection = "layout" | "shape" | "3d" | "scene";

export interface ToolboxEntry {
  readonly kind: NodeKind;
  readonly section: ToolboxSection;
  readonly label: string;
  readonly hint: string;
}

/**
 * The toolbox.
 *
 * ========================================================================
 * EVERY ENTRY DRAWS. NOTHING HERE IS A PROMISE
 * ========================================================================
 * A tool exists here only when the projector attaches something for it and a
 * backend puts it on screen. That rule is what excludes **Text, Image and SVG**
 * today — the text engine is a spike (IF-003) and images need the asset
 * pipeline — and it is the same rule that kept Blur and Glow out of the
 * animation presets. A toolbox entry that produces an invisible node teaches a
 * designer to distrust the whole palette.
 *
 * ========================================================================
 * AND NOTHING HERE IS A BROADCAST NOUN
 * ========================================================================
 * There is no "lower third" tool and there must never be one. A lower third is
 * a group with a rectangle and some text; the moment Studio ships a component
 * that knows what a lower third IS, the engine's general-purpose capabilities
 * stop being the thing that gets exercised, and the Marketplace has to ship
 * code instead of data. Everything a designer builds emerges from these.
 */
export const TOOLBOX: readonly ToolboxEntry[] = [
  { kind: "group", section: "layout", label: "Group", hint: "A container. Layout and repeat live here." },

  { kind: "text", section: "shape", label: "Text", hint: "Words. Shaped, wrapped and fitted by the engine." },
  { kind: "rect", section: "shape", label: "Rectangle", hint: "A flat quad. The background of most graphics." },
  { kind: "ellipse", section: "shape", label: "Ellipse", hint: "A flat disc. Bugs, dots, pie segments." },

  { kind: "box", section: "3d", label: "Box", hint: "A cube. Set pieces, plinths, bars." },
  { kind: "sphere", section: "3d", label: "Sphere", hint: "A UV sphere. Balls, globes." },
  { kind: "cylinder", section: "3d", label: "Cylinder", hint: "A capped tube. Podiums, trophy stems." },
  { kind: "plane", section: "3d", label: "Plane", hint: "A ground plane facing up. The floor of a set." },

  { kind: "camera", section: "scene", label: "Camera", hint: "What an output draws through." },
  { kind: "light", section: "scene", label: "Light", hint: "Lights a lit material. Points down its own −Z." },
];

/** The default fill for anything a designer creates. */
export const DEFAULT_FILL = "#2f6feb";

/**
 * The font a new text node references.
 *
 * An asset id, not a font name: SCENE_FORMAT declares fonts as assets and the
 * engine loads binaries, because `FontFace` and `document.fonts` do not exist
 * on two of the four targets. Studio registers this id with the text provider
 * at boot, which is what makes a new text node draw immediately.
 */
export const DEFAULT_FONT_ASSET = "ast_studio_ui";

function primitiveNode(
  base: SceneNode,
  name: string,
  ids: IdFactory,
  primitive: Record<string, unknown>,
  size: { width: number; height: number },
): SceneNode {
  return {
    ...base,
    name,
    // `size` is what LAYOUT, picking and the gizmos read; the primitive spec is
    // what the projector turns into geometry. They are two consumers of the
    // same intent and both have to be written, which is the same duplication
    // `rect` already carries between `size` and its component props.
    size,
    components: [
      {
        id: ids("component"),
        type: "meshRenderer",
        props: {
          primitive,
          // `unlit` unless a designer adds metallic/roughness. A `pbr` material
          // in a scene with no light renders black, and a new object that
          // appears black looks broken rather than unlit.
          material: { baseColor: DEFAULT_FILL },
        },
      },
    ],
  };
}

export function makeNode(kind: NodeKind, order: string, ids: IdFactory): SceneNode {
  const id = ids("node");
  const base: SceneNode = {
    id,
    order,
    name: "Node",
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };

  switch (kind) {
    case "camera":
      return {
        ...base,
        name: "Camera",
        components: [
          {
            id: ids("component"),
            type: "camera",
            props: { projection: "orthographic", orthographicSize: 5, near: 0.1, far: 100 },
          },
        ],
        transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
      };

    case "light":
      return {
        ...base,
        name: "Light",
        components: [
          {
            id: ids("component"),
            type: "light",
            props: { kind: "directional", color: "#FFFFFF", intensity: 1 },
          },
        ],
        // Above and in front, aimed back at the origin by its own rotation.
        // ADR-013 amendment 1: a light carries no direction of its own, so
        // where it points is entirely this transform's business.
        transform: { position: [0, 3, 4], rotation: [-35, 0, 0], scale: [1, 1, 1] },
      };

    case "rect": {
      const width = 4;
      const height = 1;
      return {
        ...base,
        name: "Rectangle",
        size: { width, height },
        components: [
          {
            id: ids("component"),
            type: "rect",
            // Dimensions are duplicated onto the component because that is what
            // the renderer consumes; `size` is what layout and the editor use.
            props: { width, height, fill: DEFAULT_FILL },
          },
        ],
      };
    }

    case "text":
      return {
        ...base,
        name: "Text",
        // A box, because `fit` needs one. SCENE_FORMAT §7.2 makes fit REQUIRED
        // precisely so unbounded text cannot reach air.
        size: { width: 6, height: 1.2 },
        components: [
          {
            id: ids("component"),
            type: "text",
            props: {
              content: "Text",
              font: { assetId: DEFAULT_FONT_ASSET, size: 48 },
              color: "#f2f5fb",
              align: "start",
              verticalAlign: "middle",
              lineHeight: 1.2,
              // `shrink` rather than `overflow`: a name slot that must hold
              // both "Li" and "Konstantinos Papadopoulos" is the normal case in
              // broadcast, and a default that overflows is one that will one
              // day paint over the graphic beside it.
              fit: { mode: "shrink", minSize: 16 },
            },
          },
        ],
      };

    case "ellipse":
      return primitiveNode(
        base,
        "Ellipse",
        ids,
        { shape: "disc", width: 2, height: 2 },
        { width: 2, height: 2 },
      );

    case "box":
      return primitiveNode(
        base,
        "Box",
        ids,
        { shape: "box", width: 1, height: 1, depth: 1 },
        { width: 1, height: 1 },
      );

    case "sphere":
      return primitiveNode(
        base,
        "Sphere",
        ids,
        { shape: "sphere", radius: 0.5 },
        { width: 1, height: 1 },
      );

    case "cylinder":
      return primitiveNode(
        base,
        "Cylinder",
        ids,
        { shape: "cylinder", radius: 0.5, height: 1 },
        { width: 1, height: 1 },
      );

    case "plane":
      return primitiveNode(
        base,
        "Plane",
        ids,
        { shape: "plane", width: 4, depth: 4 },
        { width: 4, height: 4 },
      );

    case "group":
    default:
      // NOT `children: []`. Canonical form omits an empty array, so a group that
      // carried one would fail to round-trip the moment a child was inserted and
      // the insert undone — the document would differ by a field the format drops.
      return { ...base, name: "Group", size: { width: 4, height: 2 } };
  }
}

export function toolboxEntry(kind: NodeKind): ToolboxEntry | undefined {
  return TOOLBOX.find((entry) => entry.kind === kind);
}

export function createNode(
  document: SceneDocument,
  kind: NodeKind,
  parentId: string,
  ids: IdFactory,
): { transaction: Transaction; nodeId: string } {
  const node = makeNode(kind, orderAfterLast(document, parentId), ids);
  return {
    nodeId: node.id,
    transaction: transaction(`Add ${kind}`, [
      { type: "node.insert", parentId, node },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Deletion and duplication
// ---------------------------------------------------------------------------

/**
 * Removes nodes, skipping any that are descendants of another in the set.
 *
 * Selecting a parent and its child and pressing delete must produce ONE removal,
 * not two — the second would target a node the first already took, and the
 * engine would correctly refuse it. Filtering here rather than letting it throw
 * is the difference between a working editor and one that errors on a normal
 * gesture.
 */
export function deleteNodes(
  document: SceneDocument,
  nodeIds: readonly string[],
): Transaction | null {
  const roots = topmost(document, nodeIds).filter((id) => id !== document.root.id);
  if (roots.length === 0) return null;

  const operations = roots.map((id) => makeRemoveNode(document, id));
  return transaction(
    roots.length === 1 ? "Delete node" : `Delete ${roots.length} nodes`,
    operations,
  );
}

/** Ids in the set with no ancestor also in the set. */
export function topmost(
  document: SceneDocument,
  nodeIds: readonly string[],
): readonly string[] {
  const set = new Set(nodeIds);
  return nodeIds.filter((id) => {
    let cursor = parentOf(document.root, id);
    while (cursor !== null) {
      if (set.has(cursor.id)) return false;
      cursor = parentOf(document.root, cursor.id);
    }
    return true;
  });
}

/** A deep copy with every id reminted. Ids are identity; sharing one would alias. */
export function remintIds(node: SceneNode, ids: IdFactory): SceneNode {
  const children = childrenOf(node);
  const copy: SceneNode = {
    ...node,
    id: ids("node"),
    ...(node.components === undefined
      ? {}
      : {
          components: node.components.map((component) => ({
            ...component,
            id: ids("component"),
          })),
        }),
  };
  if (children.length === 0) {
    // Omit rather than emit an empty array — canonical form depends on it.
    if (node.children === undefined) return copy;
    const { children: _dropped, ...rest } = copy;
    return rest as SceneNode;
  }
  return { ...copy, children: children.map((child) => remintIds(child, ids)) };
}

export function duplicateNodes(
  document: SceneDocument,
  nodeIds: readonly string[],
  ids: IdFactory,
): { transaction: Transaction; nodeIds: readonly string[] } | null {
  const roots = topmost(document, nodeIds).filter((id) => id !== document.root.id);
  if (roots.length === 0) return null;

  const operations: SceneOperation[] = [];
  const created: string[] = [];
  // Order keys are per parent and must be unique. A copy that kept its
  // original's key collides with it the moment both are children of the same
  // node — caught by the engine, which refuses the insert, so the whole
  // duplicate gesture fails. Keys advance as copies are appended.
  const lastOrder = new Map<string, string | null>();

  for (const id of roots) {
    const node = findNode(document.root, id);
    const parent = parentOf(document.root, id);
    if (node === null || parent === null) continue;

    const previous =
      lastOrder.get(parent.id) ?? childrenOf(parent).at(-1)?.order ?? null;
    const order = generateKeyBetween(previous, null);
    lastOrder.set(parent.id, order);

    const copy = { ...remintIds(node, ids), order };
    created.push(copy.id);
    operations.push({ type: "node.insert", parentId: parent.id, node: copy });
  }
  if (operations.length === 0) return null;

  return {
    nodeIds: created,
    transaction: transaction(
      created.length === 1 ? "Duplicate node" : `Duplicate ${created.length} nodes`,
      operations,
    ),
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function renameNode(
  document: SceneDocument,
  nodeId: string,
  name: string,
): Transaction {
  return transaction("Rename", [makeSetProp(document, nodeId, "name", name)]);
}

/**
 * Moves a node under a parent at an index.
 *
 * Refuses to reparent a node into its own subtree. The engine would refuse too
 * — the mirror keeps that invariant — but a drag that throws mid-gesture leaves
 * the editor holding a broken drag state, so it is rejected here where it can
 * simply not happen.
 */
export function moveNode(
  document: SceneDocument,
  nodeId: string,
  parentId: string,
  index: number,
): Transaction | null {
  if (nodeId === document.root.id) return null;
  if (nodeId === parentId) return null;

  let cursor: SceneNode | null = findNode(document.root, parentId);
  while (cursor !== null) {
    if (cursor.id === nodeId) return null;
    cursor = parentOf(document.root, cursor.id);
  }

  const order = orderAtIndex(document, parentId, index, nodeId);
  const current = parentOf(document.root, nodeId);
  const node = findNode(document.root, nodeId);
  if (node === null || current === null) return null;
  // Nothing to do, and emitting it anyway would put a no-op on the undo stack.
  if (current.id === parentId && node.order === order) return null;

  return transaction("Move node", [makeMoveNode(document, nodeId, parentId, order)]);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export function setProp(
  document: SceneDocument,
  nodeId: string,
  path: string,
  value: unknown,
  label = "Set property",
): Transaction | null {
  const operation = makeSetProp(document, nodeId, path, value);
  // An edit that changes nothing must not become an undo step. Property panels
  // fire on every keystroke and on blur; without this, undo fills with no-ops.
  if (Object.is(operation.previousValue, value)) return null;
  return transaction(label, [operation]);
}

/**
 * Several properties of ONE node, as a single undo step.
 *
 * A gesture that writes two transactions undoes as two, and the user gets
 * half their camera back — orbit sets position and rotation together, and
 * pressing undo once must return the camera to where it was pointing as well
 * as where it was standing.
 *
 * Returns null when nothing actually changed, for the same reason `setProp`
 * does: an undo stack full of no-ops is an undo stack nobody trusts.
 */
export function setProps(
  document: SceneDocument,
  nodeId: string,
  values: ReadonlyMap<string, unknown>,
  label = "Set properties",
): Transaction | null {
  const operations: SceneOperation[] = [];
  for (const [path, value] of values) {
    const operation = makeSetProp(document, nodeId, path, value);
    if (Object.is(operation.previousValue, value)) continue;
    operations.push(operation);
  }
  return operations.length === 0 ? null : transaction(label, operations);
}

/** One transaction for many nodes — a multi-selection nudge is one undo step. */
export function setPropOnMany(
  document: SceneDocument,
  nodeIds: readonly string[],
  path: string,
  value: (nodeId: string) => unknown,
  label: string,
): Transaction | null {
  const operations: SceneOperation[] = [];
  for (const nodeId of nodeIds) {
    try {
      const operation = makeSetProp(document, nodeId, path, value(nodeId));
      if (!Object.is(operation.previousValue, operation.value)) operations.push(operation);
    } catch (error) {
      // A node that vanished between selection and edit is not an error worth
      // failing the whole gesture over.
      if (!(error instanceof OperationError)) throw error;
    }
  }
  return operations.length === 0 ? null : transaction(label, operations);
}

// ---------------------------------------------------------------------------
// Variables and bindings
// ---------------------------------------------------------------------------

export function defineVariable(
  key: string,
  type: VariableType,
  value: unknown,
  ids: IdFactory,
): { transaction: Transaction; variable: SceneVariable } {
  const variable: SceneVariable = {
    id: ids("variable"),
    key,
    type,
    label: key,
    default: value,
  } as SceneVariable;
  return {
    variable,
    transaction: transaction(`Define ${key}`, [{ type: "variable.define", variable }]),
  };
}

export function setVariableDefault(
  document: SceneDocument,
  variableId: string,
  value: unknown,
): Transaction | null {
  const variable = document.variables.find((entry) => entry.id === variableId);
  if (variable === undefined) return null;
  if (Object.is(variable.default, value)) return null;
  return transaction(`Set ${variable.key}`, [
    {
      type: "variable.setDefault",
      variableId,
      value,
      previousValue: variable.default,
    },
  ]);
}

export function removeVariable(
  document: SceneDocument,
  variableId: string,
): Transaction | null {
  const index = document.variables.findIndex((entry) => entry.id === variableId);
  if (index < 0) return null;
  const variable = document.variables[index]!;
  return transaction(`Remove ${variable.key}`, [
    {
      type: "variable.remove",
      variableId,
      previousVariable: variable,
      previousIndex: index,
    },
  ]);
}

/** Binds a component property to a variable. The engine resolves `{ $var }`. */
export function bindProperty(
  document: SceneDocument,
  nodeId: string,
  path: string,
  variableKey: string,
): Transaction {
  const node = findNode(document.root, nodeId);
  return transaction(`Bind to ${variableKey}`, [
    {
      type: "binding.set",
      nodeId,
      path,
      variableKey,
      previousValue: node === null ? undefined : readPath(node, path),
    },
  ]);
}

export function clearBinding(
  document: SceneDocument,
  nodeId: string,
  path: string,
  value: unknown,
): Transaction {
  const node = findNode(document.root, nodeId);
  return transaction("Clear binding", [
    {
      type: "binding.clear",
      nodeId,
      path,
      value,
      previousValue: node === null ? undefined : readPath(node, path),
    },
  ]);
}

function readPath(node: SceneNode, path: string): unknown {
  let current: unknown = node;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
