import { beforeEach, describe, expect, it } from "vitest";

import { HeadlessRendererHost } from "./renderer-host";
import { ThreeMirrorBackend, BackendViolation } from "./three-backend";
import { ResourceViolation } from "./resources";
import { cubeGeometry, quadGeometry } from "./translate";
import type { MaterialDescriptor } from "./test-support";

/**
 * Failure modes. Phase 2.5j.
 *
 * Every one of these is a situation a live show can actually reach. The rule
 * throughout: fail loudly at the point of misuse, or refuse cleanly and stay
 * usable. Never corrupt the mirror, and never take the show off air to
 * recover from something recoverable.
 */

const UNLIT: MaterialDescriptor = {
  kind: "unlit",
  color: [1, 1, 1, 1],
  transparent: false,
  doubleSided: false,
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let host: HeadlessRendererHost;
let backend: ThreeMirrorBackend;

beforeEach(() => {
  host = new HeadlessRendererHost();
  backend = new ThreeMirrorBackend({ host, maxBytes: 64 * 1024 * 1024 });
});

describe("invalid handles", () => {
  it("names the operation and the handle", () => {
    // A production defect at 3am needs the message to be enough on its own.
    expect(() => backend.setWorldMatrix(1234 as never, IDENTITY)).toThrow(
      /setWorldMatrix\(1234\)/,
    );
  });

  it("distinguishes a destroyed handle from a fabricated one", () => {
    const node = backend.createNode();
    backend.destroyNode(node);
    expect(() => backend.setVisible(node, true)).toThrow(/use after destroy/);
    expect(() => backend.setVisible(4321 as never, true)).toThrow(
      /never issued/,
    );
  });

  it("rejects attaching an unknown geometry", () => {
    const node = backend.createNode();
    const material = backend.createMaterial(UNLIT);
    if (!material.ok) throw new Error("setup failed");
    expect(() =>
      backend.attachMesh(node, 999 as never, material.value),
    ).toThrow();
  });

  it("leaves the mirror unchanged after a rejected operation", () => {
    // A throw must not be a partial mutation.
    const node = backend.createNode();
    backend.setWorldMatrix(node, IDENTITY);
    const before = JSON.stringify(backend.snapshot());

    expect(() => backend.setWorldMatrix(node, [1, 2, 3])).toThrow();
    expect(JSON.stringify(backend.snapshot())).toBe(before);
    expect(backend.isBalanced()).toBe(true);
  });
});

describe("double destruction", () => {
  it("rejects destroying a node twice", () => {
    const node = backend.createNode();
    backend.destroyNode(node);
    expect(() => backend.destroyNode(node)).toThrow(BackendViolation);
  });

  it("rejects releasing a resource twice", () => {
    const material = backend.createMaterial(UNLIT);
    if (!material.ok) throw new Error("setup failed");
    backend.destroyMaterial(material.value);
    expect(() => backend.destroyMaterial(material.value)).toThrow(
      ResourceViolation,
    );
  });

  it("keeps accounting correct after a rejected double free", () => {
    const geometry = backend.createGeometry(quadGeometry());
    if (!geometry.ok) throw new Error("setup failed");
    backend.destroyGeometry(geometry.value);
    expect(() => backend.destroyGeometry(geometry.value)).toThrow();
    expect(backend.diagnostics().resources.geometry.live).toBe(0);
    expect(backend.isBalanced()).toBe(true);
  });

  it("tolerates dispose being called twice", () => {
    // Shutdown paths race; the second call is a no-op, not an error.
    backend.dispose();
    expect(() => backend.dispose()).not.toThrow();
  });
});

describe("resource exhaustion", () => {
  it("refuses allocation rather than evicting a live resource", () => {
    const tiny = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
      maxBytes: 1024,
    });
    const first = tiny.createGeometry(quadGeometry());
    expect(first.ok).toBe(true);

    const second = tiny.createGeometry(cubeGeometry());
    expect(second.ok).toBe(false);
    if (!second.ok && second.reason.kind === "budget-exceeded") {
      // The frozen failure shape names the class that ran out; the byte
      // figures come from diagnostics(), not from the refusal.
      expect(second.reason.resourceClass).toBe("geometry");
    } else {
      throw new Error("expected a budget-exceeded refusal");
    }
    expect(tiny.diagnostics().vramEstimateBytes).toBeGreaterThan(0);

    // Critically: the first resource is untouched. ENGINE_RUNTIME §4.4 —
    // blanking an on-air graphic is worse than failing to load a new one.
    expect(tiny.diagnostics().resources.geometry.live).toBe(1);
  });

  it("stays usable after a refused allocation", () => {
    const tiny = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
      maxBytes: 1024,
    });
    tiny.createGeometry(quadGeometry());
    tiny.createGeometry(cubeGeometry());

    const node = tiny.createNode();
    expect(() => tiny.setWorldMatrix(node, IDENTITY)).not.toThrow();
    expect(tiny.isBalanced()).toBe(true);
  });

  it("serves a cache hit even when the budget is full", () => {
    // Refusing an allocation that costs nothing would take a graphic off air
    // for no reason.
    const tiny = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
      maxBytes: 1024,
    });
    const first = tiny.createGeometry(quadGeometry());
    const again = tiny.createGeometry(quadGeometry());
    expect(again.ok).toBe(true);
    if (first.ok && again.ok) expect(again.value).toBe(first.value);
  });
});

describe("shutdown", () => {
  it("refuses every operation after dispose", () => {
    const node = backend.createNode();
    backend.dispose();

    expect(() => backend.createNode()).toThrow(BackendViolation);
    expect(() => backend.setWorldMatrix(node, IDENTITY)).toThrow();
    expect(() => backend.createGeometry(quadGeometry())).toThrow();
  });

  it("does not submit after dispose", () => {
    const camera = backend.createCamera({
      kind: "orthographic",
      size: 10,
      near: 0.1,
      far: 100,
    });
    backend.dispose();
    expect(() =>
      backend.render(camera, {
        target: null,
        viewport: { width: 1920, height: 1080 },
        clearColor: [0, 0, 0, 0],
        layerMask: 0xffffffff,
      }),
    ).toThrow();
    expect(host.submissions).toHaveLength(0);
  });

  it("releases everything even mid-scene", () => {
    const geometry = backend.createGeometry(cubeGeometry());
    const material = backend.createMaterial(UNLIT);
    if (!geometry.ok || !material.ok) throw new Error("setup failed");
    for (let i = 0; i < 100; i += 1) {
      const node = backend.createNode();
      backend.attachMesh(node, geometry.value, material.value);
    }
    backend.dispose();
    expect(backend.diagnostics().resources.totalLive).toBe(0);
    expect(backend.diagnostics().vramEstimateBytes).toBe(0);
  });
});

describe("backend restart", () => {
  it("a fresh backend is unaffected by a previous one", () => {
    // Handles are per-backend. A restart must not inherit anything, or a
    // stale handle from the old instance would silently resolve in the new.
    const first = backend;
    const node = first.createNode();
    first.dispose();

    const second = new ThreeMirrorBackend({ host: new HeadlessRendererHost() });
    expect(second.snapshot().nodes).toEqual([]);
    expect(second.diagnostics().nodes.created).toBe(0);
    expect(() => second.setVisible(node, true)).toThrow(/never issued/);
  });

  it("rebuilds an identical mirror after restart", () => {
    const scene = (target: ThreeMirrorBackend) => {
      const geometry = target.createGeometry(quadGeometry());
      const material = target.createMaterial(UNLIT);
      if (!geometry.ok || !material.ok) throw new Error("setup failed");
      const root = target.createNode();
      const child = target.createNode();
      target.setParent(child, root);
      target.setWorldMatrix(root, IDENTITY);
      target.setWorldMatrix(child, IDENTITY);
      target.attachMesh(child, geometry.value, material.value);
    };

    scene(backend);
    const before = JSON.stringify(backend.snapshot());
    backend.dispose();

    const restarted = new ThreeMirrorBackend({
      host: new HeadlessRendererHost(),
    });
    scene(restarted);
    expect(JSON.stringify(restarted.snapshot())).toBe(before);
  });
});

describe("context loss edge cases", () => {
  it("tolerates loss before anything is created", () => {
    expect(() => backend.simulateContextLoss()).not.toThrow();
    expect(() => backend.simulateContextRestore()).not.toThrow();
    const node = backend.createNode();
    expect(backend.snapshot().nodes).toHaveLength(1);
    void node;
  });

  it("ignores a restore that was never preceded by a loss", () => {
    backend.simulateContextRestore();
    expect(backend.diagnostics().contextRestores).toBe(0);
  });

  it("collapses a repeated loss into one", () => {
    backend.simulateContextLoss();
    backend.simulateContextLoss();
    expect(backend.diagnostics().contextLosses).toBe(1);
  });

  it("accepts mutations while the context is lost", () => {
    // The engine does not stop when the GPU does. Commands keep arriving and
    // the mirror must stay correct so the restore has something to rebuild.
    backend.simulateContextLoss();
    const node = backend.createNode();
    backend.setWorldMatrix(node, IDENTITY);
    backend.simulateContextRestore();

    expect(backend.snapshot().nodes).toHaveLength(1);
    expect(backend.isBalanced()).toBe(true);
  });
});
