/**
 * Shared harness for the P-001 performance investigation.
 *
 * Scene generators, timing helpers, and allocation measurement. Kept in one
 * place so the profiler, the benchmarks, and the regression guards all measure
 * the same shapes — otherwise a "10k scene" means something different in each
 * file and the numbers cannot be compared.
 */
import { createSequentialIdFactory } from "./ids";
import { generateKeyBetween } from "./order";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
} from "./types";
import type { SceneDocument, SceneNode } from "./types";

/** SceneNode is readonly by design; fixture construction casts deliberately. */
type Mutable = { children: SceneNode[] };

export type SceneShape = "wide" | "deep" | "balanced" | "mixed";

export interface GeneratedScene {
  readonly document: SceneDocument;
  /** Every node id, in creation order. Lets a benchmark pick targets. */
  readonly ids: readonly string[];
  /** Deepest path length, for reasoning about O(depth) claims. */
  readonly depth: number;
}

function emptyDocument(root: SceneNode): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_perf",
    meta: {
      name: "Perf",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    root,
  };
}

/**
 * Builds a scene of `count` nodes in the requested shape.
 *
 * The shapes are not decoration. "wide" and "deep" stress different terms of
 * the same complexity expressions: a wide tree makes sibling-array cost
 * dominate, a deep tree makes path-rebuild cost dominate, and an algorithm can
 * look linear in one while being quadratic in the other.
 */
export function generateScene(shape: SceneShape, count: number): GeneratedScene {
  const nextId = createSequentialIdFactory();
  const ids: string[] = [];

  const makeNode = (id: string, order: string): SceneNode => ({
    id,
    name: id,
    order,
    transform: IDENTITY_TRANSFORM,
  });

  const rootId = nextId("node");
  ids.push(rootId);
  const root = makeNode(rootId, generateKeyBetween(null, null));
  (root as unknown as Mutable).children = [];

  let depth = 1;

  if (shape === "wide") {
    // One root, count-1 direct children. Sibling arrays at their worst.
    const children: SceneNode[] = [];
    let previous: string | null = null;
    for (let i = 1; i < count; i += 1) {
      const id = nextId("node");
      ids.push(id);
      previous = generateKeyBetween(previous, null);
      children.push(makeNode(id, previous));
    }
    (root as unknown as Mutable).children = children;
    depth = count > 1 ? 2 : 1;
  } else if (shape === "deep") {
    // A single chain. Path rebuild at its worst.
    let current = root;
    for (let i = 1; i < count; i += 1) {
      const id = nextId("node");
      ids.push(id);
      const child = makeNode(id, generateKeyBetween(null, null));
      (child as unknown as Mutable).children = [];
      (current as unknown as Mutable).children = [child];
      current = child;
    }
    depth = count;
  } else if (shape === "balanced") {
    // Fan-out 8: realistic for authored scenes — a few groups, each with a
    // handful of layers.
    const FANOUT = 8;
    const queue: SceneNode[] = [root];
    let created = 1;
    while (created < count && queue.length > 0) {
      const parent = queue.shift()!;
      const children: SceneNode[] = [];
      let previous: string | null = null;
      for (let i = 0; i < FANOUT && created < count; i += 1) {
        const id = nextId("node");
        ids.push(id);
        previous = generateKeyBetween(previous, null);
        const child = makeNode(id, previous);
        (child as unknown as Mutable).children = [];
        children.push(child);
        queue.push(child);
        created += 1;
      }
      (parent as unknown as Mutable).children = children;
    }
    depth = Math.ceil(Math.log(count * (FANOUT - 1) + 1) / Math.log(FANOUT));
  } else {
    // Mixed: a wide row of groups, each holding a deep-ish stack. Closest to a
    // real broadcast package — many lower-thirds, each a small nested rig.
    const GROUPS = Math.max(1, Math.floor(Math.sqrt(count)));
    const perGroup = Math.max(1, Math.floor((count - 1) / GROUPS));
    const groups: SceneNode[] = [];
    let created = 1;
    let groupOrder: string | null = null;
    for (let g = 0; g < GROUPS && created < count; g += 1) {
      const groupId = nextId("node");
      ids.push(groupId);
      groupOrder = generateKeyBetween(groupOrder, null);
      const group = makeNode(groupId, groupOrder);
      (group as unknown as Mutable).children = [];
      created += 1;

      let current = group;
      for (let i = 1; i < perGroup && created < count; i += 1) {
        const id = nextId("node");
        ids.push(id);
        const child = makeNode(id, generateKeyBetween(null, null));
        (child as unknown as Mutable).children = [];
        (current as unknown as Mutable).children = [child];
        current = child;
        created += 1;
      }
      groups.push(group);
    }
    (root as unknown as Mutable).children = groups;
    depth = perGroup + 1;
  }

  return { document: emptyDocument(root), ids, depth };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Minimum of `rounds` samples.
 *
 * The minimum is the right statistic here: interference from GC, the OS
 * scheduler, or a parallel test worker can only ever make a sample slower, so
 * the fastest observed run is the closest estimate of true cost. Means and
 * medians drift with machine load; minima do not.
 */
export function fastest(rounds: number, body: () => void): number {
  let best = Infinity;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    body();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/** Per-iteration cost in milliseconds, for operations too fast to time once. */
export function perOperation(
  rounds: number,
  iterations: number,
  body: (index: number) => void,
): number {
  return (
    fastest(rounds, () => {
      for (let i = 0; i < iterations; i += 1) body(i);
    }) / iterations
  );
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export interface AllocationSample {
  /** Bytes retained after a forced GC — real cost. */
  readonly retainedBytes: number;
  /** Bytes allocated in total, including immediately-collectable garbage. */
  readonly allocatedBytes: number;
}

declare const global: { gc?: () => void };

export const gcAvailable = typeof global.gc === "function";

function collect(): void {
  if (global.gc) {
    // Twice: the first pass can resurrect objects held by finalisers.
    global.gc();
    global.gc();
  }
}

/**
 * Measures allocation for one operation.
 *
 * Requires --expose-gc; without it retained figures are meaningless because
 * a collection may or may not have run between samples. `gcAvailable` lets a
 * caller skip rather than report a number it cannot stand behind.
 */
export function measureAllocation(
  iterations: number,
  body: (index: number) => unknown,
): AllocationSample {
  collect();
  const before = process.memoryUsage().heapUsed;

  // Keep the last result alive so the optimiser cannot elide the work.
  let sink: unknown;
  for (let i = 0; i < iterations; i += 1) sink = body(i);

  const peak = process.memoryUsage().heapUsed;
  collect();
  const after = process.memoryUsage().heapUsed;
  void sink;

  return {
    retainedBytes: Math.max(0, after - before) / iterations,
    allocatedBytes: Math.max(0, peak - before) / iterations,
  };
}

/** Counts objects created, by patching nothing — a structural walk instead. */
export function countObjects(value: unknown, seen = new Set<unknown>()): number {
  if (value === null || typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let total = 1;
  if (Array.isArray(value)) {
    for (const item of value) total += countObjects(item, seen);
  } else {
    for (const item of Object.values(value)) total += countObjects(item, seen);
  }
  return total;
}

/**
 * Nodes that changed identity between two trees.
 *
 * Structural sharing means an untouched subtree keeps its object identity. The
 * number of nodes that did NOT survive an edit is the direct measure of how
 * much the edit actually rebuilt — and therefore of how much garbage it made.
 */
export function changedNodeCount(before: SceneNode, after: SceneNode): number {
  // Iterative: a 50k-deep chain overflows a recursive walk, and measuring the
  // deep shape is the entire point of having one.
  let total = 0;
  const stack: [SceneNode | null, SceneNode][] = [[before, after]];

  while (stack.length > 0) {
    const [previous, current] = stack.pop()!;
    if (previous === current) continue;
    total += 1;

    const currentChildren = current.children ?? [];
    if (currentChildren.length === 0) continue;

    if (previous === null) {
      for (const child of currentChildren) stack.push([null, child]);
      continue;
    }
    const byId = new Map<string, SceneNode>();
    for (const child of previous.children ?? []) byId.set(child.id, child);
    for (const child of currentChildren) {
      stack.push([byId.get(child.id) ?? null, child]);
    }
  }
  return total;
}
