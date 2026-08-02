/**
 * Stages 6 and 7 — layout and fit. TEXT_ENGINE §6.
 *
 * ============================================================================
 * THIS IS WHERE BROADCAST BEHAVIOUR LIVES
 * ============================================================================
 * Everything before this stage is Unicode: correct, standardised, vendored.
 * This is the part that is about television — a name slot that must hold both
 * "Li" and "Konstantinos Papadopoulos" without an operator touching anything,
 * on air, live.
 *
 * That is why `fit` is REQUIRED on every text node (SCENE_FORMAT §7.2). Text of
 * unpredictable length in a fixed box is the normal case, not the exception, and
 * a graphic with no declared answer for it is a graphic that will one day
 * overflow on air.
 *
 * ============================================================================
 * LAYOUT IS ENGINE STATE, NOT PIXELS
 * ============================================================================
 * Where a line breaks, what size `shrink` settled on, whether an ellipsis
 * appeared — these are OUTPUTS a show depends on, and a cloud render that broke
 * a name to two lines where the operator's preview showed one is a broken
 * broadcast, not a cosmetic difference.
 *
 * So everything here is integer arithmetic in font units, and every decision is
 * a function of (text, font stack, size, box, fit) alone. No wall clock, no
 * measurement of rendered output, no platform metrics.
 */
import type { FontStack } from "./font";
import { breakOpportunities, itemize, reorderVisual } from "./segment";
import type { Shaper, ShapedGlyph, ShapedRun } from "./shape";

export type TextAlign = "start" | "center" | "end";
export type VerticalAlign = "top" | "middle" | "bottom";

export type FitMode = "wrap" | "shrink" | "truncate" | "overflow";

export interface TextFit {
  readonly mode: FitMode;
  /** Floor for `shrink`, in the same units as `size`. */
  readonly minSize?: number;
}

export interface TextBox {
  /** Available width. `Infinity` means unbounded. */
  readonly width: number;
  readonly height: number;
}

export interface TextSpec {
  readonly content: string;
  readonly size: number;
  readonly align: TextAlign;
  readonly verticalAlign: VerticalAlign;
  /** Multiple of the font's line height. */
  readonly lineHeight: number;
  readonly maxLines?: number;
  readonly box: TextBox;
  readonly fit: TextFit;
  readonly direction: "ltr" | "rtl" | "auto";
}

/** A glyph placed on a line, in the text's own units (not font units). */
export interface PlacedGlyph {
  readonly font: string;
  readonly glyph: number;
  /** Pen position of the glyph origin, relative to the block's top-left. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly cluster: number;
}

export interface LaidOutLine {
  readonly glyphs: readonly PlacedGlyph[];
  /** Advance width, in text units. */
  readonly width: number;
  readonly baseline: number;
}

export interface TextLayout {
  readonly lines: readonly LaidOutLine[];
  /** The size actually used. Differs from the spec only under `shrink`. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** True when the content did not fit and was cut. */
  readonly truncated: boolean;
  /** True when the content exceeds the box. */
  readonly overflowed: boolean;
  /**
   * True when a line had to be cut with no UAX #14 opportunity available.
   *
   * Thai, Khmer, Lao and Burmese have none inside a word — the annex leaves
   * those to dictionary segmentation, which it does not define. Reported rather
   * than hidden so a pre-flight can warn, instead of a designer finding out on
   * air. See IF-004.
   */
  readonly brokeWithoutOpportunity: boolean;
  /** Every distinct glyph the layout needs, for atlas pre-warm. */
  readonly glyphs: readonly { readonly font: string; readonly glyph: number }[];
}

/** U+2026 HORIZONTAL ELLIPSIS. One glyph, not three periods. */
const ELLIPSIS = 0x2026;

/**
 * Line height in text units, from the primary font's own metrics.
 *
 * Derived from ascender − descender + lineGap rather than from the size,
 * because two fonts at "48pt" have different natural line heights and a stack
 * that mixed them would step unevenly down a paragraph.
 */
function lineHeightOf(stack: FontStack, size: number, multiple: number): number {
  const { ascender, descender, lineGap, upem } = stack.primary.metrics;
  return ((ascender - descender + lineGap) / upem) * size * multiple;
}

function ascenderOf(stack: FontStack, size: number): number {
  const { ascender, upem } = stack.primary.metrics;
  return (ascender / upem) * size;
}

/**
 * One unbreakable piece of a shaped run.
 *
 * Widths are in TEXT units, not font units, deliberately: a line can mix fonts
 * with different units-per-em, and adding their raw advances together measures
 * one of them wrongly. Scaling per chunk is the only point where the two can be
 * compared, so it happens here and the packer never sees a font unit.
 */
interface Chunk {
  readonly run: ShapedRun;
  readonly glyphs: readonly ShapedGlyph[];
  readonly width: number;
  readonly breakAfter: "none" | "allowed" | "required";
  /** Trailing whitespace, which does not count against the line's width. */
  readonly trailing: number;
}

function scaleOf(run: ShapedRun, size: number): number {
  return size / run.font.metrics.upem;
}

/**
 * Cuts shaped runs into chunks at UAX #14 opportunities.
 *
 * Shaping happens BEFORE cutting, deliberately. Cutting first and shaping the
 * pieces would lose every shaping decision that crosses a candidate break —
 * kerning between two words, and in Arabic the joining behaviour of a letter
 * against its neighbour, which changes the glyph itself. Shaped-then-cut keeps
 * the glyphs the shaper actually chose.
 *
 * Glyphs are assigned to chunks by CLUSTER, so a ligature or a combining mark
 * is never split: the cluster is the indivisible unit the shaper defined, and
 * cutting by glyph index would happily halve one.
 */
function chunkRuns(
  content: string,
  runs: readonly ShapedRun[],
  size: number,
): readonly Chunk[] {
  const opportunities = breakOpportunities(content);
  const required = new Set(
    opportunities.filter((entry) => entry.required).map((entry) => entry.position),
  );
  const positions = opportunities.map((entry) => entry.position);
  const chunks: Chunk[] = [];

  for (const run of runs) {
    const scale = scaleOf(run, size);
    // Break positions that fall inside this run, plus its own end.
    const cuts = [
      ...positions.filter((at) => at > run.start && at < run.end),
      run.end,
    ];

    let index = 0;
    for (const cut of cuts) {
      const glyphs: ShapedGlyph[] = [];
      let width = 0;
      while (index < run.glyphs.length) {
        const glyph = run.glyphs[index]!;
        if (run.start + glyph.cluster >= cut) break;
        glyphs.push(glyph);
        width += glyph.xAdvance * scale;
        index += 1;
      }
      if (glyphs.length === 0) continue;

      // Trailing whitespace is measured but excluded from the line width. A
      // line ending in a space must not wrap because of the space — every text
      // engine does this, and not doing it produces a ragged edge that is one
      // space wider than the box on random lines.
      let trailing = 0;
      for (let at = glyphs.length - 1; at >= 0; at -= 1) {
        const character = content[run.start + glyphs[at]!.cluster];
        if (character === undefined || !/\s/.test(character)) break;
        trailing += glyphs[at]!.xAdvance * scale;
      }

      chunks.push({
        run,
        glyphs,
        width,
        trailing,
        breakAfter: cut === run.end && !required.has(cut) ? "none" : required.has(cut) ? "required" : "allowed",
      });
    }
  }
  return chunks;
}

/**
 * Splits a chunk at cluster boundaries so it fits a width. The emergency break.
 *
 * ========================================================================
 * WHY THIS EXISTS, AND WHAT IT ADMITS
 * ========================================================================
 * UAX #14 provides NO break opportunities inside Thai, Khmer, Lao or Burmese.
 * That is not a gap in the vendored library — the annex says so explicitly;
 * those scripts need dictionary-based segmentation, which UAX #14 does not
 * define. Verified: `linebreak` returns exactly one opportunity for an
 * eighteen-character Thai string, at the end.
 *
 * So a Thai name in a `wrap` box has two possible outcomes: break somewhere
 * linguistically wrong, or overflow the box. Overflow is worse — it paints over
 * whatever is beneath it, on air — so the engine breaks, and REPORTS that it
 * broke without an opportunity, so a pre-flight can warn rather than a designer
 * discovering it live.
 *
 * See IF-004. A dictionary segmenter is its own piece of work.
 */
function splitToWidth(chunk: Chunk, size: number, limit: number): [Chunk, Chunk] | null {
  const scale = scaleOf(chunk.run, size);
  const head: ShapedGlyph[] = [];
  let width = 0;
  let lastCluster = -1;

  for (const glyph of chunk.glyphs) {
    const next = width + glyph.xAdvance * scale;
    // Never cut inside a cluster: keep taking glyphs that share the cluster
    // already accepted, even past the limit.
    if (next > limit && head.length > 0 && glyph.cluster !== lastCluster) break;
    head.push(glyph);
    width = next;
    lastCluster = glyph.cluster;
  }
  if (head.length === 0 || head.length === chunk.glyphs.length) return null;

  const tail = chunk.glyphs.slice(head.length);
  const tailWidth = tail.reduce((sum, glyph) => sum + glyph.xAdvance * scale, 0);
  return [
    { run: chunk.run, glyphs: head, width, trailing: 0, breakAfter: "allowed" },
    { run: chunk.run, glyphs: tail, width: tailWidth, trailing: chunk.trailing, breakAfter: chunk.breakAfter },
  ];
}

/** Greedy line packing. Returns lines of chunks, in logical order. */
function packLines(
  chunks: readonly Chunk[],
  size: number,
  limit: number,
  wraps: boolean,
): { lines: Chunk[][]; emergency: boolean } {
  const lines: Chunk[][] = [];
  let current: Chunk[] = [];
  let width = 0;
  let emergency = false;

  const flush = () => {
    lines.push(current);
    current = [];
    width = 0;
  };

  const queue = [...chunks];
  while (queue.length > 0) {
    let chunk = queue.shift()!;

    if (wraps && Number.isFinite(limit)) {
      const projected = width + chunk.width - chunk.trailing;
      if (projected > limit && current.length > 0) flush();

      // A single chunk wider than the whole line, with nothing before it. No
      // opportunity can help; cut it at a cluster boundary.
      if (chunk.width - chunk.trailing > limit && current.length === 0) {
        const split = splitToWidth(chunk, size, limit);
        if (split !== null) {
          emergency = true;
          chunk = split[0];
          queue.unshift(split[1]);
        }
      }
    }

    current.push(chunk);
    width += chunk.width;
    if (chunk.breakAfter === "required") flush();
  }
  if (current.length > 0) lines.push(current);
  return { lines: lines.length === 0 ? [[]] : lines, emergency };
}

/** Lays out at one specific size. `shrink` binary-searches over this. */
function layoutAtSize(
  spec: TextSpec,
  stack: FontStack,
  shaper: Shaper,
  size: number,
): TextLayout {
  const runs = itemize(spec.content, stack, spec.direction).map((run) => shaper.run(run));
  const wraps = spec.fit.mode === "wrap";
  const limit = spec.box.width;

  const chunks = chunkRuns(spec.content, runs, size);
  const packed = packLines(chunks, size, limit, wraps);

  const maxLines = spec.maxLines ?? (wraps ? Infinity : 1);
  const step = lineHeightOf(stack, size, spec.lineHeight);
  const ascent = ascenderOf(stack, size);

  // `truncate` and `wrap` also cut on HEIGHT, not only on line count: a box two
  // lines tall must not paint a third line over the graphic beneath it.
  const byHeight =
    spec.fit.mode === "overflow" || !Number.isFinite(spec.box.height)
      ? Infinity
      : Math.max(1, Math.floor(spec.box.height / step));
  const allowed = Math.min(maxLines, byHeight);

  const kept = packed.lines.slice(0, allowed === Infinity ? packed.lines.length : allowed);
  const truncated = kept.length < packed.lines.length;

  const lines: LaidOutLine[] = [];
  let widest = 0;

  kept.forEach((chunksOnLine, index) => {
    // UAX #9 rule L2 is applied PER LINE, on runs, after breaking — a line is
    // the unit the annex reorders within. Chunks of one run stay adjacent
    // because they share its level.
    const ordered = reorderVisual(
      chunksOnLine.map((chunk, at) => ({ level: chunk.run.level, at })),
    ).map((entry) => chunksOnLine[entry.at]!);

    const placed: PlacedGlyph[] = [];
    let pen = 0;
    for (const chunk of ordered) {
      const scale = scaleOf(chunk.run, size);
      for (const glyph of chunk.glyphs) {
        placed.push({
          font: chunk.run.font.id,
          glyph: glyph.glyph,
          x: pen + glyph.xOffset * scale,
          // Y grows DOWN in layout space and UP in font space, so the offset is
          // subtracted. Getting this backwards puts every accent below its
          // letter, which reads as a broken font rather than a sign error.
          y: index * step + ascent - glyph.yOffset * scale,
          size,
          cluster: chunk.run.start + glyph.cluster,
        });
        pen += glyph.xAdvance * scale;
      }
    }

    const trailing = ordered[ordered.length - 1]?.trailing ?? 0;
    const width = pen - trailing;
    if (width > widest) widest = width;
    lines.push({ glyphs: placed, width, baseline: index * step + ascent });
  });

  const height = lines.length * step;
  return {
    lines,
    size,
    width: widest,
    height,
    truncated,
    overflowed: widest > spec.box.width || height > spec.box.height,
    brokeWithoutOpportunity: packed.emergency,
    glyphs: distinctGlyphs(lines),
  };
}

function distinctGlyphs(
  lines: readonly LaidOutLine[],
): readonly { font: string; glyph: number }[] {
  const seen = new Set<string>();
  const out: { font: string; glyph: number }[] = [];
  for (const line of lines) {
    for (const glyph of line.glyphs) {
      const key = `${glyph.font}/${glyph.glyph}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ font: glyph.font, glyph: glyph.glyph });
    }
  }
  return out;
}

/**
 * How many iterations `shrink` runs, and the grid it snaps to.
 *
 * ========================================================================
 * WHY A FIXED COUNT AND A QUANTISED GRID
 * ========================================================================
 * "Loop until it fits" is not reproducible. Two targets with different
 * floating-point behaviour take a different number of steps and settle on
 * different sizes — and the size is engine state that the whole layout depends
 * on, so a 0.01pt difference becomes a different line break.
 *
 * Eight iterations over a quantised grid makes the outcome identical
 * everywhere, regardless of float behaviour, because the SET of sizes that can
 * ever be tested is finite and the same on every target. TEXT_ENGINE §6.
 */
const SHRINK_ITERATIONS = 8;
const SHRINK_QUANTUM = 0.25;

function quantise(size: number): number {
  return Math.round(size / SHRINK_QUANTUM) * SHRINK_QUANTUM;
}

function fitsIn(layout: TextLayout, box: TextBox): boolean {
  return layout.width <= box.width && layout.height <= box.height;
}

/**
 * Lays out a text spec.
 *
 * Pure: same inputs, same output, on every target. That is the property the
 * golden-layout tests assert, and the reason this function takes no clock, no
 * canvas and no device.
 */
export function layoutText(
  spec: TextSpec,
  stack: FontStack,
  shaper: Shaper,
): TextLayout {
  if (spec.content.length === 0) {
    return {
      lines: [],
      size: spec.size,
      width: 0,
      height: 0,
      truncated: false,
      overflowed: false,
      brokeWithoutOpportunity: false,
      glyphs: [],
    };
  }

  if (spec.fit.mode !== "shrink") {
    const layout = layoutAtSize(spec, stack, shaper, spec.size);
    return spec.fit.mode === "truncate" ? withEllipsis(layout, spec, stack) : layout;
  }

  // Shrink. The authored size is the ceiling — text never grows to fill a box,
  // because a name that got BIGGER when it got shorter would make a sequence of
  // graphics visibly inconsistent.
  const full = layoutAtSize(spec, stack, shaper, spec.size);
  if (fitsIn(full, spec.box)) return full;

  const floor = Math.max(SHRINK_QUANTUM, spec.fit.minSize ?? spec.size / 2);
  let low = floor;
  let high = spec.size;
  let best = layoutAtSize(spec, stack, shaper, quantise(floor));

  for (let iteration = 0; iteration < SHRINK_ITERATIONS; iteration += 1) {
    const middle = quantise((low + high) / 2);
    const candidate = layoutAtSize(spec, stack, shaper, middle);
    if (fitsIn(candidate, spec.box)) {
      // Always keep the LARGEST size that fits, so the result does not depend on
      // which iteration happened to land on it.
      if (candidate.size >= best.size) best = candidate;
      low = middle;
    } else {
      high = middle;
    }
  }

  // Still too big at the floor: the author said "no smaller than this", so it
  // is reported as truncated rather than shrunk past a legible size.
  return fitsIn(best, spec.box) ? best : { ...best, truncated: true };
}

/**
 * Appends an ellipsis to the last line of a layout that did not fit.
 *
 * Cut at a CLUSTER boundary. Glyphs carry the index of the characters they came
 * from, so dropping whole clusters never splits a ligature or separates a
 * combining mark from its base — both of which cutting by glyph count would do,
 * and both of which look like font corruption rather than truncation.
 *
 * One U+2026, not three periods: three periods are three glyphs at three
 * advances and do not kern as an ellipsis does.
 */
function withEllipsis(
  layout: TextLayout,
  spec: TextSpec,
  stack: FontStack,
): TextLayout {
  const last = layout.lines[layout.lines.length - 1];
  if (last === undefined) return layout;
  if (!layout.truncated && last.width <= spec.box.width) return layout;

  const font = stack.fontFor(ELLIPSIS);
  const glyph = font.glyphFor(ELLIPSIS);
  const ellipsisWidth = (font.advanceOf(glyph) / font.metrics.upem) * layout.size;
  const budget = spec.box.width - ellipsisWidth;

  // The first cluster that does not fit. Everything from it onward goes.
  let cut = Infinity;
  for (const placed of last.glyphs) {
    if (placed.x + advanceOfPlaced(placed, stack, layout.size) > budget) {
      cut = placed.cluster;
      break;
    }
  }
  const kept = last.glyphs.filter((placed) => placed.cluster < cut);
  const tail = kept[kept.length - 1];
  const x = tail === undefined ? 0 : tail.x + advanceOfPlaced(tail, stack, layout.size);

  const lines = [...layout.lines];
  lines[lines.length - 1] = {
    ...last,
    glyphs: [
      ...kept,
      { font: font.id, glyph, x, y: last.baseline, size: layout.size, cluster: Number.isFinite(cut) ? cut : 0 },
    ],
    width: x + ellipsisWidth,
  };

  // The reported width is RECOMPUTED from the trimmed lines. Carrying the
  // pre-trim width forward would have the layout claim it overflows a box it
  // now fits, which is the kind of wrong number a fit decision is made on.
  const width = Math.max(...lines.map((line) => line.width));
  return {
    ...layout,
    lines,
    width,
    truncated: true,
    overflowed: width > spec.box.width,
    glyphs: distinctGlyphs(lines),
  };
}

function advanceOfPlaced(
  glyph: PlacedGlyph,
  stack: FontStack,
  size: number,
): number {
  const font = stack.fonts.find((entry) => entry.id === glyph.font) ?? stack.primary;
  return (font.advanceOf(glyph.glyph) / font.metrics.upem) * size;
}

/**
 * Where the block sits inside its box, given alignment.
 *
 * Returned as an offset rather than baked into the glyph positions, so the
 * layout itself stays alignment-independent and the cache can be shared between
 * two nodes that differ only in how they are aligned.
 */
export function alignmentOffset(
  layout: TextLayout,
  spec: TextSpec,
  lineWidth: number,
): { x: number; y: number } {
  const x =
    spec.align === "center"
      ? (spec.box.width - lineWidth) / 2
      : spec.align === "end"
        ? spec.box.width - lineWidth
        : 0;
  const y =
    spec.verticalAlign === "middle"
      ? (spec.box.height - layout.height) / 2
      : spec.verticalAlign === "bottom"
        ? spec.box.height - layout.height
        : 0;
  return { x, y };
}

/**
 * A cache key for a layout. TEXT_ENGINE §7.
 *
 * Everything the result depends on, and nothing else. Alignment is deliberately
 * absent — it is applied as an offset afterwards — so two nodes that differ only
 * in alignment share one layout.
 */
export function layoutKey(spec: TextSpec, stack: FontStack): string {
  return [
    stack.key,
    spec.content,
    spec.size,
    spec.lineHeight,
    spec.maxLines ?? "-",
    spec.box.width,
    spec.box.height,
    spec.fit.mode,
    spec.fit.minSize ?? "-",
    spec.direction,
  ].join("");
}
