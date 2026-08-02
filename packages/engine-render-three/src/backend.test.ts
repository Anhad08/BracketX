import {
  MockMirrorBackend,
  Reconciler,
  quadDescriptor,
  type InspectableMirrorBackend,
  type MaterialDescriptor,
} from "./test-support";
import { beforeEach, describe, expect, it } from "vitest";

import { HeadlessRendererHost } from "./renderer-host";
import { ThreeMirrorBackend, BackendViolation } from "./three-backend";
import { ResourceViolation } from "./resources";
import { cubeGeometry, quadGeometry, verticalFovDegrees } from "./translate";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TRANSLATED = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];

const UNLIT: MaterialDescriptor = {
  kind: "unlit",
  color: [1, 0, 0, 1],
  transparent: false,
  doubleSided: false,
};

let host: HeadlessRendererHost;
let backend: ThreeMirrorBackend;

beforeEach(() => {
  host = new HeadlessRendererHost();
  backend = new ThreeMirrorBackend({ host });
});

// ---------------------------------------------------------------------------
// 2.5a — Bootstrap
// ---------------------------------------------------------------------------

describe("backend bootstrap", () => {
  it("reports capabilities without a GPU", () => {
    expect(backend.capabilities.tier).toBe("baseline");
    expect(backend.capabilities.maxTextureSize).toBeGreaterThan(0);
    // RFC-003 §3: WebGL2 is Baseline; Advanced requires WebGPU.
    expect(backend.capabilities.supportsComputeShaders).toBe(false);
  });

  it("refuses use after dispose", () => {
    backend.dispose();
    expect(() => backend.createNode()).toThrow(BackendViolation);
  });

  it("frees everything on dispose", () => {
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    expect(geometry.ok).toBe(true);
    backend.dispose();
    expect(backend.diagnostics().resources.totalLive).toBe(0);
    void node;
  });
});

// ---------------------------------------------------------------------------
// 2.5b — Mirror objects
// ---------------------------------------------------------------------------

describe("mirror objects", () => {
  it("creates and parents nodes", () => {
    const parent = backend.createNode();
    const child = backend.createNode();
    backend.setParent(child, parent);

    const snapshot = backend.snapshot();
    expect(snapshot.nodes.map((n) => n.path)).toEqual(["0", "0/0"]);
  });

  it("keeps the node handle stable across attachment changes", () => {
    // A node is a transform; a mesh is an attachment. Swapping the object
    // would drop the handle and its place in the hierarchy.
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    backend.setWorldMatrix(node, TRANSLATED);
    backend.attachMesh(node, geometry.value, material.value);
    expect(backend.snapshot().nodes[0]!.attachment).toBe("mesh");

    backend.detach(node);
    expect(backend.snapshot().nodes[0]!.attachment).toBe("none");
    // Transform survived the attachment cycle.
    expect(backend.snapshot().nodes[0]!.worldMatrix[12]).toBe(5);
  });

  it("refuses to destroy a node that still has children", () => {
    const parent = backend.createNode();
    const child = backend.createNode();
    backend.setParent(child, parent);
    expect(() => backend.destroyNode(parent)).toThrow(BackendViolation);
  });

  it("does not count the attachment mesh as a child", () => {
    // object.children holds the attachment mesh too; deriving child nodes
    // from it would refuse a legitimate destroy.
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");
    backend.attachMesh(node, geometry.value, material.value);

    expect(() => backend.destroyNode(node)).not.toThrow();
  });

  it("refuses a cycle", () => {
    const a = backend.createNode();
    const b = backend.createNode();
    backend.setParent(b, a);
    expect(() => backend.setParent(a, b)).toThrow(BackendViolation);
  });

  it("detects use after destroy", () => {
    const node = backend.createNode();
    backend.destroyNode(node);
    expect(() => backend.setVisible(node, false)).toThrow(/use after destroy/);
  });

  it("rejects a handle it never issued", () => {
    expect(() => backend.setVisible(9999 as never, true)).toThrow(
      /never issued/,
    );
  });
});

// ---------------------------------------------------------------------------
// 2.5d — Transform synchronisation
// ---------------------------------------------------------------------------

describe("transform synchronisation", () => {
  it("writes world matrices verbatim", () => {
    const node = backend.createNode();
    backend.setWorldMatrix(node, TRANSLATED);
    expect(backend.snapshot().nodes[0]!.worldMatrix).toEqual(TRANSLATED);
  });

  it("does not derive a child's world matrix from its parent", () => {
    // MirrorBackend contract C3: the backend must not compute. The engine
    // supplies every world matrix, and a child left unwritten stays identity
    // rather than silently inheriting.
    const parent = backend.createNode();
    const child = backend.createNode();
    backend.setParent(child, parent);
    backend.setWorldMatrix(parent, TRANSLATED);

    const child0 = backend.snapshot().nodes[1]!;
    expect(child0.worldMatrix).toEqual(IDENTITY);
  });

  it("propagates the node's world matrix to its attachment mesh", () => {
    // Three will not do it: auto-update is off on the parent, so traversal
    // never reaches the mesh.
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    backend.attachMesh(node, geometry.value, material.value);
    backend.setWorldMatrix(node, TRANSLATED);

    host.resetSubmissionCounters();
    const camera = backend.createCamera({
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 1000,
    });
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    // The mesh was submitted, which only happens if its matrixWorld is valid.
    expect(host.submission().drawCalls).toBe(1);
  });

  it("rejects a malformed matrix", () => {
    const node = backend.createNode();
    expect(() => backend.setWorldMatrix(node, [1, 2, 3])).toThrow(
      BackendViolation,
    );
  });
});

// ---------------------------------------------------------------------------
// 2.5c / 2.5f — Resources and geometry
// ---------------------------------------------------------------------------

describe("resource ownership", () => {
  it("deduplicates identical geometry", () => {
    // "Duplicate geometry must never allocate twice."
    const a = backend.createGeometry(quadGeometry());
    const b = backend.createGeometry(quadGeometry());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.value).toBe(b.value);
    expect(backend.diagnostics().resources.geometry.live).toBe(1);
    expect(backend.diagnostics().resources.cacheHits).toBe(1);
  });

  it("distinguishes different geometry", () => {
    const quad = backend.createGeometry(quadGeometry());
    const cube = backend.createGeometry(cubeGeometry());
    if (!quad.ok || !cube.ok) throw new Error("setup failed");
    expect(quad.value).not.toBe(cube.value);
    expect(backend.diagnostics().resources.geometry.live).toBe(2);
  });

  it("hashes buffer contents, not just lengths", () => {
    // Two meshes differing only in the middle must not collide.
    const a = quadGeometry();
    const b = quadGeometry();
    (b.positions as Float32Array)[5] = 99;

    const first = backend.createGeometry(a);
    const second = backend.createGeometry(b);
    if (!first.ok || !second.ok) throw new Error("setup failed");
    expect(first.value).not.toBe(second.value);
  });

  it("deduplicates identical materials", () => {
    const a = backend.createMaterial(UNLIT);
    const b = backend.createMaterial(UNLIT);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    expect(a.value).toBe(b.value);
  });

  it("keeps a resource alive while referenced", () => {
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    backend.attachMesh(node, geometry.value, material.value);
    // The creator's reference is dropped; the mesh still holds one.
    backend.destroyGeometry(geometry.value);
    expect(backend.diagnostics().resources.geometry.live).toBe(1);

    backend.detach(node);
    expect(backend.diagnostics().resources.geometry.live).toBe(0);
  });

  it("rejects releasing an unknown handle", () => {
    expect(() => backend.destroyGeometry(4242 as never)).toThrow(
      ResourceViolation,
    );
  });

  it("rejects a double release", () => {
    const geometry = backend.createGeometry(quadGeometry());
    if (!geometry.ok) throw new Error("setup failed");
    backend.destroyGeometry(geometry.value);
    expect(() => backend.destroyGeometry(geometry.value)).toThrow(
      ResourceViolation,
    );
  });

  it("refuses allocation over budget rather than evicting", () => {
    // ENGINE_RUNTIME §4.4 inverts normal engine behaviour: blanking an on-air
    // graphic is worse than failing to bring up a new one.
    const tiny = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
      maxBytes: 64,
    });
    const result = tiny.createGeometry(cubeGeometry());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("budget-exceeded");
  });

  it("estimates VRAM from buffer sizes", () => {
    const geometry = backend.createGeometry(cubeGeometry());
    if (!geometry.ok) throw new Error("setup failed");
    const cube = cubeGeometry();
    const expected =
      cube.positions.byteLength +
      cube.indices!.byteLength +
      cube.normals!.byteLength +
      cube.uvs!.byteLength;
    expect(backend.diagnostics().resources.geometry.bytes).toBe(expected);
  });

  it("balances every pool after a full lifecycle", () => {
    const node = backend.createNode();
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    backend.attachMesh(node, geometry.value, material.value);
    backend.destroyGeometry(geometry.value);
    backend.destroyMaterial(material.value);
    backend.destroyNode(node);

    expect(backend.isBalanced()).toBe(true);
    expect(backend.diagnostics().resources.totalLive).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2.5g — Cameras
// ---------------------------------------------------------------------------

describe("cameras", () => {
  it("derives vertical FOV from focal length and sensor width", () => {
    // SCENE_FORMAT §8: operators think in lenses. A 35mm lens on a 36mm
    // sensor at 16:9 is a known quantity.
    const fov = verticalFovDegrees(35, 36, 16 / 9);
    expect(fov).toBeGreaterThan(31);
    expect(fov).toBeLessThan(33);
  });

  it("widens the field of view for a shorter lens", () => {
    expect(verticalFovDegrees(18, 36, 16 / 9)).toBeGreaterThan(
      verticalFovDegrees(85, 36, 16 / 9),
    );
  });

  it("creates perspective and orthographic cameras", () => {
    const perspective = backend.createCamera({
      kind: "perspective",
      focalLengthMm: 50,
      sensorWidthMm: 36,
      near: 0.1,
      far: 1000,
    });
    const ortho = backend.createCamera({
      kind: "orthographic",
      size: 5,
      near: 0.1,
      far: 1000,
    });
    expect(perspective).not.toBe(ortho);
    expect(backend.snapshot().resourceCounts.cameras).toBe(2);
  });

  it("updates projection on resize", () => {
    const camera = backend.createCamera({
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 1000,
    });
    expect(() => backend.setSize(1280, 720)).not.toThrow();
    expect(host.size).toEqual({ width: 1280, height: 720 });
    void camera;
  });

  it("takes camera transform from the node it is attached to", () => {
    // Camera state originates from the Runtime, never from Three.
    const node = backend.createNode();
    const camera = backend.createCamera({
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 1000,
    });
    backend.attachCamera(node, camera);
    backend.setWorldMatrix(node, TRANSLATED);

    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submissions).toHaveLength(1);
  });

  it("rejects rendering with an unknown camera", () => {
    expect(() =>
      backend.render(77 as never, {
        target: null,
        viewport: { width: 1920, height: 1080 },
        clearColor: [0, 0, 0, 0],
        layerMask: 0xffffffff,
      }),
    ).toThrow(BackendViolation);
  });

  it("rejects destroying an unknown camera", () => {
    expect(() => backend.destroyCamera(88 as never)).toThrow(BackendViolation);
  });
});

// ---------------------------------------------------------------------------
// 2.5h — Render submission
// ---------------------------------------------------------------------------

describe("render submission", () => {
  function sceneWithMeshes(count: number) {
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");
    for (let i = 0; i < count; i += 1) {
      const node = backend.createNode();
      backend.setWorldMatrix(node, IDENTITY);
      backend.attachMesh(node, geometry.value, material.value);
    }
    return backend.createCamera({
      kind: "orthographic",
      size: 100,
      near: 0.1,
      far: 1000,
    });
  }

  it("submits once per render call", () => {
    const camera = sceneWithMeshes(3);
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submissions).toHaveLength(1);
  });

  it("reports one draw call per visible mesh", () => {
    const camera = sceneWithMeshes(5);
    host.resetSubmissionCounters();
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submission().drawCalls).toBe(5);
  });

  it("skips invisible subtrees", () => {
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    const parent = backend.createNode();
    const child = backend.createNode();
    backend.setParent(child, parent);
    backend.setWorldMatrix(parent, IDENTITY);
    backend.setWorldMatrix(child, IDENTITY);
    backend.attachMesh(child, geometry.value, material.value);
    backend.setVisible(parent, false);

    const camera = backend.createCamera({
      kind: "orthographic",
      size: 100,
      near: 0.1,
      far: 1000,
    });
    host.resetSubmissionCounters();
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submission().drawCalls).toBe(0);
  });

  it("defaults to a transparent clear colour", () => {
    // Broadcast output composites over live video.
    const camera = sceneWithMeshes(1);
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submissions[0]!.options.clearColor[3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2.5j / 2.5o — Context loss and recovery
// ---------------------------------------------------------------------------

describe("context loss and recovery", () => {
  function populate() {
    const geometry = backend.createGeometry(cubeGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");
    const node = backend.createNode();
    backend.setWorldMatrix(node, TRANSLATED);
    backend.attachMesh(node, geometry.value, material.value);
    const camera = backend.createCamera({
      kind: "orthographic",
      size: 10,
      near: 0.1,
      far: 100,
    });
    return { node, geometry: geometry.value, material: material.value, camera };
  }

  it("drops draws while the context is lost", () => {
    const { camera } = populate();
    backend.simulateContextLoss();
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submissions).toHaveLength(0);
  });

  it("recreates resources on restore, preserving handles", () => {
    // Handle stability is what lets a GPU reset not restart the engine:
    // nothing above the backend knows it happened.
    const before = populate();
    const snapshotBefore = JSON.stringify(backend.snapshot());

    backend.simulateContextLoss();
    backend.simulateContextRestore();

    expect(JSON.stringify(backend.snapshot())).toBe(snapshotBefore);
    expect(backend.diagnostics().recreatedAfterRestore).toBeGreaterThan(0);
    // Same handles still resolve.
    expect(() => backend.destroyGeometry(before.geometry)).not.toThrow();
  });

  it("renders again after restore", () => {
    const { camera } = populate();
    backend.simulateContextLoss();
    backend.simulateContextRestore();

    host.resetSubmissionCounters();
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(host.submission().drawCalls).toBe(1);
  });

  it("preserves the mirror across loss and restore", () => {
    populate();
    const nodesBefore = backend.snapshot().nodes.length;
    backend.simulateContextLoss();
    backend.simulateContextRestore();
    expect(backend.snapshot().nodes.length).toBe(nodesBefore);
    expect(backend.isBalanced()).toBe(true);
  });

  it("counts losses and restores", () => {
    populate();
    backend.simulateContextLoss();
    backend.simulateContextRestore();
    backend.simulateContextLoss();
    backend.simulateContextRestore();
    const diagnostics = backend.diagnostics();
    expect(diagnostics.contextLosses).toBe(2);
    expect(diagnostics.contextRestores).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Conformance — the backend and the mock must be interchangeable
// ---------------------------------------------------------------------------

describe("MirrorBackend conformance", () => {
  const backends: [string, () => InspectableMirrorBackend][] = [
    ["mock", () => new MockMirrorBackend()],
    ["three", () => new ThreeMirrorBackend({ host: new HeadlessRendererHost() })],
  ];

  it.each(backends)(
    "%s: projection produces the same mirror structure",
    (_name, create) => {
      // The property that makes the backend replaceable: the reconciler must
      // not be able to tell which one it is driving.
      const target = create();
      const reconciler = new Reconciler(target);
      const document = quadDescriptor();
      reconciler.build(document);

      const snapshot = target.snapshot();
      expect(snapshot.nodes.map((n) => n.path)).toEqual(["0", "0/0", "0/1"]);
      expect(snapshot.nodes.every((n) => n.visible)).toBe(true);
    },
  );

  it("both backends produce identical snapshots for the same document", () => {
    const mock = new MockMirrorBackend();
    const three = new ThreeMirrorBackend({ host: new HeadlessRendererHost() });
    const document = quadDescriptor();

    new Reconciler(mock).build(document);
    new Reconciler(three).build(document);

    expect(JSON.stringify(three.snapshot().nodes)).toBe(
      JSON.stringify(mock.snapshot().nodes),
    );
  });

  // -- Lights. ADR-013 amendment 1 (IF-002) --------------------------------

  it.each(backends)("%s: a light is an attachment like any other", (_name, create) => {
    const target = create();
    const node = target.createNode();
    const light = target.createLight({
      kind: "directional",
      color: [1, 1, 1, 1],
      intensity: 2,
    });

    target.attachLight(node, light);
    expect(target.snapshot().nodes[0]!.attachment).toBe("light");

    // Idempotent (C4), and update-in-place never changes the attachment.
    target.updateLight(light, { kind: "directional", color: [1, 0, 0, 1], intensity: 3 });
    target.updateLight(light, { kind: "directional", color: [1, 0, 0, 1], intensity: 3 });
    expect(target.snapshot().nodes[0]!.attachment).toBe("light");

    target.detach(node);
    expect(target.snapshot().nodes[0]!.attachment).toBe("none");

    target.destroyLight(light);
    target.destroyNode(node);
    target.dispose();
  });

  it.each(backends)("%s: refuses an unknown or double-freed light", (_name, create) => {
    const target = create();
    const light = target.createLight({ kind: "ambient", color: [1, 1, 1, 1], intensity: 1 });
    target.destroyLight(light);
    // C2 puts lifetime on the caller, so a double free is the caller's bug and
    // must be loud rather than silently tolerated.
    expect(() => target.destroyLight(light)).toThrow();
    target.dispose();
  });

  it("both backends produce identical snapshots for a lit scene", () => {
    // The amendment's whole point: adding lights must not make the two
    // backends distinguishable from the reconciler's side.
    const mock = new MockMirrorBackend();
    const three = new ThreeMirrorBackend({ host: new HeadlessRendererHost() });

    for (const target of [mock, three] as InspectableMirrorBackend[]) {
      const root = target.createNode();
      const lit = target.createNode();
      target.setParent(lit, root);
      // Placement and orientation come from the NODE, never the descriptor.
      target.setWorldMatrix(lit, [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 4, -3, 1,
      ]);
      for (const descriptor of [
        { kind: "ambient", color: [0.2, 0.2, 0.2, 1], intensity: 1 },
        { kind: "directional", color: [1, 1, 1, 1], intensity: 2 },
        { kind: "point", color: [1, 0.5, 0, 1], intensity: 3, distance: 10, decay: 2 },
        {
          kind: "spot",
          color: [0, 0.5, 1, 1],
          intensity: 4,
          distance: 20,
          angle: 0.5,
          penumbra: 0.3,
          decay: 2,
        },
      ] as const) {
        const light = target.createLight(descriptor);
        target.attachLight(lit, light);
      }
    }

    expect(JSON.stringify(three.snapshot().nodes)).toBe(
      JSON.stringify(mock.snapshot().nodes),
    );
    mock.dispose();
    three.dispose();
  });

  it("both backends free everything on teardown", () => {
    for (const [, create] of backends) {
      const target = create();
      const reconciler = new Reconciler(target);
      reconciler.build(quadDescriptor());
      reconciler.teardown();
      expect(target.snapshot().nodes).toEqual([]);
    }
  });
});
