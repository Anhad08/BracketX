/**
 * Named character ranges for pre-warm. TEXT_ENGINE §5, T4.
 *
 * ============================================================================
 * NAMES, NOT CODEPOINT RANGES, IN THE DOCUMENT
 * ============================================================================
 * An author declares "this scoreboard will show Korean names", not
 * "U+AC00–U+D7A3". The document stores the intent; this file stores the
 * expansion, so refining a range later is a code change rather than a migration
 * of every scene that used it.
 *
 * The sets are deliberately the COMMON block, not the full Unicode range.
 * Hangul is 11,172 syllables and pre-warming all of them would cost minutes and
 * fill the atlas; the ~2,500 in common use cover a name list, and the rest
 * rasterise on demand — which has to work anyway.
 */
import type { TextRange } from "@bracketx/engine-scene";

function span(from: number, to: number): string {
  let out = "";
  for (let code = from; code <= to; code += 1) out += String.fromCodePoint(code);
  return out;
}

const ASCII = span(0x20, 0x7e);

const RANGES: Record<TextRange, () => string> = {
  latin: () => ASCII,
  "latin-ext": () => span(0x00c0, 0x024f),
  cyrillic: () => span(0x0400, 0x045f),
  greek: () => span(0x0386, 0x03ce),
  arabic: () => span(0x0620, 0x064a) + span(0x0660, 0x0669),
  hebrew: () => span(0x05d0, 0x05ea),
  thai: () => span(0x0e01, 0x0e5b),
  // The 2,350 syllables of KS X 1001, which is what a Korean name list uses.
  // The full 11,172-syllable block would take minutes to rasterise.
  hangul: () => span(0xac00, 0xd7a3).slice(0, 2350),
  kana: () => span(0x3041, 0x309f) + span(0x30a0, 0x30ff),
  punctuation: () => span(0x2010, 0x2027) + span(0x2030, 0x205e),
};

/**
 * Expands a declaration into the characters to rasterise.
 *
 * Deduplicated, because ranges overlap — `latin` and `punctuation` both carry a
 * hyphen, and rasterising it twice is a wasted MSDF generation each time.
 */
export function expandPrewarm(declaration: {
  readonly ranges?: readonly TextRange[];
  readonly characters?: string;
}): string {
  const seen = new Set<string>();
  for (const range of declaration.ranges ?? []) {
    const expand = RANGES[range];
    if (expand === undefined) continue;
    for (const character of expand()) seen.add(character);
  }
  for (const character of declaration.characters ?? "") seen.add(character);
  return [...seen].join("");
}

export const TEXT_RANGES = Object.keys(RANGES) as readonly TextRange[];
