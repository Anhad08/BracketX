/**
 * Operations — the only path by which a document may mutate.
 *
 * RFC-002 §4.3, as corrected: this covers the DOCUMENT domain. Runtime state
 * (current variable values, active states, playhead) is mutated by commands in
 * @bracketx/engine-runtime and is neither undoable nor persisted.
 *
 * Every operation carries enough prior state to invert itself without
 * consulting the document, so inversion is total and independent of replay
 * order (RFC-002 §5).
 *
 * Animation operations (`anim.*`) are declared in RFC-002 §5 but implemented
 * with the Animation Engine in Phase 5. Adding a member to this union later is
 * additive and breaks nothing.
 */
import { getAtPath, setAtPath } from "./property-path";
import {
  findNode,
  parentOf,
  removeNode,
  replaceNode,
  withChildInserted,
} from "./tree";
import type { SceneDocument, SceneNode, SceneVariable } from "./types";

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export interface NodeInsertOperation {
  readonly type: "node.insert";
  readonly parentId: string;
  readonly node: SceneNode;
}

export interface NodeRemoveOperation {
  readonly type: "node.remove";
  readonly nodeId: string;
  /** Prior state, for inversion. */
  readonly previousParentId: string;
  readonly previousNode: SceneNode;
}

export interface NodeMoveOperation {
  readonly type: "node.move";
  readonly nodeId: string;
  readonly parentId: string;
  readonly order: string;
  readonly previousParentId: string;
  readonly previousOrder: string;
}

export interface NodeSetPropOperation {
  readonly type: "node.setProp";
  readonly nodeId: string;
  /** Dot path relative to the node. */
  readonly path: string;
  readonly value: unknown;
  readonly previousValue: unknown;
}

export interface VariableDefineOperation {
  readonly type: "variable.define";
  readonly variable: SceneVariable;
}

export interface VariableRemoveOperation {
  readonly type: "variable.remove";
  readonly variableId: string;
  readonly previousVariable: SceneVariable;
  readonly previousIndex: number;
}

export interface VariableSetDefaultOperation {
  readonly type: "variable.setDefault";
  readonly variableId: string;
  readonly value: unknown;
  readonly previousValue: unknown;
}

export interface BindingSetOperation {
  readonly type: "binding.set";
  readonly nodeId: string;
  readonly path: string;
  readonly variableKey: string;
  readonly previousValue: unknown;
}

export interface BindingClearOperation {
  readonly type: "binding.clear";
  readonly nodeId: string;
  readonly path: string;
  readonly value: unknown;
  readonly previousValue: unknown;
}

export interface DocSetMetaOperation {
  readonly type: "doc.setMeta";
  readonly path: string;
  readonly value: unknown;
  readonly previousValue: unknown;
}

export type SceneOperation =
  | NodeInsertOperation
  | NodeRemoveOperation
  | NodeMoveOperation
  | NodeSetPropOperation
  | VariableDefineOperation
  | VariableRemoveOperation
  | VariableSetDefaultOperation
  | BindingSetOperation
  | BindingClearOperation
  | DocSetMetaOperation;

/**
 * One undo step. RFC-002 §6 — users think in intentions, not primitives, so a
 * grouping action is one transaction regardless of how many operations it
 * contains.
 *
 * `actorId` is present from the start. It costs one field and is what makes
 * actor-filtered undo possible later without a migration (RFC-002 §7).
 */
export interface Transaction {
  readonly id: string;
  readonly label: string;
  readonly actorId: string;
  readonly operations: readonly SceneOperation[];
}

// ---------------------------------------------------------------------------
// Inversion
// ---------------------------------------------------------------------------

export function invertOperation(operation: SceneOperation): SceneOperation {
  switch (operation.type) {
    case "node.insert":
      return {
        type: "node.remove",
        nodeId: operation.node.id,
        previousParentId: operation.parentId,
        previousNode: operation.node,
      };
    case "node.remove":
      return {
        type: "node.insert",
        parentId: operation.previousParentId,
        node: operation.previousNode,
      };
    case "node.move":
      return {
        type: "node.move",
        nodeId: operation.nodeId,
        parentId: operation.previousParentId,
        order: operation.previousOrder,
        previousParentId: operation.parentId,
        previousOrder: operation.order,
      };
    case "node.setProp":
      return {
        type: "node.setProp",
        nodeId: operation.nodeId,
        path: operation.path,
        value: operation.previousValue,
        previousValue: operation.value,
      };
    case "variable.define":
      return {
        type: "variable.remove",
        variableId: operation.variable.id,
        previousVariable: operation.variable,
        // Appended, so the inverse removes from the end.
        previousIndex: -1,
      };
    case "variable.remove":
      return { type: "variable.define", variable: operation.previousVariable };
    case "variable.setDefault":
      return {
        type: "variable.setDefault",
        variableId: operation.variableId,
        value: operation.previousValue,
        previousValue: operation.value,
      };
    case "binding.set":
      return {
        type: "binding.clear",
        nodeId: operation.nodeId,
        path: operation.path,
        value: operation.previousValue,
        previousValue: { $var: operation.variableKey },
      };
    case "binding.clear":
      return {
        type: "node.setProp",
        nodeId: operation.nodeId,
        path: operation.path,
        value: operation.previousValue,
        previousValue: operation.value,
      };
    case "doc.setMeta":
      return {
        type: "doc.setMeta",
        path: operation.path,
        value: operation.previousValue,
        previousValue: operation.value,
      };
  }
}

export function invertTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    id: `${transaction.id}:inverse`,
    label: transaction.label,
    // Reverse order: later operations may depend on earlier ones.
    operations: [...transaction.operations].reverse().map(invertOperation),
  };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function requireNode(document: SceneDocument, nodeId: string): SceneNode {
  const node = findNode(document.root, nodeId);
  if (!node) throw new OperationError(`node "${nodeId}" not found`);
  return node;
}

/**
 * Rejects an order key already used by a sibling.
 *
 * Two siblings sharing an order key have undefined relative order, which makes
 * the tree non-deterministic to iterate and breaks ENGINE_RECONCILIATION
 * invariant R9 (build and project must produce identical mirrors). An
 * operation must not be able to produce a document that fails validation.
 */
function assertOrderKeyFreeIn(
  parent: SceneNode,
  order: string,
  exceptNodeId?: string,
): void {
  for (const child of parent.children ?? []) {
    if (child.id === exceptNodeId) continue;
    if (child.order === order) {
      throw new OperationError(
        `order key "${order}" is already used by sibling "${child.id}" ` +
          `under parent "${parent.id}"`,
      );
    }
  }
}

/**
 * Applies `update` to one node.
 *
 * The existence check rides along with the replacement rather than preceding
 * it. Calling requireNode first and then replaceNode walked the tree twice for
 * one edit, and requireNode was 13.1% of engine-scene self time in the
 * baseline profile (P-001 P1). The replacer only runs when the node is found,
 * so the flag is an exact existence test, not an approximation of one.
 */
function updateNode(
  document: SceneDocument,
  nodeId: string,
  update: (node: SceneNode) => SceneNode,
): SceneDocument {
  let found = false;
  const root = replaceNode(document.root, nodeId, (node) => {
    found = true;
    return update(node);
  });
  if (!found) throw new OperationError(`node "${nodeId}" not found`);
  if (root === null) {
    throw new OperationError(`updating "${nodeId}" removed the root`);
  }
  return { ...document, root };
}

export function applyOperation(
  document: SceneDocument,
  operation: SceneOperation,
): SceneDocument {
  switch (operation.type) {
    case "node.insert": {
      if (findNode(document.root, operation.node.id)) {
        throw new OperationError(`node "${operation.node.id}" already exists`);
      }
      // Finding the parent, checking its children for a duplicate order key,
      // and inserting are one traversal. Previously three (P-001 P5).
      let parentFound = false;
      const root = replaceNode(document.root, operation.parentId, (parent) => {
        parentFound = true;
        assertOrderKeyFreeIn(parent, operation.node.order);
        return withChildInserted(parent, operation.node);
      });
      if (!parentFound) {
        throw new OperationError(`parent "${operation.parentId}" not found`);
      }
      if (root === null) {
        throw new OperationError(
          `inserting "${operation.node.id}" removed the root`,
        );
      }
      return { ...document, root };
    }

    case "node.remove": {
      requireNode(document, operation.nodeId);
      return { ...document, root: removeNode(document.root, operation.nodeId) };
    }

    case "node.move": {
      const node = requireNode(document, operation.nodeId);
      // Reparenting a node beneath itself would detach the subtree from the
      // root and lose it. Cheaper to reject than to detect afterwards.
      if (findNode(node, operation.parentId)) {
        throw new OperationError(
          `cannot move "${operation.nodeId}" beneath its own descendant`,
        );
      }
      const detached = removeNode(document.root, operation.nodeId);
      const moved: SceneNode = { ...node, order: operation.order };

      // As with insert: locating the new parent, validating its order keys,
      // and attaching are one traversal rather than three.
      let parentFound = false;
      const root = replaceNode(detached, operation.parentId, (parent) => {
        parentFound = true;
        assertOrderKeyFreeIn(parent, operation.order);
        return withChildInserted(parent, moved);
      });
      if (!parentFound) {
        throw new OperationError(`parent "${operation.parentId}" not found`);
      }
      if (root === null) {
        throw new OperationError(`moving "${operation.nodeId}" removed the root`);
      }
      return { ...document, root };
    }

    case "node.setProp":
    case "binding.clear": {
      // updateNode reports a missing node itself; a separate lookup first
      // would walk the whole tree a second time for the same answer.
      return updateNode(document, operation.nodeId, (node) =>
        setAtPath(node, operation.path, operation.value),
      );
    }

    case "binding.set": {
      return updateNode(document, operation.nodeId, (node) =>
        setAtPath(node, operation.path, { $var: operation.variableKey }),
      );
    }

    case "variable.define": {
      if (document.variables.some((v) => v.id === operation.variable.id)) {
        throw new OperationError(
          `variable "${operation.variable.id}" already exists`,
        );
      }
      if (document.variables.some((v) => v.key === operation.variable.key)) {
        throw new OperationError(
          `variable key "${operation.variable.key}" is already in use`,
        );
      }
      return {
        ...document,
        variables: [...document.variables, operation.variable],
      };
    }

    case "variable.remove": {
      const index = document.variables.findIndex(
        (v) => v.id === operation.variableId,
      );
      if (index === -1) {
        throw new OperationError(
          `variable "${operation.variableId}" not found`,
        );
      }
      const variables = [...document.variables];
      variables.splice(index, 1);
      return { ...document, variables };
    }

    case "variable.setDefault": {
      const index = document.variables.findIndex(
        (v) => v.id === operation.variableId,
      );
      if (index === -1) {
        throw new OperationError(
          `variable "${operation.variableId}" not found`,
        );
      }
      const variables = [...document.variables];
      variables[index] = { ...variables[index]!, default: operation.value };
      return { ...document, variables };
    }

    case "doc.setMeta": {
      // The tree belongs to the node operations. A path-set into `root` would
      // bypass the invariants those maintain — order keys, parentage, id
      // uniqueness — and produce a document the mirror cannot project. Found
      // while wiring Studio's timeline, which needed document-level paths and
      // could have reached the tree with them.
      const head = operation.path.split(".")[0];
      if (head === "root" || head === "format" || head === "version" || head === "id") {
        throw new OperationError(
          `doc.setMeta must not write "${head}"; use the node operations`,
        );
      }
      return setAtPath(document, operation.path, operation.value);
    }
  }
}

export function applyTransaction(
  document: SceneDocument,
  transaction: Transaction,
): SceneDocument {
  let next = document;
  for (const operation of transaction.operations) {
    next = applyOperation(next, operation);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Construction helpers — capture prior state so inverses are total
// ---------------------------------------------------------------------------

export function makeSetProp(
  document: SceneDocument,
  nodeId: string,
  path: string,
  value: unknown,
): NodeSetPropOperation {
  const node = requireNode(document, nodeId);
  return {
    type: "node.setProp",
    nodeId,
    path,
    value,
    previousValue: getAtPath(node, path),
  };
}

export function makeRemoveNode(
  document: SceneDocument,
  nodeId: string,
): NodeRemoveOperation {
  const node = requireNode(document, nodeId);
  const parent = parentOf(document.root, nodeId);
  if (!parent) {
    throw new OperationError(`node "${nodeId}" has no parent (is it the root?)`);
  }
  return {
    type: "node.remove",
    nodeId,
    previousParentId: parent.id,
    previousNode: node,
  };
}

/**
 * A document-level property set, capturing the prior value so it inverts.
 *
 * `doc.setMeta` is named for its first consumer and has always addressed the
 * whole document — `animations.0.tracks.1.keyframes.2.time` is as valid as
 * `meta.name`. That is what makes a timeline editable through the operation
 * system rather than through a second mechanism, and it is why Studio needed no
 * new operation type for it. The name stays: renaming a serialised operation is
 * a format break, and the doc comment is cheaper than a migration.
 */
export function makeSetDocProp(
  document: SceneDocument,
  path: string,
  value: unknown,
): DocSetMetaOperation {
  return {
    type: "doc.setMeta",
    path,
    value,
    previousValue: getAtPath(document, path),
  };
}

export function makeMoveNode(
  document: SceneDocument,
  nodeId: string,
  parentId: string,
  order: string,
): NodeMoveOperation {
  const node = requireNode(document, nodeId);
  const parent = parentOf(document.root, nodeId);
  if (!parent) {
    throw new OperationError(`node "${nodeId}" has no parent (is it the root?)`);
  }
  return {
    type: "node.move",
    nodeId,
    parentId,
    order,
    previousParentId: parent.id,
    previousOrder: node.order,
  };
}
