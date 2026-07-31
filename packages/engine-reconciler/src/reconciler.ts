/**
 * The Reconciler. ENGINE_RECONCILIATION §1.
 *
 * Three verbs and nothing else: build, project, teardown.
 *
 * The reconciler owns mirror LIFETIME through opaque handles; the backend owns
 * the instances (IF-001). It never imports a rendering library, never mutates
 * the scene graph, and never diffs a tree.
 */
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";

import { DirtySet } from "./dirty";
import { MirrorGraph } from "./mirror";
import type { MirrorBackend } from "./mirror-backend";
import { Projector, type ProjectionReport } from "./projection";
import type { VariableSource } from "./resolve";
import { EMPTY_VARIABLES } from "./resolve";
import { verifyConsistency, type ConsistencyResult } from "./verify";

export interface ReconcilerOptions {
  /**
   * Verify structural consistency after every projection.
   *
   * Off by default: the check is O(scene), which defeats incremental
   * projection. On in tests and dev builds, where correctness beats speed.
   */
  readonly verifyAfterEachProjection?: boolean;
}

export interface ReconcilerStats {
  readonly mirrorNodes: number;
  readonly created: number;
  readonly destroyed: number;
  readonly projections: number;
  readonly operationsProjected: number;
  readonly dependencyEdges: number;
  readonly trackedVariables: number;
  readonly lastReport: ProjectionReport | null;
}

export class Reconciler {
  readonly mirror: MirrorGraph;
  readonly projector: Projector;

  #document: SceneDocument | null = null;
  #projections = 0;
  #operationsProjected = 0;
  #lastReport: ProjectionReport | null = null;
  #verifyAlways: boolean;

  constructor(
    private readonly backend: MirrorBackend,
    options: ReconcilerOptions = {},
  ) {
    this.mirror = new MirrorGraph(backend);
    this.projector = new Projector(this.mirror, backend);
    this.#verifyAlways = options.verifyAfterEachProjection ?? false;
  }

  get document(): SceneDocument | null {
    return this.#document;
  }

  /** Full construction. Scene load and recovery only — never a live path. */
  build(
    document: SceneDocument,
    variables: VariableSource = EMPTY_VARIABLES,
  ): ProjectionReport {
    if (this.#document !== null) {
      throw new Error(
        "build() on a populated reconciler; call teardown() first",
      );
    }
    const report = this.projector.build(document, variables);
    this.#document = document;
    this.#lastReport = report;
    if (this.#verifyAlways) this.#verifyOrThrow("build");
    return report;
  }

  /**
   * Projects a transaction.
   *
   * `document` must already have it applied — ENGINE_RECONCILIATION §1.5.
   */
  project(
    transaction: Transaction,
    document: SceneDocument,
    variables: VariableSource = EMPTY_VARIABLES,
  ): ProjectionReport {
    if (this.#document === null) {
      throw new Error("project() before build()");
    }
    const report = this.projector.project(transaction, document, variables);
    this.#document = document;
    this.#projections += 1;
    this.#operationsProjected += transaction.operations.length;
    this.#lastReport = report;
    if (this.#verifyAlways) this.#verifyOrThrow(transaction.label);
    return report;
  }

  /** Re-resolves only the nodes reading these variables. */
  invalidateVariables(
    variableKeys: Iterable<string>,
    variables: VariableSource,
  ): ProjectionReport {
    if (this.#document === null) {
      throw new Error("invalidateVariables() before build()");
    }
    const report = this.projector.invalidateVariables(
      variableKeys,
      this.#document,
      variables,
    );
    this.#lastReport = report;
    return report;
  }

  teardown(): void {
    this.projector.teardown();
    this.#document = null;
    this.#lastReport = null;
  }

  verify(): ConsistencyResult {
    if (this.#document === null) {
      return { consistent: true, issues: [], checkedNodes: 0 };
    }
    return verifyConsistency(this.mirror, this.#document);
  }

  stats(): ReconcilerStats {
    const mirrorStats = this.mirror.stats();
    const dependencyStats = this.projector.dependencies.stats();
    return {
      mirrorNodes: mirrorStats.nodeCount,
      created: mirrorStats.created,
      destroyed: mirrorStats.destroyed,
      projections: this.#projections,
      operationsProjected: this.#operationsProjected,
      dependencyEdges: dependencyStats.edges,
      trackedVariables: dependencyStats.trackedVariables,
      lastReport: this.#lastReport,
    };
  }

  #verifyOrThrow(context: string): void {
    const result = this.verify();
    if (result.consistent) return;
    const summary = result.issues
      .slice(0, 10)
      .map((i) => `  [${i.code}] ${i.nodeId ?? "-"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `mirror inconsistent after "${context}" — ` +
        `${result.issues.length} issue(s):\n${summary}`,
    );
  }
}

export { DirtySet };
export type { VariableSource };
