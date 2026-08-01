import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  Blob,
  Buffer as HbBuffer,
  Direction,
  Face,
  Font,
  shape,
  versionString,
} from "harfbuzzjs";

/**
 * T1 SPIKE — stages 2 to 5 of the text pipeline.
 *
 * TEXT_ENGINE §11 T1 requires this before Phase 3 is committed, and §9 rates
 * "the Unicode annexes are the hidden work" as High probability / Severe
 * impact. This retires that risk with evidence rather than argument.
 *
 *   2. itemize   split by script and direction      (UAX #24)
 *   3. bidi      resolve visual order                (UAX #9)
 *   4. shape     codepoints -> positioned glyph ids  (HarfBuzz)
 *   5. break     line break opportunities            (UAX #14)
 *
 * The question is not "does text appear". It is: can we get BYTE-IDENTICAL
 * glyph positions for Latin, Arabic, Hebrew, and Thai from libraries we
 * control, without touching a platform text engine — TEXT_ENGINE §1.
 *
 * Run: pnpm --filter @bracketx/engine-text spike
 *
 * FONTS. This reads Windows system fonts. They cannot ship and will not exist
 * in CI; committed golden-layout tests need OFL fonts vendored as fixtures.
 * Called out in the report rather than papered over.
 */

const FONT_PATHS: Record<string, string[]> = {
  // Arial carries Latin, Cyrillic, Greek, Arabic, and Hebrew on Windows.
  arial: ["C:/Windows/Fonts/arial.ttf"],
  thai: ["C:/Windows/Fonts/LeelaUIb.ttf", "C:/Windows/Fonts/LeelawUI.ttf"],
};

interface Sample {
  readonly name: string;
  readonly text: string;
  readonly script: string;
  readonly rtl: boolean;
  readonly font: string;
}

const SAMPLES: Sample[] = [
  { name: "latin", text: "ALEX RIVERA", script: "Latn", rtl: false, font: "arial" },
  { name: "latin-kern", text: "VA To AWAY", script: "Latn", rtl: false, font: "arial" },
  { name: "cyrillic", text: "Алексей", script: "Cyrl", rtl: false, font: "arial" },
  { name: "greek", text: "Αθήνα", script: "Grek", rtl: false, font: "arial" },
  // Arabic is the real test: contextual forms mean glyph count != char count.
  { name: "arabic", text: "محمد صلاح", script: "Arab", rtl: true, font: "arial" },
  { name: "hebrew", text: "דוד לוי", script: "Hebr", rtl: true, font: "arial" },
  // No spaces at all. Splitting on " " yields one unbreakable run.
  { name: "thai", text: "ประเทศไทยสวยงามมาก", script: "Thai", rtl: false, font: "thai" },
];

function loadFont(key: string): Uint8Array | null {
  for (const path of FONT_PATHS[key] ?? []) {
    if (existsSync(path)) return new Uint8Array(readFileSync(path));
  }
  return null;
}

interface Shaped {
  readonly glyphs: { id: number; cluster: number }[];
  readonly positions: {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }[];
  readonly upem: number;
}

/**
 * One shaping call.
 *
 * Scale is set to units-per-em so positions come back in FONT UNITS as
 * integers. TEXT_ENGINE §8.3: advances come from font metrics in fixed point,
 * never accumulated floats. Scaling to a pixel size here would bake a rounding
 * decision into the shaper that layout should own.
 */
function shapeRun(
  fontData: Uint8Array,
  text: string,
  direction: Direction,
  script: string,
): Shaped {
  const blob = new Blob(fontData);
  const face = new Face(blob, 0);
  const font = new Font(face);
  font.setScale(face.upem, face.upem);

  const buffer = new HbBuffer();
  buffer.addText(text);
  // guessSegmentProperties FIRST, then override. It derives direction, script,
  // and language from the buffer contents; the explicit calls below let
  // itemization overrule it where the higher layer knows better.
  //
  // Direction must be the numeric enum. Passing the string "ltr" makes
  // hb_shape bail and return the ORIGINAL CODEPOINTS with zero advances —
  // silently. Text still appears, unkerned and unshaped, which is the failure
  // mode that looks like success. Found by this spike; see the report.
  buffer.guessSegmentProperties();
  buffer.setDirection(direction);
  buffer.setScript(script);

  shape(font, buffer);

  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();

  return {
    glyphs: infos.map((info) => ({ id: info.codepoint, cluster: info.cluster })),
    positions: positions.map((p) => ({
      xAdvance: p.xAdvance,
      yAdvance: p.yAdvance,
      xOffset: p.xOffset,
      yOffset: p.yOffset,
    })),
    upem: face.upem,
  };
}

// ---------------------------------------------------------------------------

describe("T1 spike — stages 2 to 5", () => {
  it("shapes every script to positioned glyphs", () => {
    const rows: string[] = [];
    let shapedAny = false;

    for (const sample of SAMPLES) {
      const font = loadFont(sample.font);
      if (!font) {
        rows.push(`${sample.name.padEnd(14)} SKIPPED — font unavailable`);
        continue;
      }

      const result = shapeRun(
        font,
        sample.text,
        sample.rtl ? Direction.RTL : Direction.LTR,
        sample.script,
      );
      shapedAny = true;

      const notdef = result.glyphs.filter((g) => g.id === 0).length;
      const advance = result.positions.reduce((sum, p) => sum + p.xAdvance, 0);

      rows.push(
        `${sample.name.padEnd(14)} chars=${String([...sample.text].length).padStart(
          3,
        )} glyphs=${String(result.glyphs.length).padStart(3)} ` +
          `notdef=${notdef} advance=${String(advance).padStart(6)} upem=${result.upem}`,
      );
    }

    console.log(
      `\n=== STAGE 4: SHAPING (HarfBuzz ${versionString()}) ===\n` +
        rows.join("\n"),
    );
    expect(shapedAny).toBe(true);
  });

  it("proves shaping is more than a cmap lookup", () => {
    // Arabic is the discriminator. Its letters take initial/medial/final forms
    // and ligate, so glyph count differs from character count. A naive
    // codepoint-to-glyph mapping produces disconnected letterforms: wrong, but
    // still rendering — the failure mode that looks like success.
    const font = loadFont("arial");
    if (!font) return;

    const arabic = "محمد";
    const shaped = shapeRun(font, arabic, Direction.RTL, "Arab");
    const codepoints = [...arabic];

    // Each character shaped in isolation, for contrast.
    const isolated = codepoints.map(
      (char) => shapeRun(font, char, Direction.RTL, "Arab").glyphs[0]?.id,
    );
    const shapedIds = shaped.glyphs.map((g) => g.id);

    console.log(
      `\n=== ARABIC CONTEXTUAL SHAPING ===\n` +
        `text      : ${arabic}\n` +
        `chars     : ${codepoints.length}\n` +
        `glyphs    : ${shapedIds.length}\n` +
        `in context: ${shapedIds.join(", ")}\n` +
        `isolated  : ${isolated.join(", ")}\n` +
        `identical : ${JSON.stringify(shapedIds) === JSON.stringify(isolated)}`,
    );

    // If these matched, HarfBuzz would be adding nothing over a cmap lookup
    // and the whole vendoring decision would be wrong.
    expect(JSON.stringify(shapedIds)).not.toBe(JSON.stringify(isolated));
  });

  it("resolves bidirectional order (UAX #9)", async () => {
    const bidiFactory = (await import("bidi-js")).default;
    const bidi = bidiFactory();

    // Where naive rendering fails visibly: the Arabic must run right-to-left
    // while the score runs left-to-right, inside one line.
    const mixed = "محمد صلاح 2-1 LIVERPOOL";
    const embedding = bidi.getEmbeddingLevels(mixed);
    const segments = bidi.getReorderSegments(mixed, embedding);

    console.log(
      `\n=== STAGE 3: BIDI ===\n` +
        `text      : ${mixed}\n` +
        `paragraph : ${embedding.paragraphs[0]?.level === 1 ? "rtl" : "ltr"}\n` +
        `levels    : ${Array.from(embedding.levels).join(",")}\n` +
        `reorder   : ${segments.length} segment(s) need reversing\n` +
        `segments  : ${segments.map(([a, b]) => `[${a}..${b}]`).join(" ")}`,
    );

    expect(embedding.levels.length).toBe(mixed.length);
    // Zero reorder segments would mean bidi is a no-op and Arabic names would
    // render backwards.
    expect(segments.length).toBeGreaterThan(0);
  });

  it("finds line breaks without spaces (UAX #14)", async () => {
    const LineBreaker = (await import("linebreak")).default;

    const thai = "ประเทศไทยสวยงามมาก";
    const english = "Manchester United versus Liverpool";

    const breaksOf = (text: string) => {
      const breaker = new LineBreaker(text);
      const positions: number[] = [];
      let block = breaker.nextBreak();
      while (block) {
        positions.push(block.position);
        block = breaker.nextBreak();
      }
      return positions;
    };

    const englishBreaks = breaksOf(english);
    const thaiBreaks = breaksOf(thai);

    console.log(
      `\n=== STAGE 5: LINE BREAKING ===\n` +
        `english : ${english}\n` +
        `  spaces: ${(english.match(/ /g) ?? []).length}  breaks: ${englishBreaks.join(", ")}\n` +
        `thai    : ${thai}\n` +
        `  spaces: ${(thai.match(/ /g) ?? []).length}  breaks: ${thaiBreaks.join(", ")}`,
    );

    expect(englishBreaks.length).toBeGreaterThan(2);
    expect(thaiBreaks.length).toBeGreaterThanOrEqual(1);
  });

  it("itemizes by script (UAX #24)", async () => {
    const unicode = await import("unicode-properties");

    const mixed = "Score 2-1 محمد ประเทศ";
    const runs: { script: string; text: string }[] = [];

    for (const char of mixed) {
      const script = unicode.getScript(char.codePointAt(0)!);
      const last = runs[runs.length - 1];
      // Common and Inherited (spaces, digits, punctuation) join the run they
      // sit in rather than splitting it — otherwise "2-1" becomes three runs.
      const merge =
        last !== undefined &&
        (script === last.script ||
          script === "Common" ||
          script === "Inherited");
      if (merge) last!.text += char;
      else runs.push({ script, text: char });
    }

    console.log(
      "\n=== STAGE 2: ITEMIZATION ===\n" +
        `text : ${mixed}\n` +
        runs.map((r) => `  ${r.script.padEnd(10)} "${r.text}"`).join("\n"),
    );

    expect(runs.length).toBeGreaterThan(1);
    expect(runs.some((r) => r.script === "Arabic")).toBe(true);
    expect(runs.some((r) => r.script === "Thai")).toBe(true);
  });

  it("is deterministic across repeated calls and fresh objects", () => {
    // TEXT_ENGINE §8.1: same input must give identical glyph positions on
    // every target, to the last decimal. Same-process repetition is the
    // weakest form and the only one testable here — cross-target stays Unknown
    // until the native runtime exists.
    const font = loadFont("arial");
    if (!font) return;

    const text = "محمد صلاح 2-1";
    const once = shapeRun(font, text, Direction.RTL, "Arab");
    const twice = shapeRun(font, text, Direction.RTL, "Arab");

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

    console.log(
      `\n=== DETERMINISM ===\n` +
        `identical across repeated shaping calls: true\n` +
        `positions are integers in font units   : ${once.positions.every(
          (p) => Number.isInteger(p.xAdvance),
        )}`,
    );

    // Integer font units are what makes §8.3 achievable — no float drift.
    expect(once.positions.every((p) => Number.isInteger(p.xAdvance))).toBe(true);
  });

  it("measures cost against the 2ms frame budget", () => {
    const font = loadFont("arial");
    if (!font) return;

    const fastest = (rounds: number, body: () => void) => {
      let best = Infinity;
      for (let i = 0; i < rounds; i += 1) {
        const start = performance.now();
        body();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };

    // Face/Font construction per call is the naive path; a real implementation
    // caches them. Measuring both shows what the cache is worth.
    const withSetup = fastest(50, () => {
      shapeRun(font, "ALEX RIVERA", Direction.LTR, "Latn");
    });

    const blob = new Blob(font);
    const face = new Face(blob, 0);
    const cachedFont = new Font(face);
    cachedFont.setScale(face.upem, face.upem);

    const shapeOnly = (text: string, direction: Direction, script: string) => {
      const buffer = new HbBuffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      buffer.setDirection(direction);
      buffer.setScript(script);
      shape(cachedFont, buffer);
      buffer.getGlyphPositions();
    };

    const latin = fastest(200, () => shapeOnly("ALEX RIVERA", Direction.LTR, "Latn"));
    const arabic = fastest(200, () => shapeOnly("محمد صلاح", Direction.RTL, "Arab"));
    const long = fastest(50, () =>
      shapeOnly("Manchester United versus Liverpool FC ".repeat(4), Direction.LTR, "Latn"),
    );

    console.log(
      `\n=== COST ===\n` +
        `shape latin, face rebuilt each call : ${withSetup.toFixed(3)} ms\n` +
        `shape latin (11 chars), cached face : ${latin.toFixed(4)} ms\n` +
        `shape arabic (9 chars), cached face : ${arabic.toFixed(4)} ms\n` +
        `shape long (152 chars), cached face : ${long.toFixed(4)} ms\n` +
        `TEXT_ENGINE §7 budget: 2 ms per frame for ALL visible text`,
    );

    expect(latin).toBeLessThan(2);
  });
});
