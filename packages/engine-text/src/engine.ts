/**
 * The text engine — stages 1 to 8, and the geometry that comes out.
 *
 * ============================================================================
 * ONE PIPELINE, TWO GEOMETRY OUTPUTS
 * ============================================================================
 * TEXT_ENGINE §6 is explicit that screen-space and world-space text are the
 * SAME pipeline with a different final step, not two pipelines. That is the
 * property the C1 reversal bought: the same string laid out for a 1080p output
 * and for a camera three metres away breaks at the same word, shrinks to the
 * same size, and truncates at the same character — because stages 1 through 7
 * never learned which one it was for.
 *
 * Only `emit` differs, and only by a scale factor.
 *
 * ============================================================================
 * WHAT THIS RETURNS AND WHY IT IS NOT A MESH
 * ============================================================================
 * `TextGeometry` is positions, uvs and indices — the same shape
 * `GeometryDescriptor` takes. It is deliberately NOT a backend resource: this
 * package is `engine-core` and must not know a renderer exists. The reconciler
 * turns it into a mesh, which is the same path a rect takes.
 */
import { FontStack, LoadedFont } from "./font";
import { GlyphAtlas, type AtlasEntry, type AtlasOptions } from "./atlas";
import { generateMsdf } from "./msdf";
import {
  alignmentOffset,
  layoutKey,
  layoutText,
  type TextLayout,
  type TextSpec,
} from "./layout";
import { Shaper } from "./shape";

export interface TextGeometry {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Quads emitted. Zero for whitespace-only text — a valid, empty result. */
  readonly quadCount: number;
  /** Atlas page every quad samples. Text spanning two pages emits two meshes. */
  readonly page: number;
}

export interface TextResult {
  readonly layout: TextLayout;
  readonly geometry: readonly TextGeometry[];
  /** Atlas keys this result draws. What an on-air output pins. */
  readonly atlasKeys: readonly string[];
  readonly pxRange: number;
}

export interface EmitOptions {
  /**
   * World units per layout unit.
   *
   * A layout is computed in the same units as its `size`. Screen-space text
   * emits at 1 (a layout unit is a pixel); world-space text emits at
   * metres-per-pixel. This single number is the entire difference between the
   * two, which is the point of §6.
   */
  readonly scale: number;
  /** Z of the emitted quads. Lets a caller stack text over a background. */
  readonly z?: number;
}

export interface TextEngineOptions extends AtlasOptions {
  /** Layout cache entries. A show's working set is small; the default is ample. */
  readonly layoutCache?: number;
}

export class TextEngine {
  readonly atlas: GlyphAtlas;
  readonly shaper = new Shaper();

  readonly #fonts = new Map<string, LoadedFont>();
  readonly #layouts = new Map<string, TextLayout>();
  readonly #layoutLimit: number;
  #layoutHits = 0;
  #layoutMisses = 0;

  constructor(options: TextEngineOptions = {}) {
    this.atlas = new GlyphAtlas(options);
    this.#layoutLimit = options.layoutCache ?? 512;
  }

  /**
   * Registers a parsed font.
   *
   * TEXT_ENGINE §3: the first frame is not painted until every font a scene
   * references has parsed. Loading is therefore the caller's job and is
   * synchronous here — a font resolving mid-broadcast reflows every graphic
   * using it, so there is deliberately no lazy path.
   */
  addFont(id: string, data: Uint8Array): LoadedFont {
    const existing = this.#fonts.get(id);
    if (existing !== undefined) return existing;
    const font = new LoadedFont(id, data);
    this.#fonts.set(id, font);
    return font;
  }

  font(id: string): LoadedFont | undefined {
    return this.#fonts.get(id);
  }

  /**
   * Resolves a declared font stack.
   *
   * Missing fonts are SKIPPED rather than throwing: a scene referencing an
   * asset that failed to load should render in the fonts it does have, with a
   * visible `.notdef` for what it cannot draw. Throwing would take the whole
   * graphic off air over one missing fallback.
   */
  stack(ids: readonly string[]): FontStack | null {
    const fonts = ids
      .map((id) => this.#fonts.get(id))
      .filter((font): font is LoadedFont => font !== undefined);
    return fonts.length === 0 ? null : new FontStack(fonts);
  }

  /** Stages 1–7. Cached, because a scoreboard re-lays-out on every score. */
  layout(spec: TextSpec, stack: FontStack): TextLayout {
    const key = layoutKey(spec, stack);
    const cached = this.#layouts.get(key);
    if (cached !== undefined) {
      this.#layoutHits += 1;
      return cached;
    }
    this.#layoutMisses += 1;
    const computed = layoutText(spec, stack, this.shaper);
    if (this.#layouts.size >= this.#layoutLimit) {
      const oldest = this.#layouts.keys().next().value;
      if (oldest !== undefined) this.#layouts.delete(oldest);
    }
    this.#layouts.set(key, computed);
    return computed;
  }

  /**
   * Ensures every glyph a layout needs is in the atlas. Stage 8.
   *
   * Returns the atlas keys, which is what a caller pins for an on-air output.
   * Separated from `emit` so pre-warm can call it at scene load, before
   * anything is on screen — which is what turns a mid-show generation spike
   * into load-time cost (§5).
   */
  rasterize(layout: TextLayout, stack: FontStack): readonly string[] {
    const bucket = GlyphAtlas.bucketFor(layout.size);
    const keys: string[] = [];

    for (const { font: fontId, glyph } of layout.glyphs) {
      const key = GlyphAtlas.keyFor(fontId, glyph, bucket);
      if (this.atlas.has(fontId, glyph, bucket)) {
        keys.push(key);
        continue;
      }
      const font = this.#fonts.get(fontId) ?? stack.primary;
      const msdf = generateMsdf(font.outlineOf(glyph), font.metrics.upem, {
        size: bucket,
        pxRange: this.atlas.pxRange,
      });
      // A space has no outline. It occupies advance and no atlas area, and
      // reserving a slot for every whitespace glyph in a script would fill a
      // page with nothing.
      if (msdf === null) continue;
      if (this.atlas.add(fontId, glyph, bucket, msdf) !== null) keys.push(key);
    }
    return keys;
  }

  /**
   * Turns a layout into quads. The one stage that differs by space.
   *
   * Quads are grouped by atlas PAGE, because a mesh samples one texture. Text
   * spanning two pages emits two geometries — rare, and correct when it happens,
   * rather than silently drawing half the string from the wrong atlas.
   */
  emit(
    layout: TextLayout,
    spec: TextSpec,
    stack: FontStack,
    options: EmitOptions,
  ): readonly TextGeometry[] {
    const bucket = GlyphAtlas.bucketFor(layout.size);
    const z = options.z ?? 0;
    const byPage = new Map<
      number,
      { positions: number[]; uvs: number[]; indices: number[]; quads: number }
    >();

    for (const line of layout.lines) {
      const offset = alignmentOffset(layout, spec, line.width);

      for (const placed of line.glyphs) {
        const entry = this.atlas.get(placed.font, placed.glyph, bucket);
        if (entry === undefined) continue; // Whitespace, or over budget.

        const font = this.#fonts.get(placed.font) ?? stack.primary;
        const unit = placed.size / font.metrics.upem;

        // The field's box, in layout units, around the glyph's pen position.
        // `left`/`top` come from the MSDF and already include its padding, so
        // the quad matches the field exactly — a quad sized from the glyph's
        // ink instead would clip the distance ramp and hard-edge the glyph.
        const x0 = (placed.x + offset.x + entry.left * unit) * options.scale;
        const x1 = (placed.x + offset.x + entry.right * unit) * options.scale;
        // Layout y grows DOWN from the block's top; world y grows UP. The
        // negation here is the one place the two conventions meet.
        const y0 = -(placed.y + offset.y - entry.bottom * unit) * options.scale;
        const y1 = -(placed.y + offset.y - entry.top * unit) * options.scale;

        const page = this.atlas.pages[entry.page];
        if (page === undefined) continue;
        const size = page.size;
        const u0 = entry.x / size;
        const u1 = (entry.x + entry.width) / size;
        // V is flipped: the atlas is stored top-down and sampled bottom-up.
        const v0 = 1 - (entry.y + entry.height) / size;
        const v1 = 1 - entry.y / size;

        let group = byPage.get(entry.page);
        if (group === undefined) {
          group = { positions: [], uvs: [], indices: [], quads: 0 };
          byPage.set(entry.page, group);
        }
        const base = group.quads * 4;
        group.positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
        group.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        group.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        group.quads += 1;
      }
    }

    return [...byPage.entries()].map(([page, group]) => ({
      page,
      positions: new Float32Array(group.positions),
      uvs: new Float32Array(group.uvs),
      indices: new Uint32Array(group.indices),
      quadCount: group.quads,
    }));
  }

  /** Layout, rasterize and emit, in one call. What the projector uses. */
  render(spec: TextSpec, stack: FontStack, options: EmitOptions): TextResult {
    const layout = this.layout(spec, stack);
    const atlasKeys = this.rasterize(layout, stack);
    return {
      layout,
      atlasKeys,
      geometry: this.emit(layout, spec, stack, options),
      pxRange: this.atlas.pxRange,
    };
  }

  /**
   * Rasterises a character set ahead of time. TEXT_ENGINE §5.
   *
   * Pre-warm is what makes live text safe: it converts the common case from a
   * mid-show generation spike into load-time cost, which is the only acceptable
   * place for it. Live text still hits novel glyphs — an unexpected name — so
   * on-demand generation and eviction must keep working, and they do.
   */
  prewarm(characters: string, stack: FontStack, size: number): number {
    const bucket = GlyphAtlas.bucketFor(size);
    let added = 0;
    for (const character of characters) {
      const codepoint = character.codePointAt(0)!;
      const font = stack.fontFor(codepoint);
      const glyph = font.glyphFor(codepoint);
      if (glyph === 0 || this.atlas.has(font.id, glyph, bucket)) continue;
      const msdf = generateMsdf(font.outlineOf(glyph), font.metrics.upem, {
        size: bucket,
        pxRange: this.atlas.pxRange,
      });
      if (msdf === null) continue;
      if (this.atlas.add(font.id, glyph, bucket, msdf) !== null) added += 1;
    }
    return added;
  }

  stats(): {
    fonts: number;
    layoutHits: number;
    layoutMisses: number;
    shaper: ReturnType<Shaper["stats"]>;
    atlas: ReturnType<GlyphAtlas["stats"]>;
  } {
    return {
      fonts: this.#fonts.size,
      layoutHits: this.#layoutHits,
      layoutMisses: this.#layoutMisses,
      shaper: this.shaper.stats(),
      atlas: this.atlas.stats(),
    };
  }
}

export type { AtlasEntry };
