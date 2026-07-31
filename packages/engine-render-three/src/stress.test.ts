import { describe, expect, it } from "vitest";

import { HeadlessRendererHost } from "./renderer-host";
import { ThreeMirrorBackend } from "./three-backend";
import { quadGeometry } from "./translate";
import type { NodeHandle } from "./test-support";

/**
 * Stress and scalability. Phase 2.5m.
 *
 * Slow by design — builds scenes up to 100k meshes. Run separately:
 *   pnpm --filter @bracketx/engine-render-three test:stress
 *
 * These assert the SHAPE of the cost, not its magnitude. A machine-specific
 * millisecond figure would be a flaky test; a claim that teardown is linear
 * in node count is a real invariant, and it is the one that regressed.
 */

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const GIB = 1024 * 1024 * 1024;

function build(count: number): {
  backend: ThreeMirrorBackend;
  nodes: NodeHandle[];
} {
  const backend = new ThreeMirrorBackend({
    host: new HeadlessRendererHost(),
    maxBytes: GIB,
  });
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
  return { backend, nodes };
}

/** Minimum of several rounds: interference only ever makes a sample slower. */
function fastest(rounds: number, body: () => void): number {
  let best = Infinity;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    body();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("scale", () => {
  for (const count of [10_000, 50_000, 100_000]) {
    it(`builds and tears down ${count.toLocaleString("en-US")} meshes`, () => {
      const { backend } = build(count);
      expect(backend.snapshot().nodes.length).toBe(count);
      expect(backend.diagnostics().nodes.live).toBe(count);
      // One geometry and one material regardless of mesh count — content
      // addressing is what keeps VRAM flat as the scene grows.
      expect(backend.diagnostics().resources.geometry.live).toBe(1);
      expect(backend.diagnostics().resources.material.live).toBe(1);

      backend.dispose();
      expect(backend.diagnostics().resources.totalLive).toBe(0);
    });
  }

  it("renders 100k meshes in one submission", () => {
    const { backend } = build(100_000);
    const camera = backend.createCamera({
      kind: "orthographic",
      size: 1000,
      near: 0.1,
      far: 1000,
    });
    backend.render(camera, {
      target: null,
      viewport: { width: 1920, height: 1080 },
      clearColor: [0, 0, 0, 0],
      layerMask: 0xffffffff,
    });
    expect(backend.diagnostics().frames).toBe(1);
    expect(backend.diagnostics().drawCalls).toBe(100_000);
    backend.dispose();
  });
});

describe("cost shape", () => {
  it("teardown is linear in node count", () => {
    // REGRESSION GUARD. Three's Scene.clear() is quadratic past ~10k children
    // (measured 4ms at 10k, 1,828ms at 50k on r185), which made dispose take
    // 3.1 seconds at 50k. #detachSceneChildren replaced it. If someone
    // reinstates Scene.clear(), the ratio below explodes and this fails.
    const measure = (count: number) => {
      const { backend } = build(count);
      return fastest(1, () => backend.dispose());
    };

    const small = Math.max(measure(10_000), 0.05);
    const large = measure(100_000);

    // Linear would be 10x. Generous headroom for allocator noise at these
    // timescales, but nowhere near the ~450x that quadratic teardown costs.
    expect(large / small).toBeLessThan(60);
  });

  it("transform sync cost tracks changed nodes, not scene size", () => {
    // The reconciler is O(change). If the backend were O(scene), the pipeline
    // would be O(scene) and the whole projection argument would collapse.
    const CHANGED = 1_000;
    const syncCost = (sceneSize: number) => {
      const { backend, nodes } = build(sceneSize);
      const cost = fastest(5, () => {
        for (let i = 0; i < CHANGED; i += 1) {
          backend.setWorldMatrix(nodes[i]!, IDENTITY);
        }
      });
      backend.dispose();
      return cost;
    };

    const small = Math.max(syncCost(10_000), 0.01);
    const large = syncCost(100_000);

    // Same 1,000 nodes changed in a scene 10x larger must cost about the same.
    expect(large / small).toBeLessThan(5);
  });

  it("VRAM stays flat as instance count grows", () => {
    // 100k meshes sharing one geometry must not cost 100k geometries.
    const small = build(1_000);
    const smallBytes = small.backend.diagnostics().vramEstimateBytes;
    small.backend.dispose();

    const large = build(100_000);
    const largeBytes = large.backend.diagnostics().vramEstimateBytes;
    large.backend.dispose();

    expect(largeBytes).toBe(smallBytes);
  });
});

describe("sustained operation", () => {
  it("does not leak across many build/teardown cycles", () => {
    // A production channel runs for weeks. A per-cycle leak is invisible in a
    // single test and fatal over a season.
    const backend = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
      maxBytes: GIB,
    });
    const geometry = backend.createGeometry(quadGeometry());
    const material = backend.createMaterial({
      kind: "unlit",
      color: [1, 1, 1, 1],
      transparent: false,
      doubleSided: false,
    });
    if (!geometry.ok || !material.ok) throw new Error("setup failed");

    for (let cycle = 0; cycle < 200; cycle += 1) {
      const nodes: NodeHandle[] = [];
      for (let i = 0; i < 500; i += 1) {
        const node = backend.createNode();
        backend.setWorldMatrix(node, IDENTITY);
        backend.attachMesh(node, geometry.value, material.value);
        nodes.push(node);
      }
      for (const node of nodes) {
        backend.detach(node);
        backend.destroyNode(node);
      }
      expect(backend.diagnostics().nodes.live).toBe(0);
    }

    expect(backend.isBalanced()).toBe(true);
    // Still exactly the two resources created at the start.
    expect(backend.diagnostics().resources.totalLive).toBe(2);
    backend.dispose();
  });

  it("survives repeated context loss under load", () => {
    const { backend } = build(10_000);
    for (let i = 0; i < 20; i += 1) {
      backend.simulateContextLoss();
      backend.simulateContextRestore();
      expect(backend.snapshot().nodes.length).toBe(10_000);
    }
    expect(backend.diagnostics().contextRestores).toBe(20);
    expect(backend.isBalanced()).toBe(true);
    backend.dispose();
  });
});
