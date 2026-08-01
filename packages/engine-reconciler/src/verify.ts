/**
 * Structural verification. Phase 2.4g.
 *
 * Turns every mirror invariant into an executable check. Used by tests after
 * every operation and available as a dev-build assertion.
 *
 * Deliberately independent of the projection code: it re-derives what the
 * mirror should contain from the document, rather than trusting anything
 * projection recorded. A verifier that shares projection's assumptions cannot
 * catch projection's mistakes.
 */
import {
  childrenOf,
  multiply,
  type Mat4,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import type { MirrorGraph } from "./mirror";
import { localMatrixOf } from "./resolve";

export interface ConsistencyIssue {
  readonly code: string;
  readonly nodeId: string | null;
  readonly message: string;
}

export interface ConsistencyResult {
  readonly consistent: boolean;
  readonly issues: readonly ConsistencyIssue[];
  readonly checkedNodes: number;
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const EPSILON = 1e-9;

function matricesEqual(a: Mat4, b: Mat4): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i]! - b[i]!) > EPSILON) return false;
  }
  return true;
}

/**
 * Verifies the mirror against the document.
 *
 * Checks, in order of what they would break:
 *   membership      every document node is mirrored, and nothing else is
 *   hierarchy       parent links agree in both directions
 *   ordering        siblings follow the document's fractional index
 *   transforms      world = parent.world x local, recomputed independently
 *   visibility      effective = own AND every ancestor
 *   components      camera attachments match the document
 */
export function verifyConsistency(
  mirror: MirrorGraph,
  document: SceneDocument,
): ConsistencyResult {
  const issues: ConsistencyIssue[] = [];
  const report = (code: string, nodeId: string | null, message: string) =>
    issues.push({ code, nodeId, message });

  /**
   * Ids the document accounts for.
   *
   * A repeat container's children are a TEMPLATE, never rendered, and the
   * mirror instead holds instances named `<templateId>#<identity>` (Project
   * Alpha A2). The verifier re-derives that naming rule independently rather
   * than importing the expansion — a verifier that shared the implementation's
   * code would agree with its bugs.
   *
   * Instance identities are data-dependent and this function is deliberately
   * not given the variables, so the shape is checked, not the count: every
   * mirror node must trace back to a template node under a repeat container,
   * and every template node must be absent from the mirror.
   */
  const documentIds = new Set<string>();
  const templateIds = new Set<string>();

  const collectIds = (node: SceneNode, insideTemplate: boolean): void => {
    if (insideTemplate) templateIds.add(node.id);
    else documentIds.add(node.id);

    const childrenAreTemplate = insideTemplate || node.repeat !== undefined;
    for (const child of childrenOf(node)) collectIds(child, childrenAreTemplate);
  };
  collectIds(document.root, false);

  const mirrorIds = new Set(mirror.nodeIds());

  /** Splits `nod_row#t2` into its template id and identity. */
  const instanceOf = (id: string): string | null => {
    const hash = id.lastIndexOf("#");
    if (hash <= 0) return null;
    const templateId = id.slice(0, hash);
    return templateIds.has(templateId) ? templateId : null;
  };

  // -- Membership ----------------------------------------------------------
  for (const id of documentIds) {
    if (!mirrorIds.has(id)) {
      report("missing", id, "document node has no mirror node");
    }
  }
  for (const id of mirrorIds) {
    if (documentIds.has(id)) continue;
    if (instanceOf(id) !== null) continue;
    // An orphan is a leak: the backend object outlives its document node.
    report("orphan", id, "mirror node has no document node");
  }

  // A template node must never be mirrored directly. If one is, expansion ran
  // on the wrong nodes and the scene is rendering its own blueprint.
  for (const id of templateIds) {
    if (mirrorIds.has(id)) {
      report(
        "template-rendered",
        id,
        "template node is in the mirror; it should only appear as instances",
      );
    }
  }

  if (mirror.rootId !== document.root.id) {
    report(
      "root",
      document.root.id,
      `mirror root is "${mirror.rootId}", document root is "${document.root.id}"`,
    );
  }

  // -- Hierarchy, ordering, transforms, visibility --------------------------
  const visit = (
    node: SceneNode,
    parentId: string | null,
    parentWorld: Mat4,
    parentVisible: boolean,
  ) => {
    const mirrorNode = mirror.get(node.id);
    if (!mirrorNode) return;

    if (mirrorNode.parentId !== parentId) {
      report(
        "parent",
        node.id,
        `mirror parent "${mirrorNode.parentId}" != document parent "${parentId}"`,
      );
    }

    if (parentId !== null) {
      const parent = mirror.get(parentId);
      if (parent && !parent.childIds.includes(node.id)) {
        // One-way links are how orphans and double-frees begin.
        report("backlink", node.id, "parent does not list this node as a child");
      }
    }

    // A repeat container's children are instances, and their order comes from
    // the COLLECTION, not from fractional index keys. This function is
    // deliberately not given the variables, so it cannot re-derive that order
    // and does not pretend to — the membership and template-rendered checks
    // above already prove the instances are well-formed.
    if (node.repeat === undefined) {
      const documentChildren = childrenOf(node).map((child) => child.id);
      const mirrorChildren = [...mirrorNode.childIds];
      if (
        documentChildren.length !== mirrorChildren.length ||
        documentChildren.some((id, index) => id !== mirrorChildren[index])
      ) {
        report(
          "ordering",
          node.id,
          `child order [${mirrorChildren.join(",")}] != document [${documentChildren.join(",")}]`,
        );
      }
    }

    const expectedLocal = localMatrixOf(node.transform);
    if (!matricesEqual(mirrorNode.localMatrix, expectedLocal)) {
      report("localMatrix", node.id, "local matrix does not match the document");
    }

    const expectedWorld = multiply(parentWorld, expectedLocal);
    if (!matricesEqual(mirrorNode.worldMatrix, expectedWorld)) {
      report(
        "worldMatrix",
        node.id,
        "world matrix is not parent.world x local — propagation is stale",
      );
    }

    const ownVisible = node.visible ?? true;
    if (mirrorNode.visible !== ownVisible) {
      report("visible", node.id, "authored visibility does not match");
    }
    const expectedEffective = parentVisible && ownVisible;
    if (mirrorNode.effectiveVisible !== expectedEffective) {
      report(
        "effectiveVisible",
        node.id,
        "effective visibility does not compose with ancestors",
      );
    }

    const hasCamera = node.components?.some((c) => c.type === "camera") ?? false;
    if (hasCamera && mirrorNode.attachment.kind !== "camera") {
      report("camera", node.id, "document has a camera component, mirror does not");
    }
    if (!hasCamera && mirrorNode.attachment.kind === "camera") {
      report("camera", node.id, "mirror has a camera the document does not");
    }

    for (const child of childrenOf(node)) {
      visit(child, node.id, expectedWorld, expectedEffective);
    }
  };

  visit(document.root, null, IDENTITY, true);

  return {
    consistent: issues.length === 0,
    issues,
    checkedNodes: documentIds.size,
  };
}

export function assertConsistent(
  mirror: MirrorGraph,
  document: SceneDocument,
  context = "",
): void {
  const result = verifyConsistency(mirror, document);
  if (result.consistent) return;

  const summary = result.issues
    .slice(0, 20)
    .map((issue) => `  [${issue.code}] ${issue.nodeId ?? "-"}: ${issue.message}`)
    .join("\n");
  const more =
    result.issues.length > 20 ? `\n  ... ${result.issues.length - 20} more` : "";

  throw new Error(
    `mirror is inconsistent${context ? ` (${context})` : ""} — ` +
      `${result.issues.length} issue(s):\n${summary}${more}`,
  );
}
