import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { FontStack, LoadedFont } from "./font";
import { breakOpportunities, embeddingLevels, itemize, reorderVisual } from "./segment";
import { Shaper } from "./shape";
import { layoutKey, layoutText, type TextSpec } from "./layout";
import { generateMsdf, median } from "./msdf";
import { GlyphAtlas } from "./atlas";
import { TextEngine } from "./engine";

/**
 * Text engine verification. TEXT_ENGINE §8.
 *
 * ============================================================================
 * THE FAILURE MODE THIS SUITE IS BUILT AROUND
 * ============================================================================
 * Text that appears is not text that is correct. Every hard bug in this
 * subsystem renders something:
 *
 *   shaping silently off   → Arabic in isolated forms. Looks like a bad font.
 *   bidi missing           → a Hebrew name backwards. Looks like bad data.
 *   wrong cmap             → a .notdef box. Looks like a missing glyph.
 *   float-accumulated advances → a word 2px wider on one target than another.
 *
 * So almost nothing here asserts "text appeared". Each assertion is chosen to
 * FAIL under a specific plausible wrong implementation, and the comment says
 * which one.
 *
 * ============================================================================
 * FONTS ARE VENDORED, NOT READ FROM THE SYSTEM
 * ============================================================================
 * The T1 spike read `C:/Windows/Fonts`, which meant it could not run in CI and
 * quietly SKIPPED when a font was missing — a test that passes by not running.
 * These are OFL fonts committed under `fixtures/fonts`, so a golden layout is a
 * real golden layout.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/fonts/", import.meta.url));

function load(id: string, file: string): LoadedFont {
  return new LoadedFont(id, new Uint8Array(readFileSync(FIXTURES + file)));
}

let inter: LoadedFont;
let arabic: LoadedFont;
let thai: LoadedFont;
let hebrew: LoadedFont;
let stack: FontStack;

beforeAll(() => {
  inter = load("inter", "inter-latin-400.ttf");
  arabic = load("arabic", "noto-arabic-400.ttf");
  thai = load("thai", "noto-thai-400.ttf");
  hebrew = load("hebrew", "noto-hebrew-400.ttf");
  stack = new FontStack([inter, arabic, hebrew, thai]);
});

const BASE: Omit<TextSpec, "content"> = {
  size: 48,
  align: "start",
  verticalAlign: "top",
  lineHeight: 1.2,
  box: { width: 600, height: 200 },
  fit: { mode: "wrap" },
  direction: "auto",
};

function spec(content: string, over: Partial<TextSpec> = {}): TextSpec {
  return { ...BASE, content, ...over };
}

// ===========================================================================
// Stage 1 — fonts
// ===========================================================================

describe("fonts", () => {
  it("parses metrics and outlines from HarfBuzz, with no second parser", () => {
    // TEXT_ENGINE §10 planned to vendor opentype.js alongside HarfBuzz. It is
    // unnecessary, and two parsers would be two sources of truth for the cmap —
    // a glyph that shapes with one and rasterises with the other is a .notdef
    // in the middle of a name.
    expect(inter.metrics.upem).toBe(2048);
    expect(inter.metrics.ascender).toBeGreaterThan(0);
    expect(inter.metrics.descender).toBeLessThan(0);

    const a = inter.glyphFor("A".codePointAt(0)!);
    expect(a).toBeGreaterThan(0);
    expect(inter.advanceOf(a)).toBeGreaterThan(0);
    expect(Number.isInteger(inter.advanceOf(a))).toBe(true);
    expect(inter.outlineOf(a).length).toBeGreaterThan(3);
  });

  it("resolves a fallback chain by cmap, in declared order", () => {
    // Declared, never discovered. A platform that picked its own fallback would
    // render a name in Chrome and box it in a cloud render.
    expect(stack.fontFor("A".codePointAt(0)!)).toBe(inter);
    expect(stack.fontFor("م".codePointAt(0)!)).toBe(arabic);
    expect(stack.fontFor("א".codePointAt(0)!)).toBe(hebrew);
    expect(stack.fontFor("ป".codePointAt(0)!)).toBe(thai);
  });

  it("returns a visible .notdef rather than substituting silently", () => {
    // TEXT_ENGINE §3. A plausible-looking wrong glyph is worse on air than a
    // box that is obviously wrong, because nobody catches the first one.
    const latinOnly = new FontStack([inter]);
    const korean = "한".codePointAt(0)!;
    expect(latinOnly.fontFor(korean)).toBe(inter);
    expect(inter.glyphFor(korean)).toBe(0);
    expect(latinOnly.missing("한글")).toHaveLength(2);
    // And a chain that CAN draw it reports nothing missing.
    expect(stack.missing("ALEX محمد")).toEqual([]);
  });
});

// ===========================================================================
// Stages 2, 3, 5 — the Unicode annexes
// ===========================================================================

describe("itemization, bidi and line breaking", () => {
  it("splits by script, level and font in one pass", () => {
    const runs = itemize("Score 2-1 محمد", stack, "auto");
    expect(runs.length).toBeGreaterThan(1);
    // "2-1" must NOT become three runs: Common characters join the run they sit
    // in, or a digit sequence is shaped in three pieces and loses its kerning.
    const latin = runs.find((run) => run.font === inter)!;
    expect(latin.text).toContain("2-1");
    const arabicRun = runs.find((run) => run.font === arabic)!;
    expect(arabicRun.rtl).toBe(true);
    expect(latin.rtl).toBe(false);
  });

  it("resolves bidirectional order (UAX #9)", () => {
    // The failure this prevents: an Arabic name rendered left-to-right, which
    // is not "slightly wrong", it is unreadable.
    const levels = embeddingLevels("محمد صلاح 2-1 LIVERPOOL", "auto");
    expect(levels.length).toBe("محمد صلاح 2-1 LIVERPOOL".length);
    expect(levels[0]! & 1).toBe(1); // Arabic — odd level, RTL.
    expect([...levels].some((level) => (level & 1) === 0)).toBe(true);
  });

  it("reorders runs by level, highest first (rule L2)", () => {
    const runs = [{ level: 0 }, { level: 1 }, { level: 1 }, { level: 0 }];
    const ordered = reorderVisual(runs);
    // The two level-1 runs swap; the level-0 runs do not move.
    expect(ordered).toEqual([runs[0], runs[2], runs[1], runs[3]]);
    expect(reorderVisual([{ level: 0 }])).toHaveLength(1);
  });

  it("finds word breaks where they exist", () => {
    const breaks = breakOpportunities("Manchester United versus Liverpool");
    expect(breaks.length).toBeGreaterThan(2);
    expect(breaks.every((entry) => entry.position > 0)).toBe(true);
  });

  it("finds NO breaks inside Thai, which is the annex's own limit", () => {
    // Not a bug in the vendored library: UAX #14 leaves Thai, Khmer, Lao and
    // Burmese to dictionary segmentation, which it does not define. Asserted
    // so the limitation is a recorded fact rather than a surprise — the T1
    // spike's Thai assertion passed on the break at the END of the string,
    // which is not a wrap opportunity at all. See IF-004.
    const thaiText = "ประเทศไทยสวยงามมาก";
    const breaks = breakOpportunities(thaiText);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.position).toBe(thaiText.length);
  });
});

// ===========================================================================
// Stage 4 — shaping
// ===========================================================================

describe("shaping", () => {
  it("is more than a cmap lookup", () => {
    // THE assertion that catches shaping silently failing. `setDirection` given
    // a string instead of the numeric enum makes hb_shape bail and return the
    // original codepoints with zero advances — text still appears, unkerned and
    // in isolated forms. This fails the moment that happens.
    const shaper = new Shaper();
    const inContext = shaper.run(itemize("محمد", stack, "rtl")[0]!);
    const isolated = [..."محمد"].map(
      (character) => shaper.run(itemize(character, stack, "rtl")[0]!).glyphs[0]!.glyph,
    );
    expect(inContext.glyphs.map((glyph) => glyph.glyph)).not.toEqual(isolated);
    expect(inContext.width).toBeGreaterThan(0);
  });

  it("returns integers in font units, never accumulated floats", () => {
    // TEXT_ENGINE §8.3. A float total over a long string drifts, and the drift
    // differs between targets — which is a different line break, not a
    // different pixel.
    const shaper = new Shaper();
    const run = shaper.run(itemize("Manchester United", stack, "ltr")[0]!);
    expect(run.glyphs.every((glyph) => Number.isInteger(glyph.xAdvance))).toBe(true);
    expect(Number.isInteger(run.width)).toBe(true);
  });

  it("caches whole runs, which is what a repeat and a re-render reuse", () => {
    // What the cache is ACTUALLY worth, measured rather than assumed.
    //
    // Itemization merges Latin letters, digits and punctuation into ONE run —
    // "LIVERPOOL 2" is a single run, not two — so changing the score changes
    // the run and misses. Sub-word caching is not what this buys, and an
    // earlier version of this comment claimed it did.
    //
    // What it does buy: every OTHER node re-renders for free. A leaderboard of
    // eight rows sharing a label shapes it once, and a scoreboard whose score
    // changes reshapes the score node while the team names hit.
    const shaper = new Shaper();
    for (let row = 0; row < 8; row += 1) {
      itemize("POINTS", stack, "ltr").forEach((run) => shaper.run(run));
    }
    expect(shaper.stats().misses).toBe(1);
    expect(shaper.stats().hits).toBe(7);

    // A changed run is a miss, honestly.
    itemize("LIVERPOOL 2", stack, "ltr").forEach((run) => shaper.run(run));
    itemize("LIVERPOOL 3", stack, "ltr").forEach((run) => shaper.run(run));
    expect(shaper.stats().misses).toBe(3);
  });

  it("evicts rather than growing without bound", () => {
    const shaper = new Shaper(4);
    for (let index = 0; index < 20; index += 1) {
      shaper.run(itemize(`name ${index}`, stack, "ltr")[0]!);
    }
    expect(shaper.stats().size).toBeLessThanOrEqual(4);
  });
});

// ===========================================================================
// Stages 6, 7 — layout and fit
// ===========================================================================

describe("layout and fit", () => {
  it("is deterministic across repeated calls and fresh objects", () => {
    // TEXT_ENGINE §8.1. Same-process repetition is the weakest form of this and
    // the only one testable without a second runtime; cross-target stays
    // Unknown until the native runtime exists, and the report says so.
    const once = layoutText(spec("ALEX RIVERA"), stack, new Shaper());
    const twice = layoutText(spec("ALEX RIVERA"), stack, new Shaper());
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("matches a committed golden layout", () => {
    // The real determinism test: exact glyph positions against a snapshot. A
    // change to any stage that moves a glyph fails here, which is what makes
    // "identical to the last decimal" enforceable rather than aspirational.
    const layout = layoutText(spec("ALEX RIVERA"), stack, new Shaper());
    const positions = layout.lines[0]!.glyphs.map((glyph) =>
      `${glyph.glyph}@${glyph.x.toFixed(4)}`,
    );
    expect(positions).toEqual([
      "2@0.0000",
      "55@33.1172",
      "23@60.2578",
      "117@89.1094",
      "461@121.8516",
      "87@135.3516",
      "41@166.2422",
      "109@179.1328",
      "23@212.2500",
      "87@241.1016",
      "2@271.9922",
    ]);
    // The same letter must be the same glyph at both occurrences — "A" opens
    // and closes the string, "R" appears twice. A shaper that lost its cluster
    // mapping would produce two different ids for one letter.
    expect(positions[0]!.split("@")[0]).toBe(positions[10]!.split("@")[0]);
    expect(positions[2]!.split("@")[0]).toBe(positions[8]!.split("@")[0]);
    expect(layout.width).toBeCloseTo(305.109, 3);
  });

  it("wraps within the box", () => {
    const wrapped = layoutText(
      spec("Manchester United versus Liverpool Football Club", {
        box: { width: 300, height: 400 },
      }),
      stack,
      new Shaper(),
    );
    expect(wrapped.lines.length).toBeGreaterThan(1);
    // Every line, not just the widest — one overflowing line is enough to paint
    // over the graphic beside it.
    for (const line of wrapped.lines) expect(line.width).toBeLessThanOrEqual(300);
  });

  it("does not wrap because of a trailing space", () => {
    // A line ending in a space must not break on the space's width. Not doing
    // this produces a ragged edge one space wider than the box, on random lines.
    const tight = layoutText(
      spec("aaa bbb", { box: { width: 175, height: 400 }, size: 48 }),
      stack,
      new Shaper(),
    );
    expect(tight.lines.length).toBeGreaterThanOrEqual(1);
    for (const line of tight.lines) expect(line.width).toBeLessThanOrEqual(175);
  });

  it("shrinks deterministically, on a quantised grid", () => {
    // TEXT_ENGINE §6: "loop until it fits" is not reproducible, because two
    // targets take a different number of float steps and settle on different
    // sizes — and the size decides the line breaks.
    const shrunk = layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 300, height: 60 },
        fit: { mode: "shrink", minSize: 12 },
      }),
      stack,
      new Shaper(),
    );
    expect(shrunk.size).toBeLessThan(48);
    expect(shrunk.width).toBeLessThanOrEqual(300);
    // On the 0.25 grid, exactly.
    expect(shrunk.size * 4).toBe(Math.round(shrunk.size * 4));
    // And identical from a fresh shaper, which is the property that matters.
    const again = layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 300, height: 60 },
        fit: { mode: "shrink", minSize: 12 },
      }),
      stack,
      new Shaper(),
    );
    expect(again.size).toBe(shrunk.size);
  });

  it("never grows text to fill a box", () => {
    // A name that got BIGGER when it got shorter would make a sequence of
    // graphics visibly inconsistent, which is worse than one that is small.
    const short = layoutText(
      spec("Li", { box: { width: 600, height: 200 }, fit: { mode: "shrink", minSize: 12 } }),
      stack,
      new Shaper(),
    );
    expect(short.size).toBe(48);
  });

  it("reports truncation rather than shrinking past the floor", () => {
    const impossible = layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 40, height: 20 },
        fit: { mode: "shrink", minSize: 24 },
      }),
      stack,
      new Shaper(),
    );
    expect(impossible.truncated).toBe(true);
    expect(impossible.size).toBeGreaterThanOrEqual(24);
  });

  it("truncates with one ellipsis, at a cluster boundary, inside the box", () => {
    const truncated = layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 200, height: 60 },
        fit: { mode: "truncate" },
      }),
      stack,
      new Shaper(),
    );
    expect(truncated.truncated).toBe(true);
    // The reported width is RECOMPUTED after trimming. Carrying the pre-trim
    // width forward would have the layout claim it overflows a box it now fits.
    expect(truncated.width).toBeLessThanOrEqual(200);
    const last = truncated.lines[0]!.glyphs.at(-1)!;
    expect(last.glyph).toBe(inter.glyphFor(0x2026));
    // One ellipsis glyph, not three periods: three periods are three advances
    // and do not kern as an ellipsis does.
    const ellipses = truncated.lines[0]!.glyphs.filter(
      (glyph) => glyph.glyph === inter.glyphFor(0x2026),
    );
    expect(ellipses).toHaveLength(1);
  });

  it("overflows only when the author asked for it", () => {
    const over = layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 100, height: 60 },
        fit: { mode: "overflow" },
      }),
      stack,
      new Shaper(),
    );
    expect(over.overflowed).toBe(true);
    expect(over.truncated).toBe(false);
    expect(over.width).toBeGreaterThan(100);
    expect(over.lines).toHaveLength(1);
  });

  it("breaks Thai with no opportunity, and says so", () => {
    // The honest outcome. Overflowing would paint over the graphic beneath, so
    // the engine breaks somewhere linguistically wrong AND reports it, letting a
    // pre-flight warn instead of a designer finding out on air. IF-004.
    const thaiLayout = layoutText(
      spec("ประเทศไทยสวยงามมาก", { box: { width: 150, height: 400 } }),
      stack,
      new Shaper(),
    );
    expect(thaiLayout.lines.length).toBeGreaterThan(1);
    expect(thaiLayout.brokeWithoutOpportunity).toBe(true);
    for (const line of thaiLayout.lines) expect(line.width).toBeLessThanOrEqual(150);

    // English, by contrast, breaks at real opportunities and does NOT report it.
    const english = layoutText(
      spec("Manchester United versus Liverpool", { box: { width: 300, height: 400 } }),
      stack,
      new Shaper(),
    );
    expect(english.brokeWithoutOpportunity).toBe(false);
  });

  it("obeys maxLines and the box height together", () => {
    const capped = layoutText(
      spec("one two three four five six seven eight", {
        box: { width: 120, height: 1000 },
        maxLines: 2,
      }),
      stack,
      new Shaper(),
    );
    expect(capped.lines).toHaveLength(2);
    expect(capped.truncated).toBe(true);

    // No maxLines, but a short box: the height is the cap, or a third line
    // paints over whatever is beneath it.
    const short = layoutText(
      spec("one two three four five six seven eight", {
        box: { width: 120, height: 120 },
      }),
      stack,
      new Shaper(),
    );
    expect(short.lines.length).toBeLessThanOrEqual(2);
    expect(short.height).toBeLessThanOrEqual(120);
  });

  it("keys the cache on everything the result depends on, and nothing else", () => {
    // Alignment is applied as an offset afterwards, so two nodes differing only
    // in alignment share one layout. Including it would halve the hit rate for
    // no gain.
    const left = spec("SAME");
    const right = spec("SAME", { align: "end" });
    expect(layoutKey(left, stack)).toBe(layoutKey(right, stack));
    expect(layoutKey(left, stack)).not.toBe(layoutKey(spec("OTHER"), stack));
    expect(layoutKey(left, stack)).not.toBe(
      layoutKey(spec("SAME", { size: 24 }), stack),
    );
  });

  it("lays out an empty string without inventing a line", () => {
    const empty = layoutText(spec(""), stack, new Shaper());
    expect(empty.lines).toEqual([]);
    expect(empty.width).toBe(0);
    expect(empty.glyphs).toEqual([]);
  });
});

// ===========================================================================
// Stage 8 — MSDF and the atlas
// ===========================================================================

describe("MSDF generation", () => {
  it("reconstructs inside and outside through the median", () => {
    // The only assertion that shows the field is CORRECT rather than merely
    // non-empty. A stem's centre must read inside; a corner of the padded box
    // must read outside.
    const glyph = inter.glyphFor("I".codePointAt(0)!);
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 32,
      pxRange: 4,
    })!;
    expect(field).not.toBeNull();

    const at = (x: number, y: number) => {
      const offset = (y * field.width + x) * 4;
      return median(field.pixels[offset]!, field.pixels[offset + 1]!, field.pixels[offset + 2]!);
    };
    expect(at(Math.floor(field.width / 2), Math.floor(field.height / 2))).toBeGreaterThan(127);
    expect(at(0, 0)).toBeLessThan(127);
    expect(at(field.width - 1, field.height - 1)).toBeLessThan(127);
  });

  it("keeps a counter hollow", () => {
    // A letter O whose middle reads "inside" means the winding rule is wrong —
    // even-odd instead of non-zero, or an unclosed contour. The glyph would
    // render as a filled blob and look like a font problem.
    const glyph = inter.glyphFor("O".codePointAt(0)!);
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 32,
      pxRange: 4,
    })!;
    const offset = (Math.floor(field.height / 2) * field.width + Math.floor(field.width / 2)) * 4;
    expect(
      median(field.pixels[offset]!, field.pixels[offset + 1]!, field.pixels[offset + 2]!),
    ).toBeLessThan(127);
  });

  it("returns null for a glyph with no outline", () => {
    // A space occupies advance and no atlas area. Reserving a slot for every
    // whitespace glyph in a script would fill a page with nothing.
    const space = inter.glyphFor(32);
    expect(generateMsdf(inter.outlineOf(space), inter.metrics.upem, { size: 32, pxRange: 4 })).toBeNull();
  });

  it("pads the field by the distance range on every side", () => {
    // Without the padding the ramp is clipped at the ink boundary and the
    // shader cannot antialias the outer edge — the glyph gets a hard edge that
    // aliases on every diagonal.
    const glyph = inter.glyphFor("I".codePointAt(0)!);
    const extents = inter.extentsOf(glyph)!;
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 32,
      pxRange: 4,
    })!;
    const inkWidth = Math.abs(extents.width);
    expect(field.right - field.left).toBeGreaterThan(inkWidth);
  });
});

describe("the glyph atlas", () => {
  it("buckets sizes to powers of root two", () => {
    // Without bucketing a scale animation regenerates every glyph every frame:
    // 48.0, 48.3 and 48.7 are three keys. With it, 24 to 96 touches three.
    const buckets = [24, 30, 40, 48, 64, 90, 96].map(GlyphAtlas.bucketFor);
    expect(new Set(buckets).size).toBeLessThan(buckets.length);
    expect(GlyphAtlas.bucketFor(48)).toBe(GlyphAtlas.bucketFor(50));
    // Never zero: a graphic animating its scale through zero would ask for a
    // zero-texel field.
    expect(GlyphAtlas.bucketFor(0)).toBe(1);
    expect(GlyphAtlas.bucketFor(-5)).toBe(1);
    expect(GlyphAtlas.bucketFor(NaN)).toBe(1);
  });

  it("packs, finds, and reports", () => {
    const atlas = new GlyphAtlas({ pageSize: 256, pxRange: 4 });
    const glyph = inter.glyphFor("A".codePointAt(0)!);
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 32,
      pxRange: 4,
    })!;

    const entry = atlas.add("inter", glyph, 32, field)!;
    expect(entry.width).toBe(field.width);
    expect(atlas.get("inter", glyph, 32)).toEqual(entry);
    // A different bucket is a different glyph, or a 24pt and a 96pt A would
    // share one field and one of them would be blurry.
    expect(atlas.get("inter", glyph, 64)).toBeUndefined();
    expect(atlas.stats().glyphs).toBe(1);
  });

  it("evicts under pressure, which is a normal operating mode", () => {
    // TEXT_ENGINE §5. A 2048² page holds a few hundred CJK glyphs and a Korean
    // name is routine, so this path runs ON AIR and is tested as normal rather
    // than as an error. Forced here with a small page and many Latin glyphs:
    // the mechanism is identical and the test is deterministic.
    const atlas = new GlyphAtlas({ pageSize: 64, pxRange: 2 });
    const set = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (const character of set) {
      const glyph = inter.glyphFor(character.codePointAt(0)!);
      const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
        size: 16,
        pxRange: 2,
      });
      if (field !== null) atlas.add("inter", glyph, 16, field);
    }
    const stats = atlas.stats();
    expect(stats.evictions).toBeGreaterThan(0);
    expect(stats.glyphs).toBeGreaterThan(0);
    expect(stats.pages).toBeLessThanOrEqual(2);
  });

  it("never evicts a pinned glyph", () => {
    // ENGINE_RUNTIME §4.4. An evicted glyph that is on screen blanks a
    // character mid-broadcast, which is the worst thing this subsystem can do.
    const atlas = new GlyphAtlas({ pageSize: 64, pxRange: 2 });
    const add = (character: string) => {
      const glyph = inter.glyphFor(character.codePointAt(0)!);
      const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
        size: 16,
        pxRange: 2,
      });
      return field === null ? null : atlas.add("inter", glyph, 16, field);
    };

    add("A");
    const pinnedKey = GlyphAtlas.keyFor("inter", inter.glyphFor(65), 16);
    atlas.pin([pinnedKey]);

    for (const character of "BCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
      add(character);
    }
    expect(atlas.stats().evictions).toBeGreaterThan(0);
    expect(atlas.has("inter", inter.glyphFor(65), 16)).toBe(true);
  });

  it("counts pins, so one output going off air does not unpin another's", () => {
    const atlas = new GlyphAtlas({ pageSize: 256, pxRange: 2 });
    const glyph = inter.glyphFor(65);
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 16,
      pxRange: 2,
    })!;
    atlas.add("inter", glyph, 16, field);
    const key = GlyphAtlas.keyFor("inter", glyph, 16);

    atlas.pin([key]);
    atlas.pin([key]);
    atlas.unpin([key]);
    expect(atlas.stats().pinned).toBe(1);
    atlas.unpin([key]);
    expect(atlas.stats().pinned).toBe(0);
    // Unpinning past zero must not go negative and make it un-unpinnable.
    atlas.unpin([key]);
    expect(atlas.stats().pinned).toBe(0);
  });

  it("reports dirty regions once, for in-place texture updates", () => {
    const atlas = new GlyphAtlas({ pageSize: 256, pxRange: 2 });
    const glyph = inter.glyphFor(65);
    const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
      size: 16,
      pxRange: 2,
    })!;
    atlas.add("inter", glyph, 16, field);

    const first = atlas.flush();
    expect(first).toHaveLength(1);
    expect(first[0]!.regions).toHaveLength(1);
    // Flushed regions are cleared, or every frame re-uploads the whole atlas.
    expect(atlas.flush()).toHaveLength(0);
  });
});

// ===========================================================================
// The engine, end to end
// ===========================================================================

describe("the text engine", () => {
  function engine(): { engine: TextEngine; stack: FontStack } {
    const created = new TextEngine({ pageSize: 512, pxRange: 4 });
    created.addFont("inter", new Uint8Array(readFileSync(FIXTURES + "inter-latin-400.ttf")));
    created.addFont("arabic", new Uint8Array(readFileSync(FIXTURES + "noto-arabic-400.ttf")));
    return { engine: created, stack: created.stack(["inter", "arabic"])! };
  }

  it("emits one quad per drawable glyph, and none for whitespace", () => {
    const { engine: text, stack: fonts } = engine();
    const result = text.render(spec("ALEX RIVERA"), fonts, { scale: 1 });
    const quads = result.geometry.reduce((sum, geometry) => sum + geometry.quadCount, 0);
    // 11 characters, one space.
    expect(quads).toBe(10);
    expect(result.geometry[0]!.positions).toHaveLength(10 * 4 * 3);
    expect(result.geometry[0]!.indices).toHaveLength(10 * 6);
  });

  it("emits UVs inside the atlas", () => {
    const { engine: text, stack: fonts } = engine();
    const result = text.render(spec("ALEX"), fonts, { scale: 1 });
    for (const uv of result.geometry[0]!.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
  });

  it("is one pipeline: world and screen differ only by a scale", () => {
    // TEXT_ENGINE §6. The same string must break at the same word and shrink to
    // the same size whether it is drawn at 1080p or three metres from a camera.
    const { engine: text, stack: fonts } = engine();
    const content = spec("Manchester United versus Liverpool", {
      box: { width: 300, height: 400 },
    });
    const screen = text.render(content, fonts, { scale: 1 });
    const world = text.render(content, fonts, { scale: 0.01 });

    expect(world.layout.lines.length).toBe(screen.layout.lines.length);
    expect(world.layout.size).toBe(screen.layout.size);
    expect(world.geometry[0]!.positions[0]).toBeCloseTo(
      screen.geometry[0]!.positions[0]! * 0.01,
      6,
    );
  });

  it("caches layout, so a re-render costs nothing", () => {
    const { engine: text, stack: fonts } = engine();
    text.render(spec("LIVERPOOL"), fonts, { scale: 1 });
    const misses = text.stats().layoutMisses;
    text.render(spec("LIVERPOOL"), fonts, { scale: 1 });
    expect(text.stats().layoutMisses).toBe(misses);
    expect(text.stats().layoutHits).toBeGreaterThan(0);
  });

  it("pre-warms a character set before anything is on screen", () => {
    // §5: pre-warm converts the common case from a mid-show spike into
    // load-time cost, which is the only acceptable place for it.
    const { engine: text, stack: fonts } = engine();
    const added = text.prewarm("ABCDEFGHIJ", fonts, 32);
    expect(added).toBe(10);
    expect(text.stats().atlas.glyphs).toBe(10);
    // Rendering text made of pre-warmed glyphs adds nothing.
    const before = text.stats().atlas.glyphs;
    text.render(spec("ABC", { size: 32 }), fonts, { scale: 1 });
    expect(text.stats().atlas.glyphs).toBe(before);
  });

  it("renders a novel glyph on demand, because live text will hit one", () => {
    const { engine: text, stack: fonts } = engine();
    text.prewarm("ABC", fonts, 48);
    const before = text.stats().atlas.glyphs;
    const result = text.render(spec("ZZZ"), fonts, { scale: 1 });
    expect(text.stats().atlas.glyphs).toBeGreaterThan(before);
    expect(result.geometry[0]!.quadCount).toBe(3);
  });

  it("survives a font that failed to load", () => {
    // A scene referencing a missing asset must render in the fonts it has, not
    // take the whole graphic off air.
    const { engine: text } = engine();
    expect(text.stack(["inter", "nope"])!.fonts).toHaveLength(1);
    expect(text.stack(["nope"])).toBeNull();
  });

  it("renders right-to-left text as glyphs, not as reversed input", () => {
    const { engine: text, stack: fonts } = engine();
    const result = text.render(spec("محمد صلاح"), fonts, { scale: 1 });
    // 9 characters, one space, and Arabic ligates — so glyph count is neither
    // the character count nor zero.
    const quads = result.geometry.reduce((sum, geometry) => sum + geometry.quadCount, 0);
    expect(quads).toBeGreaterThan(0);
    expect(quads).toBeLessThanOrEqual(9);
    // Positions increase left to right on screen regardless of logical order.
    const xs = result.layout.lines[0]!.glyphs.map((glyph) => glyph.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});
