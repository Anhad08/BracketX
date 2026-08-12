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
 * The set covers the writing systems the engine's shaping actually has to get
 * right, and each one is here because it exercises something different:
 *
 *   Latin        kerning, and the baseline case
 *   Arabic       joins — a letter's shape depends on its neighbours, and the
 *                line runs right to left
 *   Hebrew       right to left without joining
 *   Devanagari   reordering — the vowel sign for "i" is TYPED after its
 *                consonant and DRAWN before it
 *   Gurmukhi     the same reordering, plus stacked marks above and below
 *   Thai         marks that stack without advancing
 *   Japanese     thousands of glyphs, and lines that may break between almost
 *                any two characters rather than at spaces
 *
 * None of this is implemented here. The engine already does UAX #9 bidi, UAX
 * #24 script itemisation and HarfBuzz shaping; what a script needs from Studio
 * is a font that contains its glyphs and its OpenType tables. Which is the
 * whole point of the list: the hard part is upstream, and adding a writing
 * system is adding a file.
 *
 * ============================================================================
 * LOADING IS NOT LAZY, AND THAT IS DELIBERATE — WITH ONE EXCEPTION
 * ============================================================================
 * TEXT_ENGINE §3: the first frame is not painted until every font a scene
 * references has parsed, because a font resolving mid-broadcast reflows every
 * graphic using it. So the editor waits, once, at boot.
 *
 * Japanese breaks that arrangement on size alone. A CJK face is 4.5MB against
 * 17–219KB for everything else — twenty times the rest of the set combined —
 * and blocking the editor's boot on it would make every designer who never
 * types Japanese pay for it every morning. So it loads in the BACKGROUND, and
 * `fontsReady` is the promise that says when the full set has arrived. Anything
 * that must not reflow — going to air, above all — awaits it. Editing does not.
 */
import type { HostTextProvider } from "@bracketx/engine-host/text";

export interface StudioFont {
  /** The asset id a document references. */
  readonly assetId: string;
  readonly label: string;
  readonly url: string;
  /** Scripts this font covers, for the inspector's font picker. */
  readonly scripts: readonly string[];
  /**
   * Which way this font's scripts run, for the direction control's default.
   *
   * Paragraph direction is still resolved per-string by UAX #9 — this only
   * says what to suggest, so a designer picking an Arabic font is not asked to
   * also know that Arabic is right-to-left.
   */
  readonly rtl?: boolean;
  /**
   * Loaded after boot rather than during it. See the note above.
   *
   * Only for faces whose size would otherwise be charged to everyone.
   */
  readonly deferred?: boolean;
}

/**
 * ============================================================================
 * THE BROADCAST FACES, AND WHY THERE ARE NOW MORE THAN ONE
 * ============================================================================
 * Until this change Studio shipped exactly ONE Latin face: Inter Regular. Every
 * shipped graphic — name, role, score, clock, kicker — was drawn in the same
 * weight at different sizes, and that is the whole reason they read as UI rather
 * than as broadcast. Weight and width contrast is the primary tool of broadcast
 * typography; size alone gives you a heading and a subheading.
 *
 * The engine has no `letterSpacing`, no `textTransform` and no OpenType feature
 * selection, so the tools that remain are FACE, SIZE, CASE, COLOUR and
 * COMPOSITION. Three of those five are chosen by picking the right file, which
 * makes the font set a design decision rather than an asset-loading detail.
 *
 * TABULAR FIGURES DECIDED THE DISPLAY FACE. A clock counting 02:14 → 02:11 must
 * not change width, and a score must not shift when it ticks. Without `tnum`
 * the figures have to be tabular BY DEFAULT, and they usually are not: measured
 * from the files, Barlow Condensed sets "1" at 284 against "4" at 484, Saira
 * Condensed 310 against 469, Inter 833 against 1323. Bebas Neue sets every digit
 * at 400. That is why it is here and the alternatives are not.
 *
 * Bebas is caps-only — its lowercase codepoints carry cap forms at identical
 * advances — which is not a limitation for the role it holds. Broadcast names,
 * scores, kickers and clocks are set in caps. It also means CASE can be a design
 * tool without a `textTransform` the engine does not have: caps come from the
 * face, and mixed case comes from choosing Barlow instead.
 *
 * Volume One G1 names the typeface as the Design OS's largest open gap —
 * "needs commissioning, not designing" — and that gap is about the INTERFACE
 * face. These are for the graphics that go to air. Both are OFL; the licences
 * ship beside the files.
 */
export const STUDIO_FONTS: readonly StudioFont[] = [
  { assetId: "ast_studio_ui", label: "Inter", url: "/fonts/inter-latin-400.ttf", scripts: ["Latin"] },
  // Display and numerals. Caps-only, condensed, and the only face in the set
  // whose digits are all one width.
  { assetId: "ast_display", label: "Bebas Neue", url: "/fonts/bebas-neue-400.ttf", scripts: ["Latin"] },
  // Headlines and anything that needs mixed case in a hurry.
  { assetId: "ast_headline", label: "Barlow Condensed Bold", url: "/fonts/barlow-condensed-700.ttf", scripts: ["Latin"] },
  { assetId: "ast_kicker", label: "Barlow Condensed Medium", url: "/fonts/barlow-condensed-500.ttf", scripts: ["Latin"] },
  // Sentence text: roles, context, sponsor lines.
  { assetId: "ast_text", label: "Barlow Medium", url: "/fonts/barlow-500.ttf", scripts: ["Latin"] },
  { assetId: "ast_noto_arabic", label: "Noto Sans Arabic", url: "/fonts/noto-arabic-400.ttf", scripts: ["Arabic"], rtl: true },
  { assetId: "ast_noto_hebrew", label: "Noto Sans Hebrew", url: "/fonts/noto-hebrew-400.ttf", scripts: ["Hebrew"], rtl: true },
  { assetId: "ast_noto_devanagari", label: "Noto Sans Devanagari", url: "/fonts/noto-devanagari-400.ttf", scripts: ["Devanagari"] },
  { assetId: "ast_noto_gurmukhi", label: "Noto Sans Gurmukhi", url: "/fonts/noto-gurmukhi-400.ttf", scripts: ["Gurmukhi"] },
  { assetId: "ast_noto_thai", label: "Noto Sans Thai", url: "/fonts/noto-thai-400.ttf", scripts: ["Thai"] },
  // ==========================================================================
  // AFTER THE NOTO FACES, AND THAT ORDER IS LOAD-BEARING
  // ==========================================================================
  // Rajdhani is an Indian Type Foundry face and it CONTAINS DEVANAGARI. Listed
  // before Noto Sans Devanagari it won the fallback for that script, and
  // `writing.test.ts` went red on two assertions at once: Devanagari stopped
  // being drawn from its own font, and the five-script line lost a system.
  //
  // The chain resolves in declaration order, so a Latin display face must never
  // precede a script font. Nothing about Rajdhani changed — only where it sits.
  // ESPORTS. Rajdhani is a squarish, technical-looking condensed face — the one
  // that reads as a HUD rather than as a newsroom — and it carries the tactical
  // pack's headings and team names.
  //
  // Its FIGURES ARE PROPORTIONAL, measured from the file: "1" at 334 against "4"
  // at 541. So it does not get the numerals. A round timer counting 0:45 to 0:44
  // in a face whose digits change width moves the centre of the scoreboard every
  // second, which is the same reason Bebas was chosen for the broadcast family —
  // and the two share enough of a skeleton to sit in one bug together.
  { assetId: "ast_tac_head", label: "Rajdhani Bold", url: "/fonts/rajdhani-700.ttf", scripts: ["Latin"] },
  { assetId: "ast_tac_label", label: "Rajdhani SemiBold", url: "/fonts/rajdhani-600.ttf", scripts: ["Latin"] },
  {
    assetId: "ast_noto_jp",
    label: "Noto Sans Japanese",
    url: "/fonts/noto-jp-400.otf",
    // Kana and Han. Latin digits and punctuation come from Inter through the
    // fallback chain, which is why this does not need to claim them.
    scripts: ["Hiragana", "Katakana", "Han"],
    deferred: true,
  },
];

/**
 * Fetches and registers every shipped font.
 *
 * A font that fails to fetch is SKIPPED rather than fatal, and the ids that
 * loaded are returned. A missing fallback should cost a `.notdef` box, not the
 * editor's ability to start — and the box is visible, which is the whole point
 * of a declared chain.
 */
async function fetchFont(
  provider: HostTextProvider,
  font: StudioFont,
  fetcher: typeof fetch,
  loaded: string[],
): Promise<void> {
  try {
    const response = await fetcher(font.url);
    if (!response.ok) return;
    provider.addFont(font.assetId, new Uint8Array(await response.arrayBuffer()));
    loaded.push(font.assetId);
  } catch {
    // Offline, blocked, or missing. The editor still opens.
  }
}

/**
 * Resolves when every shipped font has arrived, deferred ones included.
 *
 * Await this before anything that must not reflow — a take, above all. It is
 * set by `loadStudioFonts` and resolves immediately once the set is complete,
 * so awaiting it repeatedly costs nothing.
 */
export let fontsReady: Promise<readonly string[]> = Promise.resolve([]);

export async function loadStudioFonts(
  provider: HostTextProvider,
  fetcher: typeof fetch = fetch,
): Promise<readonly string[]> {
  const loaded: string[] = [];
  const deferred = STUDIO_FONTS.filter((font) => font.deferred === true);

  // The rest of the set is small enough that waiting is the right trade: text
  // that reflows one second after it appeared looks like a bug to everyone who
  // did not write it.
  await Promise.all(
    STUDIO_FONTS.filter((font) => font.deferred !== true).map((font) =>
      fetchFont(provider, font, fetcher, loaded),
    ),
  );

  // Kicked off, not awaited. Held so a caller that DOES need the full set can
  // wait for it rather than poll or guess.
  const rest = Promise.all(
    deferred.map((font) => fetchFont(provider, font, fetcher, loaded)),
  ).then(() => loaded as readonly string[]);
  fontsReady = rest;
  // A deferred font that never arrives must not become an unhandled rejection
  // — `fetchFont` swallows its own failures, and this is the belt to that
  // brace.
  void rest.catch(() => []);

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
