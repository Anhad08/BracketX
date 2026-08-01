/**
 * Layout. Project Alpha A5, SCENE_FORMAT §6.5.
 *
 * ============================================================================
 * WHY THIS IS IN engine-scene AND NOT THE RECONCILER
 * ============================================================================
 * Layout is a property of the SCENE FORMAT, not of any renderer. A horizontal
 * stack means the same thing in every backend, and a pure function over the
 * document is testable without a mirror, a backend, or a GPU.
 *
 * The reconciler calls it and turns the result into transforms; it does not own
 * the arithmetic.
 *
 * ============================================================================
 * COORDINATE CONVENTION
 * ============================================================================
 * SCENE_FORMAT §5 is Y-up, right-handed, and node origins are CENTRED — the
 * quad primitive already centres itself so rotation behaves the way an operator
 * expects. Layout therefore works in centred boxes throughout: a box is a size
 * plus a centre, never a corner plus a size. Mixing the two is the classic way
 * a layout engine ends up half a box out on one axis only.
 *
 * One pass, top-down, deterministic. Not a constraint solver: children do not
 * influence their parent's size, because two-way sizing needs iteration and
 * iteration needs a convergence rule that is another thing to get wrong on air.
 */
import { round } from "./math";
import { childrenOf } from "./tree";
import type {
  NodeAnchor,
  NodeLayout,
  NodeSize,
  SceneNode,
} from "./types";

/** Sub-micrometre at metre scale. Kills float drift in repeated layout. */
const PRECISION = 6;

/** A centred box: half-extents plus the centre position. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where layout decided a node goes, relative to its parent's origin. */
export interface Placement {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
  /** Present when the node was stretched; the node's own size otherwise. */
  readonly width: number;
  readonly height: number;
}

export type Insets = readonly [number, number, number, number];

/** Uniform or per-edge, normalised to [top, right, bottom, left]. */
export function toInsets(
  value: number | readonly [number, number, number, number] | undefined,
): Insets {
  if (value === undefined) return [0, 0, 0, 0];
  if (typeof value === "number") return [value, value, value, value];
  return [value[0], value[1], value[2], value[3]];
}

function addInsets(a: Insets, b: Insets): Insets {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
}

/** Shrinks a centred box by insets, keeping it centred on what remains. */
export function inset(box: Box, insets: Insets): Box {
  const [top, right, bottom, left] = insets;
  const width = Math.max(0, box.width - left - right);
  const height = Math.max(0, box.height - top - bottom);
  return {
    // The centre moves by half the DIFFERENCE of opposing insets. A uniform
    // inset leaves the centre alone, which is what makes padding symmetric.
    x: box.x + (left - right) / 2,
    y: box.y + (bottom - top) / 2,
    width,
    height,
  };
}

/** The size a node occupies. Zero when it declares none. */
export function sizeOf(node: SceneNode): NodeSize {
  return node.size ?? { width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

/**
 * Places one node inside a container box by its anchor.
 *
 * `stretch` on an axis makes the node fill that axis of the container minus its
 * insets, which is how a backing bar spans an output regardless of resolution.
 */
export function anchorPlacement(
  node: SceneNode,
  container: Box,
  anchor: NodeAnchor,
  safeArea: Insets,
): Placement {
  const insets = addInsets(
    toInsets(anchor.inset),
    anchor.safe === true ? safeArea : [0, 0, 0, 0],
  );
  const region = inset(container, insets);
  const size = sizeOf(node);

  const stretchX = anchor.x === "stretch";
  const stretchY = anchor.y === "stretch";
  const width = stretchX ? region.width : size.width;
  const height = stretchY ? region.height : size.height;

  let x = region.x;
  if (!stretchX) {
    if (anchor.x === "left") x = region.x - region.width / 2 + width / 2;
    else if (anchor.x === "right") x = region.x + region.width / 2 - width / 2;
  }

  let y = region.y;
  if (!stretchY) {
    // Y-up: "top" is the positive edge.
    if (anchor.y === "top") y = region.y + region.height / 2 - height / 2;
    else if (anchor.y === "bottom") y = region.y - region.height / 2 + height / 2;
  }

  return {
    nodeId: node.id,
    x: round(x, PRECISION),
    y: round(y, PRECISION),
    width: round(width, PRECISION),
    height: round(height, PRECISION),
  };
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

interface Track {
  readonly children: readonly SceneNode[];
  readonly main: number;
  readonly cross: number;
}

/** Main-axis offsets for a run, given the distribution rule. */
function distribute(
  sizes: readonly number[],
  gap: number,
  available: number,
  justify: NonNullable<NodeLayout["justify"]>,
): { offsets: number[]; used: number } {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const count = sizes.length;
  const gaps = count > 1 ? count - 1 : 0;

  let leading = 0;
  let spacing = gap;

  if (count > 0) {
    const contentWithGaps = total + gaps * gap;
    const slack = available - contentWithGaps;

    if (justify === "center") leading = slack / 2;
    else if (justify === "end") leading = slack;
    else if (justify === "between" && gaps > 0) {
      spacing = gap + slack / gaps;
    } else if (justify === "around") {
      // Half a unit of space at each end, a full unit between.
      const unit = count > 0 ? slack / count : 0;
      leading = unit / 2;
      spacing = gap + unit;
    }
  }

  const offsets: number[] = [];
  let cursor = leading;
  for (let i = 0; i < count; i += 1) {
    offsets.push(cursor);
    cursor += sizes[i]! + spacing;
  }
  return { offsets, used: cursor - spacing };
}

/** Cross-axis offset for one child. */
function crossOffset(
  childCross: number,
  trackCross: number,
  align: NonNullable<NodeLayout["align"]>,
): number {
  if (align === "center") return (trackCross - childCross) / 2;
  if (align === "end") return trackCross - childCross;
  return 0; // start and stretch both begin at the leading edge
}

/**
 * Lays out a container's children.
 *
 * `stack` places every child at the container's centre — the mode a template
 * uses when children overlap deliberately, like a badge over a photo. It is
 * still a layout mode rather than "no layout", because it still applies
 * padding, safe areas, and stretch.
 */
export function layoutChildren(
  container: SceneNode,
  containerBox: Box,
  layout: NodeLayout,
): readonly Placement[] {
  const children = childrenOf(container);
  if (children.length === 0) return [];

  const insets = addInsets(toInsets(layout.padding), toInsets(layout.safeArea));
  const region = inset(containerBox, insets);
  const align = layout.align ?? "start";
  const justify = layout.justify ?? "start";
  const gap = layout.gap ?? 0;
  const rowGap = layout.rowGap ?? gap;

  if (layout.mode === "stack") {
    return children.map((child) => {
      const size = sizeOf(child);
      const width = align === "stretch" ? region.width : size.width;
      const height = align === "stretch" ? region.height : size.height;
      return {
        nodeId: child.id,
        x: round(region.x, PRECISION),
        y: round(region.y, PRECISION),
        width: round(width, PRECISION),
        height: round(height, PRECISION),
      };
    });
  }

  const horizontal = layout.mode === "horizontal" || layout.mode === "grid";
  const tracks: Track[] = [];

  if (layout.mode === "grid") {
    const columns = Math.max(1, layout.columns ?? 1);
    for (let start = 0; start < children.length; start += columns) {
      const row = children.slice(start, start + columns);
      tracks.push({
        children: row,
        main: 0,
        cross: Math.max(...row.map((child) => sizeOf(child).height), 0),
      });
    }
  } else {
    tracks.push({
      children,
      main: 0,
      cross: horizontal
        ? Math.max(...children.map((child) => sizeOf(child).height), 0)
        : Math.max(...children.map((child) => sizeOf(child).width), 0),
    });
  }

  const placements: Placement[] = [];

  // Rows stack downward from the region's top edge, so a grid reads the way it
  // is authored rather than upside down under a Y-up convention.
  let trackCursor = 0;

  for (const track of tracks) {
    const mainAxisSizes = track.children.map((child) =>
      horizontal ? sizeOf(child).width : sizeOf(child).height,
    );
    const available = horizontal ? region.width : region.height;
    const { offsets } = distribute(mainAxisSizes, gap, available, justify);

    track.children.forEach((child, index) => {
      const size = sizeOf(child);
      const crossExtent = horizontal ? size.height : size.width;
      const trackExtent = tracks.length > 1 ? track.cross : track.cross;
      const stretched = align === "stretch";

      const mainSize = mainAxisSizes[index]!;
      const crossSize = stretched
        ? horizontal
          ? trackExtent
          : trackExtent
        : crossExtent;

      const mainStart = offsets[index]!;
      const crossStart =
        (tracks.length > 1 ? trackCursor : 0) +
        (stretched ? 0 : crossOffset(crossExtent, trackExtent, align));

      let x: number;
      let y: number;

      if (horizontal) {
        x = region.x - region.width / 2 + mainStart + mainSize / 2;
        y = region.y + region.height / 2 - crossStart - crossSize / 2;
      } else {
        y = region.y + region.height / 2 - mainStart - mainSize / 2;
        x = region.x - region.width / 2 + crossStart + crossSize / 2;
      }

      placements.push({
        nodeId: child.id,
        x: round(x, PRECISION),
        y: round(y, PRECISION),
        width: round(horizontal ? mainSize : crossSize, PRECISION),
        height: round(horizontal ? crossSize : mainSize, PRECISION),
      });
    });

    trackCursor += track.cross + rowGap;
  }

  return placements;
}

/** True when the node positions its children. */
export function isLayoutContainer(node: SceneNode): boolean {
  return node.layout !== undefined && typeof node.layout.mode === "string";
}
