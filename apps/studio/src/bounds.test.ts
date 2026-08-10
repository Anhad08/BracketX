/**
 * Selection bounds under transformation.
 *
 * The invariant these defend is the one the editor lost:
 *
 *     SELECTED OBJECT GEOMETRY == SELECTION GEOMETRY
 *
 * Every assertion here is against the geometry a world matrix actually produces,
 * not against another copy of the selection code. The bug was that `nodeBounds`
 * read `matrix[0]` and `matrix[5]` as the x and y scale — true for an unrotated
 * node, and for a rotated one they are `cos(theta) * scale`, so the box shrank
 * towards zero as the node turned and stayed axis-aligned while it did.
 */
import { describe, expect, it } from "vitest";

import { nodeBounds } from "./studio/viewport";
import type { SceneDocument, SceneNode } from "@bracketx/engine-scene";

/** Column-major 4x4 for a Z rotation about the origin, then a translation. */
function world(
  tx: number,
  ty: number,
  degrees = 0,
  sx = 1,
  sy = 1,
): readonly number[] {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // prettier-ignore
  return [
    c * sx, s * sx, 0, 0,
    -s * sy, c * sy, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1,
  ];
}

function rect(id: string, width: number, height: number): SceneNode {
  return {
    id,
    name: id,
    order: id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width, height },
    components: [
      { id: `c_${id}`, type: "rect", props: { width, height, fill: "#fff" } },
    ],
  } as unknown as SceneNode;
}

function documentOf(...children: SceneNode[]): SceneDocument {
  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn",
    meta: { name: "T", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" },
    world: { units: "meters", up: "Y", handedness: "right", output: { width: 1920, height: 1080, fps: 60 } },
    variables: [], assets: [], states: [],
    root: {
      id: "nod_root", name: "root", order: "a0",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      size: { width: 17.78, height: 10 },
      children,
    } as unknown as SceneNode,
  } as SceneDocument;
}

const only = (doc: SceneDocument, matrices: Record<string, readonly number[]>) =>
  nodeBounds(doc, (id) => matrices[id])[0]!;

describe("selection bounds follow the object", () => {
  it("matches the object at rest", () => {
    const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0) });
    expect(box.rect.width).toBeCloseTo(4, 6);
    expect(box.rect.height).toBeCloseTo(2, 6);
    expect(box.rect.x).toBeCloseTo(0, 6);
    expect(box.rect.y).toBeCloseTo(0, 6);
  });

  it("follows a MOVE exactly", () => {
    const box = only(documentOf(rect("a", 4, 2)), { a: world(3, -1.5) });
    expect(box.rect.x).toBeCloseTo(3, 6);
    expect(box.rect.y).toBeCloseTo(-1.5, 6);
    expect(box.rect.width).toBeCloseTo(4, 6);
  });

  it("follows a SCALE exactly, including non-uniform", () => {
    const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0, 0, 2, 0.5) });
    expect(box.rect.width).toBeCloseTo(8, 6);
    expect(box.rect.height).toBeCloseTo(1, 6);
  });

  it("ROTATES: at 90 degrees the extents swap", () => {
    // THE BUG. `matrix[0]` is cos(90) = 0, so the old code reported a width of
    // zero and a box that had collapsed — while the object was plainly on screen
    // turned on its side.
    const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0, 90) });
    expect(box.rect.width, "a 90-degree turn did not swap the extents").toBeCloseTo(2, 5);
    expect(box.rect.height).toBeCloseTo(4, 5);
  });

  it("ROTATES: at 45 degrees the bounds are the diagonal extent", () => {
    // 4x2 turned 45 degrees spans (4+2)/sqrt(2) = 4.2426 on both axes.
    const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0, 45) });
    const expected = 6 / Math.SQRT2;
    expect(box.rect.width).toBeCloseTo(expected, 4);
    expect(box.rect.height).toBeCloseTo(expected, 4);
  });

  it("never collapses at any angle, and never exceeds the diagonal", () => {
    // The old code's width traced cos(theta): correct at 0, zero at 90. This
    // sweeps the whole turn and holds the box between the shorter side and the
    // true diagonal, which is the property that makes a rotated object grabbable
    // at every angle rather than only near zero.
    const diagonal = Math.hypot(4, 2);
    for (let angle = 0; angle <= 180; angle += 7.5) {
      const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0, angle) });
      expect(box.rect.width, `width collapsed at ${angle} degrees`).toBeGreaterThan(1.9);
      expect(box.rect.width, `width exceeded the diagonal at ${angle}`).toBeLessThanOrEqual(
        diagonal + 1e-6,
      );
      expect(box.rect.height, `height collapsed at ${angle} degrees`).toBeGreaterThan(1.9);
    }
  });

  it("rotates AND moves together, so the box travels with the object", () => {
    const box = only(documentOf(rect("a", 4, 2)), { a: world(-2.5, 1.25, 30) });
    // The centre is the translation regardless of angle: a rotation about the
    // node's own origin moves no centre.
    expect(box.rect.x).toBeCloseTo(-2.5, 6);
    expect(box.rect.y).toBeCloseTo(1.25, 6);
  });

  it("combines rotation with non-uniform scale", () => {
    // 8x1 (4x2 scaled 2 and 0.5) turned 90 degrees: extents swap to 1x8.
    const box = only(documentOf(rect("a", 4, 2)), { a: world(0, 0, 90, 2, 0.5) });
    expect(box.rect.width).toBeCloseTo(1, 5);
    expect(box.rect.height).toBeCloseTo(8, 5);
  });

  it("skips a node the mirror has no matrix for, rather than guessing", () => {
    expect(nodeBounds(documentOf(rect("a", 4, 2)), () => undefined)).toHaveLength(0);
  });

  it("boxes a SIZELESS GROUP by what is inside it", () => {
    // `arrange.group` gives its container a transform and no size, so this used
    // to be skipped entirely: press Ctrl+G and the thing you just made had no
    // frame, no handles, and clicking it selected a child instead.
    const container = {
      id: "g", name: "Group", order: "a1",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children: [rect("a", 2, 2), rect("b", 2, 2)],
    } as unknown as SceneNode;
    const box = nodeBounds(documentOf(container), (id) =>
      id === "a" ? world(-3, 0) : id === "b" ? world(3, 1) : world(0, 0),
    );
    const g = box.find((entry) => entry.nodeId === "g")!;
    expect(g, "a grouped selection has no bounds at all").toBeDefined();
    // -4..4 across, -1..2 up: the children's union, with nothing added.
    expect(g.rect.width).toBeCloseTo(8, 6);
    expect(g.rect.height).toBeCloseTo(3, 6);
    expect(g.rect.x).toBeCloseTo(0, 6);
    expect(g.rect.y).toBeCloseTo(0.5, 6);
  });

  it("emits a parent BEFORE its children, so the topmost node wins a pick", () => {
    // `pick` takes the last match. Reversing this order hands back the group
    // whenever a child is clicked.
    const container = {
      id: "g", name: "Group", order: "a1",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children: [rect("a", 2, 2), rect("b", 2, 2)],
    } as unknown as SceneNode;
    const ids = nodeBounds(documentOf(container), () => world(0, 0)).map((b) => b.nodeId);
    expect(ids).toEqual(["g", "a", "b"]);
  });

  it("omits a sizeless node with nothing measurable in it", () => {
    // An empty group is not a box at the origin — inventing one would put a
    // selectable target where there is no object.
    const empty = {
      id: "g", name: "Group", order: "a1",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    } as unknown as SceneNode;
    expect(nodeBounds(documentOf(empty), () => world(0, 0))).toHaveLength(0);
  });

  it("never reports the root, so empty space is not selectable", () => {
    // Clicking nothing used to select the document and drag the whole scene.
    const doc = documentOf(rect("a", 4, 2));
    const ids = nodeBounds(doc, () => world(0, 0)).map((b) => b.nodeId);
    expect(ids).not.toContain("nod_root");
    expect(ids).toEqual(["a"]);
  });
});
