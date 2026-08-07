/**
 * Viewport helpers — cameras and lights you can see and click.
 *
 * ============================================================================
 * THE CLAIM UNDER TEST
 * ============================================================================
 * A helper is only useful if it lands exactly where the thing it describes
 * actually is. A frustum drawn from slightly different numbers than the
 * renderer projects through would look plausible and be wrong — and "wrong by
 * a little" is the failure that survives review, because it still looks like a
 * camera.
 *
 * So these check the geometry against the same projection the renderer uses,
 * and they check the two cases that break helpers in every editor that has
 * them: things behind the camera, and two objects close enough together that
 * one becomes unclickable.
 */
import { describe, expect, it } from "vitest";
import type { CameraDescriptor } from "@bracketx/engine-reconciler";

import { project, worldFromEuler, type CameraView } from "./studio/camera";
import {
  ICON_RADIUS,
  cameraFrustum,
  helpers,
  lightHelper,
  pickHelper,
  type HelperSource,
} from "./studio/helpers";

const CANVAS = { width: 1920, height: 1080 };
const ASPECT = CANVAS.width / CANVAS.height;

/** An editor camera at +Z looking back at the origin. */
function editorView(distance = 12): CameraView {
  return {
    descriptor: {
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 200,
    } as CameraDescriptor,
    world: worldFromEuler({ x: 0, y: 0, z: distance }, [0, 0, 0]),
    canvas: CANVAS,
  };
}

const BROADCAST: CameraDescriptor = {
  kind: "perspective",
  focalLengthMm: 35,
  sensorWidthMm: 36,
  near: 0.1,
  far: 100,
} as CameraDescriptor;

const FLAT: CameraDescriptor = {
  kind: "orthographic",
  size: 5,
  near: 0.1,
  far: 100,
} as CameraDescriptor;

describe("the frustum is the framing, not an impression of it", () => {
  it("draws a closed volume for a perspective camera", () => {
    // Four near edges, four far edges, four connecting edges, four rays to the
    // lens. Anything less is not a frustum, it is a suggestion.
    const lines = cameraFrustum(editorView(), worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]), BROADCAST, ASPECT);
    expect(lines).toHaveLength(16);
  });

  it("omits the rays for an orthographic camera, because it has no apex", () => {
    // An orthographic volume does not converge. Drawing rays to a point would
    // claim a viewpoint the projection does not have.
    const lines = cameraFrustum(editorView(), worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]), FLAT, ASPECT);
    expect(lines).toHaveLength(12);
  });

  it("keeps the same rectangle at every depth when orthographic", () => {
    // The property that makes 2D framing predictable: near and far are the
    // same size in WORLD space, so the volume has parallel sides.
    //
    // Measured through an ORTHOGRAPHIC editor view on purpose. Through a
    // perspective one the far rectangle projects smaller — correctly — and
    // asserting equal screen widths would be measuring the editor camera
    // rather than the broadcast camera. That was this test's first version
    // and it failed for exactly that reason.
    const flatEditor: CameraView = {
      descriptor: { kind: "orthographic", size: 12, near: 0.1, far: 200 } as CameraDescriptor,
      world: worldFromEuler({ x: 0, y: 0, z: 30 }, [0, 0, 0]),
      canvas: CANVAS,
    };
    const lines = cameraFrustum(
      flatEditor,
      worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]),
      FLAT,
      ASPECT,
    );
    // Horizontal edges only. The near-to-far connecting edges are seen exactly
    // end-on from this view and project to zero length — including them would
    // be comparing a rectangle's width against a point.
    const widths = lines
      .filter((line) => Math.abs(line.a.y - line.b.y) < 1 && Math.abs(line.a.x - line.b.x) > 1)
      .map((line) => Math.abs(line.a.x - line.b.x));
    expect(widths.length).toBeGreaterThan(1);
    for (const width of widths) expect(width).toBeCloseTo(widths[0]!, 0);
  });

  it("widens with a shorter lens, exactly as the renderer would", () => {
    // Drawn from the SAME verticalFov the renderer projects through. A wider
    // lens must produce a wider box or the helper is describing a different
    // camera from the one that is shooting.
    const view = editorView(20);
    const world = worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]);
    const spread = (focal: number) => {
      const lens = {
        kind: "perspective",
        focalLengthMm: focal,
        sensorWidthMm: 36,
        near: 0.1,
        far: 100,
      } as CameraDescriptor;
      const lines = cameraFrustum(view, world, lens, ASPECT);
      const xs = lines.flatMap((line) => [line.a.x, line.b.x]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(18)).toBeGreaterThan(spread(85));
  });

  it("survives a camera behind the viewer without drawing across the screen", () => {
    // A segment with one end behind the eye projects to a point on the WRONG
    // side of the screen. The ground grid paid for this once; the clipping is
    // reused rather than reimplemented.
    const view = editorView(4);
    const behind = worldFromEuler({ x: 0, y: 0, z: 40 }, [0, 0, 0]);
    const lines = cameraFrustum(view, behind, BROADCAST, ASPECT);
    for (const line of lines) {
      expect(Number.isFinite(line.a.x)).toBe(true);
      expect(Number.isFinite(line.b.x)).toBe(true);
    }
  });
});

describe("a light is drawn as the thing it physically does", () => {
  const world = worldFromEuler({ x: 0, y: 2, z: 0 }, [0, 0, 0]);

  it("draws PARALLEL rays for a directional light", () => {
    // Directional means parallel. A cone here would be a lie about how the
    // scene is actually lit.
    const lines = lightHelper(editorView(), world, "directional");
    expect(lines).toHaveLength(4);
  });

  it("draws a real cone at the spot's real angle", () => {
    const narrow = lightHelper(editorView(), world, "spot", { angle: Math.PI / 12 });
    const wide = lightHelper(editorView(), world, "spot", { angle: Math.PI / 3 });
    const spread = (lines: readonly { a: { x: number }; b: { x: number } }[]) => {
      const xs = lines.flatMap((line) => [line.a.x, line.b.x]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });

  it("draws NOTHING for an ambient light", () => {
    // It has no position and no direction that matters. A shape would be a
    // fiction the renderer does not honour.
    expect(lightHelper(editorView(), world, "ambient")).toEqual([]);
  });
});

describe("what is drawn can be clicked", () => {
  const sources: readonly HelperSource[] = [
    {
      nodeId: "node_camera",
      kind: "camera",
      world: worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]),
      descriptor: BROADCAST,
    },
    {
      nodeId: "node_key",
      kind: "directional",
      world: worldFromEuler({ x: 3, y: 3, z: 0 }, [0, 0, 0]),
    },
    {
      nodeId: "node_fill",
      kind: "ambient",
      world: worldFromEuler({ x: -3, y: 1, z: 0 }, [0, 0, 0]),
    },
  ];

  it("gives every camera and light a mark, ambient included", () => {
    // An ambient light draws no wireframe, but it must still be FINDABLE —
    // otherwise the one light a beginner most wants to turn down is the one
    // they cannot select.
    const drawn = helpers(editorView(), sources, ASPECT);
    expect(drawn.map((helper) => helper.nodeId).sort()).toEqual([
      "node_camera",
      "node_fill",
      "node_key",
    ]);
    expect(drawn.find((helper) => helper.nodeId === "node_fill")!.lines).toEqual([]);
  });

  it("picks the helper under the pointer", () => {
    const drawn = helpers(editorView(), sources, ASPECT);
    const key = drawn.find((helper) => helper.nodeId === "node_key")!;
    expect(pickHelper(drawn, key.at)).toBe("node_key");
    expect(pickHelper(drawn, { x: key.at.x + 400, y: key.at.y })).toBeNull();
  });

  it("picks the NEAREST, so two close lights are both reachable", () => {
    // First-match would make one of a close pair permanently unselectable,
    // and a key and a fill are placed close together by design.
    const close: readonly HelperSource[] = [
      { nodeId: "node_a", kind: "point", world: worldFromEuler({ x: 0, y: 0, z: 0 }, [0, 0, 0]) },
      { nodeId: "node_b", kind: "point", world: worldFromEuler({ x: 0.35, y: 0, z: 0 }, [0, 0, 0]) },
    ];
    const drawn = helpers(editorView(), close, ASPECT);
    const a = drawn.find((helper) => helper.nodeId === "node_a")!;
    const b = drawn.find((helper) => helper.nodeId === "node_b")!;
    expect(a.at.x).not.toBeCloseTo(b.at.x, 0);
    expect(pickHelper(drawn, a.at)).toBe("node_a");
    expect(pickHelper(drawn, b.at)).toBe("node_b");
  });

  it("drops anything behind the camera rather than drawing it at the edge", () => {
    const view = editorView(4);
    const drawn = helpers(
      view,
      [
        {
          nodeId: "node_behind",
          kind: "point",
          world: worldFromEuler({ x: 0, y: 0, z: 40 }, [0, 0, 0]),
        },
      ],
      ASPECT,
    );
    expect(drawn).toEqual([]);
  });

  it("orders far helpers first, so a near icon lands on top", () => {
    // Helpers are chrome and are not depth-tested against the picture, so
    // ordering among themselves is the only correctness available.
    const drawn = helpers(
      editorView(20),
      [
        { nodeId: "node_far", kind: "point", world: worldFromEuler({ x: 0, y: 0, z: -10 }, [0, 0, 0]) },
        { nodeId: "node_near", kind: "point", world: worldFromEuler({ x: 0, y: 0, z: 10 }, [0, 0, 0]) },
      ],
      ASPECT,
    );
    expect(drawn.map((helper) => helper.nodeId)).toEqual(["node_far", "node_near"]);
  });

  it("puts the icon exactly where the node is", () => {
    // The property everything else rests on: a helper that is a few pixels
    // out is a helper that selects the wrong thing.
    const view = editorView();
    const world = worldFromEuler({ x: 2, y: -1, z: 0 }, [0, 0, 0]);
    const drawn = helpers(view, [{ nodeId: "node_x", kind: "point", world }], ASPECT);
    const expected = project(view, { x: 2, y: -1, z: 0 })!;
    expect(drawn[0]!.at.x).toBeCloseTo(expected.point.x, 4);
    expect(drawn[0]!.at.y).toBeCloseTo(expected.point.y, 4);
  });

  it("has a hit radius a person can actually hit", () => {
    // A 13px target is the smallest thing a pointer reliably lands on. Stated
    // as a constant so it cannot drift to something only a mouse can manage.
    expect(ICON_RADIUS).toBeGreaterThanOrEqual(12);
  });
});
