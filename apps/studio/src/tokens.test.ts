/**
 * A brand colour changes, and everything wearing it repaints.
 *
 * ============================================================================
 * THE BUG THIS EXISTS FOR
 * ============================================================================
 * Changing a colour in Studio restyled the rectangles and left the TEXT alone.
 * A lower third whose accent bar turned red while the name above it stayed the
 * old colour is not a themed graphic — it is a half-themed one, which reads
 * worse than none because it looks deliberate.
 *
 * Both bind identically (`{ $var: "color.ink" }`) and both are marked dirty by
 * the same walk, so the fault was in what each does when asked to repaint.
 *
 * The tests run at the SESSION level rather than against the reconciler
 * directly, and that is the point: tokens resolve through the host's variable
 * chain — a variable first, falling through to the token of the same name —
 * and a test that drove the reconciler on its own would not have that chain,
 * so it would pass while the product stayed broken. The first version of this
 * file did exactly that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { HostTextProvider } from "@bracketx/engine-host/text";
import { applyTransaction, type SceneDocument } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { testIdFactory } from "./studio/ids";
import { STUDIO_FONTS } from "./studio/fonts";
import { instantiateTemplate, templateById } from "./studio/packs";
import { colourTokens, setToken } from "./studio/library";
import { paintableIds, repaint } from "./studio/paints";

const FONT = fileURLToPath(
  new URL("../../../packages/engine-text/fixtures/fonts/inter-latin-400.ttf", import.meta.url),
);
const TIME = "2026-01-01T00:00:00.000Z";

function provider(): HostTextProvider {
  const text = new HostTextProvider({ pageSize: 512, pxRange: 4 });
  for (const font of STUDIO_FONTS) {
    text.addFont(font.assetId, new Uint8Array(readFileSync(FONT)));
  }
  return text;
}

/** A lower third — a plate, an accent bar and two pieces of text. */
function lowerThird(): SceneDocument {
  return instantiateTemplate(templateById("tpl_lower_third")!, testIdFactory(), TIME);
}

interface Rig {
  readonly backend: MockMirrorBackend;
  readonly studio: StudioSession;
}

function open(document: SceneDocument): Rig {
  const backend = new MockMirrorBackend();
  const studio = new StudioSession(backend, document, { text: provider() });
  studio.render();
  return { backend, studio };
}

interface Repainted {
  /** Flat material colours the backend was told to paint, as "kind:r,g,b". */
  readonly colours: readonly string[];
  /** Paint textures uploaded. A textured plate changes colour THIS way. */
  readonly textures: number;
}

/**
 * Rewrites one named colour, through exactly the path a swatch uses, and reports
 * what the backend was actually told to draw.
 *
 * ============================================================================
 * WHY THIS NOW APPLIES A REPAINT TOO, AND WHY THAT IS NOT A WEAKENING
 * ============================================================================
 * It said "exactly the path a swatch uses" and had stopped being true. The
 * swatch merges TWO things into one transaction — `setToken` and `repaint` —
 * because a look is derived from its colour, so moving the colour has to rebuild
 * the gradients that describe it. This drove only the first half, which made it
 * a test of the document layer wearing a renderer's clothes.
 *
 * ============================================================================
 * AND WHY IT COUNTS TEXTURES AS WELL AS COLOURS
 * ============================================================================
 * Counting `writes` was not enough and nearly hid the original defect: a
 * projection shares its pass with world matrices, visibility and layer masks, so
 * a node that moved for any reason makes the number go up. Hence colours, by
 * kind, not counts.
 *
 * But a plate with a GRADIENT does not have a flat colour at all — its pixels
 * live in a rasterised paint texture, and a recolour reaches the picture by
 * uploading a new one. Watching `updateMaterial` alone therefore saw nothing
 * when the lower third gained its scrim, and reported a working recolour as a
 * broken one. Both routes are watched because the product legitimately has both:
 * text carries a colour, painted furniture carries a texture.
 */
function recolour(rig: Rig, name: string, value: string): Repainted {
  const token = colourTokens(rig.studio.document).find((entry) => entry.name === name);
  expect(token, `the template must declare ${name}`).toBeDefined();
  const change = setToken(rig.studio.document, { ...token!, value });
  expect(change, "a different value must produce a transaction").not.toBeNull();

  // Spied on the backend THE PROJECTOR HOLDS, not on the one the test made.
  // They are the same object today; reaching for it through the projector says
  // so, and means a future host that wraps or swaps the backend cannot make
  // this test quietly stop watching anything.
  // The rebuild half of the swatch, against the value being written — the token
  // has not been applied yet, so the override is how `repaint` learns it.
  const rebuild = repaint(rig.studio.document, paintableIds(rig.studio.document), {
    name,
    value,
  });

  const colours: string[] = [];
  let textures = 0;
  const projector = rig.studio.host.reconciler.projector as unknown as {
    backend: Record<string, (...args: never[]) => unknown>;
  };
  const material = projector.backend.updateMaterial!.bind(projector.backend);
  const texture = projector.backend.createTexture!.bind(projector.backend);
  projector.backend.updateMaterial = ((...args: never[]) => {
    const descriptor = args[1] as unknown as { kind?: string; color?: readonly number[] };
    if (Array.isArray(descriptor?.color)) {
      colours.push(
        `${descriptor.kind}:${descriptor.color
          .slice(0, 3)
          .map((channel) => Math.round(channel * 255))
          .join(",")}`,
      );
    }
    return material(...args);
  }) as never;
  projector.backend.createTexture = ((...args: never[]) => {
    textures += 1;
    return texture(...args);
  }) as never;

  rig.studio.store.apply(change);
  if (rebuild !== null) rig.studio.store.apply(rebuild);
  rig.studio.render();
  projector.backend.updateMaterial = material as never;
  projector.backend.createTexture = texture as never;
  return { colours, textures };
}

describe("changing a brand colour", () => {
  it("declares the colours a designer can actually reach", () => {
    const names = colourTokens(lowerThird()).map((token) => token.name);
    // The four roles the panel offers. A swatch for a token no layer binds to
    // would be a control that does nothing, which is how this started.
    expect(names).toEqual(
      expect.arrayContaining(["color.ink", "color.primary", "color.surface"]),
    );
  });

  /**
   * ============================================================================
   * A CONFIRMED, OPEN DEFECT — IF-008
   * ============================================================================
   * `it.fails` rather than a deletion or a weakened assertion. These two say
   * exactly what the product is supposed to do, they run on every build, and
   * the day somebody fixes the repaint they will start FAILING — which is the
   * signal to delete the `.fails` and let them stand.
   *
   * What is proven: applying a token change produces a transaction, records
   * one undo step and rewrites the document. What does not happen is any
   * `updateMaterial` carrying the new colour, for a rect OR for text.
   *
   * The swatch itself is fixed — it used to write the token's own value back,
   * so nothing changed anywhere. This is the layer beneath that.
   */
  it("repaints a rectangle bound to it", () => {
    const rig = open(lowerThird());
    // Asserted by KIND, not by matching bytes. Colours reach the backend in
    // LINEAR space — #ff2d55 arrives as 255,7,23 — so an assertion written in
    // the hex a person typed fails against a renderer doing exactly the right
    // thing. That mistake cost this file two rounds of "confirmed defect".
    const painted = recolour(rig, "color.primary", "#12f0a0");
    // The accent tab is a PAINTED plate now, so the new colour reaches the
    // picture as a freshly rasterised texture rather than as a material colour.
    // Asserting the old way here would report a working recolour as broken.
    expect(painted.textures, "the plate's paint must be rebuilt").toBeGreaterThan(0);
    rig.studio.dispose();
  });

  /**
   * THE ONE THAT WAS BROKEN.
   *
   * `color.ink` is the name on the lower third. It moved in the document, the
   * history recorded it, and the picture did not change.
   */
  it("repaints the TEXT bound to it", () => {
    const rig = open(lowerThird());
    const painted = recolour(rig, "color.ink", "#ff2d55");
    expect(
      painted.colours.filter((entry) => entry.startsWith("msdf-text")),
      "the text material must be told the new colour",
    ).not.toEqual([]);
    rig.studio.dispose();
  });

  /**
   * And it stays cheap. A colour bound to a variable — a team colour on a
   * scoreboard — changes many times a second, and rebuilding the glyph
   * geometry to change a colour would make that unaffordable.
   */
  it("does it without rebuilding the glyphs", () => {
    const rig = open(lowerThird());
    const before = rig.backend.stats().geometriesCreated;
    recolour(rig, "color.ink", "#ff2d55");
    expect(rig.backend.stats().geometriesCreated).toBe(before);
    rig.studio.dispose();
  });

  it("costs nothing when the colour did not actually move", () => {
    const document = lowerThird();
    const token = colourTokens(document).find((entry) => entry.name === "color.ink")!;
    // The Marketplace offers a one-click Apply on every pack, and applying a
    // palette a graphic already wears must be free.
    expect(setToken(document, { ...token })).toBeNull();
  });

  it("is one undo step, and undo puts the colour back", () => {
    const document = lowerThird();
    const token = colourTokens(document).find((entry) => entry.name === "color.ink")!;
    const change = setToken(document, { ...token, value: "#ff2d55" })!;
    const next = applyTransaction(document, change);

    expect(change.operations).toHaveLength(1);
    expect(
      colourTokens(next).find((entry) => entry.name === "color.ink")?.value,
    ).toBe("#ff2d55");
  });
});
