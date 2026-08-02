/**
 * Stages 2, 3 and 5 — itemization, bidi, line breaking.
 *
 * ============================================================================
 * THE STAGES "JUST USE HARFBUZZ" FORGETS
 * ============================================================================
 * HarfBuzz shapes, and does nothing else. It does not resolve bidirectional
 * order, find line breaks, or decide which script a character belongs to — and
 * it cannot, because each of those is a decision about a whole paragraph and
 * HarfBuzz is handed one run at a time.
 *
 * TEXT_ENGINE §2 rates underestimating this as High probability / Severe impact,
 * and names it as the specific way text subsystems overrun. These three stages
 * are what that warning is about.
 *
 * Each vendors a correct implementation of a Unicode annex rather than
 * approximating it:
 *
 *   UAX #24  script property   →  unicode-properties
 *   UAX #9   bidirectional     →  bidi-js
 *   UAX #14  line breaking     →  linebreak
 *
 * The Unicode data version ships pinned with those packages, which is what makes
 * TEXT_ENGINE §8.4 true: results depend only on a version we control, so an
 * upgrade is a deliberate change that alters layout rather than a surprise.
 */
import bidiFactory from "bidi-js";
import LineBreaker from "linebreak";
import { getScript } from "unicode-properties";

import type { FontStack, LoadedFont } from "./font";

const bidi = bidiFactory();

/**
 * A run of text that can be handed to the shaper as one unit.
 *
 * One script, one direction, one font. Those are exactly HarfBuzz's
 * preconditions, and the reason itemization exists at all.
 */
export interface TextRun {
  /** Index into the ORIGINAL string. Preserved so clusters map back. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** UAX #24 script name, e.g. `Latin`, `Arabic`. */
  readonly script: string;
  /** UAX #9 embedding level. Odd is right-to-left. */
  readonly level: number;
  readonly rtl: boolean;
  readonly font: LoadedFont;
}

/**
 * A HarfBuzz script tag from a UAX #24 script name.
 *
 * HarfBuzz wants the four-letter ISO 15924 tag; `unicode-properties` reports the
 * long name. Only the scripts a broadcast graphic realistically carries are
 * mapped; anything else falls back to letting HarfBuzz guess from the buffer,
 * which is right far more often than a wrong explicit tag would be.
 */
const SCRIPT_TAGS: Record<string, string> = {
  Latin: "Latn",
  Common: "Latn",
  Inherited: "Latn",
  Cyrillic: "Cyrl",
  Greek: "Grek",
  Arabic: "Arab",
  Hebrew: "Hebr",
  Thai: "Thai",
  Hangul: "Hang",
  Han: "Hani",
  Hiragana: "Hira",
  Katakana: "Kana",
  Devanagari: "Deva",
  Bengali: "Beng",
  Tamil: "Taml",
  Georgian: "Geor",
  Armenian: "Armn",
};

export function scriptTagFor(script: string): string {
  return SCRIPT_TAGS[script] ?? "Latn";
}

/**
 * UAX #9 embedding levels for a paragraph.
 *
 * `base` is the paragraph direction. `"auto"` applies the UAX #9 P2/P3 rule —
 * the first strong character decides — which is what a data-driven name field
 * needs, because the same node renders an English name today and an Arabic one
 * tomorrow and nobody re-authors the graphic in between.
 */
export function embeddingLevels(
  text: string,
  base: "ltr" | "rtl" | "auto" = "auto",
): Uint8Array {
  if (text.length === 0) return new Uint8Array(0);
  return bidi.getEmbeddingLevels(text, base).levels;
}

/**
 * Stages 2 and 3 together: itemize by script, direction and font.
 *
 * They are one pass because they cut the same string and their boundaries
 * interleave. Running them separately would mean merging two boundary sets,
 * which is the same work with a chance to disagree.
 *
 * A run breaks when ANY of script, bidi level, or resolved font changes. The
 * font boundary matters as much as the other two: a Latin name with one Arabic
 * word resolves to two fonts, and shaping the pair as one run would render half
 * of it from a font that has no glyphs for it.
 */
export function itemize(
  text: string,
  stack: FontStack,
  base: "ltr" | "rtl" | "auto" = "auto",
): readonly TextRun[] {
  if (text.length === 0) return [];

  const levels = embeddingLevels(text, base);
  const runs: TextRun[] = [];

  let index = 0;
  while (index < text.length) {
    const codepoint = text.codePointAt(index)!;
    const width = codepoint > 0xffff ? 2 : 1;
    const script = getScript(codepoint);
    const level = levels[index] ?? 0;
    const font = stack.fontFor(codepoint);

    const last = runs[runs.length - 1];
    // `Common` and `Inherited` — spaces, digits, punctuation, combining marks —
    // join the run they sit in rather than starting one. Without this "2-1"
    // becomes three runs and a combining accent is separated from its base,
    // which breaks the mark positioning HarfBuzz would otherwise do.
    const joins =
      last !== undefined &&
      last.level === level &&
      last.font === font &&
      (last.script === script || script === "Common" || script === "Inherited");

    if (joins) {
      runs[runs.length - 1] = {
        ...last!,
        end: index + width,
        text: last!.text + text.slice(index, index + width),
      };
    } else {
      runs.push({
        start: index,
        end: index + width,
        text: text.slice(index, index + width),
        script,
        level,
        rtl: (level & 1) === 1,
        font,
      });
    }
    index += width;
  }

  // A run that is entirely Common — a leading space, a lone digit — inherits the
  // script of the run before it, so it shapes with the same font rather than
  // opening a run with no script of its own.
  return runs.map((run, at) =>
    run.script === "Common" || run.script === "Inherited"
      ? { ...run, script: runs[at - 1]?.script ?? "Latin" }
      : run,
  );
}

/**
 * Stage 5 — UAX #14 line break opportunities.
 *
 * Returns indices at which a line MAY break, plus whether each is mandatory.
 * Thai and Khmer have no spaces at all, so splitting on `" "` produces one
 * unbreakable run and a name that overflows its box with nothing the layout can
 * do about it.
 */
export interface BreakOpportunity {
  /** Index just past the last character of the segment. */
  readonly position: number;
  /** A newline. The layout must break here, not merely may. */
  readonly required: boolean;
}

export function breakOpportunities(text: string): readonly BreakOpportunity[] {
  if (text.length === 0) return [];
  const breaker = new LineBreaker(text);
  const out: BreakOpportunity[] = [];
  let next = breaker.nextBreak();
  while (next !== null) {
    out.push({ position: next.position, required: next.required });
    next = breaker.nextBreak();
  }
  return out;
}

/**
 * Reorders logical runs into visual order. UAX #9 rule L2.
 *
 * Reverse each maximal sequence at or above every level, from the highest level
 * down to the lowest odd level. That is the whole rule, and doing it on RUNS
 * rather than on characters is what keeps shaping intact — a run has already
 * been shaped as a unit, and reversing inside it would scatter its glyphs.
 */
export function reorderVisual<T extends { readonly level: number }>(
  runs: readonly T[],
): readonly T[] {
  if (runs.length < 2) return runs;

  const out = [...runs];
  let highest = 0;
  let lowestOdd = 255;
  for (const run of runs) {
    if (run.level > highest) highest = run.level;
    if ((run.level & 1) === 1 && run.level < lowestOdd) lowestOdd = run.level;
  }
  if (lowestOdd > highest) return out;

  for (let level = highest; level >= lowestOdd; level -= 1) {
    let start = -1;
    for (let index = 0; index <= out.length; index += 1) {
      const inRange = index < out.length && out[index]!.level >= level;
      if (inRange && start === -1) start = index;
      else if (!inRange && start !== -1) {
        reverseInPlace(out, start, index - 1);
        start = -1;
      }
    }
  }
  return out;
}

function reverseInPlace<T>(items: T[], from: number, to: number): void {
  let low = from;
  let high = to;
  while (low < high) {
    const swap = items[low]!;
    items[low] = items[high]!;
    items[high] = swap;
    low += 1;
    high -= 1;
  }
}
