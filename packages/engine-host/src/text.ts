/**
 * The text adapter. Phase 3B.
 *
 * ============================================================================
 * WHY THIS FILE IS IN THE COMPOSITION ROOT
 * ============================================================================
 * `engine-reconciler` declares a `TextProvider` port and never imports the text
 * engine, because `harfbuzzjs` instantiates a WASM binary at import time and a
 * scene of colour bars must not pay for it. Somebody has to join the port to the
 * implementation, and joining independent pieces is what a composition root is
 * for — the same role this package already plays for `MirrorBackend`.
 *
 * The whole adapter is a translation between two shapes. There is no text logic
 * here, deliberately: the moment layout decisions start being made in the host,
 * there are two text engines and the C1 guarantee is gone.
 */
import {
  TextEngine,
  expandPrewarm,
  type FontStack,
  type TextEngineOptions,
  type TextSpec,
} from "@bracketx/engine-text";
import type { SceneDocument } from "@bracketx/engine-scene";
import type {
  TextAtlasPage,
  TextDraw,
  TextProvider,
  TextRequest,
} from "@bracketx/engine-reconciler";

export interface HostTextOptions extends TextEngineOptions {
  /**
   * Characters to rasterise at load, before the scene can go on air.
   *
   * TEXT_ENGINE §5: pre-warm converts the common case from a mid-show
   * generation spike into load-time cost, which is the only acceptable place
   * for it.
   */
  readonly prewarm?: string;
  readonly prewarmSize?: number;
}

export class HostTextProvider implements TextProvider {
  readonly engine: TextEngine;

  readonly #stacks = new Map<string, FontStack | null>();
  /** Bumped whenever the atlas gains texels, so the projector can skip uploads. */
  #revision = 0;
  #lastGlyphCount = 0;

  constructor(options: HostTextOptions = {}) {
    this.engine = new TextEngine(options);
  }

  /**
   * Registers a font binary under an asset id.
   *
   * Synchronous, and that is the design: TEXT_ENGINE §3 says the first frame is
   * not painted until every font a scene references has parsed, because a font
   * resolving mid-broadcast reflows every graphic using it. Fetching is the
   * caller's problem; parsing is not allowed to be lazy.
   */
  addFont(assetId: string, data: Uint8Array): void {
    this.engine.addFont(assetId, data);
    // A new font can change what a stack resolves to, so cached stacks go.
    this.#stacks.clear();
  }

  hasFont(assetId: string): boolean {
    return this.engine.font(assetId) !== undefined;
  }

  prewarm(characters: string, fonts: readonly string[], size: number): number {
    const stack = this.#stackFor(fonts);
    if (stack === null) return 0;
    const added = this.engine.prewarm(characters, stack, size);
    if (added > 0) this.#revision += 1;
    return added;
  }

  /**
   * Rasterises what a document declares it will need. TEXT_ENGINE §5, T4.
   *
   * Called once at load, before the scene may go on air. The engine already
   * knows the glyphs in static text and in variable defaults — those arrive
   * through the ordinary render path. This covers only what cannot be derived:
   * the range LIVE data will draw from, which a human declares because only a
   * human knows the show.
   */
  prewarmDocument(document: SceneDocument, size = 48): number {
    const declaration = document.world.textPrewarm;
    if (declaration === undefined) return 0;
    const characters = expandPrewarm(declaration);
    if (characters.length === 0) return 0;

    const fonts = document.assets
      .filter((asset) => asset.kind === "font")
      .map((asset) => asset.id)
      .filter((id) => this.hasFont(id));
    return fonts.length === 0 ? 0 : this.prewarm(characters, fonts, size);
  }

  draw(request: TextRequest): TextDraw | null {
    const stack = this.#stackFor(request.fonts);
    if (stack === null) return null;

    const spec: TextSpec = {
      content: request.content,
      size: request.size,
      align: request.align,
      verticalAlign: request.verticalAlign,
      lineHeight: request.lineHeight,
      ...(request.maxLines === undefined ? {} : { maxLines: request.maxLines }),
      box: request.box,
      fit: {
        // Anything the format does not name falls back to `overflow` rather
        // than throwing: an unknown fit mode is an authoring mistake, and the
        // right response on air is to draw the text, not to drop the graphic.
        mode: isFitMode(request.fit.mode) ? request.fit.mode : "overflow",
        ...(request.fit.minSize === undefined ? {} : { minSize: request.fit.minSize }),
      },
      direction: request.direction,
    };

    const before = this.engine.stats().atlas.glyphs;
    const result = this.engine.render(spec, stack, { scale: request.scale });
    if (this.engine.stats().atlas.glyphs !== before) this.#revision += 1;
    this.#lastGlyphCount = this.engine.stats().atlas.glyphs;

    return {
      batches: result.geometry.map((geometry) => ({
        positions: geometry.positions,
        uvs: geometry.uvs,
        indices: geometry.indices,
        page: geometry.page,
      })),
      pxRange: result.pxRange,
      atlasKeys: result.atlasKeys,
      truncated: result.layout.truncated,
      overflowed: result.layout.overflowed,
      brokeWithoutOpportunity: result.layout.brokeWithoutOpportunity,
      resolvedSize: result.layout.size,
    };
  }

  pages(): readonly TextAtlasPage[] {
    return this.engine.atlas.pages.map((page) => ({
      width: page.size,
      height: page.size,
      pixels: page.pixels,
      revision: this.#revision,
    }));
  }

  flushDirty(): ReturnType<TextProvider["flushDirty"]> {
    return this.engine.atlas.flush();
  }

  pin(keys: readonly string[]): void {
    this.engine.atlas.pin(keys);
  }

  unpin(keys: readonly string[]): void {
    this.engine.atlas.unpin(keys);
  }

  stats(): ReturnType<TextEngine["stats"]> & { revision: number } {
    return { ...this.engine.stats(), revision: this.#revision };
  }

  /** Resolved stacks are cached: a leaderboard asks for the same one per row. */
  #stackFor(fonts: readonly string[]): FontStack | null {
    const key = fonts.join("|");
    if (this.#stacks.has(key)) return this.#stacks.get(key)!;
    const stack = this.engine.stack(fonts);
    this.#stacks.set(key, stack);
    void this.#lastGlyphCount;
    return stack;
  }
}

function isFitMode(mode: string): mode is TextSpec["fit"]["mode"] {
  return mode === "wrap" || mode === "shrink" || mode === "truncate" || mode === "overflow";
}
