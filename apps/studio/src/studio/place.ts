/**
 * Placing a scene inside a scene.
 *
 * This is the join in the primary journey: Marketplace → Assets → **drag onto
 * the Stage** → edit → cue → take. Until now the only way to open something
 * from the library replaced whatever you had. That is not how anyone builds a
 * broadcast: a scorebug goes ON the programme you already have, and a sponsor
 * bug goes on top of that.
 *
 * There is no new document model here and no second scene graph. A placed
 * scene becomes ORDINARY NODES in the open document — reminted, appended,
 * selected. Everything downstream (undo, projection, animation, take) sees the
 * result as nodes it already knows how to handle, which is the whole reason
 * "everything is a Scene" is worth saying.
 *
 * What travels with the nodes:
 *   - variables, so the placed scene's fields appear on the Content surface
 *   - colour tokens it needs, WITHOUT overwriting the host's palette
 *
 * What does not travel: outputs, timeline and template metadata. Those belong
 * to the document doing the hosting. A scorebug does not get to redefine what
 * you are broadcasting to.
 */

import {
  childrenOf,
  makeSetDocProp,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  IDENTITY_TRANSFORM,
  type SceneToken,
  type SceneVariable,
  type Transaction,
} from "@bracketx/engine-scene";
import type { IdFactory } from "./ids";
import { orderAfterLast, remintIds, transaction } from "./editing";
import { canvasSize } from "./viewport";

/**
 * The drag-and-drop MIME type for a scene.
 *
 * A custom type, not `text/plain`: the Stage must be able to say "this is a
 * scene" during `dragover` — before the drop — so the drop target can light
 * up, and a stray text selection dragged from a panel must not look like one.
 */
export const SCENE_DRAG = "application/x-streamatrix-scene";

export interface Placement {
  readonly transaction: Transaction;
  /** The reminted roots, so the caller can select what the user just placed. */
  readonly nodeIds: readonly string[];
}

/**
 * Places `scene`'s content into `host`.
 *
 * `centre` is in document (canvas) coordinates and is optional: dropping onto
 * a specific point should land there, while an "Add to scene" button has no
 * point to speak of and should land where the designer built it.
 */
export function placeScene(
  host: SceneDocument,
  scene: SceneDocument,
  ids: IdFactory,
  centre?: { readonly x: number; readonly y: number },
): Placement | null {
  // The host keeps its own camera. A scene contributes CONTENT; what the
  // production is shot through is the host's decision, exactly as outputs and
  // timelines are. Copying the guest's camera too put two "Camera" layers in
  // the tree — inert clutter at best, and a second opinion about the framing
  // at worst.
  const hasCamera = childrenOf(host.root).some(isCamera);
  const roots = childrenOf(scene.root).filter((node) => !(hasCamera && isCamera(node)));
  if (roots.length === 0) return null;

  const operations: SceneOperation[] = [];
  const created: string[] = [];

  // A placed scene arrives as ONE thing you can move, not as loose parts.
  // Grouping also makes the drop point meaningful: offset the group, and
  // everything inside keeps the relationship its designer intended.
  const offset = centre === undefined ? null : offsetFor(scene, roots, centre);

  // Order keys are per parent and must be unique, so they advance as the
  // placed roots are appended — the same rule `duplicateNodes` follows.
  const placed: SceneNode[] = [];
  for (const node of roots) {
    const order = orderAfterLast(
      { ...host, root: { ...host.root, children: [...childrenOf(host.root), ...placed] } },
      host.root.id,
    );
    const copy = { ...remintIds(node, ids), order };
    placed.push(copy);
    created.push(copy.id);
    operations.push({
      type: "node.insert",
      parentId: host.root.id,
      node: offset === null ? copy : shift(copy, offset),
    });
  }

  // Variables the placed scene's fields are bound to. Keyed by `key`, because
  // that is what a binding names; a clash means the host already has a field
  // by that name and the host wins — its content is the one on air.
  const have = new Set((host.variables ?? []).map((variable) => variable.key));
  for (const variable of scene.variables ?? []) {
    if (have.has(variable.key)) continue;
    have.add(variable.key);
    operations.push({
      type: "variable.define",
      variable: { ...variable, id: ids("variable") } as SceneVariable,
    });
  }

  // Colours: fill the gaps, never repaint. A lower third placed into a themed
  // project must take the project's brand — that is the promise of tokens.
  const merged = new Map<string, SceneToken>();
  for (const token of scene.tokens ?? []) merged.set(token.name, token);
  for (const token of host.tokens ?? []) merged.set(token.name, token);
  if (merged.size !== (host.tokens ?? []).length) {
    const tokens = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    operations.push(makeSetDocProp(host, "tokens", tokens));
  }

  const name = scene.template?.name ?? scene.meta.name;
  return { nodeIds: created, transaction: transaction(`Place ${name}`, operations) };
}

function isCamera(node: SceneNode): boolean {
  return (node.components ?? []).some((component) => component.type === "camera");
}

/** Moves the placed content so its centre lands on the drop point. */
function offsetFor(
  scene: SceneDocument,
  roots: readonly SceneNode[],
  centre: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  // The scene's own centre is its canvas centre, not the bounding box of its
  // nodes: a lower third is deliberately off-centre inside its frame, and
  // preserving that is the difference between "placed" and "moved".
  void roots;
  const canvas = canvasSize(scene);
  return { x: centre.x - canvas.width / 2, y: centre.y - canvas.height / 2 };
}

function shift(node: SceneNode, offset: { readonly x: number; readonly y: number }): SceneNode {
  const transform = node.transform ?? IDENTITY_TRANSFORM;
  const [x, y, z] = transform.position;
  return {
    ...node,
    transform: { ...transform, position: [x + offset.x, y + offset.y, z] },
  };
}
