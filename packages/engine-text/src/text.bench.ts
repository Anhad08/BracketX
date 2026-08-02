import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";

import { FontStack, LoadedFont } from "./font";
import { itemize } from "./segment";
import { Shaper } from "./shape";
import { layoutText, type TextSpec } from "./layout";
import { generateMsdf } from "./msdf";
import { GlyphAtlas } from "./atlas";
import { TextEngine } from "./engine";

/**
 * Text engine cost. TEXT_ENGINE §7.
 *
 * ============================================================================
 * THE ONE NUMBER THAT IS A BUDGET
 * ============================================================================
 * §7 sets **2ms per frame for text layout across ALL visible nodes**. That is
 * the number this file exists to check, and it is the only one with a hard
 * ceiling — everything else here is load-time or off-frame:
 *
 *   layout        P1, on the frame path. 2ms for the whole scene.
 *   shaping       cached; a miss is layout's cost, a hit is free.
 *   MSDF + atlas  P2, in a Worker, covered by pre-warm. Load-time.
 *
 * Measuring MSDF against a frame budget would be measuring the wrong thing.
 * Measuring layout against anything else would be measuring nothing.
 *
 * Run: pnpm --filter @bracketx/engine-text bench
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/fonts/", import.meta.url));
const load = (id: string, file: string): LoadedFont =>
  new LoadedFont(id, new Uint8Array(readFileSync(FIXTURES + file)));

const inter = load("inter", "inter-latin-400.ttf");
const arabic = load("arabic", "noto-arabic-400.ttf");
const thai = load("thai", "noto-thai-400.ttf");
const stack = new FontStack([inter, arabic, thai]);

const BASE: Omit<TextSpec, "content"> = {
  size: 48,
  align: "start",
  verticalAlign: "top",
  lineHeight: 1.2,
  box: { width: 600, height: 200 },
  fit: { mode: "wrap" },
  direction: "auto",
};
const spec = (content: string, over: Partial<TextSpec> = {}): TextSpec => ({
  ...BASE,
  content,
  ...over,
});

// ---------------------------------------------------------------------------
// Layout — the budgeted path
// ---------------------------------------------------------------------------

describe("layout (2ms budget for a whole scene)", () => {
  const shaper = new Shaper();

  bench("a name, cold shaper", () => {
    layoutText(spec("ALEX RIVERA"), stack, new Shaper());
  });

  bench("a name, warm shaper", () => {
    layoutText(spec("ALEX RIVERA"), stack, shaper);
  });

  bench("a wrapped sentence", () => {
    layoutText(
      spec("Manchester United versus Liverpool Football Club", {
        box: { width: 300, height: 400 },
      }),
      stack,
      shaper,
    );
  });

  // `shrink` is the expensive fit mode by construction: eight binary-search
  // iterations, each a full layout. That is the price of a reproducible result
  // (TEXT_ENGINE §6), and knowing what it costs is the point of measuring it.
  bench("shrink to fit, eight iterations", () => {
    layoutText(
      spec("Konstantinos Papadopoulos", {
        box: { width: 300, height: 60 },
        fit: { mode: "shrink", minSize: 12 },
      }),
      stack,
      shaper,
    );
  });

  bench("right-to-left with bidi", () => {
    layoutText(spec("محمد صلاح 2-1 LIVERPOOL"), stack, shaper);
  });

  // The scene-level question. A leaderboard is twenty names, and the budget is
  // for ALL of them together.
  const twenty = Array.from({ length: 20 }, (_, index) => `PLAYER ${index}`);
  bench("twenty distinct names — one leaderboard", () => {
    for (const name of twenty) layoutText(spec(name), stack, shaper);
  });
});

describe("shaping", () => {
  const shaper = new Shaper();
  const runs = itemize("Manchester United", stack, "ltr");
  bench("cached run", () => {
    for (const run of runs) shaper.run(run);
  });

  let unique = 0;
  bench("uncached run", () => {
    unique += 1;
    for (const run of itemize(`Name ${unique}`, stack, "ltr")) {
      new Shaper().run(run);
    }
  });
});

// ---------------------------------------------------------------------------
// Rasterisation — load-time, NOT the frame path
// ---------------------------------------------------------------------------

describe("MSDF generation (P2, off-frame)", () => {
  const glyphs = [..."AMOgWi"].map((character) =>
    inter.glyphFor(character.codePointAt(0)!),
  );

  for (const size of [32, 48, 64] as const) {
    bench(`one glyph at ${size}px`, () => {
      const glyph = glyphs[0]!;
      generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, { size, pxRange: 4 });
    });
  }

  bench("six mixed glyphs at 48px", () => {
    for (const glyph of glyphs) {
      generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, { size: 48, pxRange: 4 });
    }
  });
});

describe("atlas", () => {
  const glyph = inter.glyphFor(65);
  const field = generateMsdf(inter.outlineOf(glyph), inter.metrics.upem, {
    size: 32,
    pxRange: 4,
  })!;

  bench("pack one glyph", () => {
    const atlas = new GlyphAtlas({ pageSize: 512, pxRange: 4 });
    atlas.add("inter", glyph, 32, field);
  });

  const warm = new GlyphAtlas({ pageSize: 2048, pxRange: 4 });
  warm.add("inter", glyph, 32, field);
  bench("look one up", () => {
    warm.get("inter", glyph, 32);
  });
});

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

describe("the engine end to end", () => {
  function engine(): { text: TextEngine; fonts: FontStack } {
    const text = new TextEngine({ pageSize: 2048, pxRange: 4 });
    text.addFont("inter", new Uint8Array(readFileSync(FIXTURES + "inter-latin-400.ttf")));
    return { text, fonts: text.stack(["inter"])! };
  }

  const warm = engine();
  warm.text.prewarm("ABCDEFGHIJKLMNOPQRSTUVWXYZ ", warm.fonts, 48);

  bench("render a pre-warmed name", () => {
    warm.text.render(spec("ALEX RIVERA"), warm.fonts, { scale: 1 });
  });

  /**
   * The live-text miss is NOT benchmarked end to end, deliberately.
   *
   * An unexpected name costs one layout plus one MSDF generation per novel
   * glyph, and both are already measured above: 0.010ms and 2.04ms at 48px. A
   * combined benchmark cannot isolate it — vitest runs thousands of iterations
   * and the glyph is novel only on the first, so the average reports a cache
   * hit whatever the name.
   *
   * Two earlier attempts each produced a number that was worse than none. The
   * first used Cyrillic against a Latin-only subset, so every "miss" resolved
   * to `.notdef`, generated nothing, and reported a novel glyph as CHEAPER than
   * a cached one. The second rebuilt the engine per iteration and measured
   * construction and pre-warm instead — 145ms for what is a 2ms event.
   *
   * The honest figure is the composition, and it is why §7 puts atlas
   * generation in scheduler class P2 and §5 makes pre-warm the on-air path.
   */

  bench("pre-warm a Latin set", () => {
    const fresh = engine();
    fresh.text.prewarm("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", fresh.fonts, 48);
  });
});
