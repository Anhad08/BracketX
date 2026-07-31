import { describe, expect, it } from "vitest";

import {
  makeDocument,
  makeNode,
  makeTextDocument,
  nextOrderKey,
} from "./fixtures";
import { generateKeyBetween } from "./order";
import {
  OperationError,
  applyOperation,
  applyTransaction,
  invertOperation,
  invertTransaction,
  makeMoveNode,
  makeRemoveNode,
  makeSetProp,
  type SceneOperation,
  type Transaction,
} from "./operations";
import { canonicalize } from "./serialize";
import { childrenOf, findNode } from "./tree";
import type { SceneDocument } from "./types";

/**
 * The invariant every operation must satisfy, and the reason operations exist
 * at all: applying an operation and then its inverse must restore the document
 * exactly. RFC-002 §5 — inversion is total and independent of replay order.
 */
function expectRoundTrip(document: SceneDocument, operation: SceneOperation) {
  const before = canonicalize(document);
  const applied = applyOperation(document, operation);
  const restored = applyOperation(applied, invertOperation(operation));
  expect(canonicalize(restored)).toBe(before);
}

describe("node.insert", () => {
  it("adds a node under its parent", () => {
    const document = makeDocument();
    const child = makeNode("nod_new", nextOrderKey(document.root));
    const next = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: child,
    });
    expect(findNode(next.root, "nod_new")).toBeTruthy();
  });

  it("round-trips through its inverse", () => {
    const document = makeDocument();
    expectRoundTrip(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_new", nextOrderKey(document.root)),
    });
  });

  it("rejects a duplicate id", () => {
    const document = makeDocument();
    const existing = childrenOf(document.root)[0]!;
    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: document.root.id,
        node: makeNode(existing.id, nextOrderKey(document.root)),
      }),
    ).toThrow(OperationError);
  });

  it("rejects an unknown parent", () => {
    const document = makeDocument();
    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: "nod_missing",
        node: makeNode("nod_new", generateKeyBetween(null, null)),
      }),
    ).toThrow(OperationError);
  });

  it("rejects an order key already used by a sibling", () => {
    // Two siblings sharing an order key have undefined relative order, which
    // makes iteration non-deterministic and breaks ENGINE_RECONCILIATION R9.
    // An operation must not be able to produce a document that fails
    // validation. Found by a test whose fixture collided by accident.
    const document = makeDocument();
    const existing = childrenOf(document.root)[0]!;
    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: document.root.id,
        node: makeNode("nod_clash", existing.order),
      }),
    ).toThrow(OperationError);
  });

  it("allows the same order key under a different parent", () => {
    // Order keys are scoped to a sibling set, not the document.
    const document = makeDocument();
    const [a, b] = childrenOf(document.root);
    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: a!.id,
        node: makeNode("nod_same_key", b!.order),
      }),
    ).not.toThrow();
  });

  it("keeps children sorted by order key", () => {
    const document = makeDocument();
    const [first, second] = childrenOf(document.root);
    const between = generateKeyBetween(first!.order, second!.order);
    const next = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_mid", between),
    });
    expect(childrenOf(next.root).map((c) => c.id)).toEqual([
      first!.id,
      "nod_mid",
      second!.id,
    ]);
  });
});

describe("node.remove", () => {
  it("removes the node and round-trips", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const operation = makeRemoveNode(document, target.id);
    const next = applyOperation(document, operation);
    expect(findNode(next.root, target.id)).toBeNull();
    expectRoundTrip(document, operation);
  });

  it("restores an entire subtree on inverse", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const withGrandchild = applyOperation(document, {
      type: "node.insert",
      parentId: target.id,
      node: makeNode("nod_deep", generateKeyBetween(null, null)),
    });
    const operation = makeRemoveNode(withGrandchild, target.id);
    const removed = applyOperation(withGrandchild, operation);
    expect(findNode(removed.root, "nod_deep")).toBeNull();

    const restored = applyOperation(removed, invertOperation(operation));
    expect(findNode(restored.root, "nod_deep")).toBeTruthy();
  });

  it("refuses to remove the root", () => {
    const document = makeDocument();
    expect(() => makeRemoveNode(document, document.root.id)).toThrow(
      OperationError,
    );
  });

  it("rejects an unknown node", () => {
    const document = makeDocument();
    expect(() => makeRemoveNode(document, "nod_missing")).toThrow(
      OperationError,
    );
  });
});

describe("node.move", () => {
  it("reparents and round-trips", () => {
    const document = makeDocument();
    const [a, b] = childrenOf(document.root);
    const operation = makeMoveNode(
      document,
      b!.id,
      a!.id,
      generateKeyBetween(null, null),
    );
    const next = applyOperation(document, operation);
    expect(childrenOf(findNode(next.root, a!.id)!).map((c) => c.id)).toEqual([
      b!.id,
    ]);
    expectRoundTrip(document, operation);
  });

  it("reorders within the same parent", () => {
    const document = makeDocument();
    const [a, b] = childrenOf(document.root);
    const operation = makeMoveNode(
      document,
      b!.id,
      document.root.id,
      generateKeyBetween(null, a!.order),
    );
    const next = applyOperation(document, operation);
    expect(childrenOf(next.root).map((c) => c.id)).toEqual([b!.id, a!.id]);
  });

  it("rejects a move onto an order key a sibling already holds", () => {
    const document = makeDocument();
    const [a, b] = childrenOf(document.root);
    const withChild = applyOperation(document, {
      type: "node.insert",
      parentId: a!.id,
      node: makeNode("nod_inner", generateKeyBetween(null, null)),
    });
    const inner = findNode(withChild.root, "nod_inner")!;
    expect(() =>
      applyOperation(
        withChild,
        makeMoveNode(withChild, inner.id, document.root.id, b!.order),
      ),
    ).toThrow(OperationError);
  });

  it("allows a move that keeps the node's own order key", () => {
    // Reordering within the same parent must not collide with itself.
    const document = makeDocument();
    const a = childrenOf(document.root)[0]!;
    expect(() =>
      applyOperation(
        document,
        makeMoveNode(document, a.id, document.root.id, a.order),
      ),
    ).not.toThrow();
  });

  it("refuses to move a node beneath its own descendant", () => {
    // Would detach the subtree from the root and silently lose it.
    const document = makeDocument();
    const parent = childrenOf(document.root)[0]!;
    const withChild = applyOperation(document, {
      type: "node.insert",
      parentId: parent.id,
      node: makeNode("nod_child", generateKeyBetween(null, null)),
    });
    expect(() =>
      applyOperation(
        withChild,
        makeMoveNode(
          withChild,
          parent.id,
          "nod_child",
          generateKeyBetween(null, null),
        ),
      ),
    ).toThrow(OperationError);
  });
});

describe("node.setProp", () => {
  it("sets a nested property and round-trips", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const operation = makeSetProp(
      document,
      target.id,
      "transform.position",
      [1, 2, 3],
    );
    const next = applyOperation(document, operation);
    expect(findNode(next.root, target.id)!.transform!.position).toEqual([
      1, 2, 3,
    ]);
    expectRoundTrip(document, operation);
  });

  it("sets an array element by index", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const operation = makeSetProp(document, target.id, "transform.position.1", 5);
    const next = applyOperation(document, operation);
    expect(findNode(next.root, target.id)!.transform!.position).toEqual([
      0, 5, 0,
    ]);
    expectRoundTrip(document, operation);
  });

  it("does not mutate the input document", () => {
    // Structural sharing is what lets the reconciler skip untouched subtrees
    // by reference; in-place mutation would silently break that.
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const before = canonicalize(document);
    applyOperation(
      document,
      makeSetProp(document, target.id, "name", "changed"),
    );
    expect(canonicalize(document)).toBe(before);
  });

  it("shares untouched subtrees by reference", () => {
    const document = makeDocument();
    const [a, b] = childrenOf(document.root);
    const next = applyOperation(
      document,
      makeSetProp(document, a!.id, "name", "changed"),
    );
    expect(findNode(next.root, b!.id)).toBe(b);
  });

  it("rejects a path through Object.prototype", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    expect(() =>
      applyOperation(document, {
        type: "node.setProp",
        nodeId: target.id,
        path: "__proto__.polluted",
        value: true,
        previousValue: undefined,
      }),
    ).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("variable operations", () => {
  const variable = {
    id: "var_0001",
    key: "score",
    type: "number" as const,
    label: "Score",
    default: 0,
  };

  it("defines and round-trips", () => {
    const document = makeDocument();
    expectRoundTrip(document, { type: "variable.define", variable });
  });

  it("rejects a duplicate key", () => {
    const document = applyOperation(makeDocument(), {
      type: "variable.define",
      variable,
    });
    expect(() =>
      applyOperation(document, {
        type: "variable.define",
        variable: { ...variable, id: "var_0002" },
      }),
    ).toThrow(OperationError);
  });

  it("sets a default and round-trips", () => {
    const document = applyOperation(makeDocument(), {
      type: "variable.define",
      variable,
    });
    expectRoundTrip(document, {
      type: "variable.setDefault",
      variableId: variable.id,
      value: 42,
      previousValue: 0,
    });
  });

  it("rejects setting a default on an unknown variable", () => {
    expect(() =>
      applyOperation(makeDocument(), {
        type: "variable.setDefault",
        variableId: "var_missing",
        value: 1,
        previousValue: 0,
      }),
    ).toThrow(OperationError);
  });
});

describe("binding operations", () => {
  it("binds a property and round-trips", () => {
    const document = makeTextDocument();
    const node = childrenOf(document.root)[0]!;
    const path = "components.0.props.color";
    expectRoundTrip(document, {
      type: "binding.set",
      nodeId: node.id,
      path,
      variableKey: "playerName",
      previousValue: "#FFFFFF",
    });
  });

  it("clears a binding back to a literal", () => {
    const document = makeTextDocument();
    const node = childrenOf(document.root)[0]!;
    const next = applyOperation(document, {
      type: "binding.clear",
      nodeId: node.id,
      path: "components.0.props.content",
      value: "STATIC",
      previousValue: { $var: "playerName" },
    });
    const component = findNode(next.root, node.id)!.components![0]!;
    expect((component.props as { content: unknown }).content).toBe("STATIC");
  });
});

describe("transactions", () => {
  it("applies operations in order", () => {
    const document = makeDocument();
    const transaction: Transaction = {
      id: "txn_1",
      label: "Add two nodes",
      actorId: "user_test",
      operations: [
        {
          type: "node.insert",
          parentId: document.root.id,
          node: makeNode("nod_added_a", nextOrderKey(document.root)),
        },
        {
          type: "node.insert",
          parentId: document.root.id,
          node: makeNode("nod_added_b", generateKeyBetween("a", null)),
        },
      ],
    };
    expect(childrenOf(applyTransaction(document, transaction).root)).toHaveLength(
      4,
    );
  });

  it("round-trips through its inverse", () => {
    const document = makeDocument();
    const target = childrenOf(document.root)[0]!;
    const transaction: Transaction = {
      id: "txn_1",
      label: "Rename and move",
      actorId: "user_test",
      operations: [
        makeSetProp(document, target.id, "name", "renamed"),
        {
          type: "node.insert",
          parentId: target.id,
          node: makeNode("nod_extra", generateKeyBetween(null, null)),
        },
      ],
    };

    const before = canonicalize(document);
    const applied = applyTransaction(document, transaction);
    const restored = applyTransaction(applied, invertTransaction(transaction));
    expect(canonicalize(restored)).toBe(before);
  });

  it("inverts operations in reverse order", () => {
    // A later operation may depend on an earlier one, so undoing forwards
    // would attempt to remove a parent before its child.
    const document = makeDocument();
    const transaction: Transaction = {
      id: "txn_1",
      label: "Nested insert",
      actorId: "user_test",
      operations: [
        {
          type: "node.insert",
          parentId: document.root.id,
          node: makeNode("nod_parent", nextOrderKey(document.root)),
        },
        {
          type: "node.insert",
          parentId: "nod_parent",
          node: makeNode("nod_child", generateKeyBetween(null, null)),
        },
      ],
    };

    const applied = applyTransaction(document, transaction);
    expect(() =>
      applyTransaction(applied, invertTransaction(transaction)),
    ).not.toThrow();
  });

  it("carries an actorId, for later actor-filtered undo", () => {
    // RFC-002 §7: present from the start so collaboration does not need a
    // migration. Unused in v1 by design.
    const transaction: Transaction = {
      id: "txn_1",
      label: "Anything",
      actorId: "user_alice",
      operations: [],
    };
    expect(invertTransaction(transaction).actorId).toBe("user_alice");
  });
});
