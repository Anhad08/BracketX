import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { HostTextProvider } from "@bracketx/engine-host/text";
import { canonicalize, validateDocument } from "@bracketx/engine-scene";

import { StudioSession } from "./studio/session";
import { testIdFactory, type IdFactory } from "./studio/ids";
import { resetTransactionIds } from "./studio/editing";
import { newDocument } from "./studio/project";
import {
  ENGINE_TERMS,
  SECTIONS,
  DESIGN_PANELS,
  leaksEngineTerm,
  sectionSpec,
  visibleSections,
} from "./studio/shell";
import {
  PACKS,
  installTheme,
  instantiateTemplate,
  packById,
  presetsOf,
  templateById,
  templatesOf,
} from "./studio/packs";
import { STUDIO_FONTS } from "./studio/fonts";
import { PRESETS } from "./studio/presets";
import {
  DEFAULT_WORKSPACE,
  FREE_TIER,
  loadWorkspace,
  saveWorkspace,
} from "./studio/workspace";
import { colourTokens } from "./studio/library";

/**
 * Phase 4 verification — Studio as a product.
 *
 * ============================================================================
 * WHAT IS FALSIFIABLE HERE
 * ============================================================================
 * "Feels premium" is not testable and nothing below pretends otherwise. Three
 * things ARE:
 *
 *   1. **No engine terminology reaches a broadcaster.** A word list, checked
 *      against every user-facing string the product ships.
 *   2. **The free tier is real.** Every pack installs, every template builds a
 *      valid document, every theme restyles without touching a node.
 *   3. **Nothing was lost.** Developer Mode still reaches every diagnostic, and
 *      the engine is untouched.
 *
 * The 30-second criterion is exercised end to end in the browser suite, because
 * it is a claim about gestures reaching code paths — the lesson Phases 3A and
 * 3B each paid for.
 */

const FONT = fileURLToPath(
  new URL("../../../packages/engine-text/fixtures/fonts/inter-latin-400.ttf", import.meta.url),
);

let ids: IdFactory;

beforeEach(() => {
  ids = testIdFactory();
  resetTransactionIds();
});

function session(): StudioSession {
  const provider = new HostTextProvider({ pageSize: 512, pxRange: 4 });
  for (const font of STUDIO_FONTS) {
    provider.addFont(font.assetId, new Uint8Array(readFileSync(FONT)));
  }
  return new StudioSession(new MockMirrorBackend(), newDocument("Test", ids), {
    text: provider,
  });
}

// ===========================================================================
// The engine does not leak
// ===========================================================================

describe("no engine terminology reaches a broadcaster", () => {
  it("keeps every section name and hint clean", () => {
    // The rule, applied to the navigation a first-time user reads first.
    for (const section of SECTIONS) {
      if (section.developer === true) continue;
      expect(leaksEngineTerm(section.label), section.label).toBeNull();
      expect(leaksEngineTerm(section.hint), section.hint).toBeNull();
    }
    for (const panel of DESIGN_PANELS) {
      expect(leaksEngineTerm(panel.label), panel.label).toBeNull();
      expect(leaksEngineTerm(panel.hint), panel.hint).toBeNull();
    }
  });

  it("keeps every pack and template description clean", () => {
    for (const pack of PACKS) {
      expect(leaksEngineTerm(pack.name), pack.name).toBeNull();
      expect(leaksEngineTerm(pack.description), pack.description).toBeNull();
      for (const template of pack.templates ?? []) {
        expect(leaksEngineTerm(template.name), template.name).toBeNull();
        expect(leaksEngineTerm(template.description), template.description).toBeNull();
      }
    }
  });

  it("names every layer a template creates in a designer's words", () => {
    // The brief is explicit: not `nod_tr`, not `rect_001` — Background, Accent
    // Bar, Player Name. A template that shipped generated ids as layer names
    // would put the engine's vocabulary in the layers panel.
    for (const template of templatesOf()) {
      const built = template.build(testIdFactory(), (name) => ({ $var: name }), "2026-01-01T00:00:00.000Z");
      const names: string[] = [];
      const walk = (node: { name?: string; children?: readonly unknown[] }) => {
        if (typeof node.name === "string") names.push(node.name);
        for (const child of (node.children ?? []) as { name?: string }[]) walk(child);
      };
      walk(built.root as never);

      expect(names.length).toBeGreaterThan(3);
      for (const name of names) {
        // No id-shaped names, and no engine words.
        expect(name, `${template.name}: ${name}`).not.toMatch(/^(nod|cmp|rect)_/);
        expect(leaksEngineTerm(name), `${template.name}: ${name}`).toBeNull();
      }
    }
  });

  it("catches a leak when there is one", () => {
    // A rule that cannot fire is decoration. These must be caught.
    expect(leaksEngineTerm("Mirror snapshot")).toBe("mirror");
    expect(leaksEngineTerm("Backend writes")).toBe("backend");
    expect(leaksEngineTerm("Primitives")).toBe("primitive");
    // A string containing two terms reports the FIRST one found, not a
    // specific one — the caller needs to know it leaked, not which word won.
    expect(leaksEngineTerm("Glyph atlas")).not.toBeNull();
    expect(leaksEngineTerm("Dirty nodes and projections")).not.toBeNull();
    // And a legitimate product word that merely CONTAINS one must not be.
    expect(leaksEngineTerm("Immaterial")).toBeNull();
    expect(leaksEngineTerm("Handled with care")).toBeNull();
    expect(ENGINE_TERMS.length).toBeGreaterThan(15);
  });

  it("hides Developer until the mode is on, and never deletes it", () => {
    const off = visibleSections(false);
    const on = visibleSections(true);
    expect(off.some((section) => section.id === "developer")).toBe(false);
    expect(on.some((section) => section.id === "developer")).toBe(true);
    // Exactly one section appears; nothing else changes shape.
    expect(on.length).toBe(off.length + 1);
    expect(sectionSpec("developer").developer).toBe(true);
  });
});

// ===========================================================================
// The free tier is real
// ===========================================================================

describe("the free tier", () => {
  it("is installed before a user does anything", () => {
    // A first-time user who must install something before they can evaluate
    // anything has been asked to do work before seeing value.
    expect(DEFAULT_WORKSPACE.installedPacks).toEqual(FREE_TIER);
    expect(FREE_TIER.length).toBe(9);
    for (const id of FREE_TIER) expect(packById(id), id).toBeDefined();
  });

  it("ships three themes, three motion packs and four graphics packs", () => {
    const byKind = (kind: string) => PACKS.filter((pack) => pack.kind === kind);
    expect(byKind("theme")).toHaveLength(3);
    expect(byKind("motion")).toHaveLength(3);
    // Four: the three broadcast packs plus the tactical esports pack.
    expect(byKind("graphics")).toHaveLength(4);
  });

  it("covers the jobs a broadcaster actually has", () => {
    // Three templates cannot demonstrate a broadcast platform, which was the
    // largest gap in the August product audit. Breadth is the claim, so breadth
    // is what is asserted: news, sport, events and sponsorship each reachable
    // from the free tier without buying anything.
    const ids = new Set(templatesOf().map((template) => template.id));
    for (const id of [
      "tpl_lower_third",
      "tpl_title_card",
      "tpl_sponsor",
      "tpl_ticker",
      "tpl_breaking",
      "tpl_scoreboard",
      "tpl_leaderboard",
      "tpl_countdown",
    ]) {
      expect(ids, id).toContain(id);
    }
    // The eight broadcast graphics, plus the tactical pack's three. Asserted as a
    // COUNT alongside the named list above so a template that is added without a
    // name here still has to be a deliberate change to this number.
    for (const id of ["tpl_tac_scoreboard", "tpl_tac_player", "tpl_tac_round"]) {
      expect(ids, id).toContain(id);
    }
    expect(ids.size).toBe(11);
  });

  it("gives every starter graphic an entrance", () => {
    // A template that lands with a cut is a picture. Every one ships with the
    // motion it needs, so a designer never has to build an "In" before they can
    // put something to air.
    for (const template of templatesOf()) {
      const built = instantiateTemplate(
        template,
        testIdFactory(),
        "2026-08-03T00:00:00.000Z",
      );
      const timelines = built.animations ?? [];
      expect(timelines.length, template.name).toBeGreaterThan(0);
      expect(
        timelines.some((timeline) => timeline.name === "In"),
        template.name,
      ).toBe(true);
      for (const timeline of timelines) {
        expect(timeline.tracks.length, `${template.name}/${timeline.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("survives a preference store that dropped it", () => {
    // A corrupt preference must not take a user's starter content away.
    const store = new Map<string, string>();
    saveWorkspace(
      { ...DEFAULT_WORKSPACE, installedPacks: [] },
      {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
    );
    const loaded = loadWorkspace({
      getItem: (key) => store.get(key) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    for (const id of FREE_TIER) expect(loaded.installedPacks).toContain(id);
  });

  it("surfaces only the motion an installed pack curates", () => {
    // A motion pack ships no code — it names presets that already exist. That
    // is what keeps a Marketplace item a data download rather than a plugin.
    const essentials = presetsOf(new Set(["pack_motion_essentials"]));
    expect(essentials).toContain("fade-in");
    expect(essentials).not.toContain("shake");
    expect(presetsOf(new Set())).toEqual([]);

    // Every curated id must be a preset that exists, or a pack would offer a
    // move that does nothing.
    for (const id of presetsOf(new Set(FREE_TIER))) {
      expect(PRESETS.some((preset) => preset.id === id), id).toBe(true);
    }
  });
});

// ===========================================================================
// Templates are products, not demo scenes
// ===========================================================================

describe("templates", () => {
  const now = "2026-08-03T00:00:00.000Z";

  it("build documents the engine accepts and renders", () => {
    for (const template of templatesOf()) {
      const built = instantiateTemplate(template, testIdFactory(), now);
      const result = validateDocument(built);
      expect(result.valid, `${template.name}: ${JSON.stringify(result.errors[0])}`).toBe(true);

      const provider = new HostTextProvider({ pageSize: 512, pxRange: 4 });
      for (const font of STUDIO_FONTS) {
        provider.addFont(font.assetId, new Uint8Array(readFileSync(FONT)));
      }
      const backend = new MockMirrorBackend();
      const studio = new StudioSession(backend, built, { text: provider });
      studio.render();

      // Something was actually drawn. A template that validates and renders
      // nothing is a demo scene with good manners.
      const drawn = backend.snapshot().nodes.filter((node) => node.attachment === "mesh");
      expect(drawn.length, template.name).toBeGreaterThan(1);
      studio.dispose();
    }
  });

  it("expose every changeable field as a variable", () => {
    // The difference between a template and a picture: a producer changes it
    // without opening the editor.
    for (const template of templatesOf()) {
      const built = instantiateTemplate(template, testIdFactory(), now);
      expect(built.variables.length, template.name).toBeGreaterThan(0);
      for (const variable of built.variables) {
        expect(variable.key).not.toBe("");
        expect(variable.default).toBeDefined();
      }
    }
  });

  it("animate, using the ordinary timeline", () => {
    for (const template of templatesOf()) {
      const built = instantiateTemplate(template, testIdFactory(), now);
      expect((built.animations ?? []).length, template.name).toBeGreaterThan(0);
      for (const timeline of built.animations ?? []) {
        expect(timeline.tracks.length).toBeGreaterThan(0);
        expect(timeline.duration).toBeGreaterThan(0);
      }
    }
  });

  it("bind their colours to styles, so a theme restyles them", () => {
    // The mechanism behind "install a theme pack". A template that baked its
    // colours in would be a picture.
    const midnight = packById("pack_theme_midnight")!;
    const red = packById("pack_theme_broadcast_red")!;

    const withMidnight = instantiateTemplate(
      templateById("tpl_lower_third")!,
      testIdFactory(),
      now,
      midnight.tokens ?? [],
    );
    const withRed = instantiateTemplate(
      templateById("tpl_lower_third")!,
      testIdFactory(),
      now,
      red.tokens ?? [],
    );

    // Found by NAME, which is the point: a designer's layer name is the stable
    // handle, not a generated id.
    const accentOf = (document_: typeof withMidnight): unknown => {
      let found: unknown;
      const walk = (node: { name?: string; components?: readonly { props?: unknown }[]; children?: readonly unknown[] }) => {
        if (node.name === "Accent Bar") {
          found = (node.components?.[0]?.props as { fill?: unknown } | undefined)?.fill;
        }
        for (const child of (node.children ?? []) as never[]) walk(child);
      };
      walk(document_.root as never);
      return found;
    };
    // The fill is a REFERENCE, identical in both documents. This previously
    // asserted a baked hex string — which the test's own name says is wrong,
    // and which meant applying a theme to an open graphic repainted nothing.
    expect(accentOf(withMidnight)).toEqual({ $var: "color.primary" });
    expect(accentOf(withRed)).toEqual({ $var: "color.primary" });

    // What differs is the palette the reference resolves against, and it
    // travels with the document so the graphic stays restyleable once saved.
    const primaryOf = (document_: typeof withMidnight): unknown =>
      document_.tokens?.find((token) => token.name === "color.primary")?.value;
    expect(primaryOf(withMidnight)).toBe("#2f6feb");
    expect(primaryOf(withRed)).toBe("#d7263d");
    expect(withRed.tokens).toHaveLength(5);
  });

  it("declare the fonts and pre-warm they need", () => {
    const built = instantiateTemplate(templateById("tpl_lower_third")!, testIdFactory(), now);
    expect(built.assets.filter((asset) => asset.kind === "font").length).toBe(
      STUDIO_FONTS.length,
    );
    // TEXT_ENGINE §5: rasterise what live data will draw from, at load.
    expect(built.world.textPrewarm?.ranges).toContain("latin");
  });

  it("reference only assets they declare, and nothing the engine cannot draw", () => {
    // ======================================================================
    // THIS TEST USED TO SAY "contain no image, because the engine cannot draw
    // one"
    // ======================================================================
    // IF-005 is now closed for rasters, so that premise is false and the rule
    // it protected has to be restated rather than deleted. The rule was never
    // "no images" — it was **a pack must not ship content that does not
    // appear**, because one broken item teaches a user to distrust the whole
    // Marketplace.
    //
    // So: every image a template references must resolve to an asset the
    // document declares, and the formats still not implemented stay out.
    for (const template of templatesOf()) {
      const built = instantiateTemplate(template, testIdFactory(), now);
      const declared = new Set(built.assets.map((asset) => asset.id));
      const defaults = new Map(
        built.variables.map((variable) => [variable.key, variable.default]),
      );

      const walk = (node: { components?: readonly { type?: string; props?: unknown }[]; children?: readonly unknown[] }) => {
        for (const component of node.components ?? []) {
          if (component.type !== "image") continue;
          const raw = (component.props as { assetId?: unknown })?.assetId;
          // Bound to a variable, which is the whole point — so the ASSET the
          // variable defaults to is what has to exist.
          const assetId =
            typeof raw === "object" && raw !== null && "$var" in raw
              ? defaults.get((raw as { $var: string }).$var)
              : raw;
          expect(typeof assetId, `${template.name}: image assetId`).toBe("string");
          expect(declared, `${template.name}: ${String(assetId)}`).toContain(assetId);
        }
        for (const child of (node.children ?? []) as never[]) walk(child);
      };
      walk(built.root as never);

      const json = canonicalize(built);
      for (const forbidden of ['"video"', '"svg"']) {
        expect(json, template.name).not.toContain(forbidden);
      }
    }
  });
});

// ===========================================================================
// Themes
// ===========================================================================

describe("themes", () => {
  it("apply as one undoable edit", () => {
    // A designer trying three palettes must get back with three presses.
    const studio = session();
    const depth = studio.store.depth;
    const txn = installTheme(studio.document, packById("pack_theme_broadcast_red")!)!;
    studio.store.apply(txn);

    expect(studio.store.depth).toBe(depth + 1);
    expect(txn.operations).toHaveLength(1);
    expect(colourTokens(studio.document)).toHaveLength(5);

    studio.store.undo();
    expect(colourTokens(studio.document)).toHaveLength(0);
    studio.dispose();
  });

  it("do not touch a single node", () => {
    // The whole argument for tokens: restyling is a document-level edit, not a
    // sweep over the tree.
    const studio = session();
    const before = canonicalize({ ...studio.document, tokens: undefined });
    studio.store.apply(installTheme(studio.document, packById("pack_theme_midnight")!)!);
    expect(canonicalize({ ...studio.document, tokens: undefined })).toBe(before);
    studio.dispose();
  });

  it("repaint the graphics already on the canvas", () => {
    // ======================================================================
    // THE TEST THIS BLOCK WAS MISSING
    // ======================================================================
    // Templates used to bake token VALUES at instantiation. Applying a palette
    // rewrote `tokens` and the canvas did not move — the third of the seven
    // things a designer does, silently dead. Every other test here passed
    // throughout, including "do not touch a single node", which passed
    // PRECISELY BECAUSE nothing repainted.
    //
    // So this asserts the only thing that matters: writes reach the backend.
    const backend = new MockMirrorBackend();
    const provider = new HostTextProvider({ pageSize: 512, pxRange: 4 });
    for (const font of STUDIO_FONTS) {
      provider.addFont(font.assetId, new Uint8Array(readFileSync(FONT)));
    }
    const document_ = instantiateTemplate(
      templateById("tpl_lower_third")!,
      ids,
      "2026-01-01T00:00:00.000Z",
    );
    const studio = new StudioSession(backend, document_, { text: provider });

    backend.resetWriteCount();
    studio.store.apply(installTheme(studio.document, packById("pack_theme_broadcast_red")!)!);
    expect(backend.writeCount).toBeGreaterThan(0);

    // And a palette the graphic already uses costs nothing, because the
    // Marketplace offers a one-click Apply on every pack.
    backend.resetWriteCount();
    const again = installTheme(studio.document, packById("pack_theme_broadcast_red")!);
    expect(again).toBeNull();
    expect(backend.writeCount).toBe(0);
    studio.dispose();
  });

  it("re-applying the same theme is not an edit", () => {
    const studio = session();
    const midnight = packById("pack_theme_midnight")!;
    studio.store.apply(installTheme(studio.document, midnight)!);
    expect(installTheme(studio.document, midnight)).toBeNull();
    studio.dispose();
  });
});

// ===========================================================================
// Nothing was lost
// ===========================================================================

describe("nothing was lost", () => {
  it("keeps every editor capability reachable", () => {
    // Phase 4 moved things; it deleted nothing. If a capability stopped being
    // reachable, that is a regression rather than a simplification.
    const studio = session();
    expect(studio.store.canUndo).toBe(false);
    expect(typeof studio.overrideVariable).toBe("function");
    expect(typeof studio.playClip).toBe("function");
    expect(studio.host.reconciler.stats().mirrorNodes).toBeGreaterThan(0);
    studio.dispose();
  });

  it("leaves the engine's own vocabulary intact where it belongs", () => {
    // Developer Mode is a UI decision, not an engine one. The engine still
    // calls a mirror a mirror.
    const studio = session();
    expect(studio.host.reconciler.mirror).toBeDefined();
    expect(studio.host.lastReport).not.toBeUndefined();
    studio.dispose();
  });
});
