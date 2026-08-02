/**
 * Stage 1 — fonts. TEXT_ENGINE §3.
 *
 * ============================================================================
 * ONE FONT PARSER, NOT TWO
 * ============================================================================
 * TEXT_ENGINE §10 planned to vendor opentype.js or Typr for parsing alongside
 * HarfBuzz for shaping. That is unnecessary, and the design is better without
 * it: `harfbuzzjs` already exposes everything the pipeline needs — units per em,
 * horizontal extents, `cmap` coverage, per-glyph advances, extents, and glyph
 * OUTLINES as path commands.
 *
 * Two parsers would be two sources of truth for the cmap and the metrics. Any
 * disagreement between them shows up as a glyph that shapes with one library and
 * rasterises with the other — a `.notdef` box in the middle of a name, or an
 * advance that does not match the quad it was measured for. Deleting the second
 * parser deletes that entire failure class, and it removes a dependency.
 *
 * ============================================================================
 * EVERYTHING IS IN FONT UNITS, AND THEY ARE INTEGERS
 * ============================================================================
 * The font is scaled to its own units-per-em, so HarfBuzz returns advances and
 * offsets as INTEGERS in font units rather than as floats at a pixel size.
 * TEXT_ENGINE §8.3 requires exactly this: advances come from font metrics in
 * fixed point, never accumulated floats.
 *
 * Converting to pixels or metres happens once, at geometry generation, from a
 * total that was accumulated in integers. Scaling earlier would bake a rounding
 * decision into the shaper that layout should own, and float drift over a long
 * string is precisely the cross-target divergence C1 exists to eliminate.
 */
import { Blob, Face, Font } from "harfbuzzjs";

/** Vertical metrics, in font units. */
export interface FontMetrics {
  /** Units per em. The denominator for every measurement below. */
  readonly upem: number;
  /** Distance above the baseline. Positive. */
  readonly ascender: number;
  /** Distance below the baseline. NEGATIVE, as the font declares it. */
  readonly descender: number;
  readonly lineGap: number;
}

/** One path command, in font units. Absolute coordinates. */
export type PathCommand =
  | { readonly type: "M"; readonly values: readonly number[] }
  | { readonly type: "L"; readonly values: readonly number[] }
  | { readonly type: "Q"; readonly values: readonly number[] }
  | { readonly type: "C"; readonly values: readonly number[] }
  | { readonly type: "Z"; readonly values: readonly number[] };

/** A glyph's ink box, in font units. */
export interface GlyphExtents {
  readonly xBearing: number;
  readonly yBearing: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A parsed font, ready to shape and rasterise.
 *
 * Constructed once per asset and held for the session. HarfBuzz's `Face` and
 * `Font` are WASM-backed and expensive to build — the T1 spike measured
 * rebuilding them per shaping call at ~40× the cost of the shaping itself — so
 * they are built here and never again.
 */
export class LoadedFont {
  readonly id: string;
  readonly metrics: FontMetrics;

  readonly #font: Font;
  readonly #face: Face;
  /** Codepoint → glyph id. `cmap` lookups are hot on the fallback path. */
  readonly #glyphs = new Map<number, number>();
  readonly #advances = new Map<number, number>();
  #coverage: Set<number> | null = null;

  constructor(id: string, data: Uint8Array) {
    this.id = id;
    this.#face = new Face(new Blob(data), 0);
    this.#font = new Font(this.#face);
    // The one place a scale is set, and it is the font's own em.
    this.#font.setScale(this.#face.upem, this.#face.upem);

    const extents = this.#font.hExtents();
    this.metrics = {
      upem: this.#face.upem,
      // A font with no hhea extents is malformed, but refusing to load it would
      // take a whole show off air over one bad asset. The em-square fallback
      // is visibly wrong rather than silently wrong.
      ascender: extents?.ascender ?? Math.round(this.#face.upem * 0.8),
      descender: extents?.descender ?? -Math.round(this.#face.upem * 0.2),
      lineGap: extents?.lineGap ?? 0,
    };
  }

  /** The HarfBuzz font, for the shaper. Nothing else should reach for it. */
  get hb(): Font {
    return this.#font;
  }

  /**
   * Glyph id for a codepoint, or 0 for `.notdef`.
   *
   * Zero is meaningful and must not be treated as "missing": a `.notdef` box is
   * what TEXT_ENGINE §3 requires when a fallback chain is exhausted, because a
   * plausible-looking wrong glyph is worse on air than an obviously wrong box.
   */
  glyphFor(codepoint: number): number {
    const cached = this.#glyphs.get(codepoint);
    if (cached !== undefined) return cached;
    const glyph = this.#font.nominalGlyph(codepoint) ?? 0;
    this.#glyphs.set(codepoint, glyph);
    return glyph;
  }

  /**
   * Whether this font can draw a codepoint.
   *
   * This is the fallback chain's decision function, so it is a `cmap` question
   * and not a rendering one — asked before shaping, per codepoint, over a chain
   * that may be several fonts long.
   */
  covers(codepoint: number): boolean {
    return this.glyphFor(codepoint) !== 0;
  }

  /** Every codepoint the font declares. Used to pre-warm a character set. */
  coverage(): ReadonlySet<number> {
    if (this.#coverage === null) {
      this.#coverage = new Set(this.#face.collectUnicodes());
    }
    return this.#coverage;
  }

  /** Horizontal advance in font units. Integer. */
  advanceOf(glyph: number): number {
    const cached = this.#advances.get(glyph);
    if (cached !== undefined) return cached;
    const advance = this.#font.glyphHAdvance(glyph);
    this.#advances.set(glyph, advance);
    return advance;
  }

  extentsOf(glyph: number): GlyphExtents | null {
    const extents = this.#font.glyphExtents(glyph);
    if (extents === null || extents === undefined) return null;
    return {
      xBearing: extents.xBearing,
      yBearing: extents.yBearing,
      width: extents.width,
      height: extents.height,
    };
  }

  /**
   * The glyph's outline as absolute path commands, in font units.
   *
   * This is what stage 8 rasterises. Returning commands rather than an SVG
   * string keeps the MSDF generator free of a parser it would otherwise need,
   * and the numbers stay numbers.
   */
  outlineOf(glyph: number): readonly PathCommand[] {
    const json = this.#font.glyphToJson(glyph);
    return json as readonly PathCommand[];
  }
}

/**
 * A declared fallback chain. TEXT_ENGINE §3.
 *
 * ========================================================================
 * DECLARED, NEVER DISCOVERED
 * ========================================================================
 * The chain is authored in the document and resolved in order. There is no
 * system font enumeration, no "closest match", and no platform fallback,
 * because those differ between Chrome, OBS's CEF, a cloud renderer and the
 * native runtime — and a name that renders in one and boxes in another is the
 * exact cross-target divergence this engine exists to prevent.
 *
 * Exhausting the chain yields the PRIMARY font's `.notdef`, deliberately: a
 * visible box, from a known font, at a known advance.
 */
export class FontStack {
  readonly fonts: readonly LoadedFont[];

  constructor(fonts: readonly LoadedFont[]) {
    if (fonts.length === 0) throw new Error("a font stack needs at least one font");
    this.fonts = fonts;
  }

  get primary(): LoadedFont {
    return this.fonts[0]!;
  }

  /** The first font in the chain that covers the codepoint, or the primary. */
  fontFor(codepoint: number): LoadedFont {
    for (const font of this.fonts) {
      if (font.covers(codepoint)) return font;
    }
    return this.primary;
  }

  /** Every codepoint no font in the chain can draw. What a pre-flight reports. */
  missing(text: string): readonly number[] {
    const out: number[] = [];
    for (const character of text) {
      const codepoint = character.codePointAt(0)!;
      if (!this.fonts.some((font) => font.covers(codepoint))) out.push(codepoint);
    }
    return [...new Set(out)];
  }

  /** A stable identity for cache keys. Order matters; a reorder is a new stack. */
  get key(): string {
    return this.fonts.map((font) => font.id).join("|");
  }
}
