/**
 * Stage 8a — MSDF generation. TEXT_ENGINE §4.
 *
 * ============================================================================
 * WHY MULTI-CHANNEL, AND WHY WE BUILD IT
 * ============================================================================
 * A single-channel SDF stores one distance per texel, so a corner — where two
 * edges meet at an angle — is reconstructed as the *minimum* of two distances,
 * which is a rounded corner. Broadcast typography is full of sharp corners and
 * thin stems, and rounding them is visible on a 50-inch monitor at 1080p.
 *
 * MSDF stores three distances and takes their MEDIAN. Two edges meeting at a
 * corner are given colours that share exactly one channel, so the shared channel
 * stays continuous while the other two disagree — and the median recovers the
 * true distance right up to the corner point. That is the whole trick.
 *
 * TEXT_ENGINE §10 marks this BUILD rather than vendor, and the T3 evaluation
 * confirmed why: the obvious candidate (`webgl-sdf-generator`, via troika)
 * requires a WebGL context and produces single-channel SDF. This package is
 * `engine-core` — it may not depend on a renderer — and §4 requires MSDF.
 *
 * ============================================================================
 * DETERMINISM SCOPE
 * ============================================================================
 * This stage is the one part of the text pipeline whose output is PIXELS, and
 * MirrorBackend clause C8 puts pixels outside the determinism guarantee. So the
 * float arithmetic here is deliberately not held to the fixed-point rule that
 * governs stages 1–7: an atlas texel differing in the last bit between two
 * targets changes nothing a show depends on.
 *
 * What must NOT differ is layout, and layout never reads the atlas — it reads
 * font metrics. Keeping that separation is what lets this file use ordinary
 * floating point without weakening anything.
 */
import type { PathCommand } from "./font";

/** Channel bit masks. Adjacent colours at a corner share exactly one bit. */
const MAGENTA = 0b101;
const YELLOW = 0b011;
const CYAN = 0b110;
const WHITE = 0b111;

/** The three-colour cycle. Any two distinct entries share exactly one bit. */
const CYCLE = [MAGENTA, YELLOW, CYAN] as const;

interface Segment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  colour: number;
}

/**
 * Curve flattening tolerance, in font units per em.
 *
 * Curves are flattened to line segments rather than solved analytically.
 * Analytic distance-to-cubic needs a quintic root solve per texel per edge,
 * which is both slow and numerically delicate; flattening is exact to a stated
 * tolerance and the tolerance is chosen far below a texel.
 *
 * 1/2000 em against a field that is at most ~64 texels across means the error
 * is under a hundredth of a texel — three orders of magnitude below anything
 * the median could resolve.
 */
const FLATTEN_TOLERANCE = 1 / 2000;

/** Corner threshold: ~3 degrees. Below it the join is treated as smooth. */
const CORNER_COS = Math.cos((3 * Math.PI) / 180);

function flattenQuadratic(
  segments: Segment[],
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  upem: number,
): void {
  // Steps from the control polygon's length, so a nearly-straight curve costs
  // two segments and a tight one costs many.
  const rough =
    Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  const steps = Math.max(2, Math.ceil(Math.sqrt(rough / (FLATTEN_TOLERANCE * upem))));
  let px = x0;
  let py = y0;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    segments.push({ x0: px, y0: py, x1: x, y1: y, colour: WHITE });
    px = x;
    py = y;
  }
}

function flattenCubic(
  segments: Segment[],
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  upem: number,
): void {
  const rough =
    Math.hypot(c1x - x0, c1y - y0) +
    Math.hypot(c2x - c1x, c2y - c1y) +
    Math.hypot(x1 - c2x, y1 - c2y);
  const steps = Math.max(2, Math.ceil(Math.sqrt(rough / (FLATTEN_TOLERANCE * upem))));
  let px = x0;
  let py = y0;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const x =
      u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
    const y =
      u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
    segments.push({ x0: px, y0: py, x1: x, y1: y, colour: WHITE });
    px = x;
    py = y;
  }
}

/** One closed contour, flattened. */
interface Contour {
  readonly segments: Segment[];
}

function toContours(path: readonly PathCommand[], upem: number): Contour[] {
  const contours: Contour[] = [];
  let current: Segment[] = [];
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;

  const close = () => {
    if (current.length > 0) {
      // Close the loop if the font left it open. An unclosed contour makes the
      // winding test count a crossing that is not there, and the glyph inverts.
      if (x !== startX || y !== startY) {
        current.push({ x0: x, y0: y, x1: startX, y1: startY, colour: WHITE });
      }
      contours.push({ segments: current });
    }
    current = [];
  };

  for (const command of path) {
    const v = command.values;
    switch (command.type) {
      case "M":
        close();
        startX = x = v[0]!;
        startY = y = v[1]!;
        break;
      case "L":
        current.push({ x0: x, y0: y, x1: v[0]!, y1: v[1]!, colour: WHITE });
        x = v[0]!;
        y = v[1]!;
        break;
      case "Q":
        flattenQuadratic(current, x, y, v[0]!, v[1]!, v[2]!, v[3]!, upem);
        x = v[2]!;
        y = v[3]!;
        break;
      case "C":
        flattenCubic(current, x, y, v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, upem);
        x = v[4]!;
        y = v[5]!;
        break;
      case "Z":
        close();
        x = startX;
        y = startY;
        break;
    }
  }
  close();
  return contours.filter((contour) => contour.segments.length > 0);
}

function direction(segment: Segment): [number, number] {
  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const length = Math.hypot(dx, dy);
  return length === 0 ? [0, 0] : [dx / length, dy / length];
}

/**
 * Assigns channel colours so that edges meeting at a corner share one channel.
 *
 * A contour with no corners — a letter O — gets WHITE throughout: all three
 * channels agree, the median is the plain distance, and MSDF degrades exactly
 * to SDF where SDF is already correct.
 *
 * A contour with corners switches colour AT each corner, cycling through three
 * colours that pairwise share exactly one bit. The shared bit is the channel
 * that stays continuous across the join; the other two diverge, and their
 * disagreement is what the median resolves into a sharp point.
 */
function colourContour(contour: Contour): void {
  const segments = contour.segments;
  if (segments.length === 0) return;

  const corners: number[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const previous = segments[(index - 1 + segments.length) % segments.length]!;
    const [px, py] = direction(previous);
    const [cx, cy] = direction(segments[index]!);
    if (px * cx + py * cy < CORNER_COS) corners.push(index);
  }

  if (corners.length === 0) {
    for (const segment of segments) segment.colour = WHITE;
    return;
  }

  // Walk from the first corner so the colour runs line up with the corners
  // rather than with an arbitrary starting index.
  let colour = 0;
  const start = corners[0]!;
  const cornerSet = new Set(corners);
  for (let step = 0; step < segments.length; step += 1) {
    const index = (start + step) % segments.length;
    if (step > 0 && cornerSet.has(index)) {
      colour = (colour + 1) % CYCLE.length;
    }
    segments[index]!.colour = CYCLE[colour]!;
  }

  // Two corners exactly opposite — a lens, a teardrop — would otherwise end
  // where they began and give the closing join two identical colours. Nudging
  // the last run breaks that without touching the general case.
  if (corners.length === 2 && segments.length > 2) {
    const last = segments[(start - 1 + segments.length) % segments.length]!;
    const first = segments[start]!;
    if (last.colour === first.colour) {
      last.colour = CYCLE[(CYCLE.indexOf(first.colour as 0b101) + 1) % CYCLE.length]!;
    }
  }
}

/** Squared distance from a point to a segment, and the segment's parameter. */
function distanceTo(segment: Segment, x: number, y: number): number {
  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - segment.x0, y - segment.y0);
  let t = ((x - segment.x0) * dx + (y - segment.y0) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (segment.x0 + t * dx), y - (segment.y0 + t * dy));
}

/**
 * Non-zero winding, computed once per SCANLINE rather than once per texel.
 *
 * ========================================================================
 * WHY THIS IS A SCANLINE AND NOT A POINT TEST
 * ========================================================================
 * The obvious implementation asks "is this point inside?" per texel, which is
 * O(segments) per texel and therefore O(texels × segments) per glyph. Measured
 * on Inter at 48px: 13–18 ms per glyph, which is ~1.5 seconds to pre-warm a
 * hundred-glyph Latin set and far worse for CJK.
 *
 * Every texel in a row shares its y, so every segment's crossing is the same
 * for all of them. Computing the crossings once per row and walking them in x
 * makes winding O(segments) per ROW — a 39× reduction on a 39-texel-wide glyph,
 * and it grows with the glyph.
 *
 * Non-zero rather than even-odd because TrueType and CFF both use contour
 * DIRECTION to distinguish a hole from a shape. Even-odd gets the letter "o"
 * right by luck and gets overlapping contours — common in bold weights
 * synthesised by overlap — wrong.
 */
interface Crossing {
  readonly x: number;
  readonly delta: number;
}

function crossingsAt(all: readonly Segment[], y: number): Crossing[] {
  const crossings: Crossing[] = [];
  for (const segment of all) {
    const { x0, y0, x1, y1 } = segment;
    const below0 = y0 <= y;
    const below1 = y1 <= y;
    if (below0 === below1) continue;
    // Half-open in y, so a vertex exactly on the scanline is counted once
    // rather than zero or twice — the classic source of a single-texel hole
    // running down the middle of a glyph.
    const t = (y - y0) / (y1 - y0);
    crossings.push({ x: x0 + t * (x1 - x0), delta: below0 ? 1 : -1 });
  }
  crossings.sort((a, b) => a.x - b.x);
  return crossings;
}

function insideAt(crossings: readonly Crossing[], x: number): boolean {
  let winding = 0;
  for (const crossing of crossings) {
    if (crossing.x > x) break;
    winding += crossing.delta;
  }
  return winding !== 0;
}

export interface MsdfGlyph {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, top-left origin. Alpha is opaque. */
  readonly pixels: Uint8Array;
  /** The field's box in FONT UNITS, relative to the glyph origin. */
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

export interface MsdfOptions {
  /** Target height of the em square, in texels. */
  readonly size: number;
  /** Distance range in texels. The shader's antialiasing width. */
  readonly pxRange: number;
}

/**
 * Rasterises one glyph outline to a multi-channel distance field.
 *
 * Returns `null` for a glyph with no outline — a space. Callers must handle
 * that rather than getting a blank quad, because a space occupies advance and
 * no atlas area, and reserving atlas space for every space in a script would
 * fill a page with nothing.
 */
export function generateMsdf(
  path: readonly PathCommand[],
  upem: number,
  options: MsdfOptions,
): MsdfGlyph | null {
  const contours = toContours(path, upem);
  if (contours.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const segment of contour.segments) {
      minX = Math.min(minX, segment.x0, segment.x1);
      minY = Math.min(minY, segment.y0, segment.y1);
      maxX = Math.max(maxX, segment.x0, segment.x1);
      maxY = Math.max(maxY, segment.y0, segment.y1);
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  for (const contour of contours) colourContour(contour);

  const unitsPerTexel = upem / options.size;
  // The field extends `pxRange` texels beyond the ink on every side, or the
  // distance ramp is clipped and the shader cannot antialias the outer edge.
  const pad = options.pxRange * unitsPerTexel;
  const left = minX - pad;
  const bottom = minY - pad;
  const right = maxX + pad;
  const top = maxY + pad;

  const width = Math.max(1, Math.ceil((right - left) / unitsPerTexel));
  const height = Math.max(1, Math.ceil((top - bottom) / unitsPerTexel));
  const pixels = new Uint8Array(width * height * 4);

  const range = options.pxRange * unitsPerTexel;
  const all = contours.flatMap((contour) => contour.segments);

  // Per-segment bounds, so a texel far from a segment rejects it with four
  // comparisons instead of a square root. Most texels are far from most
  // segments, so this is where the remaining time goes.
  const boxes = all.map((segment) => ({
    minX: Math.min(segment.x0, segment.x1),
    maxX: Math.max(segment.x0, segment.x1),
    minY: Math.min(segment.y0, segment.y1),
    maxY: Math.max(segment.y0, segment.y1),
  }));

  for (let row = 0; row < height; row += 1) {
    // Texel CENTRES, and y is flipped: the atlas grows downward, font space
    // grows upward. Sampling corners instead of centres shifts every glyph by
    // half a texel — invisible per glyph, cumulative across a word.
    const y = top - (row + 0.5) * unitsPerTexel;
    const crossings = crossingsAt(all, y);

    for (let column = 0; column < width; column += 1) {
      const x = left + (column + 0.5) * unitsPerTexel;

      let red = Infinity;
      let green = Infinity;
      let blue = Infinity;
      let worst = Infinity;

      for (let index = 0; index < all.length; index += 1) {
        const box = boxes[index]!;
        // The largest distance any channel still needs. A segment that cannot
        // beat it on the bounding box alone cannot beat it at all.
        if (worst !== Infinity) {
          const dx = x < box.minX ? box.minX - x : x > box.maxX ? x - box.maxX : 0;
          const dy = y < box.minY ? box.minY - y : y > box.maxY ? y - box.maxY : 0;
          if (dx * dx + dy * dy > worst * worst) continue;
        }
        const segment = all[index]!;
        const distance = distanceTo(segment, x, y);
        if ((segment.colour & 0b001) !== 0 && distance < red) red = distance;
        if ((segment.colour & 0b010) !== 0 && distance < green) green = distance;
        if ((segment.colour & 0b100) !== 0 && distance < blue) blue = distance;
        worst = Math.max(red, green, blue);
      }

      // One sign for all three channels, from the winding. Per-channel signs
      // would make the median meaningless where the channels straddle an edge.
      const sign = insideAt(crossings, x) ? 1 : -1;
      const offset = (row * width + column) * 4;
      pixels[offset] = encode(sign * red, range);
      pixels[offset + 1] = encode(sign * green, range);
      pixels[offset + 2] = encode(sign * blue, range);
      pixels[offset + 3] = 255;
    }
  }

  return { width, height, pixels, left, bottom, right, top };
}

/** Signed distance to a byte. 0.5 is the edge, matching every MSDF shader. */
function encode(distance: number, range: number): number {
  const normalised = distance / range + 0.5;
  const clamped = normalised < 0 ? 0 : normalised > 1 ? 1 : normalised;
  return Math.round(clamped * 255);
}

/**
 * The median of three channels. What a shader does, available here for tests.
 *
 * Exported because it is the only way to assert that an MSDF is CORRECT rather
 * than merely non-empty: reconstructing the distance at a known point and
 * comparing it against the outline is a real check, and "the buffer has
 * non-zero bytes in it" is not.
 */
export function median(r: number, g: number, b: number): number {
  return Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
}
