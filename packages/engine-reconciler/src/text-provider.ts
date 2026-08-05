/**
 * The text port. Phase 3B.
 *
 * ============================================================================
 * WHY THE PROJECTOR DOES NOT IMPORT THE TEXT ENGINE
 * ============================================================================
 * `engine-text` and `engine-reconciler` are both `engine-core`, and a direct
 * edge between them would be acyclic and legal. It is still wrong, for a reason
 * that has nothing to do with layering:
 *
 * **`harfbuzzjs` instantiates a WASM binary at import time.** An edge from the
 * projector to the text engine makes every scene pay for HarfBuzz — a lower
 * third with no words, a 3D set piece, a colour bar — because importing the
 * reconciler would import it transitively. TEXT_ENGINE §9 lists bundle size and
 * cold start as a risk to be mitigated by lazy loading, and an unconditional
 * import is the opposite of that.
 *
 * So the projector declares what it needs and the COMPOSITION ROOT supplies it,
 * exactly as it already does for `MirrorBackend`. A scene with no text engine
 * wired attaches nothing for a text component and the node survives unattached —
 * the same behaviour an asset-backed mesh already has.
 *
 * ============================================================================
 * WHAT CROSSES THIS BOUNDARY, AND WHAT DOES NOT
 * ============================================================================
 * DATA crosses: a request in, geometry and texels out. No handles, no textures,
 * no backend. Resource lifetime stays with the projector, because MirrorBackend
 * C2 makes it the caller's — and a text engine that created GPU resources would
 * be a second owner of them.
 */

/** Everything the layout of one text node depends on. */
export interface TextRequest {
  readonly content: string;
  /** Font asset ids, primary first. The declared fallback chain. */
  readonly fonts: readonly string[];
  readonly size: number;
  readonly align: "start" | "center" | "end";
  readonly verticalAlign: "top" | "middle" | "bottom";
  readonly lineHeight: number;
  readonly maxLines?: number;
  readonly box: { readonly width: number; readonly height: number };
  readonly fit: { readonly mode: string; readonly minSize?: number };
  readonly direction: "ltr" | "rtl" | "auto";
  /** World units per layout unit. The one difference between screen and world. */
  readonly scale: number;
}

/** One drawable batch. Text spanning two atlas pages produces two. */
export interface TextBatch {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Which atlas page these UVs address. */
  readonly page: number;
}

export interface TextDraw {
  readonly batches: readonly TextBatch[];
  /** Distance range in texels, for the `msdf-text` material. */
  readonly pxRange: number;
  /** Atlas keys this draw needs. An on-air output pins them. */
  readonly atlasKeys: readonly string[];
  /**
   * Layout facts a consumer may need to report.
   *
   * Exposed because layout is ENGINE STATE, not pixels: whether a name was
   * truncated is something a production system must be able to see, and a
   * pre-flight that could not would be checking nothing.
   */
  readonly truncated: boolean;
  readonly overflowed: boolean;
  readonly brokeWithoutOpportunity: boolean;
  readonly resolvedSize: number;
}

/**
 * What a text node's layout turned out to be, attributed to that node.
 *
 * `TextDraw` reports the same facts, but a draw is keyed by content rather than
 * by node — deliberately, because the request doubles as a cache signature. The
 * projection records this per node so a pre-flight can name the layer that
 * overflowed instead of only knowing that one did.
 */
export interface TextFacts {
  readonly overflowed: boolean;
  readonly truncated: boolean;
  readonly brokeWithoutOpportunity: boolean;
  /** The size actually used. Differs from the requested size under `shrink`. */
  readonly resolvedSize: number;
}

export interface TextAtlasPage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /**
   * Increments whenever the page's texels change.
   *
   * The projector compares it against what it last uploaded, so a frame that
   * added no glyphs uploads nothing. Without it the only options are
   * re-uploading a 16MB atlas every frame or never updating it at all.
   */
  readonly revision: number;
}

/**
 * What the composition root supplies so text can be projected.
 *
 * Deliberately five methods. Anything larger would be the text engine's public
 * API leaking through a port whose purpose is to keep it out.
 */
export interface TextProvider {
  /** Lays out, rasterises and emits. Null when the fonts are unavailable. */
  draw(request: TextRequest): TextDraw | null;
  /** Atlas pages, in index order. */
  pages(): readonly TextAtlasPage[];
  /** Regions changed since the last call. Cleared by calling. */
  flushDirty(): readonly {
    readonly page: number;
    readonly regions: readonly {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }[];
  }[];
  pin(keys: readonly string[]): void;
  unpin(keys: readonly string[]): void;
}
