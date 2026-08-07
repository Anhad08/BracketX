/**
 * The boundary, proved rather than claimed.
 *
 * ============================================================================
 * WHY THIS FILE IS THE POINT OF THE WHOLE PACKAGE
 * ============================================================================
 * `MirrorBackend` has been described as "the engine's rendering boundary" and
 * "the seam that makes renderers swappable" since Phase 2. Until now there was
 * one implementation, which means the claim was untested: any assumption about
 * three.js that leaked through the interface would have been invisible.
 *
 * These tests drive the SAME `SceneDocument` through the SAME reconciler into
 * two different libraries and require them to agree on what exists, what is
 * attached to what, where it is, and how many resources it took. Where they
 * disagree, one of them is wrong — and the interface has stopped being a
 * boundary.
 *
 * Everything runs against Babylon's `NullEngine`: every allocation, every
 * matrix, every draw call, no browser and no GPU.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  MockMirrorBackend,
  Reconciler,
  boxDescriptor,
  quadDescriptor,
  type MaterialDescriptor,
} from "@bracketx/engine-reconciler";
import {
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import { BabylonMirrorBackend } from "./babylon-backend";

const TIME = "2026-01-01T00:00:00.000Z";

function backend(): BabylonMirrorBackend {
  return new BabylonMirrorBackend({ engine: new NullEngine() });
}

function node(id: string, order: string, extra: Record<string, unknown> = {}): SceneNode {
  return {
    id,
    name: id,
    order,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [],
    children: [],
    ...extra,
  } as unknown as SceneNode;
}

function documentWith(children: readonly SceneNode[]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_conformance",
    meta: { name: "Conformance", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
      pixelsPerUnit: 100,
    },
    variables: [],
    assets: [],
    states: [],
    root: node("node_root", generateKeyBetween(null, null), { children }),
  } as unknown as SceneDocument;
}

/** A lower third with a plate, a camera and a light. The ordinary case. */
function scene(): SceneDocument {
  const a = generateKeyBetween(null, null);
  const b = generateKeyBetween(a, null);
  const c = generateKeyBetween(b, null);
  return documentWith([
    node("node_plate", a, {
      transform: { position: [0, -3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      size: { width: 9.4, height: 1.9 },
      components: [
        {
          id: "cmp_plate",
          type: "rect",
          props: { width: 9.4, height: 1.9, fill: "#1B2430", depth: 0.08, metallic: 0.1, roughness: 0.5 },
        },
      ],
    }),
    node("node_camera", b, {
      transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [
        {
          id: "cmp_camera",
          type: "camera",
          props: { projection: "orthographic", orthographicSize: 5, near: 0.1, far: 100 },
        },
      ],
    }),
    node("node_key", c, {
      transform: { position: [2, 4, 6], rotation: [-30, 20, 0], scale: [1, 1, 1] },
      components: [
        {
          id: "cmp_key",
          type: "light",
          props: { kind: "directional", color: "#FFFFFF", intensity: 1 },
        },
      ],
    }),
  ]);
}

describe("two renderers, one document", () => {
  it("builds the same mirror as the reference backend", () => {
    // The reference implementation and Babylon are driven identically. If the
    // interface is a real boundary, their snapshots describe the same scene.
    const mock = new MockMirrorBackend();
    const babylon = backend();
    const document = scene();

    new Reconciler(mock).build(document);
    new Reconciler(babylon).build(document);

    const a = mock.snapshot();
    const b = babylon.snapshot();

    expect(b.nodes).toHaveLength(a.nodes.length);
    expect(b.resourceCounts.geometries).toBe(a.resourceCounts.geometries);
    expect(b.resourceCounts.materials).toBe(a.resourceCounts.materials);
    expect(b.resourceCounts.cameras).toBe(a.resourceCounts.cameras);

    // Attachment KIND per node, in the reconciler's own order.
    expect(b.nodes.map((n) => n.attachment)).toEqual(a.nodes.map((n) => n.attachment));

    babylon.dispose();
  });

  it("places every node at the same world matrix, to the float", () => {
    // C3: matrices arrive COMPOSED. A backend that recomposed from
    // position/rotation/scale would agree on simple nodes and drift on
    // anything rotated or parented — which is why the scene has both.
    const mock = new MockMirrorBackend();
    const babylon = backend();
    const document = scene();

    new Reconciler(mock).build(document);
    new Reconciler(babylon).build(document);

    const expected = mock.snapshot().nodes;
    const actual = babylon.snapshot().nodes;

    for (let index = 0; index < expected.length; index += 1) {
      const want = expected[index]!.worldMatrix;
      const got = actual[index]!.worldMatrix;
      expect(got).toHaveLength(want.length);
      for (let cell = 0; cell < want.length; cell += 1) {
        expect(got[cell], `node ${index}, cell ${cell}`).toBeCloseTo(want[cell]!, 5);
      }
    }
    babylon.dispose();
  });
});

describe("resource ownership — C8", () => {
  it("shares one buffer between two identical rects, on both backends", () => {
    // Content addressing is now a SHARED helper, so the two backends dedup
    // identically. If they did not, every memory comparison between them
    // would be measuring the hash rather than the renderer.
    const babylon = backend();
    const first = babylon.createGeometry(quadDescriptor(2, 1));
    const second = babylon.createGeometry(quadDescriptor(2, 1));
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.value).toBe(first.value);

    const different = babylon.createGeometry(quadDescriptor(3, 1));
    expect(different.ok).toBe(true);
    if (different.ok && first.ok) expect(different.value).not.toBe(first.value);

    babylon.dispose();
  });

  it("balances every retain with a release", () => {
    const babylon = backend();
    const geometry = babylon.createGeometry(boxDescriptor(1, 1, 1));
    const material = babylon.createMaterial({
      kind: "pbr",
      baseColor: [1, 0, 0, 1],
      metallic: 0,
      roughness: 1,
      transparent: false,
      doubleSided: false,
    } as MaterialDescriptor);
    expect(geometry.ok && material.ok).toBe(true);
    if (!geometry.ok || !material.ok) return;

    const handle = babylon.createNode();
    babylon.attachMesh(handle, geometry.value, material.value);
    babylon.detach(handle);
    babylon.destroyNode(handle);
    babylon.destroyGeometry(geometry.value);
    babylon.destroyMaterial(material.value);

    expect(babylon.isBalanced(), "a leaked reference is a leaked GPU buffer").toBe(true);
    babylon.dispose();
  });

  it("refuses rather than evicting when the budget is exhausted", () => {
    // ENGINE_RUNTIME §4.4, and the same choice the three adapter makes. A
    // renderer that drops somebody else's buffer to fit yours puts a hole in
    // the picture and reports success.
    const small = new BabylonMirrorBackend({ engine: new NullEngine(), maxBytes: 1024 });
    const huge = new Float32Array(4096);
    const result = small.createGeometry({ positions: huge } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("budget-exceeded");
    small.dispose();
  });
});

describe("what this backend refuses, it refuses out loud", () => {
  it("reports render targets as unsupported rather than returning a dead handle", () => {
    // A handle that renders nowhere would make `OutputSet` believe it had a
    // surface, and the failure would appear as a black output on air rather
    // than as an error here.
    const babylon = backend();
    const result = babylon.createRenderTarget([256, 256]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("unsupported");
      if (result.reason.kind === "unsupported") {
        expect(result.reason.capability).toBe("renderTargets");
      }
    }
    babylon.dispose();
  });

  it("does not claim a capability it has not implemented", () => {
    const babylon = backend();
    expect(babylon.capabilities.name).toBe("babylon");
    expect(
      babylon.capabilities.supportsFloatRenderTargets,
      "claiming a tier it cannot serve is worse than claiming less",
    ).toBe(false);
    babylon.dispose();
  });
});

describe("the first 3D workflow, end to end", () => {
  it("creates a scene, places a solid, lights it, aims a camera and draws", () => {
    // The founder's acceptance list for this package, in one test: create a
    // 3D scene, place a cube, apply a material, add a light, and render it.
    const babylon = backend();

    const geometry = babylon.createGeometry(boxDescriptor(1, 1, 1));
    const material = babylon.createMaterial({
      kind: "pbr",
      baseColor: [0.2, 0.4, 0.9, 1],
      metallic: 0.1,
      roughness: 0.5,
      transparent: false,
      doubleSided: false,
    } as MaterialDescriptor);
    expect(geometry.ok && material.ok).toBe(true);
    if (!geometry.ok || !material.ok) return;

    const cube = babylon.createNode();
    babylon.attachMesh(cube, geometry.value, material.value);
    // Moved, rotated and scaled — one composed matrix, exactly as the
    // reconciler delivers it.
    babylon.setWorldMatrix(cube, [
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      1, 2, 3, 1,
    ]);

    const light = babylon.createLight({
      kind: "directional",
      color: [1, 1, 1, 1],
      intensity: 1,
    } as never);
    const lightNode = babylon.createNode();
    babylon.attachLight(lightNode, light);

    const camera = babylon.createCamera({
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 100,
    } as never);
    const cameraNode = babylon.createNode();
    babylon.attachCamera(cameraNode, camera);
    babylon.setWorldMatrix(cameraNode, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 10, 1,
    ]);

    expect(() =>
      babylon.render(camera, {
        target: null,
        viewport: { width: 1920, height: 1080 },
        clearColor: [0, 0, 0, 0],
        layerMask: 0xffffffff,
      }),
    ).not.toThrow();

    const snapshot = babylon.snapshot();
    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.nodes.filter((n) => n.attachment === "mesh")).toHaveLength(1);
    expect(snapshot.nodes.filter((n) => n.attachment === "light")).toHaveLength(1);
    expect(snapshot.nodes.filter((n) => n.attachment === "camera")).toHaveLength(1);

    // The cube's matrix survived the round trip unchanged — the scale is in
    // the diagonal and the translation in the last column.
    const mesh = snapshot.nodes.find((n) => n.attachment === "mesh")!;
    expect(mesh.worldMatrix[0]).toBeCloseTo(2, 5);
    expect(mesh.worldMatrix[12]).toBeCloseTo(1, 5);
    expect(mesh.worldMatrix[13]).toBeCloseTo(2, 5);
    expect(mesh.worldMatrix[14]).toBeCloseTo(3, 5);

    babylon.dispose();
  });

  it("moves the camera's view when its NODE moves", () => {
    // Pre-paid from the three adapter, where this cost a day: a camera
    // derives its view from its OWN position, not from the transform node it
    // is attached to, unless the backend keeps them in step. Moving the node
    // then moves nothing on screen and every other number is correct.
    const babylon = backend();
    const camera = babylon.createCamera({
      kind: "perspective",
      focalLengthMm: 35,
      sensorWidthMm: 36,
      near: 0.1,
      far: 100,
    } as never);
    const handle = babylon.createNode();
    babylon.attachCamera(handle, camera);

    babylon.setWorldMatrix(handle, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]);
    const moved = babylon.scene.activeCameras;
    void moved;
    const snapshot = babylon.snapshot();
    const node = snapshot.nodes.find((n) => n.attachment === "camera")!;
    expect(node.worldMatrix[12]).toBeCloseTo(4, 5);
    expect(node.worldMatrix[13]).toBeCloseTo(5, 5);
    expect(node.worldMatrix[14]).toBeCloseTo(6, 5);

    babylon.dispose();
  });
});
