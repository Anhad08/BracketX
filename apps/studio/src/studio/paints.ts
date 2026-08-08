/**
 * Paints — flat-surface looks named by what they LOOK like.
 *
 * ============================================================================
 * THE SAME GOLDEN RULE finishes.ts APPLIES, APPLIED TO PAINT
 * ============================================================================
 * `finishes.ts` records the founder's instruction and it governs here too:
 *
 *   "Never expose PBR terminology first. Expose outcomes. [...] Advanced
 *    reveals the underlying parameters."
 *
 * The engine's paint model (`packages/engine-reconciler/src/paint.ts`) takes
 * gradient stops, corner radii, stroke widths, blur radii and spreads. Those are
 * the right things for a format to carry and the wrong things to put in front of
 * somebody making their first lower third. So a person picks **Soft**, **Glass**
 * or **Elevated**, and the engine receives a full `PaintSpecDoc`.
 *
 * ============================================================================
 * A PAINT IS DERIVED FROM THE NODE'S OWN FILL
 * ============================================================================
 * This is the decision that makes the whole feature brand-safe, and it is why
 * these are functions rather than constants.
 *
 * A "Soft" gradient is not a fixed blue ramp — it is *this node's colour*, one
 * step lighter at one edge and one step darker at the other. So a pack's
 * `color.primary` token, a broadcaster's brand red, or a colour an operator
 * typed thirty seconds ago all keep working, and applying a look never silently
 * repaints a graphic in somebody else's colours.
 *
 * The cost is that a paint has to be REBUILT when the fill changes, which
 * `repaint` exists for. The alternative — storing the style name and resolving
 * it at render time — would put a broadcast noun inside SCENE_FORMAT, which §7
 * refuses, and would freeze the definition of "Glass" for ever.
 *
 * ============================================================================
 * WHY THE VALUES GO IN THE DOCUMENT
 * ============================================================================
 * Exactly as `applyFinish` does: the resolved `paint` object is written into the
 * node, and the chosen name is stored beside it as `paintStyle` purely so the
 * picker can show which button is lit. Nothing reads the name to decide how to
 * render — edit a stop by hand and the render changes while the name stops
 * matching, which is the honest outcome and is what `paintOf` reports.
 */
import {
  findNode,
  makeSetProp,
  type PaintSpecDoc,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";
import { parseSrgb } from "@bracketx/engine-reconciler";

import { transaction } from "./editing";

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/**
 * Lightens or darkens an sRGB hex by a fraction, towards white or black.
 *
 * Deliberately naive — a straight channel lerp in sRGB, not a perceptual
 * lightness step in Oklch. A gradient built from two perceptually-even steps
 * looks *flatter* than one built in the space the designer's picker uses,
 * because the sRGB ramp is what every design tool shows and what the eye has
 * been trained on by every other broadcast graphic.
 *
 * `parseSrgb` is reused from the engine so the two agree on what a malformed
 * colour means: white, never a throw.
 */
function shift(hex: string, amount: number): string {
  const { r, g, b } = parseSrgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (channel: number): number =>
    Math.round(channel + (target - channel) * t);
  const byte = (value: number): string =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
  return `#${byte(mix(r))}${byte(mix(g))}${byte(mix(b))}`;
}

// ---------------------------------------------------------------------------
// The looks
// ---------------------------------------------------------------------------

/**
 * A named look, and how to build it for a given colour and box.
 *
 * `build` receives the node's own fill and its size in world units. The size
 * matters because every distance in a paint — corner radius, stroke width,
 * shadow blur — is in world units, and a corner radius that looks right on a
 * 9-unit strap is a fully rounded pill on a 0.2-unit chip. Scaling by the box's
 * shorter side is what makes one preset work on both.
 */
export interface Paint {
  readonly id: string;
  /** What a person calls it. Never a gradient parameter. */
  readonly label: string;
  /** One line, shown under the picker. Says what it looks like. */
  readonly hint: string;
  readonly build: (fill: string, shorterSide: number) => PaintSpecDoc | undefined;
}

/** Corner radius as a fraction of the shorter side, so presets scale. */
const SOFT_CORNER = 0.09;

export const PAINTS: readonly Paint[] = [
  {
    id: "flat",
    label: "Flat",
    hint: "One solid colour. Square corners.",
    // Undefined, not an empty object: the engine's `readPaint` returns
    // undefined for a paint that asks for nothing, which puts the rect back on
    // the cheap flat-fill path with no texture uploaded at all. Flat must cost
    // nothing, or "no effect" becomes the most expensive option.
    build: () => undefined,
  },
  {
    id: "soft",
    label: "Soft",
    hint: "A gentle gradient and rounded corners. The everyday strap.",
    build: (fill, side) => ({
      cornerRadius: side * SOFT_CORNER,
      gradient: {
        kind: "linear",
        // Not 90°. A dead-vertical ramp reads as a UI panel; a few degrees off
        // is what makes broadcast furniture look lit from somewhere.
        angle: 78,
        stops: [
          { at: 0, color: shift(fill, -0.16) },
          { at: 1, color: shift(fill, 0.1) },
        ],
      },
    }),
  },
  {
    id: "elevated",
    label: "Elevated",
    hint: "Sits above the picture, with a soft shadow beneath it.",
    build: (fill, side) => ({
      cornerRadius: side * SOFT_CORNER,
      gradient: {
        kind: "linear",
        angle: 78,
        stops: [
          { at: 0, color: shift(fill, -0.2) },
          { at: 1, color: shift(fill, 0.08) },
        ],
      },
      // A top edge catching light, which is what separates a raised panel from
      // a flat one more than the shadow does.
      stroke: {
        color: "#ffffff",
        width: Math.max(0.004, side * 0.012),
        opacity: 0.16,
        gradient: {
          kind: "linear",
          angle: 90,
          stops: [
            { at: 0, color: "#ffffff", opacity: 0.02 },
            { at: 1, color: "#ffffff", opacity: 0.6 },
          ],
        },
      },
      shadow: {
        color: "#000000",
        blur: side * 0.38,
        offsetY: -side * 0.1,
        opacity: 0.55,
      },
    }),
  },
  {
    id: "glass",
    label: "Glass",
    hint: "See-through, with a bright rim. Reads over any footage.",
    build: (fill, side) => ({
      cornerRadius: side * 0.13,
      gradient: {
        kind: "linear",
        angle: 115,
        // The colour is kept but almost entirely transparent, so the panel
        // takes a tint from the brand rather than becoming grey.
        stops: [
          { at: 0, color: shift(fill, 0.55), opacity: 0.22 },
          { at: 0.45, color: shift(fill, 0.3), opacity: 0.08 },
          { at: 1, color: shift(fill, 0.5), opacity: 0.18 },
        ],
      },
      stroke: {
        color: "#ffffff",
        width: Math.max(0.004, side * 0.01),
        opacity: 0.35,
      },
      // Inner, not outer: an inner highlight is what makes an edge read as a
      // thickness of glass rather than a glow behind a hole.
      shadow: {
        color: "#ffffff",
        blur: side * 0.12,
        opacity: 0.2,
        inner: true,
      },
    }),
  },
  {
    id: "glow",
    label: "Glow",
    hint: "Lit from within. For alerts, live dots and score bugs.",
    build: (fill, side) => ({
      cornerRadius: side * SOFT_CORNER,
      gradient: {
        kind: "radial",
        center: [0.4, 0.72],
        radius: 1.1,
        stops: [
          { at: 0, color: shift(fill, 0.28) },
          { at: 0.62, color: fill },
          { at: 1, color: shift(fill, -0.35) },
        ],
      },
      // The shape's OWN colour, un-offset — which is the whole difference
      // between a glow and a shadow. One function draws both.
      shadow: { color: fill, blur: side * 0.42, opacity: 0.7 },
    }),
  },
  {
    id: "outlined",
    label: "Outlined",
    hint: "Hollow, with a clean edge. Chapter marks and chips.",
    build: (fill, side) => ({
      cornerRadius: side * 0.5,
      gradient: {
        kind: "linear",
        angle: 90,
        stops: [
          { at: 0, color: fill, opacity: 0.14 },
          { at: 1, color: fill, opacity: 0.05 },
        ],
      },
      stroke: {
        color: fill,
        width: Math.max(0.005, side * 0.03),
        opacity: 0.9,
      },
    }),
  },
  {
    id: "pill",
    label: "Pill",
    hint: "Fully rounded. Tags, timers and counters.",
    build: (fill, side) => ({
      cornerRadius: side * 0.5,
      gradient: {
        kind: "linear",
        angle: 78,
        stops: [
          { at: 0, color: shift(fill, -0.14) },
          { at: 1, color: shift(fill, 0.12) },
        ],
      },
    }),
  },
];

export const DEFAULT_PAINT = PAINTS[0]!;

export function paintById(id: string): Paint | undefined {
  return PAINTS.find((paint) => paint.id === id);
}

// ---------------------------------------------------------------------------
// Reading what a node wears
// ---------------------------------------------------------------------------

interface RectFacts {
  readonly index: number;
  readonly fill: string;
  readonly shorterSide: number;
  readonly styleId: string | null;
  /**
   * The fill the stored paint was BUILT from, when it recorded one.
   *
   * Without this, `repaint` cannot tell "the fill changed so the gradient is
   * stale" from "somebody hand-edited a stop" — both differ from a fresh build,
   * and treating the second as the first silently discards the edit. That was a
   * real bug, caught by the test written to assert the opposite.
   */
  readonly builtFrom: string | null;
}

/**
 * The rect component on a node, with what a paint needs to be rebuilt.
 *
 * Returns null for a node with no rect, which is most nodes — text, cameras,
 * lights and groups all reach here through a multi-selection and none of them
 * can wear a paint.
 */
function rectFactsOf(node: SceneNode): RectFacts | null {
  const components = node.components ?? [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    if (component.type !== "rect") continue;
    const props = component.props as Record<string, unknown>;

    // A BOUND fill cannot be read as a colour, so a paint cannot be derived
    // from it. Falling back to white would repaint a brand-bound graphic in
    // white the moment somebody clicked a look, so the fallback is the
    // document's declared literal only.
    const fill = typeof props.fill === "string" ? props.fill : null;
    if (fill === null) return null;

    const width = typeof props.width === "number" ? props.width : 1;
    const height = typeof props.height === "number" ? props.height : 1;
    return {
      index,
      fill,
      shorterSide: Math.max(0.02, Math.min(width, height)),
      styleId: typeof props.paintStyle === "string" ? props.paintStyle : null,
      builtFrom: typeof props.paintFrom === "string" ? props.paintFrom : null,
    };
  }
  return null;
}

/** True when at least one selected node can wear a paint. */
export function canPaint(
  document: SceneDocument,
  nodeIds: readonly string[],
): boolean {
  return nodeIds.some((id) => {
    const node = findNode(document.root, id);
    return node !== null && node !== undefined && rectFactsOf(node) !== null;
  });
}

/**
 * The look a node is wearing, or null.
 *
 * Reported from the stored NAME, and only when the paint still matches what
 * that name would build — so hand-editing a stop makes the picker show nothing
 * selected rather than continuing to claim "Glass". Same honesty `finishOf` has.
 */
export function paintOf(document: SceneDocument, nodeId: string): Paint | null {
  const node = findNode(document.root, nodeId);
  if (node === null || node === undefined) return null;
  const facts = rectFactsOf(node);
  if (facts === null) return null;

  const claimed = facts.styleId === null ? null : paintById(facts.styleId);
  if (claimed === undefined || claimed === null) {
    // No claim. Flat is the honest answer only if there is genuinely no paint.
    const props = (node.components ?? [])[facts.index]!.props as Record<string, unknown>;
    return props.paint === undefined ? DEFAULT_PAINT : null;
  }

  const props = (node.components ?? [])[facts.index]!.props as Record<string, unknown>;
  // Compared against the colour the paint was BUILT from. A paint left stale by
  // a recolour is still Soft — it is Soft and out of date, which `repaint`
  // fixes. Comparing against the current fill would report it as hand-edited.
  const expected = claimed.build(facts.builtFrom ?? facts.fill, facts.shorterSide);
  return sameShape(props.paint, expected) ? claimed : null;
}

/**
 * The look shared by a whole selection, or null when they differ.
 *
 * Null rather than the first node's look: lighting a button because one of six
 * selected graphics wears Glass tells the operator the wrong thing about the
 * other five.
 */
export function paintOfAll(
  document: SceneDocument,
  nodeIds: readonly string[],
): Paint | null {
  let shared: Paint | null = null;
  for (const id of nodeIds) {
    const paint = paintOf(document, id);
    if (paint === null) return null;
    if (shared === null) shared = paint;
    else if (shared.id !== paint.id) return null;
  }
  return shared;
}

/** Structural equality, for comparing a stored paint against a rebuilt one. */
function sameShape(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  // JSON is a fair canonical form here: a PaintSpecDoc is flat, bounded, has no
  // cycles and no undefined-vs-absent ambiguity, because `build` never emits
  // undefined members.
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Applies a look to every selected node that can wear one.
 *
 * Nodes that cannot — text, lights, a rect with a bound fill — are skipped
 * rather than refused, so a designer who marquee-selected a whole lower third
 * gets the panels painted instead of an error about the text.
 */
export function applyPaint(
  document: SceneDocument,
  nodeIds: readonly string[],
  paint: Paint,
): Transaction | null {
  const operations = nodeIds.flatMap((id) => {
    const node = findNode(document.root, id);
    if (node === null || node === undefined) return [];
    const facts = rectFactsOf(node);
    if (facts === null) return [];

    const built = paint.build(facts.fill, facts.shorterSide);
    const prefix = `components.${facts.index}.props`;
    return [
      // Undefined REMOVES the prop, which is what puts a Flat rect back on the
      // no-texture path rather than leaving an empty paint object behind.
      makeSetProp(document, id, `${prefix}.paint`, built),
      makeSetProp(document, id, `${prefix}.paintStyle`, paint.id),
      // Recorded so a later recolour can tell a stale paint from an edited one.
      // Cleared with the paint when Flat removes it.
      makeSetProp(
        document,
        id,
        `${prefix}.paintFrom`,
        built === undefined ? undefined : facts.fill,
      ),
    ] satisfies SceneOperation[];
  });

  if (operations.length === 0) return null;
  return transaction(`Paint ${paint.label}`, operations);
}

/**
 * Rebuilds the paint on nodes whose fill has changed.
 *
 * ==========================================================================
 * WHY THIS HAS TO EXIST
 * ==========================================================================
 * A paint is DERIVED from the fill, which is what keeps it brand-safe — and it
 * means a colour change leaves the gradient describing the old colour. Recolour
 * a Midnight pack to Broadcast Red and, without this, every panel keeps its
 * blue ramp while its flat fill goes red: the graphic looks broken in a way that
 * points at the colour picker rather than at the gradient.
 *
 * Called after a recolour rather than on every edit, and it returns null when
 * nothing needs rebuilding so it can be called unconditionally.
 */
export function repaint(
  document: SceneDocument,
  nodeIds: readonly string[],
): Transaction | null {
  const operations = nodeIds.flatMap((id) => {
    const node = findNode(document.root, id);
    if (node === null || node === undefined) return [];
    const facts = rectFactsOf(node);
    if (facts === null || facts.styleId === null) return [];

    const paint = paintById(facts.styleId);
    if (paint === undefined) return [];

    const props = (node.components ?? [])[facts.index]!.props as Record<string, unknown>;
    const source = facts.builtFrom ?? facts.fill;

    // HAND-EDITED: the stored paint no longer matches what this look built from
    // the colour it recorded. Rebuilding would discard the edit, so it is left
    // exactly as it is and `paintOf` already reports no look selected.
    if (!sameShape(props.paint, paint.build(source, facts.shorterSide))) return [];

    // Already current.
    if (source === facts.fill) return [];

    const prefix = `components.${facts.index}.props`;
    return [
      makeSetProp(document, id, `${prefix}.paint`, paint.build(facts.fill, facts.shorterSide)),
      makeSetProp(document, id, `${prefix}.paintFrom`, facts.fill),
    ] satisfies SceneOperation[];
  });

  if (operations.length === 0) return null;
  return transaction("Rebuild paint", operations);
}

/** Every node in the document that can wear a paint. */
export function paintableIds(document: SceneDocument): readonly string[] {
  const out: string[] = [];
  const visit = (node: SceneNode): void => {
    if (rectFactsOf(node) !== null) out.push(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);
  return out;
}

/** The look the whole graphic wears, for the beginner panel. */
export function graphicPaint(document: SceneDocument): Paint | null {
  return paintOfAll(document, paintableIds(document));
}

/** Applies a look to the whole graphic. The beginner's one-click restyle. */
export function applyPaintEverywhere(
  document: SceneDocument,
  paint: Paint,
): Transaction | null {
  return applyPaint(document, paintableIds(document), paint);
}
