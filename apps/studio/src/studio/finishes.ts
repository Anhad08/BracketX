/**
 * Finishes — materials named by what they LOOK like.
 *
 * ============================================================================
 * THE GOLDEN RULE, APPLIED TO MATERIALS
 * ============================================================================
 * The founder's instruction is explicit, and it is a product decision rather
 * than a stylistic one:
 *
 *   "Never expose PBR terminology first. Expose outcomes. Instead of
 *    Metalness / Roughness / Specular / IOR / Transmission — expose
 *    Matte / Glass / Chrome / Plastic / Broadcast / Premium / Soft / Bold.
 *    Advanced reveals the underlying parameters."
 *
 * So a person picks "Chrome". The engine receives `metallic: 1, roughness:
 * 0.08`. Both are true at once: the finish is what was chosen, the numbers are
 * what was generated, and an advanced user can read and override either.
 *
 * ============================================================================
 * WHY THE NUMBERS GO IN THE DOCUMENT
 * ============================================================================
 * `applyFinish` writes the resolved PBR values into the node, not the name.
 *
 * That is deliberate and it follows the pattern the motion presets already
 * established: a preset GENERATES real engine tracks, and the timeline shows
 * what it generated. A document that stored only "chrome" would need the
 * engine to know what chrome means — a broadcast noun inside SCENE_FORMAT,
 * which §7 refuses, and which would freeze the definition of chrome for ever.
 *
 * The chosen name is stored alongside as `finish`, purely so the picker can
 * show which button is lit and so an advanced user can see what produced the
 * numbers. Nothing reads it to decide how to render — change the roughness by
 * hand and the render changes; the name simply stops matching, which is the
 * honest outcome and is what `finishOf` reports.
 */
import {
  childrenOf,
  findNode,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

import { lightingOperations, setProps, transaction } from "./editing";
import type { IdFactory } from "./ids";

export interface Finish {
  readonly id: string;
  /** What a person calls it. Never a PBR parameter. */
  readonly label: string;
  /** One line, shown under the picker. Says what it looks like. */
  readonly hint: string;
  readonly metallic: number;
  readonly roughness: number;
  /** Below 1 makes the surface see-through. Only Glass uses it. */
  readonly opacity?: number;
}

/**
 * The eight the founder named, in the order he named them.
 *
 * Ordered by how often a broadcast graphic wants them rather than by
 * metalness: Broadcast first because it is the safe answer, Matte second
 * because it is the common one, and the showy finishes after.
 */
export const FINISHES: readonly Finish[] = [
  {
    id: "broadcast",
    label: "Broadcast",
    hint: "Neutral and safe on any background",
    metallic: 0.08,
    roughness: 0.52,
  },
  {
    id: "matte",
    label: "Matte",
    hint: "Flat, no shine",
    metallic: 0,
    roughness: 0.95,
  },
  {
    id: "soft",
    label: "Soft",
    hint: "Gentle falloff, no hotspot",
    metallic: 0,
    roughness: 0.78,
  },
  {
    id: "plastic",
    label: "Plastic",
    hint: "Clean highlight, moulded",
    metallic: 0,
    roughness: 0.34,
  },
  {
    id: "bold",
    label: "Bold",
    hint: "Hard highlight, high contrast",
    metallic: 0.28,
    roughness: 0.19,
  },
  {
    id: "premium",
    label: "Premium",
    hint: "Brushed metal, restrained",
    metallic: 0.62,
    roughness: 0.26,
  },
  {
    id: "chrome",
    label: "Chrome",
    hint: "Mirror finish",
    metallic: 1,
    roughness: 0.07,
  },
  {
    /**
     * GLASS IS AN APPROXIMATION, AND SAYING SO IS THE POINT.
     *
     * The founder's specification for Glass is "transmission, IOR,
     * reflections, roughness, fresnel". The frozen `MirrorBackend`
     * (ADR-013) has none of transmission, IOR or fresnel — its `pbr`
     * descriptor carries baseColor, metallic, roughness, transparent and
     * doubleSided, and nothing else.
     *
     * What is below is the closest that descriptor can express: a very
     * smooth, partly transparent surface. It reads as glass on a graphic and
     * it is NOT refractive — put it in front of detail and nothing bends.
     *
     * Raised as IF-007 rather than silently shipped as though complete, and
     * rather than reopening a frozen boundary in the middle of a UI sprint.
     */
    id: "glass",
    label: "Glass",
    hint: "Smooth and see-through",
    metallic: 0,
    roughness: 0.05,
    opacity: 0.34,
  },
];

/** The finish a graphic gets when depth is switched on and nothing was chosen. */
export const DEFAULT_FINISH = FINISHES[0]!;

export function finishById(id: string): Finish | undefined {
  return FINISHES.find((finish) => finish.id === id);
}

/**
 * How deep a graphic becomes when depth is first switched on, in world units.
 *
 * Small on purpose. The point of the first press is to show that the graphic
 * has become a solid, not to build a plinth — and a lower third that suddenly
 * gained half a metre of depth would read as broken rather than as 3D.
 * Everything after the first press is a number the person chose.
 */
export const DEFAULT_DEPTH = 0.08;

/** Every rect component on a node. Depth belongs to rects. */
function rectComponentIndexes(
  document: SceneDocument,
  nodeId: string,
): readonly number[] {
  const node = findNode(document.root, nodeId);
  if (node === null) return [];
  const out: number[] = [];
  (node.components ?? []).forEach((component, index) => {
    if (component.type === "rect") out.push(index);
  });
  return out;
}

export function hasDepth(document: SceneDocument, nodeId: string): boolean {
  const node = findNode(document.root, nodeId);
  if (node === null) return false;
  return (node.components ?? []).some(
    (component) =>
      component.type === "rect" &&
      typeof (component.props as { depth?: unknown }).depth === "number" &&
      ((component.props as { depth: number }).depth ?? 0) > 0,
  );
}

export function depthOf(document: SceneDocument, nodeId: string): number {
  const node = findNode(document.root, nodeId);
  if (node === null) return 0;
  for (const component of node.components ?? []) {
    if (component.type !== "rect") continue;
    const depth = (component.props as { depth?: unknown }).depth;
    if (typeof depth === "number") return depth;
  }
  return 0;
}

/**
 * Which finish is currently applied, or null when the numbers no longer match
 * any of them.
 *
 * Null is a real answer, not a failure: an advanced user who nudged roughness
 * by hand has a graphic that is no longer "Chrome", and a picker that went on
 * claiming it was would be lying about what is being rendered.
 */
export function finishOf(document: SceneDocument, nodeId: string): Finish | null {
  const node = findNode(document.root, nodeId);
  if (node === null) return null;
  for (const component of node.components ?? []) {
    if (component.type !== "rect") continue;
    const props = component.props as Record<string, unknown>;
    const match = FINISHES.find(
      (finish) =>
        props.metallic === finish.metallic && props.roughness === finish.roughness,
    );
    return match ?? null;
  }
  return null;
}

/**
 * Applies a finish to every rect on a node.
 *
 * One transaction, so one undo takes the whole appearance back — a finish that
 * needed three undos to remove would be a finish nobody experiments with.
 */
export function applyFinish(
  document: SceneDocument,
  nodeId: string,
  finish: Finish,
): Transaction | null {
  const indexes = rectComponentIndexes(document, nodeId);
  if (indexes.length === 0) return null;

  const values = new Map<string, unknown>();
  for (const index of indexes) {
    values.set(`components.${index}.props.metallic`, finish.metallic);
    values.set(`components.${index}.props.roughness`, finish.roughness);
    values.set(`components.${index}.props.finish`, finish.id);
    // Written every time, including back to 1, so switching away from Glass
    // restores an opaque surface rather than leaving it ghosted.
    values.set(`components.${index}.props.opacity`, finish.opacity ?? 1);
  }
  return setProps(document, nodeId, values, `Finish: ${finish.label}`);
}

/** Sets depth on every rect of a node. Zero switches it back to flat. */
export function setDepth(
  document: SceneDocument,
  nodeId: string,
  depth: number,
): Transaction | null {
  const indexes = rectComponentIndexes(document, nodeId);
  if (indexes.length === 0) return null;
  const values = new Map<string, unknown>();
  for (const index of indexes) {
    values.set(`components.${index}.props.depth`, Math.max(0, depth));
  }
  return setProps(document, nodeId, values, depth > 0 ? "Set depth" : "Flatten");
}

/**
 * Enable 3D — the one press that turns a flat graphic into a solid one.
 *
 * ==========================================================================
 * THE GOLDEN RULE, MADE LITERAL
 * ==========================================================================
 * The founder's specification for this control is exact:
 *
 *   "Enable 3D → Engine creates camera, lighting, environment, default
 *    material, shadows, perspective. The user presses ONE button. The engine
 *    performs hundreds of decisions."
 *
 * and, on what must NOT happen:
 *
 *   "Everything remains editable. Nothing becomes a mesh. Nothing leaves the
 *    document model."
 *
 * So this sets a depth, generates a finish, and provisions the lighting a lit
 * surface needs — all in ONE transaction, so a single undo returns the graphic
 * to exactly the flat thing it was, lighting included. A person who presses
 * this and dislikes it must be one keystroke from where they started, or they
 * will not press it a second time.
 *
 * The camera is deliberately NOT created here. Every scene Studio can open
 * already has one — a scene with no camera cannot be shot and the templates
 * all carry theirs — so creating a second would give the projector two to
 * choose between. If a cameraless scene ever becomes reachable, that provision
 * belongs beside this one and in the same transaction.
 */
export function enableDepth(
  document: SceneDocument,
  nodeId: string,
  ids: IdFactory,
  options: { readonly depth?: number; readonly finish?: Finish } = {},
): Transaction | null {
  const indexes = rectComponentIndexes(document, nodeId);
  if (indexes.length === 0) return null;

  const depth = options.depth ?? DEFAULT_DEPTH;
  const finish = options.finish ?? DEFAULT_FINISH;

  const operations: SceneOperation[] = [
    // Lighting FIRST. The order keys are generated against the document as it
    // stands, and inserting after a prop change would be the same document —
    // but reading them in the order they are applied is what makes a
    // transaction reviewable.
    ...lightingOperations(document, document.root.id, ids),
  ];

  const values = new Map<string, unknown>();
  for (const index of indexes) {
    values.set(`components.${index}.props.depth`, depth);
    values.set(`components.${index}.props.metallic`, finish.metallic);
    values.set(`components.${index}.props.roughness`, finish.roughness);
    values.set(`components.${index}.props.finish`, finish.id);
    values.set(`components.${index}.props.opacity`, finish.opacity ?? 1);
  }
  // Folded into the SAME operation list as the lighting, so the whole press is
  // one undo step rather than two.
  const props = setProps(document, nodeId, values, "Enable 3D");
  if (props !== null) operations.push(...props.operations);

  return operations.length === 0 ? null : transaction("Enable 3D", operations);
}

/**
 * Back to flat.
 *
 * Removes the depth and the generated PBR values, so the surface returns to
 * the unlit quad it was — `#applyRect` switches on exactly those props. The
 * lighting is deliberately LEFT: it belongs to the scene rather than to this
 * graphic, other objects may be using it, and silently deleting a light
 * because one rect went flat is the kind of tidying that loses somebody's
 * work. Undo removes it; flattening does not.
 */
export function disableDepth(
  document: SceneDocument,
  nodeId: string,
): Transaction | null {
  const indexes = rectComponentIndexes(document, nodeId);
  if (indexes.length === 0) return null;

  const values = new Map<string, unknown>();
  for (const index of indexes) {
    values.set(`components.${index}.props.depth`, 0);
    values.set(`components.${index}.props.metallic`, undefined);
    values.set(`components.${index}.props.roughness`, undefined);
    values.set(`components.${index}.props.finish`, undefined);
    values.set(`components.${index}.props.opacity`, 1);
  }
  return setProps(document, nodeId, values, "Back to flat");
}

/**
 * Every node in the graphic that has a rect on it.
 *
 * The document-wide controls act on all of them, because a person pressing
 * "3D" means their graphic, not one rectangle in it. A lower third whose plate
 * became solid while its accent bar stayed flat is not a 3D lower third; it is
 * a bug with a button.
 */
export function rectNodeIds(document: SceneDocument): readonly string[] {
  const out: string[] = [];
  const visit = (node: SceneNode): void => {
    if ((node.components ?? []).some((component) => component.type === "rect")) {
      out.push(node.id);
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(document.root);
  return out;
}

/** True when any part of the graphic has depth. */
export function graphicHasDepth(document: SceneDocument): boolean {
  return rectNodeIds(document).some((id) => hasDepth(document, id));
}

/** The finish the graphic is wearing, when every solid part agrees on one. */
export function graphicFinish(document: SceneDocument): Finish | null {
  const solids = rectNodeIds(document).filter((id) => hasDepth(document, id));
  if (solids.length === 0) return null;
  const first = finishOf(document, solids[0]!);
  if (first === null) return null;
  return solids.every((id) => finishOf(document, id)?.id === first.id) ? first : null;
}

/**
 * Enable 3D for the whole graphic, in ONE transaction.
 *
 * The lighting is provisioned once, not once per rect — `lightingOperations`
 * reads the document as it stands, so calling it per node would add a rig for
 * every rectangle. It is called here, once, and the per-node property changes
 * are folded in after it.
 */
export function enableDepthEverywhere(
  document: SceneDocument,
  ids: IdFactory,
  options: { readonly depth?: number; readonly finish?: Finish } = {},
): Transaction | null {
  const nodeIds = rectNodeIds(document);
  if (nodeIds.length === 0) return null;

  const depth = options.depth ?? DEFAULT_DEPTH;
  const finish = options.finish ?? DEFAULT_FINISH;
  const operations: SceneOperation[] = [
    ...lightingOperations(document, document.root.id, ids),
  ];

  for (const nodeId of nodeIds) {
    const values = new Map<string, unknown>();
    for (const index of rectComponentIndexes(document, nodeId)) {
      values.set(`components.${index}.props.depth`, depth);
      values.set(`components.${index}.props.metallic`, finish.metallic);
      values.set(`components.${index}.props.roughness`, finish.roughness);
      values.set(`components.${index}.props.finish`, finish.id);
      values.set(`components.${index}.props.opacity`, finish.opacity ?? 1);
    }
    const props = setProps(document, nodeId, values, "Enable 3D");
    if (props !== null) operations.push(...props.operations);
  }

  return operations.length === 0 ? null : transaction("Enable 3D", operations);
}

/** Back to flat, for the whole graphic. One undo step. */
export function disableDepthEverywhere(document: SceneDocument): Transaction | null {
  const operations: SceneOperation[] = [];
  for (const nodeId of rectNodeIds(document)) {
    const flat = disableDepth(document, nodeId);
    if (flat !== null) operations.push(...flat.operations);
  }
  return operations.length === 0 ? null : transaction("Back to flat", operations);
}

/** Re-finishes every solid part of the graphic. One undo step. */
export function applyFinishEverywhere(
  document: SceneDocument,
  finish: Finish,
): Transaction | null {
  const operations: SceneOperation[] = [];
  for (const nodeId of rectNodeIds(document)) {
    if (!hasDepth(document, nodeId)) continue;
    const applied = applyFinish(document, nodeId, finish);
    if (applied !== null) operations.push(...applied.operations);
  }
  return operations.length === 0 ? null : transaction(`Finish: ${finish.label}`, operations);
}
