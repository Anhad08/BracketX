import {
  applyTransaction,
  generateKeyBetween,
  makeSetProp,
  type SceneDocument,
  type SceneNode,
  type Transaction,
} from "@bracketx/engine-scene";
import { bench, describe } from "vitest";


import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import { verifyConsistency } from "./verify";

/**
 * Fixture builders assemble trees before freezing them into a document.
 * SceneNode is readonly by design, so construction casts deliberately.
 */
type Mutable = { children: SceneNode[] };

/**
 * Reconciler benchmarks. Phase 2.4i.
 *
 * MEASURE REALITY. These record where projection actually spends time before
 * anyone tunes it. The stress tests assert the *shape* of the cost; these
 * record its magnitude.
 *
 * Run: pnpm --filter @bracketx/engine-reconciler bench
 */

function scene(kind: "wide" | "deep" | "balanced", count: number): SceneDocument {
  const root: SceneNode = {
    id: "nod_root",
    name: "root",
    order: generateKeyBetween(null, null),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children: [],
  };
  const node = (id: string, order: string): SceneNode => ({
    id,
    name: id,
    order,
    transform: { position: [1, 0, 0], rotation: [0, 30, 0], scale: [1, 1, 1] },
    children: [],
  });

  if (kind === "wide") {
    const children: SceneNode[] = [];
    let key: string | null = null;
    for (let i = 0; i < count; i += 1) {
      key = generateKeyBetween(key, null);
      children.push(node(`nod_${i}`, key));
    }
    (root as unknown as Mutable).children = children;
  } else if (kind === "deep") {
    let current = root;
    for (let i = 0; i < count; i += 1) {
      const child = node(`nod_${i}`, generateKeyBetween(null, null));
      (current as unknown as Mutable).children = [child];
      current = child;
    }
  } else {
    const nodes: SceneNode[] = [root];
    for (let i = 0; i < count; i += 1) {
      const parent = nodes[Math.floor(i / 4)]!;
      const siblings = parent.children ?? [];
      const last = siblings.length > 0 ? siblings[siblings.length - 1]!.order : null;
      const child = node(`nod_${i}`, generateKeyBetween(last, null));
      (parent as unknown as Mutable).children = [...siblings, child];
      nodes.push(child);
    }
  }

  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn_bench",
    meta: {
      name: "Bench",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    root,
  };
}

function prepared(kind: "wide" | "deep" | "balanced", count: number) {
  const document = scene(kind, count);
  const reconciler = new Reconciler(new MockMirrorBackend());
  reconciler.build(document);
  return { document, reconciler };
}

function edit(document: SceneDocument, nodeId: string, x: number): Transaction {
  return {
    id: "t",
    label: "edit",
    actorId: "bench",
    operations: [makeSetProp(document, nodeId, "transform.position", [x, 0, 0])],
  };
}

describe("build (full construction)", () => {
  const d1k = scene("balanced", 1_000);
  const d10k = scene("balanced", 10_000);
  const d50k = scene("balanced", 50_000);

  bench("1,000 nodes", () => {
    new Reconciler(new MockMirrorBackend()).build(d1k);
  });

  bench("10,000 nodes", () => {
    new Reconciler(new MockMirrorBackend()).build(d10k);
  });

  bench("50,000 nodes", () => {
    new Reconciler(new MockMirrorBackend()).build(d50k);
  });
});

describe("incremental projection — leaf edit", () => {
  const small = prepared("wide", 1_000);
  const medium = prepared("wide", 10_000);
  const large = prepared("wide", 50_000);
  let counter = 0;

  bench("leaf edit in 1,000-node scene", () => {
    counter += 1;
    const txn = edit(small.document, "nod_500", counter);
    small.document = applyTransaction(small.document, txn);
    small.reconciler.project(txn, small.document);
  });

  bench("leaf edit in 10,000-node scene", () => {
    counter += 1;
    const txn = edit(medium.document, "nod_5000", counter);
    medium.document = applyTransaction(medium.document, txn);
    medium.reconciler.project(txn, medium.document);
  });

  bench("leaf edit in 50,000-node scene", () => {
    counter += 1;
    const txn = edit(large.document, "nod_25000", counter);
    large.document = applyTransaction(large.document, txn);
    large.reconciler.project(txn, large.document);
  });
});

describe("hierarchy propagation", () => {
  const shallow = prepared("deep", 10);
  const mid = prepared("deep", 100);
  const deep = prepared("deep", 1_000);
  let counter = 0;

  bench("root edit, depth 10", () => {
    counter += 1;
    const txn = edit(shallow.document, "nod_root", counter);
    shallow.document = applyTransaction(shallow.document, txn);
    shallow.reconciler.project(txn, shallow.document);
  });

  bench("root edit, depth 100", () => {
    counter += 1;
    const txn = edit(mid.document, "nod_root", counter);
    mid.document = applyTransaction(mid.document, txn);
    mid.reconciler.project(txn, mid.document);
  });

  bench("root edit, depth 1,000", () => {
    counter += 1;
    const txn = edit(deep.document, "nod_root", counter);
    deep.document = applyTransaction(deep.document, txn);
    deep.reconciler.project(txn, deep.document);
  });
});

describe("wide propagation", () => {
  const wide = prepared("wide", 5_000);
  let counter = 0;

  bench("root edit over 5,000 children", () => {
    counter += 1;
    const txn = edit(wide.document, "nod_root", counter);
    wide.document = applyTransaction(wide.document, txn);
    wide.reconciler.project(txn, wide.document);
  });
});

describe("insert and remove", () => {
  bench("insert 100 nodes one at a time", () => {
    const document = scene("wide", 100);
    const reconciler = new Reconciler(new MockMirrorBackend());
    reconciler.build(document);

    let current = document;
    let key = generateKeyBetween("z", null);
    for (let i = 0; i < 100; i += 1) {
      key = generateKeyBetween(key, null);
      const txn: Transaction = {
        id: `t${i}`,
        label: "insert",
        actorId: "bench",
        operations: [
          {
            type: "node.insert",
            parentId: "nod_root",
            node: {
              id: `nod_added_${i}`,
              name: "added",
              order: key,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
            },
          },
        ],
      };
      current = applyTransaction(current, txn);
      reconciler.project(txn, current);
    }
  });

  bench("teardown 10,000 nodes", () => {
    const document = scene("balanced", 10_000);
    const reconciler = new Reconciler(new MockMirrorBackend());
    reconciler.build(document);
    reconciler.teardown();
  });
});

describe("verification cost", () => {
  const small = prepared("balanced", 1_000);
  const large = prepared("balanced", 10_000);

  bench("verify 1,000 nodes", () => {
    verifyConsistency(small.reconciler.mirror, small.document);
  });

  bench("verify 10,000 nodes", () => {
    verifyConsistency(large.reconciler.mirror, large.document);
  });
});
