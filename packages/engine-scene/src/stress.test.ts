import { describe, expect, it } from "vitest";

import {
  applyOperation,
  applyTransaction,
  invertTransaction,
  type SceneOperation,
  type Transaction,
} from "./operations";
import { canonicalize, serialize } from "./serialize";
import { generateKeyBetween, generateNKeysBetween } from "./order";
import {
  countNodes,
  findNode,
  parentOf,
  pathToNode,
  removeNode,
  replaceNode,
  walk,
} from "./tree";
import { validateDocument } from "./validate";
import { IDENTITY_TRANSFORM } from "./types";
import type { SceneNode } from "./types";
import { changedNodeCount, fastest, generateScene } from "./perf-support";

/**
 * P-001 P6/P7 — stress and regression protection.
 *
 * Run: pnpm --filter @bracketx/engine-scene test:stress
 *
 * These assert the SHAPE of the cost, never a machine-specific millisecond
 * figure — a wall-clock threshold would be flaky on a loaded CI box and
 * useless on a faster one. What they pin down is the property that was
 * actually broken: cost must not grow faster than the scene does.
 *
 * Each guard names the defect it protects against, so a future failure is a
 * diagnosis rather than a puzzle.
 */

const SIZES = [10_000, 50_000, 100_000] as const;

/** Ratio of measured cost between two sizes, normalised by the size ratio. */
function growthFactor(
  small: number,
  large: number,
  cost: (size: number) => number,
): number {
  const costSmall = Math.max(cost(small), 0.01);
  const costLarge = cost(large);
  return costLarge / costSmall / (large / small);
}

// ---------------------------------------------------------------------------
// P7 — scale across every shape
// ---------------------------------------------------------------------------

describe("scale", () => {
  for (const shape of ["wide", "balanced", "mixed"] as const) {
    for (const size of SIZES) {
      it(`${shape}: builds and edits ${size.toLocaleString("en-US")} nodes`, () => {
        const scene = generateScene(shape, size);
        expect(countNodes(scene.document.root)).toBe(size);

        const target = scene.ids[Math.floor(scene.ids.length / 2)]!;
        const next = applyOperation(scene.document, {
          type: "node.setProp",
          nodeId: target,
          path: "name",
          value: "edited",
          previousValue: null,
        });

        expect(findNode(next.root, target)!.name).toBe("edited");
        // The edit must not disturb the rest of the document.
        expect(countNodes(next.root)).toBe(size);
      });
    }
  }

  // Deep trees have a hard recursion ceiling, measured in limits.perf.ts.
  // Testing them at 100k would assert that a known limitation is absent.
  it("deep: handles the deepest hierarchy the recursion allows", () => {
    // 3,000 sits under the lowest traversal ceiling measured in
    // limits.perf.ts (countNodes overflows at ~3,520). Testing deeper would
    // assert that a known, documented limitation is absent.
    const scene = generateScene("deep", 3_000);
    expect(countNodes(scene.document.root)).toBe(3_000);
    expect(scene.depth).toBe(3_000);

    const target = scene.ids[scene.ids.length - 1]!;
    const path = pathToNode(scene.document.root, target);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2_999);
  });
});

// ---------------------------------------------------------------------------
// P6 — regression guards
// ---------------------------------------------------------------------------

describe("cost shape", () => {
  it("order keys stay short when appending siblings", () => {
    // REGRESSION GUARD for the largest defect P-001 found. Minting the
    // midpoint between a key and "after everything" grew keys by one character
    // per five appends: 40,000 appends produced an 8,000-character key, which
    // made sibling arrays hold O(n²) characters and every scan quadratic.
    let key: string | null = null;
    for (let i = 0; i < 40_000; i += 1) key = generateKeyBetween(key, null);

    // Incrementing gives ~n/61. The midpoint form would be ~8,000 here.
    expect(key!.length).toBeLessThan(1_000);

    // Batch generation must stay logarithmic.
    const batch = generateNKeysBetween(null, null, 40_000);
    expect(Math.max(...batch.map((k) => k.length))).toBeLessThan(8);
  });

  it("appending siblings does not overflow the stack", () => {
    // The baseline could not complete an 80,000-node scaling fit: midpoint()
    // recursed once per character of an ever-growing key.
    let key: string | null = null;
    expect(() => {
      for (let i = 0; i < 100_000; i += 1) key = generateKeyBetween(key, null);
    }).not.toThrow();
  });

  it("generated order keys are strictly increasing", () => {
    // Correctness guard beside the performance one: a shorter key is worthless
    // if it sorts wrongly. Sibling order is what makes projection deterministic
    // (ENGINE_RECONCILIATION R9).
    let key: string | null = null;
    let previous: string | null = null;
    for (let i = 0; i < 20_000; i += 1) {
      previous = key;
      key = generateKeyBetween(key, null);
      if (previous !== null) expect(key > previous).toBe(true);
    }
  });

  it("an edit rebuilds only the ancestor path", () => {
    // REGRESSION GUARD for structural sharing. This is the property the
    // reconciler depends on to skip subtrees by reference comparison — if an
    // edit rebuilt unrelated nodes, projection would re-apply the whole scene.
    for (const shape of ["wide", "balanced", "mixed"] as const) {
      const scene = generateScene(shape, 50_000);
      const target = scene.ids[Math.floor(scene.ids.length / 2)]!;
      const before = scene.document.root;
      const after = applyOperation(scene.document, {
        type: "node.setProp",
        nodeId: target,
        path: "name",
        value: "edited",
        previousValue: null,
      }).root;

      // Only the target and its ancestors may change identity.
      const rebuilt = changedNodeCount(before, after);
      const depth = (pathToNode(before, target)?.length ?? 0) + 1;
      expect(rebuilt).toBeLessThanOrEqual(depth);
    }
  });

  it("edit cost grows no faster than the scene", () => {
    // REGRESSION GUARD for the O(scene)-with-a-quadratic-constant behaviour.
    // Before P-001, going from 10k to 50k wide (5x) cost 26x more.
    const editCost = (size: number) => {
      const scene = generateScene("wide", size);
      const target = scene.ids[Math.floor(scene.ids.length / 2)]!;
      const operation: SceneOperation = {
        type: "node.setProp",
        nodeId: target,
        path: "name",
        value: "edited",
        previousValue: null,
      };
      return fastest(5, () => {
        applyOperation(scene.document, operation);
      });
    };

    // Linear is 1.0. Generous headroom for allocator and cache effects, but
    // far below the ~5x normalised growth the quadratic form produced.
    expect(growthFactor(10_000, 50_000, editCost)).toBeLessThan(2.5);
  });

  it("lookup cost grows no faster than the scene", () => {
    const lookupCost = (size: number) => {
      const scene = generateScene("wide", size);
      const target = scene.ids[scene.ids.length - 1]!;
      return fastest(5, () => {
        findNode(scene.document.root, target);
      });
    };
    expect(growthFactor(10_000, 50_000, lookupCost)).toBeLessThan(2.5);
  });

  it("insertion cost grows no faster than the scene", () => {
    const insertCost = (size: number) => {
      const scene = generateScene("wide", size);
      const children = scene.document.root.children ?? [];
      const last = children.length > 0 ? children[children.length - 1]!.order : null;
      const node: SceneNode = {
        id: "nod_stress_insert",
        name: "inserted",
        order: generateKeyBetween(last, null),
        transform: IDENTITY_TRANSFORM,
      };
      return fastest(5, () => {
        applyOperation(scene.document, {
          type: "node.insert",
          parentId: scene.document.root.id,
          node,
        });
      });
    };
    expect(growthFactor(10_000, 50_000, insertCost)).toBeLessThan(2.5);
  });

  it("serialization grows no faster than the scene", () => {
    const cost = (size: number) => {
      const scene = generateScene("balanced", size);
      return fastest(3, () => {
        serialize(scene.document);
      });
    };
    expect(growthFactor(10_000, 50_000, cost)).toBeLessThan(2.5);
  });

  it("validation grows no faster than the scene", () => {
    const cost = (size: number) => {
      const scene = generateScene("balanced", size);
      return fastest(3, () => {
        validateDocument(scene.document);
      });
    };
    expect(growthFactor(10_000, 50_000, cost)).toBeLessThan(2.5);
  });
});

// ---------------------------------------------------------------------------
// P6 — correctness under repeated and random edits
// ---------------------------------------------------------------------------

describe("repeated edits", () => {
  it("replays a 500-operation transaction without drift", () => {
    const scene = generateScene("balanced", 50_000);
    const operations: SceneOperation[] = [];
    for (let i = 0; i < 500; i += 1) {
      operations.push({
        type: "node.setProp",
        nodeId: scene.ids[(i * 37) % scene.ids.length]!,
        path: "name",
        value: `renamed-${i}`,
        previousValue: null,
      });
    }
    const transaction: Transaction = {
      id: "txn_stress",
      label: "stress",
      actorId: "usr_stress",
      operations,
    };

    const once = applyTransaction(scene.document, transaction);
    const twice = applyTransaction(scene.document, transaction);

    // Determinism: the same transaction against the same document must
    // produce byte-identical results, or replay is not reproducible.
    expect(canonicalize(twice)).toBe(canonicalize(once));
    expect(countNodes(once.root)).toBe(50_000);
  });

  it("survives many random edits with the document still valid", () => {
    const scene = generateScene("mixed", 10_000);
    let document = scene.document;

    // Deterministic sequence — a failure here must be reproducible.
    let state = 12_345;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };

    for (let i = 0; i < 2_000; i += 1) {
      const id = scene.ids[Math.floor(random() * scene.ids.length)]!;
      document = applyOperation(document, {
        type: "node.setProp",
        nodeId: id,
        path: "name",
        value: `n${i}`,
        previousValue: null,
      });
    }

    expect(validateDocument(document).valid).toBe(true);
    expect(countNodes(document.root)).toBe(10_000);
  });

  it("round-trips insert and undo to the original bytes", () => {
    // Canonical equality after an insert/undo cycle is what proves the edit
    // model is lossless. It is also how the `children: []` defect was caught
    // originally, so it stays guarded at scale.
    const scene = generateScene("balanced", 10_000);
    const children = scene.document.root.children ?? [];
    const last = children.length > 0 ? children[children.length - 1]!.order : null;

    const transaction: Transaction = {
      id: "txn_roundtrip",
      label: "insert",
      actorId: "usr_stress",
      operations: [
        {
          type: "node.insert",
          parentId: scene.document.root.id,
          node: {
            id: "nod_roundtrip",
            name: "temp",
            order: generateKeyBetween(last, null),
            transform: IDENTITY_TRANSFORM,
          },
        },
      ],
    };

    const inserted = applyTransaction(scene.document, transaction);
    const undone = applyTransaction(inserted, invertTransaction(transaction));

    expect(canonicalize(undone)).toBe(canonicalize(scene.document));
  });

  it("removes and reinserts a deep subtree without loss", () => {
    const scene = generateScene("mixed", 10_000);
    const target = scene.ids[Math.floor(scene.ids.length / 2)]!;
    const subtree = findNode(scene.document.root, target)!;
    const parent = parentOf(scene.document.root, target)!;
    const subtreeSize = countNodes(subtree);

    const removed = removeNode(scene.document.root, target);
    expect(countNodes(removed)).toBe(10_000 - subtreeSize);

    const restored = replaceNode(removed, parent.id, (node) => ({
      ...node,
      children: [...(node.children ?? []), subtree],
    }))!;
    expect(countNodes(restored)).toBe(10_000);
    expect(canonicalize({ ...scene.document, root: restored })).toBe(
      canonicalize(scene.document),
    );
  });
});

describe("traversal at scale", () => {
  it("walks 100,000 nodes exactly once each", () => {
    const scene = generateScene("balanced", 100_000);
    const seen = new Set<string>();
    for (const node of walk(scene.document.root)) {
      expect(seen.has(node.id)).toBe(false);
      seen.add(node.id);
    }
    expect(seen.size).toBe(100_000);
  });

  it("keeps siblings in order-key order through the whole tree", () => {
    // Deterministic iteration order is what ENGINE_RECONCILIATION R9 rests on.
    const scene = generateScene("mixed", 50_000);
    for (const node of walk(scene.document.root)) {
      const children = node.children ?? [];
      for (let i = 1; i < children.length; i += 1) {
        expect(children[i - 1]!.order < children[i]!.order).toBe(true);
      }
    }
  });
});
