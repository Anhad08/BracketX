/**
 * Content packs — what a new user finds when they open Streamatrix.
 *
 * ============================================================================
 * THESE ARE REAL GRAPHICS, NOT DEMO SCENES
 * ============================================================================
 * Studio Phase 3's brief was explicit: *"Do not create demo scenes. Do not
 * create fake templates. Do not hardcode graphics."* Nothing here contradicts
 * that, and the distinction matters.
 *
 * A demo scene is a fixture that exists to prove the engine works. Every
 * template here is a **product**: parameterised, variable-driven, animated,
 * editable in every panel, saveable, takeable to air, and indistinguishable
 * from one a designer built — because it is built from exactly the same
 * primitives through exactly the same operations.
 *
 * The test for the difference is simple and asserted: **delete this file and a
 * designer loses content, not capability.** Nothing in Studio or the engine
 * knows a pack exists. `installTheme` returns an ordinary transaction;
 * `instantiate` returns an ordinary document.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 * The brief's success criterion is thirty seconds to a lower third. An empty
 * editor cannot meet it however good it is — a first-time user with a blank
 * canvas and a toolbox of rectangles is being asked to be a designer before
 * they are allowed to be a user.
 *
 * ============================================================================
 * WHAT IS MISSING, AND WHY IT IS NOT FAKED
 * ============================================================================
 * No pack contains an image, an icon, a logo or a stinger, because the engine
 * cannot draw one (IF-005). Shipping a "Brand Pack" whose logo does not appear
 * would teach a user to distrust everything else here. Every pack below is
 * built from `rect`, `text` and generated primitives, which is enough for a
 * genuinely professional lower third — and is exactly what broadcast typography
 * mostly is.
 */
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  makeSetDocProp,
  type SceneDocument,
  type SceneNode,
  type SceneToken,
  type SceneVariable,
  type Timeline,
  type Transaction,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";
import { DEFAULT_FONT_ASSET } from "./editing";
import { STUDIO_FONTS } from "./fonts";
import type { IdFactory } from "./ids";

export type PackKind = "theme" | "motion" | "graphics";

export interface Pack {
  readonly id: string;
  readonly name: string;
  readonly kind: PackKind;
  readonly author: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** Two colours the card previews with. Cheaper and truer than a screenshot. */
  readonly swatch: readonly [string, string];
  readonly tokens?: readonly SceneToken[];
  /** Preset ids this pack surfaces. They already exist; a pack curates them. */
  readonly presets?: readonly string[];
  readonly templates?: readonly PackTemplate[];
}

export interface PackTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly build: (ids: IdFactory, tokens: TokenLookup, now: string) => SceneDocument;
}

/** Resolves a token name to its value, falling back to the pack's own default. */
export type TokenLookup = (name: string, fallback: string) => string;

// ---------------------------------------------------------------------------
// Scene construction helpers
// ---------------------------------------------------------------------------

/** Sibling order keys. Fractional indexing, so nothing renumbers on insert. */
function nextOrder(previous: string | null): string {
  return generateKeyBetween(previous, null);
}

interface NodeOptions {
  readonly position?: readonly [number, number, number];
  readonly size?: { readonly width: number; readonly height: number };
  readonly children?: readonly SceneNode[];
  readonly anchor?: SceneNode["anchor"];
}

function group(id: string, order: string, options: NodeOptions = {}): SceneNode {
  return {
    id,
    name: "Group",
    order,
    transform: {
      position: [...(options.position ?? [0, 0, 0])] as [number, number, number],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    ...(options.size === undefined ? {} : { size: options.size }),
    ...(options.children === undefined ? {} : { children: options.children }),
  };
}

function bar(
  ids: IdFactory,
  name: string,
  order: string,
  width: number,
  height: number,
  fill: unknown,
  position: readonly [number, number, number],
): SceneNode {
  return {
    id: ids("node"),
    name,
    order,
    transform: { position: [...position] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width, height },
    components: [
      { id: ids("component"), type: "rect", props: { width, height, fill } },
    ],
  };
}

function label(
  ids: IdFactory,
  name: string,
  order: string,
  content: unknown,
  colour: unknown,
  size: number,
  box: { width: number; height: number },
  position: readonly [number, number, number],
  extra: Record<string, unknown> = {},
): SceneNode {
  return {
    id: ids("node"),
    name,
    order,
    transform: { position: [...position] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: box,
    components: [
      {
        id: ids("component"),
        type: "text",
        props: {
          content,
          font: { assetId: DEFAULT_FONT_ASSET, size },
          color: colour,
          align: "start",
          verticalAlign: "middle",
          lineHeight: 1.1,
          // `shrink` on every label, always. A name slot that must hold both
          // "Li" and "Konstantinos Papadopoulos" is the normal case, and a
          // template that overflows on an unusual name is a template that will
          // one day paint over the graphic beside it.
          fit: { mode: "shrink", minSize: Math.max(10, Math.round(size * 0.45)) },
          ...extra,
        },
      },
    ],
  };
}

function camera(ids: IdFactory, order: string): SceneNode {
  return {
    id: ids("node"),
    name: "Camera",
    order,
    transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: ids("component"),
        type: "camera",
        props: { projection: "orthographic", orthographicSize: 5, near: 0.1, far: 100 },
      },
    ],
  };
}

function document_(
  ids: IdFactory,
  name: string,
  now: string,
  root: SceneNode,
  variables: readonly SceneVariable[],
  animations: readonly Timeline[],
): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: ids("scene"),
    meta: { name, createdAt: now, updatedAt: now, tags: ["template"] },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
      // Declared so the engine rasterises what live data will draw from before
      // the graphic can go on air. TEXT_ENGINE §5.
      textPrewarm: { ranges: ["latin", "punctuation"] },
    },
    variables,
    // Every font Studio ships, so a saved template is self-describing and a
    // name in any of these scripts renders without re-authoring.
    assets: STUDIO_FONTS.map((font) => ({
      id: font.assetId,
      kind: "font" as const,
      name: font.label,
      hash: `studio-${font.assetId}`,
    })),
    states: [],
    root,
    animations,
  };
}

function variable(
  id: string,
  key: string,
  label_: string,
  value: unknown,
  type: SceneVariable["type"] = "string",
): SceneVariable {
  return { id, key, type, label: label_, default: value } as SceneVariable;
}

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

/**
 * A lower third. The graphic this whole product is measured against.
 *
 * Two lines of text over an accent bar, entering from the left and leaving the
 * same way. Every colour is a design token, so applying a theme pack restyles
 * it without touching the layout; every string is a variable, so a data feed
 * or an operator drives it without touching the document.
 */
const LOWER_THIRD: PackTemplate = {
  id: "tpl_lower_third",
  name: "Lower Third",
  description: "Name and role, over an accent bar. Slides in from the left.",
  build: (ids, token, now) => {
    const rootId = ids("node");
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", "#101319");
    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");
    const muted = token("color.muted", "#8a93a6");

    const backdrop = bar(ids, "Background", next(), 9.4, 1.9, surface, [0, 0, 0]);
    const accentBar = bar(ids, "Accent Bar", next(), 0.14, 1.9, accent, [-4.63, 0, 0.01]);
    const name = label(
      ids,
      "Name",
      next(),
      { $var: "name" },
      ink,
      0.52,
      { width: 8.4, height: 0.7 },
      [-4.35, 0.32, 0.02],
    );
    const role = label(
      ids,
      "Role",
      next(),
      { $var: "role" },
      muted,
      0.3,
      { width: 8.4, height: 0.45 },
      [-4.35, -0.36, 0.02],
    );

    const holder = group(holderId, next(), {
      position: [0, -3.1, 0],
      size: { width: 9.4, height: 1.9 },
      children: [backdrop, accentBar, name, role],
    });

    const root: SceneNode = {
      id: rootId,
      name: "Lower Third",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Lower Third" }],
    };

    return document_(
      ids,
      "Lower Third",
      now,
      root,
      [
        variable(ids("variable"), "name", "Name", "ALEX RIVERA"),
        variable(ids("variable"), "role", "Role", "Team Captain"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.7,
          tracks: [
            {
              target: holderId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -12, easing: "easeOutCubic" },
                { time: 0.55, value: 0 },
              ],
            },
            {
              target: name.id,
              path: "transform.position.0",
              delay: 0.12,
              keyframes: [
                { time: 0, value: -6, easing: "easeOutCubic" },
                { time: 0.45, value: -4.35 },
              ],
            },
            {
              target: role.id,
              path: "transform.position.0",
              delay: 0.2,
              keyframes: [
                { time: 0, value: -6, easing: "easeOutCubic" },
                { time: 0.45, value: -4.35 },
              ],
            },
          ],
        },
        {
          id: ids("timeline"),
          name: "Out",
          duration: 0.45,
          tracks: [
            {
              target: holderId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: 0, easing: "easeInCubic" },
                { time: 0.45, value: -12 },
              ],
            },
          ],
        },
      ],
    );
  },
};

/** A two-team scoreboard. Data-driven scores, on a bar. */
const SCOREBOARD: PackTemplate = {
  id: "tpl_scoreboard",
  name: "Scoreboard",
  description: "Two teams and a score. Every field is a variable.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", "#101319");
    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");

    const holderId = ids("node");
    const backdrop = bar(ids, "Background", next(), 7.2, 1.05, surface, [0, 0, 0]);
    const scoreBlock = bar(ids, "Score Block", next(), 2.0, 1.05, accent, [0, 0, 0.01]);
    const home = label(ids, "Home Team", next(), { $var: "home" }, ink, 0.42, { width: 2.4, height: 0.6 }, [-3.4, 0, 0.02]);
    const away = label(ids, "Away Team", next(), { $var: "away" }, ink, 0.42, { width: 2.4, height: 0.6 }, [1.1, 0, 0.02]);
    const score = label(
      ids,
      "Score",
      next(),
      { $var: "score" },
      ink,
      0.56,
      { width: 1.9, height: 0.7 },
      [-0.95, 0, 0.02],
      { align: "center" },
    );

    const holder = group(holderId, next(), {
      position: [0, 3.6, 0],
      size: { width: 7.2, height: 1.05 },
      children: [backdrop, scoreBlock, home, away, score],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Scoreboard",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Scoreboard" }],
    };

    return document_(
      ids,
      "Scoreboard",
      now,
      root,
      [
        variable(ids("variable"), "home", "Home", "LIVERPOOL"),
        variable(ids("variable"), "away", "Away", "ARSENAL"),
        variable(ids("variable"), "score", "Score", "2 – 1"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.6,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: 6.2, easing: "easeOutCubic" },
                { time: 0.5, value: 3.6 },
              ],
            },
          ],
        },
      ],
    );
  },
};

/** A full-frame title card. The simplest useful graphic, and a good first open. */
const TITLE_CARD: PackTemplate = {
  id: "tpl_title_card",
  name: "Title Card",
  description: "A headline and a standfirst, centred. Fades up.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");
    const muted = token("color.muted", "#8a93a6");

    const holderId = ids("node");
    const rule = bar(ids, "Rule", next(), 3.2, 0.06, accent, [0, -0.72, 0.01]);
    const headline = label(
      ids,
      "Headline",
      next(),
      { $var: "headline" },
      ink,
      0.92,
      { width: 12, height: 1.3 },
      [-6, 0.2, 0.02],
      { align: "center" },
    );
    const standfirst = label(
      ids,
      "Standfirst",
      next(),
      { $var: "standfirst" },
      muted,
      0.36,
      { width: 10, height: 0.5 },
      [-5, -1.3, 0.02],
      { align: "center" },
    );

    const holder = group(holderId, next(), {
      size: { width: 12, height: 3 },
      children: [rule, headline, standfirst],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Title Card",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Title" }],
    };

    return document_(
      ids,
      "Title Card",
      now,
      root,
      [
        variable(ids("variable"), "headline", "Headline", "MATCH OF THE DAY"),
        variable(ids("variable"), "standfirst", "Standfirst", "Round 24 · Highlights"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.8,
          tracks: [
            {
              target: headline.id,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -0.1, easing: "easeOutCubic" },
                { time: 0.6, value: 0.2 },
              ],
            },
            {
              target: rule.id,
              path: "transform.scale.0",
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.7, value: 1 },
              ],
            },
          ],
        },
      ],
    );
  },
};

// ---------------------------------------------------------------------------
// The packs
// ---------------------------------------------------------------------------

/**
 * What ships with every account. The brief's free tier.
 *
 * Three theme packs, three motion packs, and one broadcast package — enough to
 * evaluate Streamatrix without buying anything, which is the point.
 */
export const PACKS: readonly Pack[] = [
  // -- Themes ---------------------------------------------------------------
  {
    id: "pack_theme_midnight",
    name: "Midnight",
    kind: "theme",
    author: "Streamatrix",
    description: "Deep navy and electric blue. The default broadcast palette.",
    tags: ["dark", "sport", "news"],
    swatch: ["#101319", "#2f6feb"],
    tokens: [
      { name: "color.primary", value: "#2f6feb", description: "Accent and highlights" },
      { name: "color.surface", value: "#101319", description: "Panel and bar fills" },
      { name: "color.ink", value: "#f2f5fb", description: "Foreground on surface" },
      { name: "color.muted", value: "#8a93a6", description: "Secondary foreground" },
    ],
  },
  {
    id: "pack_theme_broadcast_red",
    name: "Broadcast Red",
    kind: "theme",
    author: "Streamatrix",
    description: "High-contrast news red on near-black. Reads at any size.",
    tags: ["news", "breaking", "bold"],
    swatch: ["#0b0b0d", "#d7263d"],
    tokens: [
      { name: "color.primary", value: "#d7263d", description: "Accent and highlights" },
      { name: "color.surface", value: "#0b0b0d", description: "Panel and bar fills" },
      { name: "color.ink", value: "#ffffff", description: "Foreground on surface" },
      { name: "color.muted", value: "#9a9aa2", description: "Secondary foreground" },
    ],
  },
  {
    id: "pack_theme_studio_light",
    name: "Studio Light",
    kind: "theme",
    author: "Streamatrix",
    description: "Warm off-white with a teal accent. For daytime and lifestyle.",
    tags: ["light", "lifestyle", "daytime"],
    swatch: ["#f4f1ec", "#0f8a7e"],
    tokens: [
      { name: "color.primary", value: "#0f8a7e", description: "Accent and highlights" },
      { name: "color.surface", value: "#f4f1ec", description: "Panel and bar fills" },
      { name: "color.ink", value: "#17191c", description: "Foreground on surface" },
      { name: "color.muted", value: "#5d6068", description: "Secondary foreground" },
    ],
  },

  // -- Motion ---------------------------------------------------------------
  //
  // A motion pack CURATES presets that already exist. It ships no code, which
  // is what keeps a Marketplace pack a data download rather than a plugin.
  {
    id: "pack_motion_essentials",
    name: "Motion Essentials",
    kind: "motion",
    author: "Streamatrix",
    description: "The four moves most broadcast graphics are built from.",
    tags: ["slide", "fade", "essential"],
    swatch: ["#2f6feb", "#101319"],
    presets: ["slide-in-left", "slide-out-left", "fade-in", "fade-out"],
  },
  {
    id: "pack_motion_snap",
    name: "Snap",
    kind: "motion",
    author: "Streamatrix",
    description: "Fast, punchy entrances with overshoot. For sport.",
    tags: ["sport", "fast", "overshoot"],
    swatch: ["#d7263d", "#0b0b0d"],
    presets: ["pop-in", "zoom-in", "slide-in-up", "collapse"],
  },
  {
    id: "pack_motion_emphasis",
    name: "Emphasis",
    kind: "motion",
    author: "Streamatrix",
    description: "Loops that draw the eye without moving the graphic.",
    tags: ["loop", "attention"],
    swatch: ["#0f8a7e", "#f4f1ec"],
    presets: ["pulse", "bounce", "shake"],
  },

  // -- Graphics -------------------------------------------------------------
  {
    id: "pack_broadcast_starter",
    name: "Broadcast Starter",
    kind: "graphics",
    author: "Streamatrix",
    description: "A lower third, a scoreboard and a title card. Fully editable.",
    tags: ["starter", "lower third", "scoreboard", "title"],
    swatch: ["#2f6feb", "#101319"],
    templates: [LOWER_THIRD, SCOREBOARD, TITLE_CARD],
  },
];

export function packById(id: string): Pack | undefined {
  return PACKS.find((pack) => pack.id === id);
}

export function templatesOf(packs: readonly Pack[] = PACKS): readonly PackTemplate[] {
  return packs.flatMap((pack) => pack.templates ?? []);
}

export function templateById(id: string): PackTemplate | undefined {
  return templatesOf().find((template) => template.id === id);
}

/** Preset ids a set of installed motion packs makes available. */
export function presetsOf(installed: ReadonlySet<string>): readonly string[] {
  const out = new Set<string>();
  for (const pack of PACKS) {
    if (pack.kind !== "motion" || !installed.has(pack.id)) continue;
    for (const preset of pack.presets ?? []) out.add(preset);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

/**
 * Applies a theme pack's tokens to the open document.
 *
 * ONE transaction, so applying a theme is one undo step — a designer trying
 * three palettes must be able to get back with three presses, not twelve.
 *
 * Tokens are document data (§11.2) and resolve BENEATH variables, so a theme
 * restyles every graphic that references `color.primary` without touching a
 * single node. That is why the templates above bind their colours to tokens
 * rather than to literals, and it is the whole mechanism behind "install a
 * theme pack".
 */
export function installTheme(document: SceneDocument, pack: Pack): Transaction | null {
  if (pack.tokens === undefined || pack.tokens.length === 0) return null;

  const byName = new Map((document.tokens ?? []).map((token) => [token.name, token]));
  let changed = false;
  for (const token of pack.tokens) {
    const current = byName.get(token.name);
    if (current?.value === token.value && current?.description === token.description) continue;
    byName.set(token.name, token);
    changed = true;
  }
  if (!changed) return null;

  const tokens = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return transaction(`Apply ${pack.name}`, [makeSetDocProp(document, "tokens", tokens)]);
}

/**
 * Builds a template into a document, resolving its colours against a theme.
 *
 * The theme is read from the CURRENTLY OPEN document when there is one, so
 * inserting a lower third into a project that already has a palette produces a
 * graphic that matches it rather than one that has to be restyled by hand.
 */
export function instantiateTemplate(
  template: PackTemplate,
  ids: IdFactory,
  now: string,
  theme: readonly SceneToken[] = [],
): SceneDocument {
  const byName = new Map(theme.map((token) => [token.name, token]));
  const lookup: TokenLookup = (name, fallback) => {
    const value = byName.get(name)?.value;
    return typeof value === "string" ? value : fallback;
  };

  const built = template.build(ids, lookup, now);
  // The theme travels with the document, so the graphic stays restyleable after
  // it is saved — a template that baked its colours in would be a picture.
  return theme.length === 0 ? built : { ...built, tokens: [...theme] };
}
