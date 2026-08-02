import {
  applyOperation,
  applyTransaction,
  createSequentialIdFactory,
  generateKeyBetween,
  makeMoveNode,
  makeRemoveNode,
  makeSetProp,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";
import { beforeEach, describe, expect, it } from "vitest";

import { MirrorViolation } from "./mirror";
import { MirrorBackendViolation, MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import type { VariableSource } from "./resolve";
import { verifyConsistency } from "./verify";

// ---------------------------------------------------------------------------
// Fixtures — local, so engine-scene's test fixtures stay private to it
// ---------------------------------------------------------------------------

function node(
  id: string,
  order: string,
  overrides: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    order,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    ...overrides,
  };
}

function emptyDocument(root: SceneNode): SceneDocument {
  const ids = createSequentialIdFactory();
  return {
    format: "bracketx.scene",
    version: 2,
    id: ids("scene"),
    meta: {
      name: "Test",
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

/** Root with children a, b; a has child a1. */
function makeTree(): SceneDocument {
  const ka = generateKeyBetween(null, null);
  const kb = generateKeyBetween(ka, null);
  return emptyDocument(
    node("nod_root", generateKeyBetween(null, null), {
      children: [
        node("nod_a", ka, {
          children: [node("nod_a1", generateKeyBetween(null, null))],
        }),
        node("nod_b", kb),
      ],
    }),
  );
}

function transaction(...operations: SceneOperation[]): Transaction {
  return { id: "txn", label: "test", actorId: "test", operations };
}

/** Applies to the document and projects in one step, as the pipeline does. */
function commit(
  reconciler: Reconciler,
  document: SceneDocument,
  ...operations: SceneOperation[]
): SceneDocument {
  const txn = transaction(...operations);
  const next = applyTransaction(document, txn);
  reconciler.project(txn, next);
  return next;
}

let backend: MockMirrorBackend;
let reconciler: Reconciler;

beforeEach(() => {
  backend = new MockMirrorBackend();
  reconciler = new Reconciler(backend, { verifyAfterEachProjection: true });
});

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

describe("build", () => {
  it("mirrors every document node", () => {
    const document = makeTree();
    const report = reconciler.build(document);
    expect(report.nodesCreated).toBe(4);
    expect(reconciler.mirror.size).toBe(4);
  });

  it("produces a consistent mirror", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(verifyConsistency(reconciler.mirror, document).issues).toEqual([]);
  });

  it("refuses to build twice without teardown", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(() => reconciler.build(document)).toThrow(/teardown/);
  });

  it("refuses to project before build", () => {
    expect(() =>
      reconciler.project(transaction(), makeTree()),
    ).toThrow(/before build/);
  });
});

// ---------------------------------------------------------------------------
// Projection — structure
// ---------------------------------------------------------------------------

describe("node.insert", () => {
  it("creates the node and its subtree", () => {
    let document = makeTree();
    reconciler.build(document);

    const subtree = node("nod_new", generateKeyBetween("z", null), {
      children: [node("nod_new_child", generateKeyBetween(null, null))],
    });
    document = commit(reconciler, document, {
      type: "node.insert",
      parentId: "nod_root",
      node: subtree,
    });

    expect(reconciler.mirror.has("nod_new")).toBe(true);
    expect(reconciler.mirror.has("nod_new_child")).toBe(true);
    expect(reconciler.verify().consistent).toBe(true);
  });

  it("places the node in document order", () => {
    let document = makeTree();
    reconciler.build(document);

    const between = generateKeyBetween(
      reconciler.mirror.get("nod_a")!.order,
      reconciler.mirror.get("nod_b")!.order,
    );
    document = commit(reconciler, document, {
      type: "node.insert",
      parentId: "nod_root",
      node: node("nod_mid", between),
    });

    expect([...reconciler.mirror.childrenOf("nod_root")]).toEqual([
      "nod_a",
      "nod_mid",
      "nod_b",
    ]);
  });
});

describe("node.remove", () => {
  it("destroys the whole subtree", () => {
    let document = makeTree();
    reconciler.build(document);
    document = commit(reconciler, document, makeRemoveNode(document, "nod_a"));

    expect(reconciler.mirror.has("nod_a")).toBe(false);
    expect(reconciler.mirror.has("nod_a1")).toBe(false);
    expect(reconciler.mirror.size).toBe(2);
  });

  it("leaks no backend handles", () => {
    let document = makeTree();
    reconciler.build(document);
    document = commit(reconciler, document, makeRemoveNode(document, "nod_a"));

    const stats = backend.stats();
    expect(stats.liveNodes).toBe(2);
    expect(stats.nodesCreated - stats.nodesDestroyed).toBe(2);
  });

  it("destroys depth-first, so no backend object is orphaned", () => {
    // The mock rejects destroying a node that still has children, so a
    // breadth-first implementation would throw here.
    let document = makeTree();
    reconciler.build(document);
    expect(() => {
      document = commit(reconciler, document, makeRemoveNode(document, "nod_a"));
    }).not.toThrow();
  });
});

describe("node.move", () => {
  it("reparents without destroying the handle", () => {
    // ENGINE_RECONCILIATION §1.4: destroy-and-recreate would drop GPU
    // resources and restart in-flight state.
    let document = makeTree();
    reconciler.build(document);
    const before = reconciler.mirror.get("nod_b")!.handle;

    document = commit(
      reconciler,
      document,
      makeMoveNode(document, "nod_b", "nod_a", generateKeyBetween("z", null)),
    );

    expect(reconciler.mirror.get("nod_b")!.handle).toBe(before);
    expect(backend.stats().nodesDestroyed).toBe(0);
  });

  it("keeps the mirror consistent after reparenting", () => {
    let document = makeTree();
    reconciler.build(document);
    document = commit(
      reconciler,
      document,
      makeMoveNode(document, "nod_b", "nod_a", generateKeyBetween("z", null)),
    );
    expect(reconciler.verify().consistent).toBe(true);
  });

  it("refuses a cycle at the mirror level", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(() =>
      reconciler.mirror.reparent("nod_a", "nod_a1", "a"),
    ).toThrow(MirrorViolation);
  });
});

// ---------------------------------------------------------------------------
// Transform propagation
// ---------------------------------------------------------------------------

describe("transform propagation", () => {
  it("composes world matrices down the tree", () => {
    let document = makeTree();
    reconciler.build(document);

    document = commit(
      reconciler,
      document,
      makeSetProp(document, "nod_a", "transform.position", [10, 0, 0]),
    );

    // a1 inherits a's translation.
    const a1 = reconciler.mirror.get("nod_a1")!;
    expect([a1.worldMatrix[12], a1.worldMatrix[13], a1.worldMatrix[14]]).toEqual(
      [10, 0, 0],
    );
  });

  it("does not touch siblings", () => {
    let document = makeTree();
    reconciler.build(document);

    document = commit(
      reconciler,
      document,
      makeSetProp(document, "nod_a", "transform.position", [5, 0, 0]),
    );

    const b = reconciler.mirror.get("nod_b")!;
    expect([b.worldMatrix[12], b.worldMatrix[13], b.worldMatrix[14]]).toEqual([
      0, 0, 0,
    ]);
  });

  it("marks only the affected subtree dirty", () => {
    let document = makeTree();
    reconciler.build(document);

    const txn = transaction(
      makeSetProp(document, "nod_a", "transform.position", [1, 0, 0]),
    );
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    // nod_a and nod_a1 — not root, not nod_b.
    expect(report.dirty.transform).toBe(2);
    expect(report.dirty.material).toBe(0);
  });

  it("reports propagation depth", () => {
    let document = makeTree();
    reconciler.build(document);

    const txn = transaction(
      makeSetProp(document, "nod_root", "transform.position", [1, 0, 0]),
    );
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    // root -> a -> a1 is depth 2.
    expect(report.dirty.maxPropagationDepth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("visibility", () => {
  it("composes with ancestors", () => {
    let document = makeTree();
    reconciler.build(document);

    document = commit(
      reconciler,
      document,
      makeSetProp(document, "nod_a", "visible", false),
    );

    expect(reconciler.mirror.get("nod_a")!.effectiveVisible).toBe(false);
    expect(reconciler.mirror.get("nod_a1")!.effectiveVisible).toBe(false);
    expect(reconciler.mirror.get("nod_b")!.effectiveVisible).toBe(true);
  });

  it("restores descendants when the ancestor becomes visible again", () => {
    let document = makeTree();
    reconciler.build(document);

    document = commit(
      reconciler,
      document,
      makeSetProp(document, "nod_a", "visible", false),
    );
    document = commit(
      reconciler,
      document,
      makeSetProp(document, "nod_a", "visible", true),
    );

    expect(reconciler.mirror.get("nod_a1")!.effectiveVisible).toBe(true);
  });

  it("does not dirty transforms", () => {
    let document = makeTree();
    reconciler.build(document);

    const txn = transaction(makeSetProp(document, "nod_a", "visible", false));
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    expect(report.dirty.visibility).toBeGreaterThan(0);
    expect(report.dirty.transform).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Channel isolation — 2.4e
// ---------------------------------------------------------------------------

describe("dirty channels are isolated", () => {
  it("a material change does not invalidate transforms", () => {
    // The core claim of separate dirty channels.
    let document = makeTree();
    const withComponent = applyOperation(document, {
      type: "node.insert",
      parentId: "nod_root",
      node: node("nod_rect", generateKeyBetween("z", null), {
        components: [
          {
            id: "cmp_rect",
            type: "rect",
            props: { width: 10, height: 10, fill: "#FF0000" },
          },
        ],
      }),
    });
    reconciler.build(withComponent);
    document = withComponent;

    const txn = transaction(
      makeSetProp(document, "nod_rect", "components.0.props.fill", "#00FF00"),
    );
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    expect(report.dirty.material).toBe(1);
    expect(report.dirty.transform).toBe(0);
    expect(report.dirty.visibility).toBe(0);
  });

  it("a variable change affects only dependent nodes", () => {
    const ka = generateKeyBetween(null, null);
    const kb = generateKeyBetween(ka, null);
    const document: SceneDocument = {
      ...emptyDocument(
        node("nod_root", generateKeyBetween(null, null), {
          children: [
            node("nod_bound", ka, {
              components: [
                {
                  id: "cmp_a",
                  type: "rect",
                  props: { width: 1, height: 1, fill: { $var: "teamColor" } },
                },
              ],
            }),
            node("nod_free", kb, {
              components: [
                {
                  id: "cmp_b",
                  type: "rect",
                  props: { width: 1, height: 1, fill: "#FFFFFF" },
                },
              ],
            }),
          ],
        }),
      ),
      variables: [
        {
          id: "var_1",
          key: "teamColor",
          type: "color",
          label: "Team Colour",
          default: "#FF0000",
        },
      ],
    };

    const variables: VariableSource = { read: () => "#00FF00" };
    reconciler.build(document, variables);

    const report = reconciler.invalidateVariables(["teamColor"], variables);
    expect(report.dirty.material).toBe(1);
    expect(report.dirty.transform).toBe(0);
  });

  it("invalidates a DOTTED binding when the flat key is set", () => {
    // Regression. `{ $var: "team.accent" }` records its dependency under
    // `team`, because a dotted binding is a PATH into a variable and
    // `dependencyKeyOf` takes the segment before the first dot. A live command
    // sets the flat key `team.accent`, and looking THAT up found nobody — so
    // the node resolved once at build and never updated again.
    //
    // Every dotted binding was affected, and dotted is the documented idiomatic
    // form. Nothing caught it because the tests that use `team.accent` assert
    // that an attachment did NOT change, which is trivially true when the
    // invalidation never fires. Found by a text node bound to `player.name`.
    const ka = generateKeyBetween(null, null);
    const document: SceneDocument = {
      ...emptyDocument(
        node("nod_root", generateKeyBetween(null, null), {
          children: [
            node("nod_bound", ka, {
              components: [
                {
                  id: "cmp_a",
                  type: "rect",
                  props: { width: 1, height: 1, fill: { $var: "team.accent" } },
                },
              ],
            }),
          ],
        }),
      ),
      variables: [
        {
          id: "var_1",
          key: "team.accent",
          type: "color",
          label: "Accent",
          default: "#FF0000",
        },
      ],
    };

    const variables: VariableSource = { read: () => "#00FF00" };
    reconciler.build(document, variables);

    // The dependency really is recorded under the ROOT. Asserted, so the fix
    // cannot be mistaken for a change to how bindings are keyed.
    expect([...reconciler.projector.dependencies.dependenciesOf("nod_bound")]).toEqual([
      "team",
    ]);

    const report = reconciler.invalidateVariables(["team.accent"], variables);
    expect(report.dirty.material).toBe(1);
  });

  it("records no dependency for an unbound node", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(reconciler.stats().dependencyEdges).toBe(0);
  });

  it("drops dependencies when a node is destroyed", () => {
    const document: SceneDocument = {
      ...emptyDocument(
        node("nod_root", generateKeyBetween(null, null), {
          children: [
            node("nod_bound", generateKeyBetween(null, null), {
              components: [
                {
                  id: "cmp_a",
                  type: "rect",
                  props: { width: 1, height: 1, fill: { $var: "c" } },
                },
              ],
            }),
          ],
        }),
      ),
      variables: [
        { id: "var_1", key: "c", type: "color", label: "C", default: "#000000" },
      ],
    };

    reconciler.build(document, { read: () => "#111111" });
    expect(reconciler.stats().dependencyEdges).toBe(1);

    commit(reconciler, document, makeRemoveNode(document, "nod_bound"));
    expect(reconciler.stats().dependencyEdges).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Incrementality — 2.4d
// ---------------------------------------------------------------------------

describe("incremental synchronisation", () => {
  function wideTree(width: number): SceneDocument {
    const children: SceneNode[] = [];
    let key: string | null = null;
    for (let i = 0; i < width; i += 1) {
      key = generateKeyBetween(key, null);
      children.push(node(`nod_${i}`, key));
    }
    return emptyDocument(
      node("nod_root", generateKeyBetween(null, null), { children }),
    );
  }

  it("touches only the changed node, not the scene", () => {
    let document = wideTree(200);
    reconciler.build(document);

    backend.resetWriteCount();
    const txn = transaction(
      makeSetProp(document, "nod_57", "transform.position", [1, 2, 3]),
    );
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    // One leaf: one world-matrix write. Not 201.
    expect(report.dirty.transform).toBe(1);
    expect(report.backendWrites).toBeLessThanOrEqual(2);
  });

  it("never rebuilds the mirror", () => {
    let document = wideTree(100);
    reconciler.build(document);
    const created = backend.stats().nodesCreated;

    for (let i = 0; i < 20; i += 1) {
      const txn = transaction(
        makeSetProp(document, `nod_${i}`, "transform.position", [i, 0, 0]),
      );
      document = applyTransaction(document, txn);
      reconciler.project(txn, document);
    }

    // No node was recreated.
    expect(backend.stats().nodesCreated).toBe(created);
    expect(backend.stats().nodesDestroyed).toBe(0);
  });

  it("keeps handles stable across updates", () => {
    let document = wideTree(20);
    reconciler.build(document);
    const before = new Map(
      [...reconciler.mirror.nodeIds()].map((id) => [
        id,
        reconciler.mirror.get(id)!.handle,
      ]),
    );

    for (let i = 0; i < 20; i += 1) {
      const txn = transaction(
        makeSetProp(document, `nod_${i}`, "transform.scale", [2, 2, 2]),
      );
      document = applyTransaction(document, txn);
      reconciler.project(txn, document);
    }

    for (const [id, handle] of before) {
      expect(reconciler.mirror.get(id)!.handle).toBe(handle);
    }
  });

  it("does not re-walk an already-dirty subtree", () => {
    // Marking a parent then a child must not double-visit the subtree.
    let document = makeTree();
    reconciler.build(document);

    const txn = transaction(
      makeSetProp(document, "nod_root", "transform.position", [1, 0, 0]),
      makeSetProp(document, "nod_a", "transform.position", [2, 0, 0]),
    );
    document = applyTransaction(document, txn);
    const report = reconciler.project(txn, document);

    // 4 nodes; visits must not exceed a small constant factor of that.
    expect(report.dirty.propagationVisits).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Lifetime — 2.4f
// ---------------------------------------------------------------------------

describe("lifetime ownership", () => {
  it("refuses duplicate creation", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(() => reconciler.mirror.create("nod_a", "nod_root", "z")).toThrow(
      MirrorViolation,
    );
  });

  it("refuses a second root", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(() => reconciler.mirror.create("nod_other", null, "a")).toThrow(
      MirrorViolation,
    );
  });

  it("detects use after destroy", () => {
    let document = makeTree();
    reconciler.build(document);
    document = commit(reconciler, document, makeRemoveNode(document, "nod_a"));
    expect(() => reconciler.mirror.require("nod_a", "test")).toThrow(
      /use after destroy/,
    );
  });

  it("leaves nothing behind after teardown", () => {
    const document = makeTree();
    reconciler.build(document);
    reconciler.teardown();

    expect(reconciler.mirror.size).toBe(0);
    expect(backend.liveHandles().nodes).toBe(0);
    const stats = backend.stats();
    expect(stats.nodesCreated).toBe(stats.nodesDestroyed);
  });

  it("allows rebuild after teardown", () => {
    const document = makeTree();
    reconciler.build(document);
    reconciler.teardown();
    expect(() => reconciler.build(document)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Failure handling — 2.4k
// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("surfaces a backend exception rather than corrupting the mirror", () => {
    const document = makeTree();
    reconciler.build(document);

    backend.failures.throwOnCreateNode = true;
    expect(() =>
      commit(reconciler, document, {
        type: "node.insert",
        parentId: "nod_root",
        node: node("nod_new", generateKeyBetween("z", null)),
      }),
    ).toThrow(MirrorBackendViolation);

    backend.failures.throwOnCreateNode = false;
    // The pre-failure mirror is still internally consistent.
    expect(reconciler.mirror.has("nod_new")).toBe(false);
    expect(reconciler.mirror.size).toBe(4);
  });

  it("rejects projecting onto a node that is not mirrored", () => {
    const document = makeTree();
    reconciler.build(document);
    expect(() =>
      reconciler.project(
        transaction({
          type: "node.setProp",
          nodeId: "nod_ghost",
          path: "transform.position",
          value: [1, 0, 0],
          previousValue: [0, 0, 0],
        }),
        document,
      ),
    ).toThrow();
  });

  it("rejects a double destroy", () => {
    const document = makeTree();
    reconciler.build(document);
    reconciler.mirror.destroySubtree("nod_a");
    expect(() => reconciler.mirror.destroySubtree("nod_a")).toThrow(
      MirrorViolation,
    );
  });

  it("reports a resource failure without throwing", () => {
    // A real backend can run out of VRAM. That is a returned failure, not an
    // exception — MirrorBackend contract C7.
    backend.failures.failCreateMaterial = true;
    const result = backend.createMaterial({
      kind: "unlit",
      color: [1, 1, 1, 1],
      transparent: false,
      doubleSided: false,
    });
    expect(result.ok).toBe(false);
  });

  it("detects an orphan at teardown", () => {
    const document = makeTree();
    reconciler.build(document);

    // Simulate corruption: a node still tracked by the mirror but no longer
    // reachable from the root. Detaching on the backend side too, so the
    // failure exercised is the orphan check rather than the backend's own
    // "destroyed a node that still has children" guard.
    const root = reconciler.mirror.get("nod_root")!;
    const orphan = reconciler.mirror.get("nod_b")!;
    backend.setParent(orphan.handle, null);
    root.childIds = root.childIds.filter((id) => id !== "nod_b");

    expect(() => reconciler.teardown()).toThrow(/orphaned/);
  });

  it("still frees an orphan's backend handle while reporting it", () => {
    // Reporting is not enough — teardown must leave nothing allocated.
    const document = makeTree();
    reconciler.build(document);
    const root = reconciler.mirror.get("nod_root")!;
    const orphan = reconciler.mirror.get("nod_b")!;
    backend.setParent(orphan.handle, null);
    root.childIds = root.childIds.filter((id) => id !== "nod_b");

    expect(() => reconciler.teardown()).toThrow();
    expect(backend.liveHandles().nodes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Backend neutrality
// ---------------------------------------------------------------------------

describe("backend neutrality", () => {
  it("stores no document node in the mirror", () => {
    const document = makeTree();
    reconciler.build(document);
    const mirrorNode = reconciler.mirror.get("nod_a")!;

    // Only resolved values and an opaque handle.
    expect(mirrorNode).not.toHaveProperty("components");
    expect(mirrorNode).not.toHaveProperty("children");
    expect(mirrorNode).not.toHaveProperty("name");
    expect(typeof mirrorNode.nodeId).toBe("string");
  });

  it("does not mutate the scene graph", () => {
    const document = makeTree();
    const before = JSON.stringify(document);
    reconciler.build(document);
    expect(JSON.stringify(document)).toBe(before);
  });
});
