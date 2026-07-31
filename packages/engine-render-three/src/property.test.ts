import { describe, expect, it } from "vitest";

import { HeadlessRendererHost } from "./renderer-host";
import { ThreeMirrorBackend } from "./three-backend";
import { cubeGeometry, quadGeometry, planeGeometry } from "./translate";
import type { GeometryHandle, MaterialHandle, NodeHandle } from "./test-support";

/**
 * Property-based testing. Phase 2.5k.
 *
 * Randomised mirror graphs, driven through randomised operation sequences,
 * asserting invariants that must hold no matter what the engine does. Every
 * case is reproducible from its seed: a failure prints the seed, and rerunning
 * with that seed replays the exact sequence.
 *
 * These do not check that rendering looks right — they check that the backend
 * cannot be driven into an inconsistent state.
 */

/** Same LCG as the reconciler's property suite, for comparable sequences. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface World {
  backend: ThreeMirrorBackend;
  live: NodeHandle[];
  /** Parent of each live handle, for independent hierarchy verification. */
  parents: Map<NodeHandle, NodeHandle | null>;
  geometries: GeometryHandle[];
  materials: MaterialHandle[];
  attached: Set<NodeHandle>;
}

function newWorld(): World {
  const backend = new ThreeMirrorBackend({
    host: new HeadlessRendererHost(),
    maxBytes: 512 * 1024 * 1024,
  });
  const geometries: GeometryHandle[] = [];
  for (const descriptor of [quadGeometry(), cubeGeometry(), planeGeometry(2, 2)]) {
    const result = backend.createGeometry(descriptor);
    if (result.ok) geometries.push(result.value);
  }
  const materials: MaterialHandle[] = [];
  for (const color of [
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, 0, 1, 0.5],
  ] as const) {
    const result = backend.createMaterial({
      kind: "unlit",
      color: [...color],
      transparent: color[3] < 1,
      doubleSided: false,
    });
    if (result.ok) materials.push(result.value);
  }
  return {
    backend,
    live: [],
    parents: new Map(),
    geometries,
    materials,
    attached: new Set(),
  };
}

/** True if `candidate` is `node` or below it, walking the model, not Three. */
function isDescendant(
  world: World,
  ancestor: NodeHandle,
  candidate: NodeHandle,
): boolean {
  let current: NodeHandle | null = candidate;
  while (current !== null && current !== undefined) {
    if (current === ancestor) return true;
    current = world.parents.get(current) ?? null;
  }
  return false;
}

function childrenOf(world: World, parent: NodeHandle): NodeHandle[] {
  return world.live.filter((h) => world.parents.get(h) === parent);
}

type OperationName =
  | "create"
  | "reparent"
  | "transform"
  | "visibility"
  | "attach"
  | "detach"
  | "destroy";

/** Applies one random operation. Returns its name for the failure trace. */
function step(world: World, random: () => number): OperationName {
  const { backend } = world;
  const choice = random();

  if (world.live.length === 0 || choice < 0.3) {
    const node = backend.createNode();
    world.live.push(node);
    world.parents.set(node, null);
    return "create";
  }

  const pick = (): NodeHandle =>
    world.live[Math.floor(random() * world.live.length)]!;

  if (choice < 0.45) {
    const child = pick();
    const parent = pick();
    // The backend refuses cycles; only ask for legal ones so the property
    // under test is the resulting structure, not the rejection.
    if (child !== parent && !isDescendant(world, child, parent)) {
      backend.setParent(child, parent);
      world.parents.set(child, parent);
    }
    return "reparent";
  }

  if (choice < 0.6) {
    const node = pick();
    const matrix = [...IDENTITY];
    matrix[12] = Math.floor(random() * 100);
    matrix[13] = Math.floor(random() * 100);
    matrix[14] = Math.floor(random() * 100);
    backend.setWorldMatrix(node, matrix);
    return "transform";
  }

  if (choice < 0.7) {
    backend.setVisible(pick(), random() < 0.5);
    return "visibility";
  }

  if (choice < 0.85) {
    const node = pick();
    if (!world.attached.has(node)) {
      const geometry =
        world.geometries[Math.floor(random() * world.geometries.length)]!;
      const material =
        world.materials[Math.floor(random() * world.materials.length)]!;
      backend.attachMesh(node, geometry, material);
      world.attached.add(node);
    }
    return "attach";
  }

  if (choice < 0.9) {
    const node = pick();
    if (world.attached.has(node)) {
      backend.detach(node);
      world.attached.delete(node);
    }
    return "detach";
  }

  // Destroy is only legal for a leaf, matching the backend's contract.
  const node = pick();
  if (childrenOf(world, node).length === 0) {
    if (world.attached.has(node)) {
      backend.detach(node);
      world.attached.delete(node);
    }
    backend.destroyNode(node);
    world.live.splice(world.live.indexOf(node), 1);
    world.parents.delete(node);
  }
  return "destroy";
}

/**
 * Invariants that must hold after every single operation. Checking after each
 * step rather than at the end is what makes a failure point at one operation
 * instead of at a whole sequence.
 */
function checkInvariants(world: World, seed: number, index: number, op: string) {
  const context = `seed=${seed} step=${index} op=${op}`;
  const snapshot = world.backend.snapshot();

  // P1: every live node appears exactly once in the mirror.
  expect(snapshot.nodes.length, `${context}: node count`).toBe(
    world.live.length,
  );
  const paths = snapshot.nodes.map((n) => n.path);
  expect(new Set(paths).size, `${context}: duplicate paths`).toBe(paths.length);

  // P2: accounting balances — nothing is leaked and nothing double-freed.
  const diagnostics = world.backend.diagnostics();
  expect(diagnostics.nodes.balance, `${context}: node balance`).toBe(0);
  expect(world.backend.isBalanced(), `${context}: pools balanced`).toBe(true);

  // P3: a resource in use is never released.
  if (world.attached.size > 0) {
    expect(
      diagnostics.resources.totalLive,
      `${context}: live resources`,
    ).toBeGreaterThan(0);
  }

  // P4: the mirror is a forest — paths are well-formed and every non-root
  // path has a parent present.
  for (const path of paths) {
    if (!path.includes("/")) continue;
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    expect(paths, `${context}: orphan at ${path}`).toContain(parentPath);
  }
}

describe("randomised mirror graphs", () => {
  const seeds = [1, 7, 42, 99, 1234, 8675309, 20260801, 314159];

  it.each(seeds)("holds every invariant under seed %i", (seed) => {
    const random = rng(seed);
    const world = newWorld();
    for (let i = 0; i < 300; i += 1) {
      const op = step(world, random);
      checkInvariants(world, seed, i, op);
    }
    world.backend.dispose();
    expect(world.backend.diagnostics().resources.totalLive).toBe(0);
  });

  it.each(seeds)("teardown from any state frees everything (seed %i)", (seed) => {
    const random = rng(seed);
    const world = newWorld();
    for (let i = 0; i < 200; i += 1) step(world, random);

    // Destroying leaves repeatedly must terminate and empty the mirror.
    let guard = 0;
    while (world.live.length > 0) {
      if (guard++ > 10_000) throw new Error(`seed=${seed}: teardown looped`);
      const leaf = world.live.find(
        (h) => childrenOf(world, h).length === 0,
      );
      if (leaf === undefined) throw new Error(`seed=${seed}: cycle in forest`);
      if (world.attached.has(leaf)) {
        world.backend.detach(leaf);
        world.attached.delete(leaf);
      }
      world.backend.destroyNode(leaf);
      world.live.splice(world.live.indexOf(leaf), 1);
      world.parents.delete(leaf);
    }

    expect(world.backend.snapshot().nodes).toEqual([]);
    expect(world.backend.diagnostics().nodes.balance).toBe(0);
  });

  it.each(seeds.slice(0, 4))(
    "survives context loss at an arbitrary point (seed %i)",
    (seed) => {
      const random = rng(seed);
      const world = newWorld();
      for (let i = 0; i < 150; i += 1) step(world, random);

      const before = JSON.stringify(world.backend.snapshot());
      world.backend.simulateContextLoss();
      world.backend.simulateContextRestore();

      // The mirror is the engine's contract; a GPU reset must not perturb it.
      expect(JSON.stringify(world.backend.snapshot())).toBe(before);
      expect(world.backend.isBalanced()).toBe(true);

      // And the backend keeps working afterwards.
      for (let i = 0; i < 50; i += 1) step(world, random);
      expect(world.backend.diagnostics().nodes.balance).toBe(0);
    },
  );

  it("produces identical results for identical seeds", () => {
    // Determinism is the whole reason a seed is worth printing.
    const run = () => {
      const random = rng(777);
      const world = newWorld();
      for (let i = 0; i < 200; i += 1) step(world, random);
      return JSON.stringify(world.backend.snapshot());
    };
    expect(run()).toBe(run());
  });
});
