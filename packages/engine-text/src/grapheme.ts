/**
 * UAX #29 grapheme cluster segmentation, and caret movement over it.
 *
 * ============================================================================
 * WHY THIS IS A VENDORED LIBRARY AND NOT A HAND-WRITTEN TABLE
 * ============================================================================
 * This package already delegates every other Unicode algorithm to a pinned
 * dependency — UAX #24 to `unicode-properties`, UAX #9 to `bidi-js`, UAX #14 to
 * `linebreak`. Segmentation follows the same policy for the same reason: the
 * Grapheme_Cluster_Break property is thousands of ranges that change with every
 * Unicode release, and a hand-typed copy would be wrong on the day it was
 * written and wronger every year after.
 *
 * `Intl.Segmenter` was rejected deliberately. It is correct, but its Unicode
 * version is whatever the host's ICU happens to be, so two targets could
 * segment the same string differently — and segmentation feeds layout, which
 * feeds what goes to air. A pinned library gives the same answer on every
 * target, which is the property this engine trades other things for.
 *
 * ============================================================================
 * WHY EDITING NEEDS THIS AT ALL
 * ============================================================================
 * A caret that moves by UTF-16 code unit splits an emoji in half. A caret that
 * moves by code point splits a family emoji into five people, an é into two
 * marks, and a Hangul syllable into jamo. The grapheme cluster is the only unit
 * that matches what a person sees as "one character", and every editing
 * operation below is defined on it.
 */
import Graphemer from "graphemer";

/** One splitter for the process. It is stateless and allocation-free to reuse. */
const splitter = new Graphemer();

/**
 * A grapheme cluster boundary, as a UTF-16 index into the source string.
 *
 * Always begins with 0 and ends with `text.length`, so the boundaries of an
 * empty string are `[0]` and consecutive pairs are always a valid slice.
 */
export type GraphemeBoundaries = readonly number[];

/**
 * Every cluster boundary in `text`.
 *
 * O(n) and computed in one pass. Callers that move a caret repeatedly over
 * unchanged text should hold the result rather than calling `nextGrapheme` in a
 * loop, which re-segments from the start each time.
 */
export function graphemeBoundaries(text: string): GraphemeBoundaries {
  if (text.length === 0) return [0];
  const boundaries: number[] = [0];
  let index = 0;
  for (const cluster of splitter.iterateGraphemes(text)) {
    index += cluster.length;
    boundaries.push(index);
  }
  return boundaries;
}

/** The clusters themselves. `graphemeClusters("á").length === 1`. */
export function graphemeClusters(text: string): readonly string[] {
  return text.length === 0 ? [] : splitter.splitGraphemes(text);
}

/** How many clusters `text` contains — what a person would call its length. */
export function graphemeLength(text: string): number {
  return text.length === 0 ? 0 : splitter.countGraphemes(text);
}

/**
 * True when `index` sits on a cluster boundary.
 *
 * Out-of-range indices are not boundaries, and neither is a position inside a
 * surrogate pair. A caret is only ever allowed to occupy a boundary.
 */
export function isGraphemeBoundary(text: string, index: number): boolean {
  if (index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  return graphemeBoundaries(text).includes(index);
}

/**
 * Snaps an arbitrary index to the nearest boundary at or before it.
 *
 * The function every entry point uses on untrusted input — a caret restored
 * from a saved session, an offset from a hit test, a value from an IME. Nothing
 * downstream has to defend against a mid-cluster index because nothing can
 * produce one.
 */
export function clampToGrapheme(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const boundaries = graphemeBoundaries(text);
  let previous = 0;
  for (const boundary of boundaries) {
    if (boundary > index) return previous;
    previous = boundary;
  }
  return previous;
}

/**
 * The boundary after `index`, or `text.length` at the end.
 *
 * A mid-cluster `index` moves to the end of the cluster it is inside, not to
 * the end of the next one — otherwise a caret restored to a bad position would
 * skip a character on its first keypress.
 */
export function nextGrapheme(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const boundaries = graphemeBoundaries(text);
  for (const boundary of boundaries) if (boundary > index) return boundary;
  return text.length;
}

/** The boundary before `index`, or 0 at the start. */
export function previousGrapheme(text: string, index: number): number {
  if (index <= 0) return 0;
  const boundaries = graphemeBoundaries(text);
  let previous = 0;
  for (const boundary of boundaries) {
    if (boundary >= index) return previous;
    previous = boundary;
  }
  return previous;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * Word boundaries, for double-click selection.
 *
 * ============================================================================
 * THIS IS NOT UAX #29 WORD SEGMENTATION, AND SAYS SO
 * ============================================================================
 * Full word segmentation needs the Word_Break property, which the vendored
 * splitter does not expose. What a double-click should select is also not
 * exactly UAX #29 — every editor extends or narrows it, and Thai, Khmer, Lao
 * and Japanese need dictionary segmentation that no property table provides.
 *
 * So this is a deliberately simple classifier: runs of letters, marks and
 * digits are one word; runs of whitespace are one word; everything else is a
 * single cluster. It is correct for Latin, Cyrillic, Greek and Arabic, and it
 * is honestly wrong for scripts without spaces — which is recorded rather than
 * hidden, because a double-click that silently selects a whole Thai sentence is
 * a defect somebody must be able to find.
 */
export type WordClass = "word" | "space" | "other";

function classifyCluster(cluster: string): WordClass {
  const first = cluster.codePointAt(0);
  if (first === undefined) return "other";
  const ch = String.fromCodePoint(first);
  if (/\s/u.test(ch)) return "space";
  // Letters, marks, numbers and the connector punctuation that binds them.
  if (/[\p{L}\p{M}\p{N}\p{Pc}]/u.test(ch)) return "word";
  return "other";
}

export interface WordRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The word containing `index`, on grapheme boundaries.
 *
 * At a class change the word *starting* at `index` wins, which is what a
 * double-click between two words should select.
 */
export function wordAt(text: string, index: number): WordRange {
  if (text.length === 0) return { start: 0, end: 0 };
  const boundaries = graphemeBoundaries(text);
  const clusters: { start: number; end: number; cls: WordClass }[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    clusters.push({ start, end, cls: classifyCluster(text.slice(start, end)) });
  }

  const position = clampToGrapheme(text, index);
  let at = clusters.findIndex((c) => c.start <= position && position < c.end);
  if (at === -1) at = clusters.length - 1;
  const cls = clusters[at]!.cls;
  if (cls === "other") return { start: clusters[at]!.start, end: clusters[at]!.end };

  let first = at;
  while (first > 0 && clusters[first - 1]!.cls === cls) first -= 1;
  let last = at;
  while (last < clusters.length - 1 && clusters[last + 1]!.cls === cls) last += 1;
  return { start: clusters[first]!.start, end: clusters[last]!.end };
}

/**
 * The boundary at the start of the next word — what ⌥→ moves to.
 *
 * Skips the remainder of the current word and any whitespace after it, which is
 * the behaviour every platform agrees on even though they disagree about
 * ⌥← (this one stops at the start of the current word first).
 */
export function nextWordBoundary(text: string, index: number): number {
  const boundaries = graphemeBoundaries(text);
  let position = clampToGrapheme(text, index);
  const classAt = (at: number): WordClass => {
    const end = nextGrapheme(text, at);
    return at >= text.length ? "space" : classifyCluster(text.slice(at, end));
  };
  // Leave the current run.
  const starting = classAt(position);
  while (position < text.length && classAt(position) === starting) {
    position = nextGrapheme(text, position);
  }
  // Then skip whitespace to land on the next word.
  while (position < text.length && classAt(position) === "space") {
    position = nextGrapheme(text, position);
  }
  return boundaries.includes(position) ? position : text.length;
}

/** The boundary at the start of the previous word — what ⌥← moves to. */
export function previousWordBoundary(text: string, index: number): number {
  let position = clampToGrapheme(text, index);
  const classBefore = (at: number): WordClass => {
    if (at <= 0) return "space";
    const start = previousGrapheme(text, at);
    return classifyCluster(text.slice(start, at));
  };
  while (position > 0 && classBefore(position) === "space") {
    position = previousGrapheme(text, position);
  }
  const target = classBefore(position);
  while (position > 0 && classBefore(position) === target) {
    position = previousGrapheme(text, position);
  }
  return position;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Hard line boundaries — the `\n`, `\r\n` and `\r` in the string.
 *
 * Deliberately NOT the wrapped lines: those are a function of the box and the
 * font and belong to `layoutText`. Home and End over a wrapped line are a
 * layout question and are answered by the caller that has a layout; this is the
 * answer for a caller that only has the string.
 */
export function lineAt(text: string, index: number): WordRange {
  const position = Math.max(0, Math.min(text.length, index));
  let start = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const carriage = text.lastIndexOf("\r", Math.max(0, position - 1)) + 1;
  if (carriage > start) start = carriage;
  let end = position;
  while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
  return { start, end };
}
