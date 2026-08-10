/**
 * Paint looks.
 *
 * The engine's `paint.test.ts` proves the pixels. This proves the PRODUCT rules
 * that sit above them: that a look is derived from the node's own colour rather
 * than a fixed palette, that Flat costs nothing, that a bound fill is left
 * alone, and that the picker tells the truth after a hand edit.
 */
import { describe, expect, it } from "vitest";
import {
  applyOperation,
  applyTransaction,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import {
  DEFAULT_PAINT,
  PAINTS,
  applyPaint,
  applyPaintEverywhere,
  canPaint,
  graphicPaint,
  paintById,
  paintOf,
  paintOfAll,
  paintableIds,
  repaint,
} from "./studio/paints";
import { PRESETS } from "./studio/presets";

function rect(
  id: string,
  fill: unknown,
  size: { width: number; height: number } = { width: 4, height: 1 },
): SceneNode {
  return {
    id,
    name: id,
    order: id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      { id: `cmp_${id}`, type: "rect", props: { ...size, fill } },
    ],
  } as unknown as SceneNode;
}

function textNode(id: string): SceneNode {
  return {
    id,
    name: id,
    order: id,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [{ id: `cmp_${id}`, type: "text", props: { content: "Hi" } }],
  } as unknown as SceneNode;
}

function documentOf(...children: SceneNode[]): SceneDocument {
  return {
    format: "bracketx.scene",
    version: 2,
    id: "scn_1",
    meta: { name: "T", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" },
    world: { units: "meters", up: "Y", handedness: "right", output: { width: 1920, height: 1080, fps: 60 } },
    variables: [],
    assets: [],
    states: [],
    root: {
      id: "nod_root",
      name: "root",
      order: "a0",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      children,
    } as unknown as SceneNode,
  } as SceneDocument;
}

/** Applies a transaction, so assertions read the document a user would have. */
function commit(document: SceneDocument, txn: ReturnType<typeof applyPaint>): SceneDocument {
  expect(txn).not.toBeNull();
  return applyTransaction(document, txn!);
}

function paintPropOf(document: SceneDocument, nodeId: string): Record<string, unknown> | undefined {
  const node = (document.root.children ?? []).find((child) => child.id === nodeId)!;
  const props = (node.components ?? [])[0]!.props as Record<string, unknown>;
  return props.paint as Record<string, unknown> | undefined;
}

describe("the looks on offer", () => {
  it("names outcomes, never gradient parameters", () => {
    // The founder's rule, recorded in finishes.ts and applying here: a person
    // picks "Glass", not "linear-gradient at 115° with three stops".
    const labels = PAINTS.map((paint) => paint.label);
    expect(labels).toContain("Flat");
    expect(labels).toContain("Soft");
    expect(labels).toContain("Glass");
    expect(labels).toContain("Glow");
    for (const paint of PAINTS) {
      expect(paint.hint.length).toBeGreaterThan(0);
      expect(paint.label).not.toMatch(/gradient|radius|stroke|blur|opacity/i);
    }
  });

  it("has ids that are all distinct, so the picker cannot light two buttons", () => {
    expect(new Set(PAINTS.map((p) => p.id)).size).toBe(PAINTS.length);
  });

  it("Flat builds no paint at all", () => {
    // Not an empty object: an empty paint would still take the texture path.
    // "No effect" must be the cheapest option, not the most expensive.
    expect(paintById("flat")!.build("#2f6feb", 1, { width: 1, height: 1 })).toBeUndefined();
    expect(DEFAULT_PAINT.id).toBe("flat");
  });

  it("derives every look from the colour it was given", () => {
    // The rule that keeps this brand-safe. A look must never introduce a colour
    // the document did not already contain.
    for (const paint of PAINTS) {
      const built = paint.build("#d7263d", 1, { width: 1, height: 1 });
      if (built === undefined) continue;
      const json = JSON.stringify(built);
      // Red-dominant channels throughout. A blue ramp here would mean the
      // preset was hardcoded rather than derived.
      const colours = json.match(/#[0-9a-f]{6}/gi) ?? [];
      const branded = colours.filter((hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return r > b;
      });
      // White is legitimate for a rim highlight, so not every colour must be
      // branded — but at least one must be, or nothing was derived.
      expect(branded.length, `${paint.id} introduced no colour from the fill`).toBeGreaterThan(0);
    }
  });

  it("scales its distances by the box, so one preset fits a strap and a chip", () => {
    const strap = paintById("soft")!.build("#2f6feb", 1.9, { width: 1.9, height: 1.9 })!;
    const chip = paintById("soft")!.build("#2f6feb", 0.2, { width: 0.2, height: 0.2 })!;
    expect(strap.cornerRadius).toBeGreaterThan(chip.cornerRadius!);
    // And neither is a fully rounded pill by accident.
    expect(strap.cornerRadius).toBeLessThan(1.9 / 2);
  });

  it("builds a glow as the shape's OWN colour, un-offset", () => {
    // A shadow and a glow are one operation; what separates them is the colour
    // and the offset. If this ever gains an offset it has become a shadow.
    const glow = paintById("glow")!.build("#d7263d", 1, { width: 1, height: 1 })!;
    expect(glow.shadow?.color).toBe("#d7263d");
    expect(glow.shadow?.offsetX ?? 0).toBe(0);
    expect(glow.shadow?.offsetY ?? 0).toBe(0);
  });

  it("builds glass with an INNER highlight, not an outer one", () => {
    // Outer would read as a glow behind a hole rather than a thickness of glass.
    expect(paintById("glass")!.build("#2f6feb", 1, { width: 1, height: 1 })!.shadow?.inner).toBe(true);
  });
});

describe("applying a look", () => {
  it("writes the built paint and the chosen name into the node", () => {
    const before = documentOf(rect("nod_a", "#2f6feb"));
    const after = commit(before, applyPaint(before, ["nod_a"], paintById("soft")!));

    const props = (after.root.children![0]!.components ?? [])[0]!.props as Record<string, unknown>;
    expect(props.paint).toBeDefined();
    expect(props.paintStyle).toBe("soft");
    // The resolved values are in the document — nothing has to know what "soft"
    // means to render it.
    expect((props.paint as Record<string, unknown>).gradient).toBeDefined();
  });

  it("removes the paint entirely when Flat is chosen", () => {
    let document = documentOf(rect("nod_a", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("glass")!));
    expect(paintPropOf(document, "nod_a")).toBeDefined();

    document = commit(document, applyPaint(document, ["nod_a"], paintById("flat")!));
    expect(paintPropOf(document, "nod_a")).toBeUndefined();
  });

  it("is one undo step for a whole multi-selection", () => {
    const document = documentOf(rect("nod_a", "#2f6feb"), rect("nod_b", "#d7263d"));
    const txn = applyPaint(document, ["nod_a", "nod_b"], paintById("soft")!);
    expect(txn).not.toBeNull();
    // ONE transaction covering BOTH nodes is the invariant. The operation count
    // is not: it changed from four to six the moment `paintFrom` was added, and
    // asserting the number would have failed a change that broke nothing.
    const touched = new Set(txn!.operations.map((op) => (op as { nodeId: string }).nodeId));
    expect([...touched].sort()).toEqual(["nod_a", "nod_b"]);
  });

  it("skips what cannot wear a paint instead of refusing the gesture", () => {
    // A designer who marquee-selected a lower third gets its panels painted,
    // not an error about the text.
    const document = documentOf(rect("nod_a", "#2f6feb"), textNode("nod_t"));
    const txn = applyPaint(document, ["nod_a", "nod_t"], paintById("soft")!);
    expect(txn).not.toBeNull();
    expect(txn!.operations.every((op) => (op as { nodeId: string }).nodeId === "nod_a")).toBe(true);
  });

  it("leaves a BOUND fill alone rather than repainting it white", () => {
    // A fill bound to a brand variable cannot be read as a colour, so no look
    // can be derived from it. Guessing white would destroy the brand.
    const document = documentOf(rect("nod_a", { $var: "brand.primary" }));
    expect(canPaint(document, ["nod_a"])).toBe(false);
    expect(applyPaint(document, ["nod_a"], paintById("soft")!)).toBeNull();
  });

  it("returns null when nothing in the selection can be painted", () => {
    const document = documentOf(textNode("nod_t"));
    expect(canPaint(document, ["nod_t"])).toBe(false);
    expect(applyPaint(document, ["nod_t"], paintById("soft")!)).toBeNull();
  });
});

describe("reading back what is worn", () => {
  it("reports the look that was applied", () => {
    const before = documentOf(rect("nod_a", "#2f6feb"));
    const after = commit(before, applyPaint(before, ["nod_a"], paintById("elevated")!));
    expect(paintOf(after, "nod_a")?.id).toBe("elevated");
  });

  it("reports Flat for a rect that has never been painted", () => {
    expect(paintOf(documentOf(rect("nod_a", "#2f6feb")), "nod_a")?.id).toBe("flat");
  });

  it("reports NOTHING once the paint has been hand-edited", () => {
    // The honesty rule `finishOf` already follows: the name stops matching, and
    // the picker shows no selection rather than continuing to claim "Glass".
    let document = documentOf(rect("nod_a", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("glass")!));

    const edited = applyOperation(document, {
      type: "node.setProp",
      nodeId: "nod_a",
      path: "components.0.props.paint.cornerRadius",
      value: 0.42,
      previousValue: paintPropOf(document, "nod_a")!.cornerRadius,
    });
    expect(paintOf(edited, "nod_a")).toBeNull();
  });

  it("reports nothing for a selection wearing different looks", () => {
    // Lighting a button because one of six graphics wears Glass tells the
    // operator the wrong thing about the other five.
    let document = documentOf(rect("nod_a", "#2f6feb"), rect("nod_b", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("glass")!));
    document = commit(document, applyPaint(document, ["nod_b"], paintById("glow")!));
    expect(paintOfAll(document, ["nod_a", "nod_b"])).toBeNull();
  });

  it("reports the shared look when they agree", () => {
    let document = documentOf(rect("nod_a", "#2f6feb"), rect("nod_b", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a", "nod_b"], paintById("soft")!));
    expect(paintOfAll(document, ["nod_a", "nod_b"])?.id).toBe("soft");
  });
});

describe("rebuilding after a recolour", () => {
  it("rebuilds the gradient when the fill changed", () => {
    // The failure this exists for: recolour a pack from blue to red and, without
    // this, every panel keeps its blue ramp while its flat fill goes red.
    let document = documentOf(rect("nod_a", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("soft")!));
    const blue = JSON.stringify(paintPropOf(document, "nod_a"));

    document = applyOperation(document, {
      type: "node.setProp",
      nodeId: "nod_a",
      path: "components.0.props.fill",
      value: "#d7263d",
      previousValue: "#2f6feb",
    });

    const rebuild = repaint(document, ["nod_a"]);
    expect(rebuild).not.toBeNull();
    document = applyTransaction(document, rebuild!);

    const red = JSON.stringify(paintPropOf(document, "nod_a"));
    expect(red).not.toBe(blue);
    expect(paintOf(document, "nod_a")?.id).toBe("soft");
  });

  it("returns null when everything already matches, so it is safe to call always", () => {
    let document = documentOf(rect("nod_a", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("soft")!));
    expect(repaint(document, ["nod_a"])).toBeNull();
  });

  it("does NOT rebuild a hand-edited paint, which would discard the edit", () => {
    let document = documentOf(rect("nod_a", "#2f6feb"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("soft")!));
    document = applyOperation(document, {
      type: "node.setProp",
      nodeId: "nod_a",
      path: "components.0.props.paint.cornerRadius",
      value: 0.42,
      previousValue: paintPropOf(document, "nod_a")!.cornerRadius,
    });

    expect(repaint(document, ["nod_a"])).toBeNull();
    expect(paintPropOf(document, "nod_a")!.cornerRadius).toBe(0.42);
  });
});

describe("the whole graphic at once", () => {
  it("finds every paintable node and skips the rest", () => {
    const document = documentOf(rect("nod_a", "#2f6feb"), textNode("nod_t"), rect("nod_b", "#fff"));
    expect([...paintableIds(document)].sort()).toEqual(["nod_a", "nod_b"]);
  });

  it("restyles the whole graphic in one step", () => {
    const before = documentOf(rect("nod_a", "#2f6feb"), rect("nod_b", "#2f6feb"));
    const after = commit(before, applyPaintEverywhere(before, paintById("elevated")!));
    expect(graphicPaint(after)?.id).toBe("elevated");
  });
});

describe("recolouring through a token", () => {
  /** A themed rect, the way every shipped template writes one. */
  function themed(id: string): SceneNode {
    return rect(id, { $var: "color.surface" });
  }

  function withTokens(value: string, ...children: SceneNode[]): SceneDocument {
    const base = documentOf(...children);
    return { ...base, tokens: [{ name: "color.surface", value }] } as SceneDocument;
  }

  it("resolves a token binding, so a SHIPPED template is paintable", () => {
    // The bug this pins: treating any non-string fill as unpaintable disabled
    // styling on every template the product ships, because they all bind their
    // fills to design tokens.
    const document = withTokens("#101319", themed("nod_a"));
    expect(canPaint(document, ["nod_a"])).toBe(true);
    expect(applyPaint(document, ["nod_a"], paintById("soft")!)).not.toBeNull();
  });

  it("records the RESOLVED colour, not the binding", () => {
    const before = withTokens("#101319", themed("nod_a"));
    const after = commit(before, applyPaint(before, ["nod_a"], paintById("soft")!));
    const props = (after.root.children![0]!.components ?? [])[0]!.props as Record<string, unknown>;
    expect(props.paintFrom).toBe("#101319");
    // And the fill is still the BINDING — styling must not flatten a theme.
    expect(props.fill).toEqual({ $var: "color.surface" });
  });

  it("rebuilds against a token value that has not been written yet", () => {
    // What the colour swatch needs: the new value is known before the document
    // carries it, so the recolour and the rebuild can be ONE undo step.
    let document = withTokens("#101319", themed("nod_a"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("soft")!));
    const wasDark = JSON.stringify(paintPropOf(document, "nod_a"));

    const rebuild = repaint(document, ["nod_a"], {
      name: "color.surface",
      value: "#d7263d",
    });
    expect(rebuild).not.toBeNull();
    document = applyTransaction(document, rebuild!);

    expect(JSON.stringify(paintPropOf(document, "nod_a"))).not.toBe(wasDark);
    // paintFrom followed, so the style still reports itself after the recolour.
    const props = (document.root.children![0]!.components ?? [])[0]!.props as Record<string, unknown>;
    expect(props.paintFrom).toBe("#d7263d");
  });

  it("does nothing for a token the graphic does not use", () => {
    let document = withTokens("#101319", themed("nod_a"));
    document = commit(document, applyPaint(document, ["nod_a"], paintById("soft")!));
    expect(repaint(document, ["nod_a"], { name: "color.primary", value: "#fff" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wipe reveals — the one remaining animation primitive, without a mask
// ---------------------------------------------------------------------------

describe("wipe presets", () => {
  const wipeById = (id: string) => PRESETS.find((preset) => preset.id === id)!;

  function node(): SceneNode {
    return {
      id: "nod_a",
      name: "a",
      order: "a0",
      transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      size: { width: 4, height: 1 },
      components: [{ id: "c", type: "rect", props: { width: 4, height: 1, fill: "#fff" } }],
    } as unknown as SceneNode;
  }

  it("is offered in both directions, in and out", () => {
    for (const id of [
      "wipe-in-left",
      "wipe-in-right",
      "wipe-in-up",
      "wipe-out-left",
      "wipe-out-right",
      "wipe-out-down",
    ]) {
      expect(wipeById(id), `${id} is missing`).toBeDefined();
    }
  });

  it("grows from zero on ONE axis only", () => {
    const tracks = wipeById("wipe-in-left").build(node(), 0.5);
    const paths = tracks.map((t) => t.path);
    expect(paths).toContain("transform.scale.0");
    expect(paths).not.toContain("transform.scale.1");
    const scaleTrack = tracks.find((t) => t.path === "transform.scale.0")!;
    expect(scaleTrack.keyframes[0]!.value).toBe(0);
    expect(scaleTrack.keyframes.at(-1)!.value).toBe(1);
  });

  it("holds the growing EDGE still, not the centre", () => {
    // The whole point. A node scales about its centre (SCENE_FORMAT §5), so
    // without this the plate blooms out of the middle and reads as a zoom.
    // Resting centre 2, width 4 — the left edge is at 0, so a collapsed box must
    // have its centre at 0.
    const tracks = wipeById("wipe-in-left").build(node(), 0.5);
    const move = tracks.find((t) => t.path === "transform.position.0")!;
    expect(move.keyframes[0]!.value).toBe(0);
    expect(move.keyframes.at(-1)!.value).toBe(2);
  });

  it("holds the RIGHT edge for a right wipe", () => {
    const move = wipeById("wipe-in-right")
      .build(node(), 0.5)
      .find((t) => t.path === "transform.position.0")!;
    expect(move.keyframes[0]!.value).toBe(4);
  });

  it("runs an exit backwards, ending collapsed", () => {
    const tracks = wipeById("wipe-out-left").build(node(), 0.5);
    const scaleTrack = tracks.find((t) => t.path === "transform.scale.0")!;
    expect(scaleTrack.keyframes[0]!.value).toBe(1);
    expect(scaleTrack.keyframes.at(-1)!.value).toBe(0);
  });

  it("composes with a node that is already scaled and offset", () => {
    const scaled = {
      ...node(),
      transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] },
    } as unknown as SceneNode;
    const tracks = wipeById("wipe-in-left").build(scaled, 0.5);
    // Returns to its own resting scale, not to 1.
    expect(tracks.find((t) => t.path === "transform.scale.0")!.keyframes.at(-1)!.value).toBe(2);
    // Extent is 4 * 2 = 8, so the left edge sits 4 left of centre 5.
    expect(tracks.find((t) => t.path === "transform.position.0")!.keyframes[0]!.value).toBe(1);
  });

  it("never touches size, so layout and text fit are not reshaped mid-reveal", () => {
    const paths = wipeById("wipe-in-up").build(node(), 0.5).map((t) => t.path);
    expect(paths.every((path) => !path.includes("size"))).toBe(true);
  });
});
