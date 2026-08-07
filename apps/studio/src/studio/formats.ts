/**
 * Delivery formats, and whether the graphic survives each of them.
 *
 * ============================================================================
 * WHAT THE CONFIDENCE STRIP IS FOR
 * ============================================================================
 * A graphic is authored once and delivered several times — a 2160 master, a
 * 720 web cut, a 9:16 social version, a 4:3 archive feed. The name that fits
 * beautifully in 16:9 is the name that runs off the side in 9:16, and the only
 * moment anybody discovers that today is when somebody watches the 9:16 cut.
 *
 * So the formats are checked continuously, all of them, beside the graphic —
 * and the one that breaks says so itself. The prototype leaves a note next to
 * this feature worth reproducing, because it is the failure the strip exists
 * to stop:
 *
 *   "The primary is checked on exactly the same terms as the secondaries. It
 *   was not, briefly, and the result was a clipped name on the main canvas
 *   with no warning anywhere."
 *
 * The primary is therefore in the list, not above it.
 *
 * ============================================================================
 * WHY A FORMAT CHANGES ANYTHING AT ALL
 * ============================================================================
 * A scene is authored in world units and shot by an orthographic camera whose
 * `orthographicSize` fixes the visible world HEIGHT. The width follows the
 * aspect ratio. So changing delivery format does not move a single node and
 * does not reshape a single glyph — it changes how much of the world is in
 * frame:
 *
 *     visible half-height = orthographicSize            (same in every format)
 *     visible half-width  = orthographicSize x aspect   (differs per format)
 *
 * That is the whole mechanism, and it is why this module measures geometry
 * rather than re-running the shaper. A 9:16 frame is a NARROWER WINDOW ON THE
 * SAME PICTURE, so a name that sat comfortably inside title safe at 16:9 can
 * cross it — or leave the frame entirely — without one byte of the document
 * changing.
 *
 * It is also why a tile can show the real render: the secondary formats are
 * crops of, or windows onto, the frame the engine is already drawing. Nothing
 * here paints a second version of the graphic. See `cropFor`.
 *
 * ============================================================================
 * WHAT IS MEASURED, AND WHAT IS NOT
 * ============================================================================
 * Two findings, and they come from different places on purpose:
 *
 *   `unsafe` / `off-frame`   geometry, per format, computed here from the
 *                            SAME `nodeBounds` the viewport and the align
 *                            commands read. Genuinely differs per format.
 *
 *   `overflow`               the shaper's own verdict, via `textFacts()`.
 *                            Identical in every format, because a text box is
 *                            a fixed size in world units. Reported on every
 *                            tile anyway — it breaks all of them, and a tile
 *                            that stayed green while the text was clipped
 *                            would be the exact lie the strip exists to stop.
 *
 * Only TEXT nodes are checked against title safe. A breaking strap is designed
 * to run off both edges of the frame and a background plate is designed to
 * bleed; warning about those would train people to ignore the lamp. What must
 * not leave title safe is the words.
 */
import { childrenOf, type SceneDocument, type SceneNode } from "@bracketx/engine-scene";
import type { TextFacts } from "@bracketx/engine-reconciler";

import { orthographicSize, type NodeBounds, type Rect } from "./viewport";

export interface DeliveryFormat {
  readonly id: string;
  /** What an operator calls it. Never a resolution the product invented. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The formats the strip carries, beside the document's own.
 *
 * These are the prototype's four. They are not configurable yet, and saying so
 * here is more honest than a settings screen that stores a list nothing reads.
 */
export const SECONDARY_FORMATS: readonly DeliveryFormat[] = [
  { id: "2160", name: "2160p", width: 3840, height: 2160 },
  { id: "720", name: "720p", width: 1280, height: 720 },
  { id: "vertical", name: "9:16", width: 1080, height: 1920 },
  { id: "sd", name: "4:3", width: 1440, height: 1080 },
];

/** The document's own output, as a format. Checked on the same terms. */
export function primaryFormat(document: SceneDocument): DeliveryFormat {
  const { width, height } = document.world.output;
  return { id: "primary", name: `${height}p`, width, height };
}

/** The primary first, then the secondaries, with duplicates of it removed. */
export function formatsFor(document: SceneDocument): readonly DeliveryFormat[] {
  const primary = primaryFormat(document);
  return [
    primary,
    ...SECONDARY_FORMATS.filter(
      (format) => format.width !== primary.width || format.height !== primary.height,
    ),
  ];
}

export function aspectOf(format: DeliveryFormat): number {
  return format.width / format.height;
}

// ---------------------------------------------------------------------------
// The window each format opens on the world
// ---------------------------------------------------------------------------

/** Half-extents, in world units, of what this format has in frame. */
export function visibleWorld(
  document: SceneDocument,
  format: DeliveryFormat,
): { readonly halfWidth: number; readonly halfHeight: number } {
  const halfHeight = orthographicSize(document);
  return { halfWidth: halfHeight * aspectOf(format), halfHeight };
}

/**
 * The title-safe rectangle for a format, in world units, centred on the origin.
 *
 * The fraction comes from `world.safeAreas` when the document declares one,
 * because safe areas belong to the delivery specification and a broadcaster may
 * set their own. 90% is the conventional default and the same one the on-canvas
 * safe-area guides use — there is one number, read in one place.
 */
export function titleSafeWorld(document: SceneDocument, format: DeliveryFormat): Rect {
  const { halfWidth, halfHeight } = visibleWorld(document, format);
  const fraction = document.world.safeAreas?.title ?? 0.9;
  return { x: 0, y: 0, width: halfWidth * 2 * fraction, height: halfHeight * 2 * fraction };
}

/** The whole frame, in world units. */
export function frameWorld(document: SceneDocument, format: DeliveryFormat): Rect {
  const { halfWidth, halfHeight } = visibleWorld(document, format);
  return { x: 0, y: 0, width: halfWidth * 2, height: halfHeight * 2 };
}

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

export interface Crop {
  /**
   * How much of the primary render this format shows, as a fraction of its
   * width. 1 means all of it.
   */
  readonly source: number;
  /**
   * How much of the tile the render covers, as a fraction of the tile's width.
   * Below 1 when the format is WIDER than the primary and the engine is simply
   * not drawing the sides — which the tile pillar-boxes rather than stretching.
   * A stretched picture would misreport the very thing being checked.
   */
  readonly covers: number;
}

/**
 * Where the primary's pixels land in a format's tile.
 *
 * Both formats are shot at the same world height, so one is a horizontal window
 * on the other and nothing needs re-rendering. This is what lets the strip show
 * the REAL frame — the engine's own pixels, from the canvas it already drew —
 * rather than a second, drifting drawing of the same graphic.
 */
export function cropFor(primary: DeliveryFormat, format: DeliveryFormat): Crop {
  const wanted = aspectOf(format);
  const have = aspectOf(primary);
  if (wanted <= have) return { source: wanted / have, covers: 1 };
  return { source: 1, covers: have / wanted };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type FormatIssueKind =
  /** The words are wholly outside this format's frame. */
  | "off-frame"
  /** The words cross title safe. Legal, and usually a mistake. */
  | "unsafe"
  /** The shaper could not fit the content in its box. Breaks every format. */
  | "overflow";

export interface FormatIssue {
  readonly kind: FormatIssueKind;
  readonly nodeId: string;
  readonly label: string;
  readonly detail: string;
}

export interface FormatCheck {
  readonly format: DeliveryFormat;
  readonly issues: readonly FormatIssue[];
  readonly clear: boolean;
  readonly crop: Crop;
}

/** Every text node in the document, by id. */
export function textNodes(document: SceneDocument): ReadonlyMap<string, SceneNode> {
  const out = new Map<string, SceneNode>();
  const visit = (node: SceneNode): void => {
    if ((node.components ?? []).some((component) => component.type === "text")) {
      out.set(node.id, node);
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(document.root);
  return out;
}

function exceeds(box: Rect, limit: Rect): boolean {
  return (
    Math.abs(box.x - limit.x) + box.width / 2 > limit.width / 2 ||
    Math.abs(box.y - limit.y) + box.height / 2 > limit.height / 2
  );
}

function disjoint(box: Rect, limit: Rect): boolean {
  return (
    Math.abs(box.x - limit.x) > (box.width + limit.width) / 2 ||
    Math.abs(box.y - limit.y) > (box.height + limit.height) / 2
  );
}

/**
 * Checks one format.
 *
 * Takes bounds and facts rather than a session, so it runs in a test against a
 * bare document — and so the strip and the pre-flight cannot be reading two
 * different measurements of the same graphic.
 */
export function checkFormat(
  document: SceneDocument,
  format: DeliveryFormat,
  bounds: readonly NodeBounds[],
  facts: ReadonlyMap<string, TextFacts>,
): FormatCheck {
  const texts = textNodes(document);
  const safe = titleSafeWorld(document, format);
  const frame = frameWorld(document, format);
  const issues: FormatIssue[] = [];

  for (const entry of bounds) {
    const node = texts.get(entry.nodeId);
    if (node === undefined) continue;
    const label = node.name ?? entry.nodeId;

    if (disjoint(entry.rect, frame)) {
      issues.push({
        kind: "off-frame",
        nodeId: entry.nodeId,
        label,
        detail: `Outside the frame at ${format.name}. It would not be on screen at all.`,
      });
    } else if (exceeds(entry.rect, safe)) {
      issues.push({
        kind: "unsafe",
        nodeId: entry.nodeId,
        label,
        detail: `Crosses title safe at ${format.name}.`,
      });
    }

    // The shaper's verdict, repeated on every tile: a box that cannot hold its
    // own text is clipped in all of them, and a green tile would be a lie.
    if (facts.get(entry.nodeId)?.overflowed === true) {
      issues.push({
        kind: "overflow",
        nodeId: entry.nodeId,
        label,
        detail: "Does not fit its box. The shaper reported overflow.",
      });
    }
  }

  return {
    format,
    issues,
    clear: issues.length === 0,
    crop: cropFor(primaryFormat(document), format),
  };
}

/** Every format, checked. What the strip renders. */
export function checkFormats(
  document: SceneDocument,
  bounds: readonly NodeBounds[],
  facts: ReadonlyMap<string, TextFacts>,
): readonly FormatCheck[] {
  return formatsFor(document).map((format) => checkFormat(document, format, bounds, facts));
}
