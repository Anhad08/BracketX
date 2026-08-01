/**
 * Ambient declarations for the vendored Unicode libraries.
 *
 * Three of the four dependencies the text pipeline needs ship no TypeScript
 * types: bidi-js, linebreak, and unicode-properties. Only harfbuzzjs does.
 *
 * These are not a convenience. The T1 spike lost time to a silent shaping
 * failure — `setDirection("ltr")` against a numeric enum — which tsc catches
 * as TS2345 and vitest does not, because vitest never typechecks. Untyped
 * boundaries are where that class of bug lives, so every one of them gets a
 * declaration before it gets a caller.
 *
 * Scoped to what the pipeline actually uses. Declaring the full surface of a
 * library we call four functions on would be maintenance with no reader.
 */

declare module "bidi-js" {
  /** UAX #9 embedding levels for a paragraph. */
  export interface EmbeddingLevels {
    /** One resolved level per UTF-16 code unit. Odd is right-to-left. */
    readonly levels: Uint8Array;
    readonly paragraphs: readonly {
      readonly start: number;
      readonly end: number;
      readonly level: number;
    }[];
  }

  export interface Bidi {
    getEmbeddingLevels(
      text: string,
      defaultDirection?: "ltr" | "rtl" | "auto",
    ): EmbeddingLevels;
    /**
     * Index ranges that must be reversed to get visual order, outermost last.
     * Applied in order, they turn logical order into display order.
     */
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][];
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string;
    getMirroredCharacter(char: string): string | null;
  }

  export default function bidiFactory(): Bidi;
}

declare module "linebreak" {
  /** A UAX #14 break opportunity. */
  export interface Break {
    /** Index just past the last character of the segment. */
    readonly position: number;
    /** True for a mandatory break (newline), false for an allowed one. */
    readonly required: boolean;
  }

  export default class LineBreaker {
    constructor(text: string);
    /** Next opportunity, or null at the end of the text. */
    nextBreak(): Break | null;
  }
}

declare module "unicode-properties" {
  /** UAX #24 script name, e.g. "Latin", "Arabic", "Common". */
  export function getScript(codePoint: number): string;
  export function getCategory(codePoint: number): string;
  export function getCombiningClass(codePoint: number): string;
  export function getEastAsianWidth(codePoint: number): string;
  export function getNumericValue(codePoint: number): number | null;
  export function isAlphabetic(codePoint: number): boolean;
  export function isDigit(codePoint: number): boolean;
  export function isMark(codePoint: number): boolean;
  export function isWhiteSpace(codePoint: number): boolean;
}
