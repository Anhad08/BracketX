/**
 * UAX #29 segmentation and caret movement.
 *
 * The cases below are the ones that break naive editors: combining marks,
 * surrogate pairs, ZWJ sequences, regional indicator pairs, skin tone
 * modifiers, CRLF, and Indic consonant clusters. Each is a real string a
 * broadcaster will type into a name field.
 */
import { describe, expect, it } from "vitest";
import {
  clampToGrapheme,
  graphemeBoundaries,
  graphemeClusters,
  graphemeLength,
  isGraphemeBoundary,
  lineAt,
  nextGrapheme,
  nextWordBoundary,
  previousGrapheme,
  previousWordBoundary,
  wordAt,
} from "./grapheme";

const FAMILY = "\u{1F468}‍\u{1F469}‍\u{1F467}"; // 👨‍👩‍👧
const FLAG_GB = "\u{1F1EC}\u{1F1E7}"; // 🇬🇧
const THUMBS = "\u{1F44D}\u{1F3FD}"; // 👍🏽
const E_ACUTE = "é"; // é as e + combining acute
const HANGUL = "한"; // 한, precomposed

describe("clusters match what a person sees as one character", () => {
  it("counts a combining sequence as one", () => {
    expect(graphemeLength(E_ACUTE)).toBe(1);
    expect(E_ACUTE.length).toBe(2); // two UTF-16 units
  });

  it("counts a ZWJ family emoji as one", () => {
    expect(graphemeLength(FAMILY)).toBe(1);
    expect([...FAMILY].length).toBe(5); // five code points
  });

  it("counts a regional indicator pair as one flag", () => {
    expect(graphemeLength(FLAG_GB)).toBe(1);
    expect(graphemeLength(FLAG_GB + FLAG_GB)).toBe(2);
  });

  it("keeps a skin tone modifier with its base", () => {
    expect(graphemeLength(THUMBS)).toBe(1);
  });

  it("treats CRLF as one cluster", () => {
    expect(graphemeLength("\r\n")).toBe(1);
    expect(graphemeLength("\n\r")).toBe(2);
  });

  it("handles an empty string without a special case at the call site", () => {
    expect(graphemeLength("")).toBe(0);
    expect(graphemeBoundaries("")).toEqual([0]);
    expect(graphemeClusters("")).toEqual([]);
  });

  it("produces boundaries that always slice cleanly", () => {
    const text = `A${E_ACUTE}${FAMILY}${FLAG_GB}B`;
    const boundaries = graphemeBoundaries(text);
    expect(boundaries[0]).toBe(0);
    expect(boundaries.at(-1)).toBe(text.length);
    const rebuilt = boundaries
      .slice(0, -1)
      .map((start, i) => text.slice(start, boundaries[i + 1]))
      .join("");
    expect(rebuilt).toBe(text);
  });
});

/**
 * The platform's own ICU as an oracle.
 *
 * Not the implementation — `Intl.Segmenter`'s Unicode version follows the host,
 * which is why the engine vendors a pinned splitter instead. But where the two
 * agree, the pinned one is very likely right, and a disagreement is worth
 * investigating rather than discovering on air.
 */
describe("agrees with the platform segmenter", () => {
  const CORPUS = [
    "Amara Okonkwo",
    "Konstantinos Papadopoulos",
    E_ACUTE,
    FAMILY,
    FLAG_GB,
    THUMBS,
    "\r\n",
    "กัน", // กัน — Thai with a vowel sign
    "한국어", // 한국어
    "אָלֶף", // Hebrew with points
    "اَلسَلام", // Arabic with harakat
    "á̧b", // stacked marks
    `${FAMILY}${FLAG_GB}${THUMBS}`,
  ];

  it("segments every corpus string identically", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const text of CORPUS) {
      const platform = [...segmenter.segment(text)].map((s) => s.segment);
      expect(graphemeClusters(text), JSON.stringify(text)).toEqual(platform);
    }
  });

  /**
   * ==========================================================================
   * KNOWN DIVERGENCE — INDIC CONJUNCTS (GB9c)
   * ==========================================================================
   * Unicode 15.1 added rule GB9c: do not break inside an Indic conjunct
   * sequence (Consonant Linker Consonant). The vendored splitter is Unicode
   * 15.0 and predates it; the host's ICU is newer and applies it.
   *
   * Both are correct for their version. The NEWER behaviour is the one a person
   * sees, because a conjunct renders as a single ligature glyph — so a caret
   * that stops inside `क्ष` lands in the middle of one visible character.
   *
   * This is pinned rather than skipped so that:
   *   - it is impossible to believe Indic editing is finished,
   *   - upgrading the splitter makes this test FAIL, forcing a deliberate
   *     review rather than a silent behaviour change on air.
   */
  it("does not yet apply GB9c, and this is the shape of the gap", () => {
    const conjuncts = ["क्ष", "न्न", "त्र"];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const text of conjuncts) {
      // Ours: splits at the virama.
      expect(graphemeClusters(text).length, text).toBe(2);
      // The platform, at Unicode 15.1+: one cluster.
      expect([...segmenter.segment(text)].length, text).toBe(1);
    }
  });
});

describe("the caret only ever occupies a boundary", () => {
  const text = `A${FAMILY}B`;

  it("moves right by whole clusters", () => {
    let at = 0;
    at = nextGrapheme(text, at);
    expect(at).toBe(1); // past A
    at = nextGrapheme(text, at);
    expect(at).toBe(1 + FAMILY.length); // past the whole family, not one person
    at = nextGrapheme(text, at);
    expect(at).toBe(text.length);
    expect(nextGrapheme(text, at)).toBe(text.length); // stops at the end
  });

  it("moves left by whole clusters", () => {
    let at = text.length;
    at = previousGrapheme(text, at);
    expect(at).toBe(1 + FAMILY.length);
    at = previousGrapheme(text, at);
    expect(at).toBe(1);
    at = previousGrapheme(text, at);
    expect(at).toBe(0);
    expect(previousGrapheme(text, at)).toBe(0); // stops at the start
  });

  it("never lands inside a surrogate pair", () => {
    let at = 0;
    const visited: number[] = [at];
    while (at < text.length) {
      at = nextGrapheme(text, at);
      visited.push(at);
    }
    for (const index of visited) {
      expect(isGraphemeBoundary(text, index), `index ${index}`).toBe(true);
    }
  });

  it("moves a mid-cluster index to the END of that cluster, not past it", () => {
    // An index restored from a bad session, or a hit test that landed inside a
    // surrogate pair. Moving to the next cluster's end would skip a character.
    const inside = 2; // inside the first emoji of the family
    expect(nextGrapheme(text, inside)).toBe(1 + FAMILY.length);
  });

  it("clamps an arbitrary index back onto a boundary", () => {
    expect(clampToGrapheme(text, 2)).toBe(1);
    expect(clampToGrapheme(text, -5)).toBe(0);
    expect(clampToGrapheme(text, 999)).toBe(text.length);
    expect(clampToGrapheme("", 3)).toBe(0);
  });
});

describe("words, for double click", () => {
  it("selects a whole word", () => {
    const text = "Amara Okonkwo reports";
    expect(wordAt(text, 2)).toEqual({ start: 0, end: 5 });
    expect(text.slice(6, 13)).toBe("Okonkwo");
    expect(wordAt(text, 8)).toEqual({ start: 6, end: 13 });
  });

  it("selects a run of whitespace as one unit", () => {
    const text = "a   b";
    expect(wordAt(text, 2)).toEqual({ start: 1, end: 4 });
  });

  it("keeps a combining mark with its base", () => {
    const text = `caf${E_ACUTE}`;
    expect(wordAt(text, 1)).toEqual({ start: 0, end: text.length });
  });

  it("treats an emoji as its own unit rather than part of a word", () => {
    const text = `hi ${FAMILY} there`;
    const range = wordAt(text, 3);
    expect(text.slice(range.start, range.end)).toBe(FAMILY);
  });

  it("moves to the next word start", () => {
    const text = "Amara Okonkwo reports";
    expect(nextWordBoundary(text, 0)).toBe(6);
    expect(nextWordBoundary(text, 6)).toBe(14);
    expect(nextWordBoundary(text, 14)).toBe(text.length);
  });

  it("moves to the previous word start", () => {
    const text = "Amara Okonkwo reports";
    expect(previousWordBoundary(text, text.length)).toBe(14);
    expect(previousWordBoundary(text, 14)).toBe(6);
    expect(previousWordBoundary(text, 6)).toBe(0);
    expect(previousWordBoundary(text, 0)).toBe(0);
  });
});

describe("lines, for triple click and Home/End", () => {
  it("finds the hard line containing an index", () => {
    const text = "first\nsecond\nthird";
    expect(lineAt(text, 0)).toEqual({ start: 0, end: 5 });
    expect(lineAt(text, 8)).toEqual({ start: 6, end: 12 });
    expect(lineAt(text, text.length)).toEqual({ start: 13, end: 18 });
  });

  it("handles CRLF without leaving the caret between CR and LF", () => {
    const text = "first\r\nsecond";
    const line = lineAt(text, 9);
    expect(text.slice(line.start, line.end)).toBe("second");
  });

  it("returns the whole string when there are no breaks", () => {
    expect(lineAt("one line", 4)).toEqual({ start: 0, end: 8 });
  });
});
