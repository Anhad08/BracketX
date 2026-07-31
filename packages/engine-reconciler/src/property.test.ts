import {
  applyTransaction,
  childrenOf,
  findNode,
  generateKeyBetween,
  makeMoveNode,
  makeRemoveNode,
  makeSetProp,
  walk,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";
import { describe, expect, it } from "vitest";


import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import { verifyConsistency } from "./verify";

/**
 * Fixture builders assemble trees before freezing them into a document.
 * SceneNode is readonly by design, so construction casts deliberately.
 */
type Mutable = { children: SceneNode[] };

/**
 * Property-based reconciler verification. Phase 2.4h.
 *
 * Randomized scenes and randomized operation sequences. The generator is a
 * seeded LCG so every failure is reproducible from its seed, and every
 * assertion carries the seed.
 *
 * The properties under test are the ones that cannot be established by
 * example: that the mirror stays consistent under *arbitrary* interleavings of
 * insert, delete, move, and property change.
 */

function createRandom(seed: number) {
  let state = seed >>> 0;
  const api = {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
    int(maxExclusive: number): number {
      return Math.floor(api.next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      return items[api.int(items.length)]!;
    },
    bool(): boolean {
      return api.next() < 0.5;
    },
  };
  return api;
}

type Random = ReturnType<typeof createRandom>;

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `nod_p${idCounter}`;
}

function makeNode(id: string, order: string, random: Random): SceneNode {
  const withComponent = random.next() < 0.3;
  return {
    id,
    name: id,
    order,
    transform: {
      position: [random.int(10), random.int(10), random.int(10)],
      rotation: [0, random.int(4) * 90, 0],
      scale: [1, 1, 1],
    },
    visible: random.next() < 0.9,
    ...(withComponent
      ? {
          components: [
            {
              id: `cmp_${id}`,
              type: "rect" as const,
              props: { width: 1, height: 1, fill: "#FFFFFF" },
            },
          ],
        }
      : {}),
  };
}

/** A random tree of roughly `count` nodes. */
function randomDocument(random: Random, count: number): SceneDocument {
  const root: SceneNode = {
    id: "nod_root",
    name: "root",
    order: generateKeyBetween(null, null),
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    children: [],
  };

  const pool: SceneNode[] = [root];
  const lastKey = new Map<string, string | null>([["nod_root", null]]);

  for (let i = 0; i < count; i += 1) {
    const parent = random.pick(pool);
    const previous = lastKey.get(parent.id) ?? null;
    const order = generateKeyBetween(previous, null);
    lastKey.set(parent.id, order);

    const child = makeNode(freshId(), order, random);
    lastKey.set(child.id, null);
    (parent as unknown as Mutable).children = [
      ...(parent.children ?? []),
      child,
    ];
    pool.push(child);
  }

  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn_prop",
    meta: {
      name: "Property",
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

function allIds(document: SceneDocument): string[] {
  return [...walk(document.root)].map((n) => n.id);
}

/** A random legal operation, or null when none applies. */
function randomOperation(
  document: SceneDocument,
  random: Random,
): SceneOperation | null {
  const ids = allIds(document).filter((id) => id !== "nod_root");
  const allWithRoot = allIds(document);
  const roll = random.int(100);

  // Insert
  if (roll < 30 || ids.length === 0) {
    const parentId = random.pick(allWithRoot);
    const parent = findNode(document.root, parentId)!;
    const children = childrenOf(parent);
    const last = children.length > 0 ? children[children.length - 1]!.order : null;
    return {
      type: "node.insert",
      parentId,
      node: makeNode(freshId(), generateKeyBetween(last, null), random),
    };
  }

  // Remove
  if (roll < 45) {
    return makeRemoveNode(document, random.pick(ids));
  }

  // Move — must not reparent under own descendant
  if (roll < 60) {
    const nodeId = random.pick(ids);
    const node = findNode(document.root, nodeId)!;
    const descendants = new Set([...walk(node)].map((n) => n.id));
    const candidates = allWithRoot.filter((id) => !descendants.has(id));
    if (candidates.length === 0) return null;

    const parentId = random.pick(candidates);
    const parent = findNode(document.root, parentId)!;
    const children = childrenOf(parent).filter((c) => c.id !== nodeId);
    const last = children.length > 0 ? children[children.length - 1]!.order : null;
    return makeMoveNode(document, nodeId, parentId, generateKeyBetween(last, null));
  }

  // Transform
  if (roll < 80) {
    return makeSetProp(
      document,
      random.pick(allWithRoot),
      "transform.position",
      [random.int(20), random.int(20), random.int(20)],
    );
  }

  // Visibility
  if (roll < 92) {
    return makeSetProp(document, random.pick(allWithRoot), "visible", random.bool());
  }

  // Component property — material channel
  const withComponents = allWithRoot.filter(
    (id) => (findNode(document.root, id)?.components?.length ?? 0) > 0,
  );
  if (withComponents.length === 0) return null;
  return makeSetProp(
    document,
    random.pick(withComponents),
    "components.0.props.fill",
    `#${random.int(0xffffff).toString(16).padStart(6, "0").toUpperCase()}`,
  );
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i * 6151 + 17);

describe("property: mirror stays consistent under random operations", () => {
  it("holds across 150 seeds x 60 operations", () => {
    for (const seed of SEEDS) {
      const random = createRandom(seed);
      const backend = new MockMirrorBackend();
      const reconciler = new Reconciler(backend);

      let document = randomDocument(random, 25);
      reconciler.build(document);

      for (let step = 0; step < 60; step += 1) {
        const operation = randomOperation(document, random);
        if (!operation) continue;

        const txn: Transaction = {
          id: `txn_${step}`,
          label: operation.type,
          actorId: "prop",
          operations: [operation],
        };

        document = applyTransaction(document, txn);
        reconciler.project(txn, document);

        const result = verifyConsistency(reconciler.mirror, document);
        expect(
          result.issues,
          `seed ${seed} step ${step} after ${operation.type}`,
        ).toEqual([]);
      }
    }
  });
});

describe("property: no leaked or duplicated handles", () => {
  it("live backend nodes always equal document nodes", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const random = createRandom(seed);
      const backend = new MockMirrorBackend();
      const reconciler = new Reconciler(backend);

      let document = randomDocument(random, 20);
      reconciler.build(document);

      for (let step = 0; step < 50; step += 1) {
        const operation = randomOperation(document, random);
        if (!operation) continue;
        const txn: Transaction = {
          id: `t${step}`,
          label: "x",
          actorId: "prop",
          operations: [operation],
        };
        document = applyTransaction(document, txn);
        reconciler.project(txn, document);

        expect(backend.liveHandles().nodes, `seed ${seed} step ${step}`).toBe(
          allIds(document).length,
        );
      }
    }
  });

  it("teardown always frees everything", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const random = createRandom(seed);
      const backend = new MockMirrorBackend();
      const reconciler = new Reconciler(backend);

      let document = randomDocument(random, 20);
      reconciler.build(document);

      for (let step = 0; step < 30; step += 1) {
        const operation = randomOperation(document, random);
        if (!operation) continue;
        const txn: Transaction = {
          id: `t${step}`,
          label: "x",
          actorId: "prop",
          operations: [operation],
        };
        document = applyTransaction(document, txn);
        reconciler.project(txn, document);
      }

      reconciler.teardown();
      const stats = backend.stats();
      expect(stats.liveNodes, `seed ${seed}`).toBe(0);
      expect(stats.nodesCreated, `seed ${seed}`).toBe(stats.nodesDestroyed);
    }
  });
});

describe("property: identities are stable", () => {
  it("a node's handle never changes while it exists", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const random = createRandom(seed);
      const backend = new MockMirrorBackend();
      const reconciler = new Reconciler(backend);

      let document = randomDocument(random, 20);
      reconciler.build(document);

      const handles = new Map<string, number>();
      for (const id of reconciler.mirror.nodeIds()) {
        handles.set(id, reconciler.mirror.get(id)!.handle as number);
      }

      for (let step = 0; step < 40; step += 1) {
        const operation = randomOperation(document, random);
        if (!operation) continue;
        const txn: Transaction = {
          id: `t${step}`,
          label: "x",
          actorId: "prop",
          operations: [operation],
        };
        document = applyTransaction(document, txn);
        reconciler.project(txn, document);

        for (const id of reconciler.mirror.nodeIds()) {
          const handle = reconciler.mirror.get(id)!.handle as number;
          const known = handles.get(id);
          if (known === undefined) {
            handles.set(id, handle);
          } else {
            // A move must reparent, never destroy-recreate.
            expect(handle, `seed ${seed} step ${step} node ${id}`).toBe(known);
          }
        }
      }
    }
  });
});

describe("property: projection is deterministic", () => {
  it("the same operation sequence produces the same snapshot", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const run = () => {
        // Reset the id counter so both runs generate identical node ids.
        idCounter = seed * 100000;
        const random = createRandom(seed);
        const backend = new MockMirrorBackend();
        const reconciler = new Reconciler(backend);

        let document = randomDocument(random, 20);
        reconciler.build(document);

        for (let step = 0; step < 40; step += 1) {
          const operation = randomOperation(document, random);
          if (!operation) continue;
          const txn: Transaction = {
            id: `t${step}`,
            label: "x",
            actorId: "prop",
            operations: [operation],
          };
          document = applyTransaction(document, txn);
          reconciler.project(txn, document);
        }
        return JSON.stringify(backend.snapshot());
      };

      expect(run(), `seed ${seed}`).toBe(run());
    }
  });

  it("build and project reach the same mirror structure", () => {
    // ENGINE_RECONCILIATION invariant R9: the two paths into the mirror must
    // agree, or a rebuilt mirror would differ from an incrementally
    // maintained one.
    for (const seed of SEEDS.slice(0, 60)) {
      idCounter = seed * 200000;
      const random = createRandom(seed);

      const projectedBackend = new MockMirrorBackend();
      const projected = new Reconciler(projectedBackend);
      let document = randomDocument(random, 20);
      projected.build(document);

      for (let step = 0; step < 30; step += 1) {
        const operation = randomOperation(document, random);
        if (!operation) continue;
        const txn: Transaction = {
          id: `t${step}`,
          label: "x",
          actorId: "prop",
          operations: [operation],
        };
        document = applyTransaction(document, txn);
        projected.project(txn, document);
      }

      // A fresh reconciler built from the final document.
      const builtBackend = new MockMirrorBackend();
      const built = new Reconciler(builtBackend);
      built.build(document);

      expect(
        JSON.stringify(builtBackend.snapshot()),
        `seed ${seed}: build and project disagree`,
      ).toBe(JSON.stringify(projectedBackend.snapshot()));
    }
  });
});

describe("property: no crashes", () => {
  it("survives long random sequences", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const random = createRandom(seed);
      const backend = new MockMirrorBackend();
      const reconciler = new Reconciler(backend);

      let document = randomDocument(random, 30);
      reconciler.build(document);

      expect(() => {
        for (let step = 0; step < 150; step += 1) {
          const operation = randomOperation(document, random);
          if (!operation) continue;
          const txn: Transaction = {
            id: `t${step}`,
            label: "x",
            actorId: "prop",
            operations: [operation],
          };
          document = applyTransaction(document, txn);
          reconciler.project(txn, document);
        }
      }, `seed ${seed}`).not.toThrow();
    }
  });
});
