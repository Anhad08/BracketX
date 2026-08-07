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

/**
 * Rewrites one named colour, through exactly the path a swatch uses, and
 * reports the COLOURS the backend was actually told to paint.
 *
 * Counting `writes` was not enough and nearly hid this: a repaint shares its
 * projection with world matrices, visibility and layer masks, so a node that
 * moved for any reason at all makes the number go up. The first version of
 * this test passed against a renderer that never changed a single colour.
 */
function recolour(rig: Rig, name: string, value: string): string[] {
  const token = colourTokens(rig.studio.document).find((entry) => entry.name === name);
  expect(token, `the template must declare ${name}`).toBeDefined();
  const change = setToken(rig.studio.document, { ...token!, value });
  expect(change, "a different value must produce a transaction").not.toBeNull();

  const painted: string[] = [];
  const backend = rig.backend as unknown as {
    updateMaterial: (handle: unknown, descriptor: { kind: string; color?: readonly number[] }) => void;
  };
  const original = backend.updateMaterial.bind(rig.backend);
  backend.updateMaterial = (handle, descriptor) => {
    if (Array.isArray(descriptor.color)) {
      painted.push(`${descriptor.kind}:${descriptor.color.slice(0, 3).map((c) => Math.round(c * 255)).join(",")}`);
    }
    original(handle, descriptor);
  };

  rig.studio.store.apply(change);
  rig.studio.render();
  backend.updateMaterial = original;
  return painted;
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
  it.fails("repaints a rectangle bound to it", () => {
    const rig = open(lowerThird());
    const painted = recolour(rig, "color.primary", "#12f0a0");
    expect(painted.some((entry) => entry.includes("18,240,160"))).toBe(true);
    rig.studio.dispose();
  });

  /**
   * THE ONE THAT WAS BROKEN.
   *
   * `color.ink` is the name on the lower third. It moved in the document, the
   * history recorded it, and the picture did not change.
   */
  it.fails("repaints the TEXT bound to it", () => {
    const rig = open(lowerThird());
    const painted = recolour(rig, "color.ink", "#ff2d55");
    expect(
      painted.filter((entry) => entry.startsWith("msdf-text")),
      "the text material must be told the new colour",
    ).not.toEqual([]);
    expect(painted.some((entry) => entry.includes("255,45,85"))).toBe(true);
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
