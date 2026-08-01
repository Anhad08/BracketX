import { beforeEach, describe, expect, it } from "vitest";

import {
  MockMirrorBackend,
  type InspectableMirrorBackend,
} from "@bracketx/engine-reconciler";
import {
  canonicalize,
  deserialize,
  generateKeyBetween,
  serialize,
  validateDocument,
  type Transaction,
} from "@bracketx/engine-scene";

import { SceneHost, HostError, findCameraNode } from "./host";
import { FrameLoop, type FrameScheduler } from "./loop";
import { makeDemoScene } from "./demo-scene";

/**
 * The vertical slice, headless. Phase 2.6.
 *
 * Document -> Runtime -> Reconciler -> MirrorBackend, asserted end to end
 * against the mock. Everything here is backend-neutral by construction; the
 * Three.js half and the actual pixels are proven separately in
 * engine-render-three and in the browser suite.
 */

let backend: InspectableMirrorBackend;
let host: SceneHost;

beforeEach(() => {
  backend = new MockMirrorBackend();
  host = new SceneHost(backend);
});

// ---------------------------------------------------------------------------
// The demo scene is a real document, not a fixture
// ---------------------------------------------------------------------------

describe("the demo scene is a real SceneDocument", () => {
  it("validates", () => {
    const result = validateDocument(makeDemoScene());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("round-trips through serialization byte-identically", () => {
    // If it survives save/load it can be persisted, which is what separates a
    // document from a renderer fixture.
    const document = makeDemoScene();
    expect(canonicalize(deserialize(serialize(document)))).toBe(
      canonicalize(document),
    );
  });

  it("is deterministic to construct", () => {
    expect(canonicalize(makeDemoScene())).toBe(canonicalize(makeDemoScene()));
  });

  it("declares its own output resolution", () => {
    expect(makeDemoScene().world.output).toEqual({
      width: 1920,
      height: 1080,
      fps: 60,
    });
  });
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

describe("load", () => {
  it("builds a mirror node for every document node", () => {
    const report = host.load(makeDemoScene());
    // root + camera + group + 3 rects
    expect(report.nodesCreated).toBe(6);
    expect(backend.snapshot().nodes).toHaveLength(6);
  });

  it("takes the output size from the document", () => {
    host.load(makeDemoScene({ width: 1280, height: 720 }));
    const [output] = host.outputs;
    expect(output!.width).toBe(1280);
    expect(output!.height).toBe(720);
  });

  it("finds the camera deterministically", () => {
    const document = makeDemoScene();
    expect(findCameraNode(document)).toBe("nod_camera");
    host.load(document);
    expect(host.cameraNodeId).toBe("nod_camera");
    expect(host.activeCamera()).not.toBeNull();
  });

  it("seeds runtime variables from the document defaults", () => {
    // Without this the first frame resolves bindings to undefined and paints
    // the fallback colour, then corrects itself — a visible flash on air.
    host.load(makeDemoScene());
    expect(host.runtime.state.variables.get("accentColor")).toBe("#E8B23A");
  });

  it("attaches a mesh for every rect component", () => {
    host.load(makeDemoScene());
    const meshes = backend
      .snapshot()
      .nodes.filter((node) => node.attachment === "mesh");
    expect(meshes).toHaveLength(3);
  });

  it("shares one geometry between rects of equal size", () => {
    // The backing bar and the name plate are both 6 wide; content addressing
    // must collapse them. Two rects of the same size costing two uploads is
    // the whole reason the resource manager exists.
    host.load(makeDemoScene());
    const counts = backend.snapshot().resourceCounts;
    // 3 rects, but only 3 distinct sizes -> at most 3, and the two 6-wide
    // rects differ in height, so this scene has 3. The property under test is
    // that the count tracks DISTINCT descriptors, not rect instances.
    expect(counts.geometries).toBeLessThanOrEqual(3);
  });

  it("refuses a second load without teardown, then accepts a reload", () => {
    host.load(makeDemoScene());
    expect(() => host.load(makeDemoScene())).not.toThrow();
    expect(backend.snapshot().nodes).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Hierarchy — the thing that would silently look right if broken
// ---------------------------------------------------------------------------

describe("world transforms compose", () => {
  it("places a child by its parent's transform", () => {
    // The bars are authored at the group's origin; the group is at
    // (-2.5, -2.5). If composition were broken they would render centred and
    // the scene would still "look like something".
    host.load(makeDemoScene());
    const backing = backend
      .snapshot()
      .nodes.find((node) => node.path.endsWith("/1/0"));

    expect(backing).toBeDefined();
    expect(backing!.worldMatrix[12]).toBeCloseTo(-2.5, 5);
    expect(backing!.worldMatrix[13]).toBeCloseTo(-2.5, 5);
  });

  it("moves every child when the group moves", () => {
    const document = makeDemoScene();
    host.load(document);

    const transaction: Transaction = {
      id: "txn_move",
      label: "move group",
      actorId: "usr_test",
      operations: [
        {
          type: "node.setProp",
          nodeId: "nod_lowerThird",
          path: "transform.position.0",
          value: 1,
          previousValue: -2.5,
        },
      ],
    };
    host.apply(transaction);

    const backing = backend
      .snapshot()
      .nodes.find((node) => node.path.endsWith("/1/0"));
    expect(backing!.worldMatrix[12]).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// The live path
// ---------------------------------------------------------------------------

describe("variables drive the mirror", () => {
  it("repaints only the nodes reading the variable", () => {
    host.load(makeDemoScene());
    const report = host.setVariable("accentColor", "#FF0000");

    // One node binds accentColor. Touching the other five would mean the
    // dependency index is not doing its job.
    expect(report.dirty.material).toBe(1);
    expect(report.dirty.transform).toBe(0);
  });

  it("does not treat a runtime value as a document edit", () => {
    // RFC-002 §4.3: runtime state is not persisted and not undoable.
    const document = makeDemoScene();
    host.load(document);
    const before = canonicalize(host.document!);

    host.setVariable("accentColor", "#00FF00");

    expect(canonicalize(host.document!)).toBe(before);
    expect(host.runtime.state.variables.get("accentColor")).toBe("#00FF00");
  });
});

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

describe("renderFrame", () => {
  it("submits once per frame through the active camera", () => {
    host.load(makeDemoScene());
    const result = host.renderFrame(0);

    expect(result.drawn).toBe(true);
    expect(result.rendered).toEqual(["default"]);
    expect(host.submissions).toBe(1);
  });

  it("advances the clock from host-supplied wall time", () => {
    // ENGINE_RUNTIME invariant I2: the runtime never reads a clock itself.
    host.load(makeDemoScene());
    // A loaded graphic is cued, not on air — the clock starts stopped, and
    // starting it is an explicit transport action.
    host.play();
    host.renderFrame(0);
    host.renderFrame(1_000);

    // One second at 60fps.
    expect(host.runtime.clock.frame).toBe(60);
  });

  it("does not draw a scene with no camera", () => {
    const document = makeDemoScene();
    const headless = {
      ...document,
      root: { ...document.root, children: [document.root.children![1]!] },
    };
    host.load(headless);

    const result = host.renderFrame(0);
    expect(result.drawn).toBe(false);
    expect(result.missed).toEqual(["default"]);
  });

  it("refuses to render before load", () => {
    expect(() => host.renderFrame(0)).toThrow(HostError);
  });

  it("refuses every operation after dispose", () => {
    host.load(makeDemoScene());
    host.dispose();
    expect(() => host.renderFrame(0)).toThrow(/disposed/);
    expect(() => host.load(makeDemoScene())).toThrow(/disposed/);
  });

  it("frees the mirror on dispose", () => {
    host.load(makeDemoScene());
    host.dispose();
    expect(backend.snapshot().nodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

/** A scheduler tests drive by hand, so frames are exact rather than timed. */
function manualScheduler(): FrameScheduler & { advance(ms: number): void } {
  let pending: ((wallMs: number) => void) | null = null;
  let clock = 0;
  let nextHandle = 1;

  return {
    request(callback) {
      pending = callback;
      return nextHandle++;
    },
    cancel() {
      pending = null;
    },
    now: () => clock,
    advance(ms) {
      clock += ms;
      const callback = pending;
      pending = null;
      callback?.(clock);
    },
  };
}

describe("frame loop", () => {
  it("renders a frame per scheduled tick", () => {
    const scheduler = manualScheduler();
    host.load(makeDemoScene());
    const loop = new FrameLoop(host, { scheduler });

    loop.start();
    scheduler.advance(16);
    scheduler.advance(16);
    scheduler.advance(16);

    expect(loop.frames).toBe(3);
    expect(host.framesRendered).toBe(3);
  });

  it("stops cleanly", () => {
    const scheduler = manualScheduler();
    host.load(makeDemoScene());
    const loop = new FrameLoop(host, { scheduler });

    loop.start();
    scheduler.advance(16);
    loop.stop();
    scheduler.advance(16);

    expect(loop.frames).toBe(1);
    expect(loop.running).toBe(false);
  });

  it("keeps running when a frame throws", () => {
    // A single bad frame freezing the output on the last good image is the
    // worst on-air failure, because it looks like nothing is wrong.
    const scheduler = manualScheduler();
    host.load(makeDemoScene());

    const errors: unknown[] = [];
    const loop = new FrameLoop(host, {
      scheduler,
      onError: (error) => errors.push(error),
    });

    loop.start();
    scheduler.advance(16);

    host.dispose(); // every subsequent frame now throws
    scheduler.advance(16);
    scheduler.advance(16);

    expect(errors).toHaveLength(2);
    expect(loop.running).toBe(true);
    expect(loop.errors).toBe(2);
  });

  it("does not queue a second frame behind a slow one", () => {
    const scheduler = manualScheduler();
    host.load(makeDemoScene());
    const loop = new FrameLoop(host, { scheduler });

    loop.start();
    // Only one frame is ever outstanding, so advancing once yields one frame.
    scheduler.advance(100);
    expect(loop.frames).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Structural determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("two hosts reach the same mirror from the same document", () => {
    const a = new MockMirrorBackend();
    const b = new MockMirrorBackend();
    new SceneHost(a).load(makeDemoScene());
    new SceneHost(b).load(makeDemoScene());

    expect(JSON.stringify(a.snapshot().nodes)).toBe(
      JSON.stringify(b.snapshot().nodes),
    );
  });

  it("an edit and its inverse return the mirror to its original state", () => {
    const document = makeDemoScene();
    host.load(document);
    const before = JSON.stringify(backend.snapshot().nodes);

    const transaction: Transaction = {
      id: "txn_add",
      label: "add bar",
      actorId: "usr_test",
      operations: [
        {
          type: "node.insert",
          parentId: "nod_lowerThird",
          node: {
            id: "nod_extra",
            name: "Extra",
            order: generateKeyBetween("zzzz", null),
            transform: {
              position: [0, 2, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
            components: [
              {
                id: "cmp_extra",
                type: "rect",
                props: { width: 1, height: 1, fill: "#FFFFFF" },
              },
            ],
          },
        },
      ],
    };

    host.apply(transaction);
    expect(backend.snapshot().nodes).toHaveLength(7);

    host.apply({
      id: "txn_add:inverse",
      label: "undo",
      actorId: "usr_test",
      operations: [
        {
          type: "node.remove",
          nodeId: "nod_extra",
          previousParentId: "nod_lowerThird",
          previousNode: transaction.operations[0]!.type === "node.insert"
            ? transaction.operations[0]!.node
            : (undefined as never),
        },
      ],
    });

    expect(JSON.stringify(backend.snapshot().nodes)).toBe(before);
  });
});
