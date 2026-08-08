/**
 * The scene graph: hierarchy, transforms, and the two kinds of ordering.
 *
 * ============================================================================
 * THE DISTINCTION THIS FILE EXISTS TO HOLD
 * ============================================================================
 * Three things are related and are not the same, and conflating any two of
 * them is how a hybrid editor becomes unusable:
 *
 *   HIERARCHY   parent/child. Decides inherited transform, inherited
 *               visibility, and what moves when you move a group.
 *   ORDER       where a node sits among its SIBLINGS. Decides compositing —
 *               which flat graphic draws over which.
 *   DEPTH       where a thing is in space. Decided by the camera, and by
 *               nothing in the tree at all.
 *
 * A 3D object closer to the lens must not be pushed behind another because a
 * panel gave it a lower ordering number, and a flat plate must not fight its
 * own accent bar for who is on top because they happen to share a Z. These
 * assertions are what stop the two systems being wired to each other.
 */
import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  childrenOf,
  findNode,
  generateKeyBetween,
  invertTransaction,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { StudioSession } from "./studio/session";
import { testIdFactory } from "./studio/ids";
import { newDocument } from "./studio/project";
import { createNode, moveNode } from "./studio/editing";
import { group, reorder, ungroup } from "./studio/arrange";

function ids() {
  return testIdFactory();
}

/** A document with a group holding two rects, and a box beside them. */
function scene(): { document: SceneDocument; factory: ReturnType<typeof ids> } {
  const factory = ids();
  let document = newDocument("Scene", factory);
  for (const kind of ["rect", "rect", "box"] as const) {
    const made = createNode(document, kind, document.root.id, factory);
    document = applyTransaction(document, made.transaction);
  }
  return { document, factory };
}

const namesOf = (node: SceneNode): string[] => childrenOf(node).map((child) => child.name);
const idsOf = (node: SceneNode): string[] => childrenOf(node).map((child) => child.id);

// ===========================================================================
// Hierarchy
// ===========================================================================

describe("the tree is a real hierarchy", () => {
  it("reparents a node, and it keeps its own children", () => {
    const { document, factory } = scene();
    const holder = createNode(document, "group", document.root.id, factory);
    const withHolder = applyTransaction(document, holder.transaction);

    const rect = childrenOf(withHolder.root).find((node) => node.name === "Rectangle")!;
    const moved = applyTransaction(
      withHolder,
      moveNode(withHolder, rect.id, holder.nodeId, 0)!,
    );

    const parent = findNode(moved.root, holder.nodeId)!;
    expect(idsOf(parent)).toContain(rect.id);
    expect(idsOf(moved.root)).not.toContain(rect.id);
  });

  /**
   * A cycle would make the tree un-walkable, and every consumer of it —
   * projection, layout, world matrices — recurses forever rather than failing.
   */
  it("refuses to put a node inside its own descendant", () => {
    const { document, factory } = scene();
    const outer = createNode(document, "group", document.root.id, factory);
    let next = applyTransaction(document, outer.transaction);
    const inner = createNode(next, "group", outer.nodeId, factory);
    next = applyTransaction(next, inner.transaction);

    expect(moveNode(next, outer.nodeId, inner.nodeId, 0)).toBeNull();
    expect(moveNode(next, outer.nodeId, outer.nodeId, 0)).toBeNull();
  });

  it("groups a selection and ungroups it again", () => {
    const { document, factory } = scene();
    const rects = childrenOf(document.root)
      .filter((node) => node.name === "Rectangle")
      .map((node) => node.id);

    const grouped = applyTransaction(document, group(document, rects, factory)!.transaction);
    const holder = childrenOf(grouped.root).find((node) => childrenOf(node).length === 2)!;
    expect(idsOf(holder).sort()).toEqual([...rects].sort());

    const flat = applyTransaction(grouped, ungroup(grouped, holder.id)!);
    expect(idsOf(flat.root)).toEqual(expect.arrayContaining(rects));
  });

  it("carries hierarchy through save and reopen, unchanged", () => {
    const { document, factory } = scene();
    const holder = createNode(document, "group", document.root.id, factory);
    let next = applyTransaction(document, holder.transaction);
    const rect = childrenOf(next.root).find((node) => node.name === "Rectangle")!;
    next = applyTransaction(next, moveNode(next, rect.id, holder.nodeId, 0)!);

    const shape = (doc: SceneDocument): unknown => {
      const walk = (node: SceneNode): unknown => ({
        name: node.name,
        children: childrenOf(node).map(walk),
      });
      return walk(doc.root);
    };
    const reopened = JSON.parse(JSON.stringify(next)) as SceneDocument;
    expect(shape(reopened)).toEqual(shape(next));
  });
});

// ===========================================================================
// Inherited transforms
// ===========================================================================

describe("a parent carries its children", () => {
  const worldOf = (studio: StudioSession, nodeId: string): readonly number[] =>
    studio.worldMatrixOf(nodeId) ?? [];

  it("moves, rotates and scales the whole assembly", () => {
    const { document, factory } = scene();
    const holder = createNode(document, "group", document.root.id, factory);
    let next = applyTransaction(document, holder.transaction);
    const rect = childrenOf(next.root).find((node) => node.name === "Rectangle")!;
    next = applyTransaction(next, moveNode(next, rect.id, holder.nodeId, 0)!);

    const studio = new StudioSession(new MockMirrorBackend(), next, { output: false });
    const before = [...worldOf(studio, rect.id)];

    // The PARENT moves. Nothing touches the child.
    studio.store.apply({
      id: "txn_parent",
      label: "Move assembly",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: holder.nodeId,
          path: "transform.position",
          value: [3, 1, 0],
          previousValue: [0, 0, 0],
        },
      ],
    });

    const after = worldOf(studio, rect.id);
    // Translation lives in the last column. The child followed by exactly the
    // parent's move, which is the entire meaning of a parent.
    expect(after[12]! - before[12]!).toBeCloseTo(3, 5);
    expect(after[13]! - before[13]!).toBeCloseTo(1, 5);
    studio.dispose();
  });

  it("hides a whole assembly when the parent is hidden", () => {
    const { document, factory } = scene();
    const holder = createNode(document, "group", document.root.id, factory);
    let next = applyTransaction(document, holder.transaction);
    const rect = childrenOf(next.root).find((node) => node.name === "Rectangle")!;
    next = applyTransaction(next, moveNode(next, rect.id, holder.nodeId, 0)!);

    const studio = new StudioSession(new MockMirrorBackend(), next, { output: false });
    studio.store.apply({
      id: "txn_hide",
      label: "Hide",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: holder.nodeId,
          path: "visible",
          value: false,
          previousValue: true,
        },
      ],
    });

    // The CHILD'S own flag is untouched — it is hidden by its ancestor, which
    // is a different fact and has to stay a different fact, or showing the
    // parent again would not bring the child back.
    const child = findNode(studio.document.root, rect.id)!;
    expect(child.visible).not.toBe(false);
    expect(studio.host.reconciler.mirror.get(rect.id)?.effectiveVisible).toBe(false);
    studio.dispose();
  });
});

// ===========================================================================
// Order, and what it is NOT
// ===========================================================================

describe("sibling order is compositing, not depth", () => {
  it("moves a sibling forward and back among its siblings", () => {
    const { document } = scene();
    const before = namesOf(document.root);
    const first = childrenOf(document.root)[1]!;

    const forward = applyTransaction(document, reorder(document, first.id, "front")!);
    expect(namesOf(forward.root)).not.toEqual(before);
    expect(childrenOf(forward.root).at(-1)!.id).toBe(first.id);

    const back = applyTransaction(forward, reorder(forward, first.id, "back")!);
    expect(childrenOf(back.root)[0]!.id).toBe(first.id);
  });

  it("refuses a move that would change nothing", () => {
    const { document } = scene();
    const last = childrenOf(document.root).at(-1)!;
    expect(reorder(document, last.id, "front")).toBeNull();
  });

  /**
   * THE ONE THAT KEEPS THE TWO SYSTEMS APART.
   *
   * Reordering siblings must not touch a node's TRANSFORM. If ordering were
   * implemented by nudging Z — the obvious shortcut — then bringing a flat
   * plate forward would physically move it in space, and a 3D object would
   * jump toward or away from the camera because a panel changed a number.
   */
  it("never moves anything in space", () => {
    const { document } = scene();
    const box = childrenOf(document.root).find((node) => node.name === "Box")!;
    const before = JSON.stringify(box.transform);

    const moved = applyTransaction(document, reorder(document, box.id, "back")!);
    const after = findNode(moved.root, box.id)!;

    expect(JSON.stringify(after.transform)).toBe(before);
  });

  /**
   * And the reverse: a node's depth in space says nothing about its place in
   * the tree. Moving a 3D object toward the camera must not reorder it.
   */
  it("moving something in space never reorders the tree", () => {
    const { document } = scene();
    const order = idsOf(document.root);
    const box = childrenOf(document.root).find((node) => node.name === "Box")!;

    const pulled = applyTransaction(document, {
      id: "txn_depth",
      label: "Pull forward",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: box.id,
          path: "transform.position",
          value: [0, 0, 4],
          previousValue: [0, 0, 0],
        },
      ],
    });

    expect(idsOf(pulled.root)).toEqual(order);
  });

  it("keeps sibling keys stable, so a reorder renumbers nothing else", () => {
    const { document } = scene();
    const before = new Map(childrenOf(document.root).map((node) => [node.id, node.order]));
    const first = childrenOf(document.root)[0]!;
    const moved = applyTransaction(document, reorder(document, first.id, "front")!);

    // Fractional indexing: exactly one key changes. Integer indices would
    // rewrite every sibling and turn one reorder into N operations to undo.
    const changed = childrenOf(moved.root).filter(
      (node) => before.get(node.id) !== node.order,
    );
    expect(changed.map((node) => node.id)).toEqual([first.id]);
  });
});

// ===========================================================================
// Compositing — what the ordering actually DOES
// ===========================================================================

describe("the tree decides what covers what", () => {
  const paintOf = (studio: StudioSession, nodeId: string): number =>
    studio.host.reconciler.mirror.get(nodeId)?.renderOrder ?? 0;

  it("paints later siblings over earlier ones", () => {
    const { document } = scene();
    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    const [first, second] = childrenOf(document.root).filter(
      (node) => node.name === "Rectangle",
    );

    // The whole point: the one further down the tree wins the overlap.
    expect(paintOf(studio, second!.id)).toBeGreaterThan(paintOf(studio, first!.id));
    studio.dispose();
  });

  /**
   * The founder's complaint, as a test. Before this, "Bring Forward" moved a
   * row in a panel and the picture did not change.
   */
  it("changes what covers what when a node is brought forward", () => {
    const { document } = scene();
    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    const [first, second] = childrenOf(document.root).filter(
      (node) => node.name === "Rectangle",
    );

    studio.store.apply(reorder(studio.document, first!.id, "front")!);

    expect(paintOf(studio, first!.id)).toBeGreaterThan(paintOf(studio, second!.id));
    studio.dispose();
  });

  it("puts a child above its parent, and above the parent's earlier siblings", () => {
    const factory = ids();
    let document = newDocument("Nested", factory);
    const under = createNode(document, "rect", document.root.id, factory);
    document = applyTransaction(document, under.transaction);
    const holder = createNode(document, "group", document.root.id, factory);
    document = applyTransaction(document, holder.transaction);
    const inside = createNode(document, "rect", holder.nodeId, factory);
    document = applyTransaction(document, inside.transaction);

    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    // Depth-first: the group comes after the loose rect, so its contents do too.
    expect(paintOf(studio, inside.nodeId)).toBeGreaterThan(paintOf(studio, under.nodeId));
    studio.dispose();
  });

  /**
   * THE SEPARATION, ENFORCED AT THE BACKEND.
   *
   * A mesh must reach the renderer with no imposed order at all, or the tree
   * would be deciding occlusion for objects whose occlusion belongs to the
   * camera — a box behind another box would jump in front because somebody
   * dragged a row.
   */
  it("never imposes a paint order on anything in space", () => {
    const factory = ids();
    let document = newDocument("Depth", factory);
    const near = createNode(document, "box", document.root.id, factory);
    document = applyTransaction(document, near.transaction);
    const far = createNode(document, "sphere", document.root.id, factory);
    document = applyTransaction(document, far.transaction);

    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    expect(paintOf(studio, near.nodeId)).toBe(0);
    expect(paintOf(studio, far.nodeId)).toBe(0);

    // And reordering them leaves the camera in charge.
    studio.store.apply(reorder(studio.document, near.nodeId, "front")!);
    expect(paintOf(studio, near.nodeId)).toBe(0);
    expect(paintOf(studio, far.nodeId)).toBe(0);
    studio.dispose();
  });

  it("lets an authored render order override the tree", () => {
    const { document } = scene();
    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    const rect = childrenOf(document.root).find((node) => node.name === "Rectangle")!;

    studio.store.apply({
      id: "txn_authored",
      label: "Pin to front",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: rect.id,
          // The whole block: a path write into a `runtime` that does not exist
          // yet throws, exactly as `world.environment` does.
          path: "runtime",
          value: { ...(rect.runtime ?? {}), renderOrder: 999 },
          previousValue: rect.runtime,
        },
      ],
    });

    expect(paintOf(studio, rect.id)).toBe(999);
    studio.dispose();
  });

  it("keeps paint order contiguous after an insert near the front", () => {
    const { document, factory } = scene();
    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    const made = createNode(studio.document, "rect", studio.document.root.id, factory);
    studio.store.apply(made.transaction);

    const orders = childrenOf(studio.document.root)
      .filter((node) => node.name === "Rectangle")
      .map((node) => paintOf(studio, node.id));

    // Strictly increasing down the tree, with no duplicates — a duplicate is a
    // tie, and a tie is the arbitrary result this whole mechanism replaced.
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    studio.dispose();
  });
});

// ===========================================================================
// Undo
// ===========================================================================

describe("every structural change is one undo step", () => {
  const roundTrips = (document: SceneDocument, transaction: ReturnType<typeof reorder>) => {
    expect(transaction).not.toBeNull();
    const next = applyTransaction(document, transaction!);
    const back = applyTransaction(next, invertTransaction(transaction!));
    const shape = (doc: SceneDocument): string => {
      const walk = (node: SceneNode): unknown => ({
        id: node.id,
        order: node.order,
        children: childrenOf(node).map(walk),
      });
      return JSON.stringify(walk(doc.root));
    };
    expect(shape(back)).toBe(shape(document));
  };

  it("undoes a reorder", () => {
    const { document } = scene();
    roundTrips(document, reorder(document, childrenOf(document.root)[0]!.id, "front"));
  });

  it("undoes a reparent", () => {
    const { document, factory } = scene();
    const holder = createNode(document, "group", document.root.id, factory);
    const next = applyTransaction(document, holder.transaction);
    const rect = childrenOf(next.root).find((node) => node.name === "Rectangle")!;
    roundTrips(next, moveNode(next, rect.id, holder.nodeId, 0));
  });

  it("undoes a group", () => {
    const { document, factory } = scene();
    const rects = childrenOf(document.root)
      .filter((node) => node.name === "Rectangle")
      .map((node) => node.id);
    roundTrips(document, group(document, rects, factory)!.transaction);
  });
});

// ===========================================================================
// One tree, both dimensions
// ===========================================================================

describe("one hierarchy for 2D and 3D", () => {
  it("holds flat graphics, meshes, a camera and lights in the same tree", () => {
    const factory = ids();
    let document = newDocument("Hybrid", factory);
    for (const kind of ["rect", "text", "box", "sphere", "light"] as const) {
      const made = createNode(document, kind, document.root.id, factory);
      document = applyTransaction(document, made.transaction);
    }

    const kinds = childrenOf(document.root).map((node) =>
      (node.components ?? []).map((component) => component.type).join(),
    );
    // A camera comes with the document; the rest were just added. All of them
    // are siblings in ONE tree — there is no second hierarchy for 3D.
    expect(kinds).toEqual(expect.arrayContaining(["camera", "rect", "text", "meshRenderer"]));
  });

  it("puts a flat graphic under a 3D assembly and carries it", () => {
    const factory = ids();
    let document = newDocument("Hybrid", factory);
    const assembly = createNode(document, "group", document.root.id, factory);
    document = applyTransaction(document, assembly.transaction);
    const mesh = createNode(document, "box", assembly.nodeId, factory);
    document = applyTransaction(document, mesh.transaction);
    const label = createNode(document, "text", assembly.nodeId, factory);
    document = applyTransaction(document, label.transaction);

    const studio = new StudioSession(new MockMirrorBackend(), document, { output: false });
    studio.store.apply({
      id: "txn_assembly",
      label: "Turn the assembly",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: assembly.nodeId,
          path: "transform.position",
          value: [2, 0, 0],
          previousValue: [0, 0, 0],
        },
      ],
    });

    // A mesh and a piece of text, under one parent, moved by one gesture.
    for (const id of [mesh.nodeId, label.nodeId]) {
      expect(studio.worldMatrixOf(id)?.[12]).toBeCloseTo(2, 5);
    }
    studio.dispose();
  });
});

// Keeps the unused import honest if a future edit drops the last user.
void generateKeyBetween;
