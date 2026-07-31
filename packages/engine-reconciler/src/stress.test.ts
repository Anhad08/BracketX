import {
  applyTransaction,
  generateKeyBetween,
  makeSetProp,
  type SceneDocument,
  type SceneNode,
  type Transaction,
} from "@bracketx/engine-scene";
import { describe, expect, it } from "vitest";

import { describeHierarchy, lifetimeBalanced } from "./diagnostics";
import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";

/**
 * Fixture builders assemble trees before freezing them into a document.
 * SceneNode is readonly by design, so construction casts deliberately.
 */
type Mutable = { children: SceneNode[] };

/**
 * Stress and scalability. Phase 2.4j.
 *
 * The reconciler must prove scalability WITHOUT a renderer. What is asserted
 * here is not speed — that is the benchmark's job — but the shape of the cost:
 * an incremental update must be proportional to what changed, not to scene
 * size. A test that only measured milliseconds would pass on a fast machine
 * while hiding an O(n) update.
 */

function buildScene(
  kind: "wide" | "deep" | "balanced",
  count: number,
): SceneDocument {
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
    transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
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
    // Balanced binary-ish tree: realistic depth and branching together.
    const nodes: SceneNode[] = [root];
    for (let i = 0; i < count; i += 1) {
      const parent = nodes[Math.floor(i / 4)]!;
      const siblings = parent.children ?? [];
      const last =
        siblings.length > 0 ? siblings[siblings.length - 1]!.order : null;
      const child = node(`nod_${i}`, generateKeyBetween(last, null));
      (parent as unknown as Mutable).children = [...siblings, child];
      nodes.push(child);
    }
  }

  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn_stress",
    meta: {
      name: "Stress",
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

function setup(kind: "wide" | "deep" | "balanced", count: number) {
  const document = buildScene(kind, count);
  const backend = new MockMirrorBackend();
  const reconciler = new Reconciler(backend);
  reconciler.build(document);
  return { document, backend, reconciler };
}

describe("large scenes build correctly", () => {
  it.each([1_000, 10_000, 50_000])("builds %i nodes", (count) => {
    const { reconciler, backend } = setup("balanced", count);
    expect(reconciler.mirror.size).toBe(count + 1);
    expect(backend.liveHandles().nodes).toBe(count + 1);
    expect(lifetimeBalanced(reconciler.mirror)).toBe(true);
  });

  it("builds a 100k-node scene", () => {
    const { reconciler } = setup("balanced", 100_000);
    expect(reconciler.mirror.size).toBe(100_001);
    expect(describeHierarchy(reconciler.mirror).nodeCount).toBe(100_001);
  }, 120_000);
});

describe("incremental cost is proportional to change, not scene size", () => {
  it("a leaf edit in a 50k scene touches one node", () => {
    // The property that makes projection viable at all. If this ever becomes
    // O(scene), the reconciler has silently become a differ.
    const { reconciler, backend, ...rest } = setup("wide", 50_000);
    let document = rest.document;
    backend.resetWriteCount();

    const txn: Transaction = {
      id: "t",
      label: "edit",
      actorId: "stress",
      operations: [
        makeSetProp(document, "nod_25000", "transform.position", [9, 9, 9]),
      ],
    };
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    expect(report.dirty.transform).toBe(1);
    expect(report.backendWrites).toBeLessThanOrEqual(2);
  }, 120_000);

  it("cost does not grow with scene size", () => {
    // Same edit, three scene sizes. Dirty count must be identical.
    const results = [1_000, 10_000, 50_000].map((count) => {
      const { reconciler, ...rest } = setup("wide", count);
      let document = rest.document;
      const txn: Transaction = {
        id: "t",
        label: "edit",
        actorId: "stress",
        operations: [
          makeSetProp(document, "nod_10", "transform.position", [1, 2, 3]),
        ],
      };
      document = applyTransaction(document, txn);
      return reconciler.project(txn, document).dirty.transform;
    });

    expect(results).toEqual([1, 1, 1]);
  }, 120_000);

  it("projection wall time does not grow with scene size", () => {
    // The dirty-count assertions above are necessary but not sufficient: an
    // earlier implementation reported a correct dirty count of 1 while taking
    // 21.5ms in a 50k scene, because the index refresh scanned a sibling
    // array. Only an isolated timing measurement exposed it.
    //
    // Timing under a parallel test runner is noisy, so this takes the MINIMUM
    // of several interleaved rounds rather than a mean. Minimum is the robust
    // statistic here: scheduler interference can only ever make a sample
    // slower, never faster, so the floor reflects the real cost.
    //
    // Transactions and documents are prepared OUTSIDE the timed region, so
    // engine-scene's O(scene) document application is excluded — this measures
    // projection alone.
    const prepare = (count: number) => {
      let document = buildScene("wide", count);
      const seed = new Reconciler(new MockMirrorBackend());
      seed.build(document);

      const prepared: { txn: Transaction; doc: SceneDocument }[] = [];
      for (let i = 0; i < 100; i += 1) {
        const txn: Transaction = {
          id: `t${i}`,
          label: "edit",
          actorId: "stress",
          operations: [
            makeSetProp(document, `nod_${i}`, "transform.position", [i, 0, 0]),
          ],
        };
        document = applyTransaction(document, txn);
        prepared.push({ txn, doc: document });
      }
      return { prepared, source: buildScene("wide", count) };
    };

    const timeOnce = (fixture: ReturnType<typeof prepare>): number => {
      const target = new Reconciler(new MockMirrorBackend());
      target.build(fixture.source);
      // Warm the JIT so the first sample is not an outlier.
      for (const p of fixture.prepared.slice(0, 20)) target.project(p.txn, p.doc);

      const begin = performance.now();
      for (const p of fixture.prepared) target.project(p.txn, p.doc);
      return (performance.now() - begin) / fixture.prepared.length;
    };

    const smallFixture = prepare(1_000);
    const largeFixture = prepare(50_000);

    let small = Infinity;
    let large = Infinity;
    for (let round = 0; round < 5; round += 1) {
      small = Math.min(small, timeOnce(smallFixture));
      large = Math.min(large, timeOnce(largeFixture));
    }

    // O(scene) across a 50x size difference would be roughly 50x slower. A 15x
    // bound catches that with wide margin for noise, and the floor guards
    // against a divide-by-tiny when both are sub-microsecond.
    expect(
      large,
      `projection scaled with scene size: ${small.toFixed(3)}ms at 1k vs ` +
        `${large.toFixed(3)}ms at 50k`,
    ).toBeLessThan(Math.max(small * 15, 0.05));
  }, 180_000);

  it("a root edit in a deep scene propagates the full depth, and no more", () => {
    const depth = 2_000;
    const { reconciler, ...rest } = setup("deep", depth);
    let document = rest.document;

    const txn: Transaction = {
      id: "t",
      label: "edit",
      actorId: "stress",
      operations: [
        makeSetProp(document, "nod_root", "transform.position", [1, 0, 0]),
      ],
    };
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    // Root plus the chain.
    expect(report.dirty.transform).toBe(depth + 1);
    expect(report.dirty.maxPropagationDepth).toBe(depth);
  }, 120_000);

  it("a leaf edit in a deep scene propagates nothing", () => {
    const depth = 2_000;
    const { reconciler, ...rest } = setup("deep", depth);
    let document = rest.document;

    const txn: Transaction = {
      id: "t",
      label: "edit",
      actorId: "stress",
      operations: [
        makeSetProp(
          document,
          `nod_${depth - 1}`,
          "transform.position",
          [1, 0, 0],
        ),
      ],
    };
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    expect(report.dirty.transform).toBe(1);
    expect(report.dirty.maxPropagationDepth).toBe(0);
  }, 120_000);
});

describe("repeated updates do not accumulate", () => {
  it("1,000 sequential edits create and destroy nothing", () => {
    const { reconciler, backend, ...rest } = setup("wide", 5_000);
    let document = rest.document;
    const created = backend.stats().nodesCreated;

    for (let i = 0; i < 1_000; i += 1) {
      const txn: Transaction = {
        id: `t${i}`,
        label: "edit",
        actorId: "stress",
        operations: [
          makeSetProp(document, `nod_${i}`, "transform.position", [i, 0, 0]),
        ],
      };
      document = applyTransaction(document, txn);
      reconciler.project(txn, document);
    }

    expect(backend.stats().nodesCreated).toBe(created);
    expect(backend.stats().nodesDestroyed).toBe(0);
    expect(lifetimeBalanced(reconciler.mirror)).toBe(true);
  }, 120_000);

  it("teardown of a 50k scene frees everything", () => {
    const { reconciler, backend } = setup("balanced", 50_000);
    reconciler.teardown();
    expect(backend.liveHandles().nodes).toBe(0);
    expect(backend.stats().nodesCreated).toBe(backend.stats().nodesDestroyed);
  }, 120_000);
});
