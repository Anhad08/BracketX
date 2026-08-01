import { describe, expect, it } from "vitest";

import {
  applyOperation,
  applyTransaction,
  invertTransaction,
  makeSetProp,
  type SceneOperation,
  type Transaction,
} from "./operations";
import { canonicalize, deserialize, serialize } from "./serialize";
import { generateKeyBetween } from "./order";
import { childrenOf, findNode, replaceNode, walk } from "./tree";
import { validateDocument } from "./validate";
import { makeDocument, makeNode } from "./fixtures";
import { IDENTITY_TRANSFORM } from "./types";
import type { SceneNode } from "./types";

/**
 * P-001 P9 — architectural invariants after optimization.
 *
 * The optimizations in P-001c changed how the scene graph is traversed and
 * rebuilt. These assert that none of them changed what it *means*. They are in
 * the fast suite deliberately: an invariant that only runs in a slow, separate
 * job is an invariant that breaks unnoticed.
 *
 * Each test names the property and the subsystem that depends on it, so a
 * failure says what is now broken downstream rather than only that a number
 * moved.
 */

function documentWithChild(): { document: ReturnType<typeof makeDocument>; childId: string } {
  const document = makeDocument();
  const childId = document.root.children![0]!.id;
  return { document, childId };
}

describe("immutability", () => {
  it("never mutates the input document", () => {
    const { document, childId } = documentWithChild();
    const before = canonicalize(document);

    applyOperation(document, makeSetProp(document, childId, "name", "changed"));

    // The operation returns a new document; the original is untouched. This is
    // what lets undo hold a reference rather than a deep copy.
    expect(canonicalize(document)).toBe(before);
  });

  it("never mutates the input node in replaceNode", () => {
    const { document, childId } = documentWithChild();
    const originalRoot = document.root;
    const originalChildren = originalRoot.children;

    replaceNode(originalRoot, childId, (node) => ({ ...node, name: "x" }));

    expect(document.root).toBe(originalRoot);
    expect(originalRoot.children).toBe(originalChildren);
    expect(originalRoot.children![0]!.name).not.toBe("x");
  });

  it("returns the identical root when nothing matched", () => {
    // Reference equality on a no-op is what lets a caller skip work entirely.
    const { document } = documentWithChild();
    const result = replaceNode(document.root, "nod_missing", (node) => node);
    expect(result).toBe(document.root);
  });

  it("shares the frozen empty children list without exposing it to mutation", () => {
    // childrenOf now returns one shared array for every leaf. If a caller could
    // push to it, every leaf in the process would gain a child.
    const leaf = makeNode("nod_leaf", generateKeyBetween(null, null));
    const children = childrenOf(leaf);
    expect(children).toHaveLength(0);
    expect(Object.isFrozen(children)).toBe(true);
  });
});

describe("structural sharing", () => {
  it("keeps untouched siblings by reference", () => {
    // The reconciler skips subtrees by reference comparison. If an edit
    // rebuilt siblings, projection would re-apply nodes that did not change
    // and the O(change) guarantee from Phase 2.4 would be lost.
    const document = makeDocument();
    const [first, second] = document.root.children!;

    const next = applyOperation(document, {
      type: "node.setProp",
      nodeId: first!.id,
      path: "name",
      value: "edited",
      previousValue: null,
    });

    const nextChildren = next.root.children!;
    expect(nextChildren[0]).not.toBe(first);
    expect(nextChildren[1]).toBe(second);
  });

  it("keeps untouched subtrees by reference through a deep edit", () => {
    const deep: SceneNode = {
      ...makeNode("nod_a", generateKeyBetween(null, null)),
      children: [
        {
          ...makeNode("nod_b", generateKeyBetween(null, null)),
          children: [makeNode("nod_c", generateKeyBetween(null, null))],
        },
      ],
    };
    const sibling = makeNode("nod_sibling", generateKeyBetween("zzz", null));
    const base = makeDocument();
    const document = {
      ...base,
      root: { ...base.root, children: [deep, sibling] },
    };

    const next = applyOperation(document, {
      type: "node.setProp",
      nodeId: "nod_c",
      path: "name",
      value: "edited",
      previousValue: null,
    });

    // The whole untouched branch survives by reference.
    expect(next.root.children![1]).toBe(sibling);
  });
});

describe("operation correctness", () => {
  it("still rejects a duplicate sibling order key", () => {
    // The order-key check moved inside the insertion traversal. It must still
    // fire: two siblings sharing a key have undefined relative order, which
    // breaks deterministic iteration (ENGINE_RECONCILIATION R9).
    const document = makeDocument();
    const existing = document.root.children![0]!;

    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: document.root.id,
        node: {
          id: "nod_dup",
          name: "dup",
          order: existing.order,
          transform: IDENTITY_TRANSFORM,
        },
      }),
    ).toThrow(/already used by sibling/);
  });

  it("still rejects a missing node on setProp", () => {
    // Existence now rides along with the replacement rather than preceding it.
    const document = makeDocument();
    expect(() =>
      applyOperation(document, {
        type: "node.setProp",
        nodeId: "nod_missing",
        path: "name",
        value: "x",
        previousValue: null,
      }),
    ).toThrow(/not found/);
  });

  it("still rejects a missing parent on insert", () => {
    const document = makeDocument();
    expect(() =>
      applyOperation(document, {
        type: "node.insert",
        parentId: "nod_missing",
        node: makeNode("nod_new", generateKeyBetween(null, null)),
      }),
    ).toThrow(/parent "nod_missing" not found/);
  });

  it("still rejects moving a node beneath its own descendant", () => {
    const base = makeDocument();
    const child = base.root.children![0]!;
    const grandchild = makeNode("nod_grand", generateKeyBetween(null, null));
    const document = {
      ...base,
      root: {
        ...base.root,
        children: [
          { ...child, children: [grandchild] },
          base.root.children![1]!,
        ],
      },
    };

    expect(() =>
      applyOperation(document, {
        type: "node.move",
        nodeId: child.id,
        parentId: "nod_grand",
        order: generateKeyBetween(null, null),
        previousParentId: document.root.id,
        previousOrder: child.order,
      }),
    ).toThrow(/beneath its own descendant/);
  });

  it("keeps siblings sorted after an insert in the middle", () => {
    // withChildInserted splices at the insertion point instead of appending
    // and re-sorting. The result must be identical.
    const document = makeDocument();
    const [first, second] = document.root.children!;
    const middleKey = generateKeyBetween(first!.order, second!.order);

    const next = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_middle", middleKey),
    });

    const orders = next.root.children!.map((c) => c.order);
    expect(orders).toEqual([...orders].sort());
    expect(next.root.children![1]!.id).toBe("nod_middle");
  });
});

describe("determinism", () => {
  it("produces byte-identical results for identical inputs", () => {
    const document = makeDocument();
    const operations: SceneOperation[] = [
      {
        type: "node.insert",
        parentId: document.root.id,
        node: makeNode("nod_x", generateKeyBetween("zzz", null)),
      },
      {
        type: "node.setProp",
        nodeId: document.root.children![0]!.id,
        path: "name",
        value: "renamed",
        previousValue: null,
      },
    ];
    const transaction: Transaction = {
      id: "txn_det",
      label: "determinism",
      actorId: "usr_det",
      operations,
    };

    expect(canonicalize(applyTransaction(document, transaction))).toBe(
      canonicalize(applyTransaction(document, transaction)),
    );
  });

  it("generates the same order key for the same bounds", () => {
    // generateKeyBetween must stay a pure function of its arguments, or replay
    // on another machine diverges.
    expect(generateKeyBetween("V", null)).toBe(generateKeyBetween("V", null));
    expect(generateKeyBetween(null, null)).toBe(generateKeyBetween(null, null));
    expect(generateKeyBetween("a", "c")).toBe(generateKeyBetween("a", "c"));
  });

  it("round-trips an edit and its inverse to the original bytes", () => {
    const document = makeDocument();
    const transaction: Transaction = {
      id: "txn_rt",
      label: "insert",
      actorId: "usr_rt",
      operations: [
        {
          type: "node.insert",
          parentId: document.root.id,
          node: makeNode("nod_temp", generateKeyBetween("zzz", null)),
        },
      ],
    };

    const inserted = applyTransaction(document, transaction);
    const undone = applyTransaction(inserted, invertTransaction(transaction));

    expect(canonicalize(undone)).toBe(canonicalize(document));
  });
});

describe("canonical serialization", () => {
  it("survives a serialize/deserialize round trip", () => {
    const document = makeDocument();
    const next = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_ser", generateKeyBetween("zzz", null)),
    });

    expect(canonicalize(deserialize(serialize(next)))).toBe(canonicalize(next));
  });

  it("produces identical bytes regardless of construction order", () => {
    // Two documents reaching the same state by different routes must
    // canonicalize identically, or hashing and deduplication break.
    const base = makeDocument();
    const key = generateKeyBetween("zzz", null);

    const routeA = applyOperation(
      applyOperation(base, {
        type: "node.insert",
        parentId: base.root.id,
        node: makeNode("nod_p", key),
      }),
      {
        type: "node.setProp",
        nodeId: "nod_p",
        path: "name",
        value: "final",
        previousValue: null,
      },
    );

    const routeB = applyOperation(base, {
      type: "node.insert",
      parentId: base.root.id,
      node: { ...makeNode("nod_p", key), name: "final" },
    });

    expect(canonicalize(routeA)).toBe(canonicalize(routeB));
  });

  it("keeps an optimized document valid", () => {
    const document = makeDocument();
    const next = applyOperation(document, {
      type: "node.insert",
      parentId: document.root.id,
      node: makeNode("nod_v", generateKeyBetween("zzz", null)),
    });
    expect(validateDocument(next).valid).toBe(true);
  });
});

describe("iteration order", () => {
  it("walks parents before children, children in order-key order", () => {
    const document = makeDocument();
    const seen = [...walk(document.root)].map((n) => n.id);
    expect(seen[0]).toBe(document.root.id);

    for (const node of walk(document.root)) {
      const children = childrenOf(node);
      for (let i = 1; i < children.length; i += 1) {
        expect(children[i - 1]!.order < children[i]!.order).toBe(true);
      }
    }
  });

  it("sorts defensively when a document arrives out of order", () => {
    // Documents come from disk and from other clients. The defensive sort in
    // childrenOf is what makes iteration deterministic regardless.
    const base = makeDocument();
    const [first, second] = base.root.children!;
    const scrambled = { ...base.root, children: [second!, first!] };

    const ordered = childrenOf(scrambled).map((c) => c.id);
    expect(ordered).toEqual([first!.id, second!.id]);
  });

  it("finds a node regardless of sibling position", () => {
    const document = makeDocument();
    for (const child of document.root.children!) {
      expect(findNode(document.root, child.id)!.id).toBe(child.id);
    }
    expect(findNode(document.root, "nod_absent")).toBeNull();
  });
});
