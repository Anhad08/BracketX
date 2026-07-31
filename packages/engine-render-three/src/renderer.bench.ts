import { Matrix4, Object3D, Scene } from "three";
import { bench, describe } from "vitest";

import { HeadlessRendererHost } from "./renderer-host";
import { ThreeMirrorBackend } from "./three-backend";
import { cubeGeometry, quadGeometry } from "./translate";
import type { GeometryHandle, MaterialHandle, NodeHandle } from "./test-support";

/**
 * Render backend benchmarks. Phase 2.5d and 2.5l.
 *
 * MEASURE REALITY. Two of these exist to settle questions rather than to
 * decorate a report:
 *
 *   - "auto-update" answers 2.5d: is disabling Three's matrix auto-update
 *     actually faster, or only theoretically more deterministic?
 *   - "transform sync" answers whether per-frame cost tracks the number of
 *     CHANGED nodes or the size of the scene. The reconciler is O(change);
 *     if the backend is O(scene) the pipeline is O(scene) regardless.
 *
 * These measure CPU submission cost with a headless host. Actual GPU time,
 * driver upload cost, and real VRAM are Unknown here by construction —
 * see RENDER_BACKEND_VERIFICATION.md.
 *
 * Run: pnpm --filter @bracketx/engine-render-three bench
 */

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function makeBackend(maxBytes?: number): ThreeMirrorBackend {
  return new ThreeMirrorBackend({ host: new HeadlessRendererHost(), maxBytes });
}

/** A flat scene of `count` meshes sharing one geometry and one material. */
function flatScene(count: number): {
  backend: ThreeMirrorBackend;
  nodes: NodeHandle[];
  geometry: GeometryHandle;
  material: MaterialHandle;
} {
  const backend = makeBackend(1024 * 1024 * 1024);
  const geometry = backend.createGeometry(quadGeometry());
  const material = backend.createMaterial({
    kind: "unlit",
    color: [1, 1, 1, 1],
    transparent: false,
    doubleSided: false,
  });
  if (!geometry.ok || !material.ok) throw new Error("setup failed");

  const nodes: NodeHandle[] = [];
  for (let i = 0; i < count; i += 1) {
    const node = backend.createNode();
    backend.setWorldMatrix(node, IDENTITY);
    backend.attachMesh(node, geometry.value, material.value);
    nodes.push(node);
  }
  return { backend, nodes, geometry: geometry.value, material: material.value };
}

// ---------------------------------------------------------------------------
// 2.5d — Auto-update enabled vs disabled
// ---------------------------------------------------------------------------

/**
 * Both paths must produce the same result: correct world matrices for a scene
 * of SCENE_SIZE nodes of which CHANGED were moved this frame. Anything less is
 * not a comparison, it is two different workloads.
 */
const SCENE_SIZE = 10_000;
const CHANGED = 100;

/** Three's own path: mutate local TRS, let it recompute by traversal. */
function autoUpdateScene(count: number): { scene: Scene; nodes: Object3D[] } {
  const scene = new Scene();
  const nodes: Object3D[] = [];
  for (let i = 0; i < count; i += 1) {
    const object = new Object3D();
    // matrixAutoUpdate defaults to true — left alone deliberately.
    scene.add(object);
    nodes.push(object);
  }
  return { scene, nodes };
}

/** Our path: the engine already has the world matrix; write it verbatim. */
function explicitScene(count: number): { scene: Scene; nodes: Object3D[] } {
  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  scene.matrixWorldAutoUpdate = false;
  const nodes: Object3D[] = [];
  for (let i = 0; i < count; i += 1) {
    const object = new Object3D();
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    scene.add(object);
    nodes.push(object);
  }
  return { scene, nodes };
}

describe(`auto-update: ${CHANGED} of ${SCENE_SIZE} nodes moved per frame`, () => {
  const auto = autoUpdateScene(SCENE_SIZE);
  const explicit = explicitScene(SCENE_SIZE);
  const matrix = new Matrix4();
  let frame = 0;

  bench("matrixAutoUpdate enabled (Three recomputes by traversal)", () => {
    frame += 1;
    for (let i = 0; i < CHANGED; i += 1) {
      auto.nodes[i]!.position.set(frame, i, 0);
    }
    // The cost Three imposes: it cannot know only 100 changed.
    auto.scene.updateMatrixWorld(true);
  });

  bench("matrixAutoUpdate disabled (engine writes world matrices)", () => {
    frame += 1;
    for (let i = 0; i < CHANGED; i += 1) {
      matrix.makeTranslation(frame, i, 0);
      explicit.nodes[i]!.matrixWorld.copy(matrix);
      explicit.nodes[i]!.matrixWorldNeedsUpdate = false;
    }
  });
});

describe(`auto-update: whole scene moved (${SCENE_SIZE} nodes)`, () => {
  // The worst case for our path and the best case for Three's: if every node
  // changes, explicit sync loses its structural advantage. Recorded so the
  // decision is not defended only by its favourable case.
  const auto = autoUpdateScene(SCENE_SIZE);
  const explicit = explicitScene(SCENE_SIZE);
  const matrix = new Matrix4();
  let frame = 0;

  bench("enabled", () => {
    frame += 1;
    for (let i = 0; i < SCENE_SIZE; i += 1) auto.nodes[i]!.position.x = frame;
    auto.scene.updateMatrixWorld(true);
  });

  bench("disabled", () => {
    frame += 1;
    for (let i = 0; i < SCENE_SIZE; i += 1) {
      matrix.makeTranslation(frame, 0, 0);
      explicit.nodes[i]!.matrixWorld.copy(matrix);
      explicit.nodes[i]!.matrixWorldNeedsUpdate = false;
    }
  });
});

// ---------------------------------------------------------------------------
// 2.5l — Startup, frame cost, and scale
// ---------------------------------------------------------------------------

describe("startup", () => {
  bench("backend construction", () => {
    makeBackend().dispose();
  });

  bench("empty frame", () => {
    const backend = makeBackend();
    const camera = backend.createCamera({
      kind: "orthographic",
      size: 10,
      near: 0.1,
      far: 100,
    });
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    backend.dispose();
  });
});

for (const count of [1_000, 10_000, 50_000]) {
  describe(`scene of ${count.toLocaleString("en-US")} meshes`, () => {
    const built = flatScene(count);
    const camera = built.backend.createCamera({
      kind: "orthographic",
      size: 1000,
      near: 0.1,
      far: 1000,
    });

    bench("build", () => {
      flatScene(count).backend.dispose();
    });

    bench("transform sync — 1% changed", () => {
      const changed = Math.max(1, Math.floor(count / 100));
      for (let i = 0; i < changed; i += 1) {
        built.backend.setWorldMatrix(built.nodes[i]!, IDENTITY);
      }
    });

    bench("render submission", () => {
      built.backend.render(camera, {
        target: null,
        viewport: { width: 1920, height: 1080 },
        clearColor: [0, 0, 0, 0],
        layerMask: 0xffffffff,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 2.5l — Resource reuse and upload cost
// ---------------------------------------------------------------------------

describe("resources", () => {
  const reuse = makeBackend(1024 * 1024 * 1024);
  reuse.createGeometry(cubeGeometry());

  bench("cache hit (identical geometry)", () => {
    // Content addressing must make the second request cheaper than the first,
    // or dedupe is costing more than it saves.
    reuse.createGeometry(cubeGeometry());
  });

  bench("cache miss (new geometry allocated)", () => {
    const backend = makeBackend(1024 * 1024 * 1024);
    backend.createGeometry(cubeGeometry());
    backend.dispose();
  });

  bench("material creation", () => {
    const backend = makeBackend(1024 * 1024 * 1024);
    backend.createMaterial({
      kind: "unlit",
      color: [1, 0, 0, 1],
      transparent: false,
      doubleSided: false,
    });
    backend.dispose();
  });
});
