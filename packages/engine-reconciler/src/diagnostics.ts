/**
 * Developer diagnostics. Phase 2.4l.
 *
 * Aggregates every counter the reconciler already maintains into one snapshot,
 * so a regression can be expressed as "this projection should touch N nodes and
 * issue M writes" rather than as a timing measurement that varies per machine.
 *
 * Deterministic by construction: no timestamps, no wall-clock durations, no
 * iteration-order-dependent output. Two identical runs produce identical
 * snapshots, which is what makes these usable as committed fixtures.
 */
import type { DependencyIndex } from "./dependencies";
import type { MirrorGraph, MirrorNode } from "./mirror";
import type { ProjectionReport } from "./projection";
import type { Reconciler } from "./reconciler";

export interface LifetimeSnapshot {
  readonly created: number;
  readonly destroyed: number;
  readonly live: number;
  /** created - destroyed. Non-zero when live disagrees is a leak. */
  readonly balance: number;
}

export interface HierarchySnapshot {
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly maxBranching: number;
  readonly leafCount: number;
}

export interface DiagnosticsSnapshot {
  readonly mirror: HierarchySnapshot;
  readonly lifetime: LifetimeSnapshot;
  readonly dependencies: {
    readonly trackedNodes: number;
    readonly trackedVariables: number;
    readonly edges: number;
  };
  readonly projections: number;
  readonly operationsProjected: number;
  readonly lastProjection: ProjectionReport | null;
}

/** Depth, branching, and leaf counts. O(nodes); dev and test use only. */
export function describeHierarchy(mirror: MirrorGraph): HierarchySnapshot {
  let maxDepth = 0;
  let maxBranching = 0;
  let leafCount = 0;
  let nodeCount = 0;

  const rootId = mirror.rootId;
  if (rootId === null) {
    return { nodeCount: 0, maxDepth: 0, maxBranching: 0, leafCount: 0 };
  }

  // Iterative: a 100k-node chain would blow the stack recursively.
  const stack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    const node: MirrorNode | undefined = mirror.get(id);
    if (!node) continue;

    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    const children = node.childIds;
    if (children.length === 0) leafCount += 1;
    if (children.length > maxBranching) maxBranching = children.length;

    for (const childId of children) stack.push({ id: childId, depth: depth + 1 });
  }

  return { nodeCount, maxDepth, maxBranching, leafCount };
}

export function describeLifetime(mirror: MirrorGraph): LifetimeSnapshot {
  const stats = mirror.stats();
  return {
    created: stats.created,
    destroyed: stats.destroyed,
    live: stats.nodeCount,
    balance: stats.created - stats.destroyed,
  };
}

export function describeDependencies(index: DependencyIndex) {
  return index.stats();
}

/** One deterministic snapshot of everything. */
export function snapshotDiagnostics(
  reconciler: Reconciler,
): DiagnosticsSnapshot {
  const stats = reconciler.stats();
  return {
    mirror: describeHierarchy(reconciler.mirror),
    lifetime: describeLifetime(reconciler.mirror),
    dependencies: describeDependencies(reconciler.projector.dependencies),
    projections: stats.projections,
    operationsProjected: stats.operationsProjected,
    lastProjection: stats.lastReport,
  };
}

/**
 * True when the mirror's own counters are self-consistent.
 *
 * Cheap enough for a dev-build assertion after every projection, unlike full
 * structural verification which is O(scene).
 */
export function lifetimeBalanced(mirror: MirrorGraph): boolean {
  const lifetime = describeLifetime(mirror);
  return lifetime.balance === lifetime.live;
}
