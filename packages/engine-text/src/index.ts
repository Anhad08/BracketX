/* eslint-disable @typescript-eslint/triple-slash-reference --
   The rule's advice ("use import style") cannot apply here: `vendor.d.ts` holds
   AMBIENT `declare module` blocks for three untyped libraries, and an ambient
   declaration file must not be a module — so it cannot be imported. A
   triple-slash reference is the designed mechanism for exactly this case, and
   it is load-bearing: without it a consumer compiling these sources reports
   three implicit-any errors for modules this package has already declared. */
/// <reference path="./vendor.d.ts" />
/* eslint-enable @typescript-eslint/triple-slash-reference */
/**
 * @bracketx/engine-text — the text pipeline, stages 1 to 8.
 *
 * The reference above is load-bearing. This package exports SOURCE, so a
 * consumer typechecks these files in its own program — and the ambient module
 * declarations for the three untyped Unicode libraries live in a `.d.ts` that
 * nothing imports. Without the reference, `engine-host` compiles `segment.ts`
 * and reports three implicit-any errors for modules this package has already
 * declared.
 *
 * `engine-core`, per tools/engine-layers.mjs. It depends on the scene graph for
 * types and on nothing else: no renderer, no GPU context, no DOM. That is what
 * lets the same layout run in Chrome, in OBS's CEF, in a headless cloud render
 * and in the native runtime — TEXT_ENGINE §1.
 *
 * The public surface is deliberately small. A consumer loads fonts, builds a
 * stack, and calls `render`; everything else is an implementation detail that
 * exists so the verification suite can assert on one stage at a time.
 */
export const ENGINE_PACKAGE = { name: "@bracketx/engine-text", layer: "engine-core" } as const;

export { LoadedFont, FontStack } from "./font";
export type { FontMetrics, GlyphExtents, PathCommand } from "./font";

export {
  breakOpportunities,
  embeddingLevels,
  itemize,
  reorderVisual,
  scriptTagFor,
} from "./segment";
export type { BreakOpportunity, TextRun } from "./segment";

export { Shaper } from "./shape";
export type { ShapedGlyph, ShapedRun } from "./shape";

export { alignmentOffset, layoutKey, layoutText } from "./layout";
export type {
  FitMode,
  LaidOutLine,
  PlacedGlyph,
  TextAlign,
  TextBox,
  TextFit,
  TextLayout,
  TextSpec,
  VerticalAlign,
} from "./layout";

export { generateMsdf, median } from "./msdf";
export type { MsdfGlyph, MsdfOptions } from "./msdf";

export { GlyphAtlas } from "./atlas";
export type { AtlasEntry, AtlasOptions, AtlasPage } from "./atlas";

export { TextEngine } from "./engine";
export type {
  EmitOptions,
  TextEngineOptions,
  TextGeometry,
  TextResult,
} from "./engine";

export { TEXT_RANGES, expandPrewarm } from "./ranges";

// -- Editing primitives — UAX #29 -------------------------------------------
//
// The unit every caret, selection and clipboard operation is defined on. Text
// EDITING lives here rather than in Studio so the same behaviour serves any
// consumer that renders text — the alternative is a second text model.

export {
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
export type { GraphemeBoundaries, WordClass, WordRange } from "./grapheme";
