/**
 * Fonts Studio ships with.
 *
 * ============================================================================
 * A FONT IS AN ASSET, NOT A NAME
 * ============================================================================
 * SCENE_FORMAT declares fonts as assets and the engine loads binaries, because
 * `FontFace` and `document.fonts` do not exist on two of the four targets and
 * because a system font resolves differently on each of them. So Studio fetches
 * font FILES and hands the bytes to the text engine.
 *
 * These four are the starter set, chosen to cover what the engine's own
 * verification covers: Latin with real kerning, Arabic with contextual shaping,
 * Hebrew, and Thai. They are not a font library — that arrives with the asset
 * pipeline, which is what lets a designer bring their own.
 *
 * ============================================================================
 * LOADING IS NOT LAZY, AND THAT IS DELIBERATE
 * ============================================================================
 * TEXT_ENGINE §3: the first frame is not painted until every font a scene
 * references has parsed, because a font resolving mid-broadcast reflows every
 * graphic using it. So the editor waits, once, at boot.
 */
import type { HostTextProvider } from "@bracketx/engine-host/text";

export interface StudioFont {
  /** The asset id a document references. */
  readonly assetId: string;
  readonly label: string;
  readonly url: string;
  /** Scripts this font covers, for the inspector's font picker. */
  readonly scripts: readonly string[];
}

export const STUDIO_FONTS: readonly StudioFont[] = [
  { assetId: "ast_studio_ui", label: "Inter", url: "/fonts/inter-latin-400.ttf", scripts: ["Latin"] },
  { assetId: "ast_noto_arabic", label: "Noto Sans Arabic", url: "/fonts/noto-arabic-400.ttf", scripts: ["Arabic"] },
  { assetId: "ast_noto_hebrew", label: "Noto Sans Hebrew", url: "/fonts/noto-hebrew-400.ttf", scripts: ["Hebrew"] },
  { assetId: "ast_noto_thai", label: "Noto Sans Thai", url: "/fonts/noto-thai-400.ttf", scripts: ["Thai"] },
];

/**
 * Fetches and registers every shipped font.
 *
 * A font that fails to fetch is SKIPPED rather than fatal, and the ids that
 * loaded are returned. A missing fallback should cost a `.notdef` box, not the
 * editor's ability to start — and the box is visible, which is the whole point
 * of a declared chain.
 */
export async function loadStudioFonts(
  provider: HostTextProvider,
  fetcher: typeof fetch = fetch,
): Promise<readonly string[]> {
  const loaded: string[] = [];
  await Promise.all(
    STUDIO_FONTS.map(async (font) => {
      try {
        const response = await fetcher(font.url);
        if (!response.ok) return;
        provider.addFont(font.assetId, new Uint8Array(await response.arrayBuffer()));
        loaded.push(font.assetId);
      } catch {
        // Offline, blocked, or missing. The editor still opens.
      }
    }),
  );
  return loaded;
}

/**
 * The character set pre-warmed at boot. TEXT_ENGINE §5.
 *
 * Printable ASCII, because that is what a designer types while building a
 * graphic and it costs about 290ms once. Everything else rasterises on demand,
 * which must keep working anyway — live text hits novel glyphs by definition.
 */
export const PREWARM_ASCII =
  " !\"#$%&'()*+,-./0123456789:;<=>?@" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
  "abcdefghijklmnopqrstuvwxyz{|}~";
