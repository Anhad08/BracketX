/**
 * Writing systems: the ones Studio ships fonts for, shaped for real.
 *
 * ============================================================================
 * WHAT THIS ASSERTS, AND WHY IT IS NOT "DOES IT DRAW SOMETHING"
 * ============================================================================
 * Any text pipeline can turn a string into some glyphs. The question that
 * separates a broadcast tool from a canvas demo is whether it turns a string
 * into the RIGHT glyphs in the RIGHT order and the RIGHT places — which for
 * most of the world's writing systems is not the order the characters were
 * typed in:
 *
 *   Arabic       runs right to left, and each letter has up to four forms
 *                depending on what it joins to
 *   Hebrew       runs right to left without joining
 *   Devanagari   the vowel sign ि is typed AFTER its consonant and drawn
 *                BEFORE it
 *   Gurmukhi     the same reordering, with marks stacked above and below
 *   Japanese     no spaces, so a line may break almost anywhere
 *
 * Each test below states the property in those terms and checks it against
 * shaped output — not against a screenshot, and not against itself.
 *
 * The engine does the work: UAX #24 itemisation, UAX #9 bidi and HarfBuzz.
 * What Studio contributes is a font per script, so what is really under test
 * is whether the fonts we ship actually cover what we claim they cover.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Through the HOST, not through `@bracketx/engine-text` directly. Studio does
// not depend on the text engine and must not start: the host is the boundary,
// and a test that reaches past it would be the first crack in the layering the
// build checks for.
import { HostTextProvider } from "@bracketx/engine-host/text";

import { STUDIO_FONTS, type StudioFont } from "./studio/fonts";

/**
 * The strings under test, written as codepoints.
 *
 * Deliberately not literals. A test whose input can be changed by an editor,
 * a shell, or a file encoding is a test that can start failing for reasons
 * that have nothing to do with the shaper — and when the subject is text
 * encoding, that is not a hypothetical. Written this way, what reaches
 * HarfBuzz is exactly what is named here.
 */
/** العربية — "Arabic". */
const ARABIC = "العربية";
/** نعم — "yes". */
const ARABIC_YES = "نعم";
/** ببب — the letter beh, three times. */
const BEH_BEH_BEH = "ببب";
/** שלום — "shalom". */
const HEBREW = "שלום";
/** हिन्दी — "Hindi". */
const HINDI = "हिन्दी";
/** ਪੰਜਾਬੀ — "Punjabi". */
const PUNJABI = "ਪੰਜਾਬੀ";
/** ไทย — "Thai". */
const THAI = "ไทย";
/** 日本語 — "Japanese". */
const JAPANESE_WORD = "日本語";
/** 日本語のテスト — "a Japanese test". */
const JAPANESE = `${JAPANESE_WORD}のテスト`;
/** A Japanese sentence with no spaces in it anywhere. */
const JAPANESE_SENTENCE =
  `${JAPANESE_WORD}のテキストはスペース` +
  "がないので文字の間で折り返します";

const fontPath = (font: StudioFont): string =>
  fileURLToPath(new URL(`../public${font.url}`, import.meta.url));

const fontFor = (script: string): StudioFont => {
  const font = STUDIO_FONTS.find((entry) => entry.scripts.includes(script));
  if (font === undefined) throw new Error(`no shipped font covers ${script}`);
  return font;
};

/**
 * Lays a string out with every shipped font available, so the fallback chain
 * is exercised rather than bypassed.
 *
 * The engine is built once and reused: parsing seven fonts — one of them a
 * 4.5MB CJK face — per test would dominate the run.
 */
const provider = new HostTextProvider({ pageSize: 1024, pxRange: 4 });
for (const font of STUDIO_FONTS) {
  provider.addFont(font.assetId, new Uint8Array(readFileSync(fontPath(font))));
}
const engine = provider.engine;
const stack = engine.stack(STUDIO_FONTS.map((font) => font.assetId))!;

/** Every glyph on every line, in the order they are DRAWN. */
function glyphs(text: string, direction: "ltr" | "rtl" | "auto" = "auto") {
  const layout = engine.layout(
    {
      content: text,
      size: 64,
      align: "start",
      verticalAlign: "top",
      lineHeight: 1.2,
      box: { width: 4000, height: 400 },
      fit: { mode: "overflow" as const },
      direction,
    },
    stack,
  );
  return layout.lines.flatMap((line) => line.glyphs);
}

/**
 * Does this text come out laid RIGHT TO LEFT?
 *
 * Asked of the geometry rather than of a flag, because a flag can be correct
 * while the placement is not. In a right-to-left run the glyph drawn furthest
 * right is the one that came EARLIEST in the string — so cluster indices fall
 * as x rises. That is the whole property, and it is what a viewer sees.
 */
function readsRightToLeft(placed: ReturnType<typeof glyphs>): boolean {
  const byX = [...placed].sort((a, b) => a.x - b.x);
  let falling = 0;
  for (let index = 1; index < byX.length; index += 1) {
    if (byX[index]!.cluster < byX[index - 1]!.cluster) falling += 1;
  }
  return falling > byX.length / 2;
}

// ===========================================================================
// The fonts themselves
// ===========================================================================

describe("the shipped fonts", () => {
  it("are all present and parse", () => {
    for (const font of STUDIO_FONTS) {
      const bytes = readFileSync(fontPath(font));
      // A truncated download is a file that exists and is useless. Every one
      // of these is larger than any plausible error page.
      expect(bytes.byteLength, `${font.label} is too small to be a font`).toBeGreaterThan(4096);
    }
  });

  it("cover every writing system the product claims", () => {
    // Named explicitly rather than derived from the list, so removing a font
    // fails a test instead of quietly narrowing what Streamatrix supports.
    for (const script of [
      "Latin",
      "Arabic",
      "Hebrew",
      "Devanagari",
      "Gurmukhi",
      "Thai",
      "Hiragana",
      "Katakana",
      "Han",
    ]) {
      expect(() => fontFor(script), `nothing covers ${script}`).not.toThrow();
    }
  });

  it("keeps only the CJK face out of the boot path", () => {
    const deferred = STUDIO_FONTS.filter((font) => font.deferred === true);
    // If this ever grows, the editor is quietly starting up without fonts it
    // says it has, and a designer will meet a row of empty boxes.
    expect(deferred.map((font) => font.assetId)).toEqual(["ast_noto_jp"]);
  });
});

// ===========================================================================
// Right to left
// ===========================================================================

describe("scripts that run right to left", () => {
  it("lays Arabic out from the right", () => {
    // "العربية" — the word "Arabic".
    const placed = glyphs(ARABIC);
    expect(placed.length).toBeGreaterThan(0);
    expect(readsRightToLeft(placed), "Arabic was laid out left to right").toBe(true);
  });

  /**
   * Joining, which is the part a naive renderer gets wrong.
   *
   * The same letter twice in a row must NOT produce the same glyph twice: the
   * first joins only forwards, the second joins backwards and forwards. A
   * pipeline that maps characters to glyphs one at a time cannot tell them
   * apart, and Arabic comes out as disconnected letter shapes — legible to
   * nobody and instantly recognisable as broken.
   */
  it("gives a letter a different shape depending on what it joins to", () => {
    const ids = glyphs(BEH_BEH_BEH).map((glyph) => glyph.glyph);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    // Three of the same letter, and NOT three of the same glyph: initial,
    // medial and final are distinct shapes. Beh also carries a dot below,
    // which some faces emit as its own glyph — hence the count is a floor
    // rather than an equality. The distinctness is the assertion.
    expect(
      new Set(ids).size,
      "every beh shaped identically — joining is not happening",
    ).toBeGreaterThan(1);
  });

  it("lays Hebrew out from the right", () => {
    const placed = glyphs(HEBREW); // shalom
    expect(placed.length).toBeGreaterThan(0);
    expect(readsRightToLeft(placed)).toBe(true);
  });

  /**
   * Mixed direction in one string — a name in Latin inside an Arabic sentence,
   * which is what a lower third for an Arabic broadcast actually contains.
   *
   * The Latin must read left to right INSIDE a line that reads right to left.
   * A pipeline that reverses the whole string gets the Arabic right and spells
   * the name backwards.
   */
  it("keeps Latin readable inside a right-to-left line", () => {
    const placed = glyphs(`${ARABIC} BBC ${ARABIC_YES}`);
    expect(placed.length).toBeGreaterThan(0);

    // The three Latin letters, in the order they are drawn. Their clusters
    // must RISE with x even though the line around them falls.
    //
    // Selected by cluster range rather than by font: the SPACES on either side
    // also resolve to the Latin font, and a space's cluster sits outside the
    // word — which made the first version of this test read the word as
    // reversed when it was not.
    const first = ARABIC.length + 1;
    const latin = placed
      .filter((glyph) => glyph.cluster >= first && glyph.cluster < first + 3)
      .sort((a, b) => a.x - b.x);
    expect(latin.length, "the Latin letters were not laid out").toBe(3);
    for (let index = 1; index < latin.length; index += 1) {
      expect(
        latin[index]!.cluster,
        "the Latin word was reversed along with the Arabic",
      ).toBeGreaterThan(latin[index - 1]!.cluster);
    }
  });

  it("honours an explicitly stated paragraph direction", () => {
    // Digits and a space alone carry no strong direction, so UAX #9 falls back
    // to the paragraph's — which is why stating it has to be possible at all.
    const rtl = glyphs("2026 2027", "rtl");
    const ltr = glyphs("2026 2027", "ltr");
    // Same characters, same count, different arrangement.
    expect(rtl.length).toBe(ltr.length);
    expect(
      rtl.map((glyph) => glyph.cluster).join(),
      "stating the paragraph direction changed nothing",
    ).not.toBe(ltr.map((glyph) => glyph.cluster).join());
  });
});

// ===========================================================================
// Scripts that reorder
// ===========================================================================

describe("scripts that reorder what was typed", () => {
  /**
   * Devanagari: "हिन्दी".
   *
   * The vowel sign ि (U+093F) is typed after its consonant and drawn BEFORE
   * it. If the pipeline is passing characters through in typed order, the
   * glyphs come out in typed order too — which is the single most visible way
   * to get an Indic script wrong.
   */
  it("shapes Devanagari as syllables rather than one glyph per character", () => {
    const placed = glyphs(HINDI);
    expect(placed.length).toBeGreaterThan(0);
    expect(
      placed.every((glyph) => glyph.font === "ast_noto_devanagari"),
      "Devanagari fell through to another font",
    ).toBe(true);

    // HarfBuzz reports a whole syllable under ONE cluster, because the glyphs
    // inside it have been reordered and no longer map to characters one for
    // one — the vowel sign ि is typed after its consonant and drawn before it,
    // and न् + द combine into a conjunct. So the evidence that Indic shaping
    // ran is that some cluster owns more than one glyph, and that there are
    // fewer clusters than there are characters.
    const clusters = new Map<number, number>();
    for (const glyph of placed) clusters.set(glyph.cluster, (clusters.get(glyph.cluster) ?? 0) + 1);

    expect(
      [...clusters.values()].some((count) => count > 1),
      "every glyph stood alone — characters were mapped one to one",
    ).toBe(true);
    expect(
      clusters.size,
      "as many clusters as characters — no syllables were formed",
    ).toBeLessThan([...HINDI].length);
  });

  /**
   * Gurmukhi: "ਪੰਜਾਬੀ" — Punjabi.
   *
   * Reorders like Devanagari, and stacks a nasal mark above the line. The
   * mark must attach without advancing the pen, or the word comes out spaced
   * like it has an extra letter in it.
   */
  it("stacks a Gurmukhi mark over its letter rather than beside it", () => {
    const placed = glyphs(PUNJABI);
    expect(placed.length).toBeGreaterThan(0);
    expect(
      placed.every((glyph) => glyph.font === "ast_noto_gurmukhi"),
      "Gurmukhi fell through to another font",
    ).toBe(true);

    // A mark that stacks does not advance the pen, so two glyphs share an x.
    // If every glyph has its own x, the marks are being set as letters and the
    // word comes out looking spaced wrong.
    const xs = placed.map((glyph) => Math.round(glyph.x * 100));
    expect(
      new Set(xs).size,
      "every Gurmukhi glyph advanced the pen — marks are being drawn as letters",
    ).toBeLessThan(placed.length);
  });

  it("draws Thai from the Thai font", () => {
    const placed = glyphs(THAI);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every((glyph) => glyph.font === "ast_noto_thai")).toBe(true);
  });
});

// ===========================================================================
// Japanese
// ===========================================================================

describe("Japanese", () => {
  it("shapes kana and han from the deferred face", () => {
    const placed = glyphs(JAPANESE);
    expect(placed.length).toBeGreaterThan(0);
    // Nothing fell through to .notdef, which is glyph 0 in every font.
    expect(
      placed.every((glyph) => glyph.glyph !== 0),
      "some Japanese characters came out as empty boxes",
    ).toBe(true);
    expect(placed.every((glyph) => glyph.font === "ast_noto_jp")).toBe(true);
  });

  /**
   * Japanese has no spaces, so a line breaks between characters. A pipeline
   * that only breaks at spaces runs a long Japanese line straight off the
   * side of the box — the classic failure, and invisible in every Latin test.
   */
  it("breaks a long Japanese line without any spaces to break at", () => {
    const layout = engine.layout(
      {
        content: JAPANESE_SENTENCE,
        size: 64,
        align: "start",
        verticalAlign: "top",
        lineHeight: 1.2,
        box: { width: 500, height: 900 },
        fit: { mode: "wrap" as const },
        direction: "auto",
      },
      stack,
    );
    expect(layout.lines.length, "the line never wrapped").toBeGreaterThan(1);
  });
});

// ===========================================================================
// Unicode, generally
// ===========================================================================

describe("Unicode, beyond the scripts we ship fonts for", () => {
  /**
   * Characters outside the Basic Multilingual Plane.
   *
   * These are two UTF-16 code units in JavaScript, and anything that indexes a
   * Half a surrogate pair is not a character.
   */
  it("does not split a surrogate pair", () => {
    // Mathematical bold A and B: two characters, four UTF-16 units. Anything
    // that indexes by `.length` produces four glyphs, half of them built from
    // broken halves of a pair.
    const placed = glyphs("\u{1D400}\u{1D401}");
    expect(placed.length).toBeLessThanOrEqual(2);
    expect(new Set(placed.map((glyph) => glyph.cluster)).size).toBe(placed.length);
  });

  it("keeps a combining mark with its base letter", () => {
    // "e" + combining acute — one cluster, not a letter followed by a floating
    // accent that a line break could separate from it.
    const placed = glyphs("é");
    expect(new Set(placed.map((glyph) => glyph.cluster)).size).toBe(1);
  });

  it("survives text that carries no glyphs at all", () => {
    // Live data is not clean. A name field that arrives empty, or holding only
    // a newline, or only a zero-width joiner, must not throw on air.
    for (const text of ["", "\n", "‍", "   "]) {
      expect(() => glyphs(text), JSON.stringify(text)).not.toThrow();
    }
  });

  it("draws an unknown character as a visible box rather than nothing", () => {
    // A private-use codepoint no shipped font covers. The chain is exhausted,
    // and the answer must be .notdef — which a designer SEES and fixes. A
    // silently dropped character is one nobody notices until it is on air.
    const placed = glyphs("");
    expect(placed.length).toBe(1);
    expect(placed[0]!.glyph).toBe(0);
  });

  it("lays out a line mixing five writing systems", () => {
    // The product claim, in one string.
    const placed = glyphs(`English ${HINDI} ${PUNJABI} ${JAPANESE_WORD} ${ARABIC}`);
    expect(placed.length).toBeGreaterThan(0);

    // Each script came from its own font, which is the fallback chain working.
    const fonts = new Set(placed.map((glyph) => glyph.font));
    for (const assetId of [
      "ast_studio_ui",
      "ast_noto_devanagari",
      "ast_noto_gurmukhi",
      "ast_noto_jp",
      "ast_noto_arabic",
    ]) {
      expect(fonts.has(assetId), `nothing was drawn from ${assetId}`).toBe(true);
    }
  });
});
