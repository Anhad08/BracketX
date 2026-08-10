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
  type PaintSpecDoc,
  type SceneNode,
  type SceneToken,
  type VariableBinding,
  type SceneVariable,
  type Timeline,
  type Transaction,
} from "@bracketx/engine-scene";

import { transaction } from "./editing";
import { DEFAULT_FONT_ASSET } from "./editing";
import { STUDIO_FONTS } from "./fonts";
import { STUDIO_IMAGES } from "./images";
import {
  BREAKING,
  COUNTDOWN,
  LEADERBOARD,
  SPONSOR,
  TICKER,
} from "./essentials";
import {
  FACE,
  PALETTE,
  SIZE,
  STAGE_PPU,
  col,
  flagSpec,
  grounded,
  plane,
  recessed,
  rule,
  scrimSpec,
  veilSpec,
  sp,
  type_,
} from "./broadcast";
import type { IdFactory } from "./ids";

// Re-exported: the constant now lives with the design language that uses it.
export { STAGE_PPU };


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

/**
 * Emits a reference to a design token, and registers the default it stands for.
 *
 * It returns a BINDING rather than a hex string. That is the whole difference
 * between a themed graphic and a picture: the reference survives into the saved
 * document, so rewriting `tokens` — which is all installing a theme pack does —
 * repaints every graphic that points at them.
 *
 * An ordinary `$var`, not a token-specific form: the host resolves a variable
 * first and falls through to the token of that name, so one chain covers both
 * and an operator overriding a colour on air still wins (Project Alpha A6).
 *
 * The fallback is not a resolution fallback. It is the palette this template
 * ships with, seeded onto the document at instantiation so a graphic built into
 * an untenanted project still has colours.
 */
export type TokenLookup = (name: string, fallback: string) => VariableBinding;

// ---------------------------------------------------------------------------
// Scene construction helpers
// ---------------------------------------------------------------------------

/** Sibling order keys. Fractional indexing, so nothing renumbers on insert. */
export function nextOrder(previous: string | null): string {
  return generateKeyBetween(previous, null);
}

interface NodeOptions {
  readonly position?: readonly [number, number, number];
  readonly size?: { readonly width: number; readonly height: number };
  readonly children?: readonly SceneNode[];
  readonly anchor?: SceneNode["anchor"];
}

export function group(id: string, order: string, options: NodeOptions = {}): SceneNode {
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

export function bar(
  ids: IdFactory,
  name: string,
  order: string,
  width: number,
  height: number,
  fill: unknown,
  position: readonly [number, number, number],
  /**
   * The plate's PAINT. Optional, and every shipped graphic should pass one.
   *
   * ========================================================================
   * A FLAT RECTANGLE IS WHAT A PLACEHOLDER LOOKS LIKE
   * ========================================================================
   * The engine has gained gradients, rounded corners, strokes and shadows, and
   * for a while none of the shipped graphics used any of them: every plate in
   * every template was one flat hex. That is exactly the "generic card
   * pretending to be a graphic" problem, and it was in the CONTENT rather than
   * in the renderer the whole time.
   *
   * Passed per plate rather than defaulted here, because the right paint differs
   * by role: a lower third's plate is elevated furniture, an accent flag is
   * deliberately flat so it reads as a flag, and a ticker strip wants almost no
   * radius because it runs to the frame edge.
   */
  paint?: PaintSpecDoc,
): SceneNode {
  return {
    id: ids("node"),
    name,
    order,
    transform: { position: [...position] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width, height },
    components: [
      {
        id: ids("component"),
        type: "rect",
        props: { width, height, fill, ...(paint === undefined ? {} : { paint }) },
      },
    ],
  };
}

/**
 * The paints the shipped graphics are built from.
 *
 * Named by the role they play in a broadcast frame, not by their parameters —
 * the same rule `finishes.ts` and `paints.ts` follow. Distances are in world
 * units and are chosen per plate size, because a corner radius that reads
 * correctly on a 9-unit strap is a pill on a 3-unit chip.
 */
export const PLATE = {
  /** Furniture that sits above the picture: a strap, a card, a scoreboard. */
  panel: (fill: unknown, side: number): PaintSpecDoc => ({
    cornerRadius: side * 0.1,
    ...ramp(fill, 78, -0.18, 0.09),
    stroke: {
      color: "#ffffff",
      width: Math.max(0.004, side * 0.012),
      opacity: 0.14,
      gradient: {
        kind: "linear",
        angle: 90,
        stops: [
          { at: 0, color: "#ffffff", opacity: 0.02 },
          { at: 1, color: "#ffffff", opacity: 0.55 },
        ],
      },
    },
    shadow: { color: "#000000", blur: side * 0.36, offsetY: -side * 0.09, opacity: 0.5 },
  }),

  /** A full-width strip. Almost no radius: it runs to the frame edge. */
  strip: (fill: unknown, side: number): PaintSpecDoc => ({
    cornerRadius: side * 0.04,
    ...ramp(fill, 90, -0.2, 0.06),
    shadow: { color: "#000000", blur: side * 0.5, offsetY: -side * 0.12, opacity: 0.45 },
  }),

  /**
   * An urgent flag: a kicker, a score block. Lit so it pulls the eye first.
   *
   * Its glow is the flag's OWN colour, which only exists when the fill is a
   * literal. A bound flag keeps its geometry and no glow — never a glow in a
   * colour this had to guess.
   */
  urgent: (fill: unknown, side: number): PaintSpecDoc => {
    const colour = literal(fill);
    return {
      cornerRadius: side * 0.06,
      ...ramp(fill, 78, 0.12, -0.16),
      ...(colour === null
        ? {}
        : { shadow: { color: colour, blur: side * 0.55, opacity: 0.5 } }),
    };
  },
} as const;

/**
 * A gradient derived from the plate's colour — or NOTHING, if there isn't one.
 *
 * ==========================================================================
 * A BOUND FILL GETS NO GRADIENT, RATHER THAN A GUESSED ONE
 * ==========================================================================
 * A pack's fills are `{ $var: "color.primary" }` so a theme can restyle them,
 * and a gradient stop cannot hold a binding. The first version of this fell back
 * to a dark literal when it could not resolve one — which painted the Breaking
 * News kicker, an accent-RED flag, in near-black. The graphic looked broken and
 * the cause was a fallback pretending to know a colour.
 *
 * So an unresolvable fill returns no gradient at all. The plate keeps its
 * geometry and its shadow, the flat bound fill shows through unchanged, and the
 * theme still owns the colour. Less decoration, and never the wrong one.
 */
function ramp(
  fill: unknown,
  angle: number,
  from: number,
  to: number,
): Pick<PaintSpecDoc, "gradient"> | Record<string, never> {
  const colour = literal(fill);
  if (colour === null) return {};
  return {
    gradient: {
      kind: "linear",
      angle,
      stops: [
        { at: 0, color: shade(colour, from) },
        { at: 1, color: shade(colour, to) },
      ],
    },
  };
}

/** The fill as a colour, or null when it is a binding. */
function literal(fill: unknown): string | null {
  return typeof fill === "string" && /^#[0-9a-fA-F]{3,8}$/.test(fill) ? fill : null;
}

/** Lightens or darkens a literal hex. */
function shade(hex: string, amount: number): string {
  const value = hex.replace(/^#/, "");
  if (value.length < 6) return hex;
  const to = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const part = (at: number): string => {
    const channel = parseInt(value.slice(at, at + 2), 16);
    const mixed = Math.round(channel + (to - channel) * t);
    return Math.max(0, Math.min(255, mixed)).toString(16).padStart(2, "0");
  };
  return `#${part(0)}${part(2)}${part(4)}`;
}



export function label(
  ids: IdFactory,
  name: string,
  order: string,
  content: unknown,
  colour: unknown,
  /** Design pixels. SCENE_FORMAT §7.2 — not world units. */
  size: number,
  box: { width: number; height?: number },
  position: readonly [number, number, number],
  extra: Record<string, unknown> = {},
): SceneNode {
  // Height is DERIVED from the font size, not hand-picked.
  //
  // `size` is design pixels; the box is world units, so the conversion goes
  // through STAGE_PPU. One line occupies about 1.35 ems for a typical face
  // ((ascender − descender + lineGap) / upem × lineHeight), and a box shorter
  // than that makes `shrink` shrink — correctly, and all the way to its floor.
  // 1.6 leaves room for a descender without the box driving the layout.
  const height = box.height ?? (size / STAGE_PPU) * 1.6;
  return {
    id: ids("node"),
    name,
    order,
    transform: { position: [...position] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: box.width, height },
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
          // PROPORTIONAL to the size, because `size` here is in WORLD units.
          // A constant floor written for pixel-sized text is larger than the
          // whole request at this scale.
          fit: { mode: "shrink", minSize: size * 0.55 },
          ...extra,
        },
      },
    ],
  };
}

/**
 * A logo. IF-005 — the component that did not exist until the asset pipeline.
 *
 * `assetId` is bound to a VARIABLE rather than written in, which is what makes
 * "replace a logo" an operator action instead of an edit: pointing `logo` at a
 * different asset swaps the sponsor mid-show through the same path a score
 * change takes.
 *
 * `fit: "contain"` is not decoration. A brand mark stretched to fill a box is
 * the most visible mistake this component can make.
 */
export function logo(
  ids: IdFactory,
  name: string,
  order: string,
  assetId: unknown,
  box: { width: number; height: number },
  position: readonly [number, number, number],
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
        type: "image",
        props: { assetId, fit: "contain" },
      },
    ],
  };
}

export function camera(ids: IdFactory, order: string): SceneNode {
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

export function document_(
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
      pixelsPerUnit: STAGE_PPU,
      // Declared so the engine rasterises what live data will draw from before
      // the graphic can go on air. TEXT_ENGINE §5.
      textPrewarm: { ranges: ["latin", "punctuation"] },
    },
    variables,
    // Every font Studio ships, so a saved template is self-describing and a
    // name in any of these scripts renders without re-authoring.
    assets: [
      // Every font Studio ships, so a saved template is self-describing and a
      // name in any of these scripts renders without re-authoring.
      ...STUDIO_FONTS.map((font) => ({
        id: font.assetId,
        kind: "font" as const,
        name: font.label,
        hash: `studio-${font.assetId}`,
      })),
      ...STUDIO_IMAGES.map((image) => ({
        id: image.assetId,
        kind: "texture" as const,
        name: image.label,
        hash: `studio-${image.assetId}`,
      })),
    ],
    states: [],
    root,
    animations,
  };
}

export function variable(
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
 * THE LOWER THIRD.
 *
 * ==========================================================================
 * THE COMPOSITION, AND WHAT IT REPLACED
 * ==========================================================================
 * What was here: one rounded rectangle 9.4 x 1.9, a 0.2-wide vertical stripe
 * near its left edge, a name at 60 and a role at 26, both in Inter Regular, and
 * a logo floating at the right end. Every criticism of it is structural rather
 * than parametric — it is a card with two lines of text in it, and no adjustment
 * to the radius, the stripe or the sizes changes that.
 *
 * What it is now, and why each part exists:
 *
 *   THE TAB      A solid accent block, full height of the assembly, holding the
 *                brand mark. It is the identity, it anchors the composition at
 *                the left, and it gives the name something to start against.
 *                Rule 3 — a flag with a job, not a stripe.
 *
 *   THE STEP     Two bands of DIFFERENT HEIGHT AND DIFFERENT WIDTH, the lower
 *                one about half the upper's height and half its length. That
 *                step is the silhouette: it reads as a lower third from across
 *                the room, before a word of it is legible, which is the actual
 *                test a broadcast graphic has to pass.
 *
 *   THE SCRIM    Both bands dissolve to nothing before the right edge of frame.
 *                Rule 1. There is no far edge to read, so the graphic sits IN
 *                the picture instead of on top of it — and the name gets the
 *                full contrast it needs without a box being drawn around it.
 *
 *   THE LIGHT    A four-pixel accent rule along the top of the name band,
 *                fading out with the scrim. It ties the tab's colour into the
 *                whole width and gives the flat top edge somewhere to end.
 *
 *   THE TYPE     Name in Bebas at 88 — caps, condensed, and 2.6x the role. Role
 *                in Barlow Medium at 34, mixed case, in muted ink. Rule 5: the
 *                caps/lowercase contrast comes from the FACE, so it is real
 *                rather than a `textTransform` the engine would have dropped.
 *
 * ==========================================================================
 * WHY THE CONDENSED FACE FIXED THE LONG-NAME PROBLEM
 * ==========================================================================
 * The old strap set the name at 60 rather than 68 because at 68 a long name
 * VANISHED: `shrink` floors at a fraction of the authored size, so a large
 * authored size raises the floor it cannot go under, and the layout gave up.
 * The name is now set LARGER, at 88, and a long name still fits — because Bebas
 * Condensed averages about 0.42 em per capital against Inter's 0.6. Measured on
 * the real worst case: "KONSTANTINOS PAPADOPOULOS" is 25 characters, so about
 * 925 px at 88, inside a 9.2-unit box that holds 993. It sets at full size with
 * room to spare, and the shrink floor is never reached at all.
 *
 * Choosing the right face bought two whole steps of hierarchy that no amount of
 * adjusting numbers could.
 */
const LOWER_THIRD: PackTemplate = {
  id: "tpl_lower_third",
  name: "Lower Third",
  description: "A name, a role and a brand tab. Steps in from the left.",
  build: (ids, token, now) => {
    const rootId = ids("node");
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const surfaceLift = token("color.surfaceLift", PALETTE.surfaceLift);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);

    // ====================================================================
    // THE GRID
    // ====================================================================
    // Every number below is derived from five: where the assembly starts, how
    // wide the tab is, how tall each band is, and where the floor sits. Nothing
    // is nudged. That is what makes this graphic and the other seven look like
    // one package — they are all measured from `col()` and `sp()` rather than
    // from each other.
    // OFF THE LEFT FRAME EDGE, not one column inside title-safe. The strap used
    // to be a 12-unit object floating in a 17.8-unit frame with air on both
    // sides, and air on the entering side is what made it read as a widget: a
    // broadcast strap is CUT by the edge it came from. The tab now starts beyond
    // the frame and the frame crops it, which costs nothing and is most of the
    // difference in presence.
    const x0 = -9.3;
    const tabW = 2.2;
    const bandH = sp(150); // the name band
    const subH = sp(72); // the role shelf, near half
    const floorY = -3.9; // the assembly's baseline
    const seamY = floorY + subH; // where the step happens
    const topY = seamY + bandH;
    const bodyX = x0 + tabW; // both bands start at the tab's edge
    const textX = bodyX + sp(34); // and the type insets from there

    // The name band. 11.2 wide and gone by 88% of it, so the dissolve happens
    // inside the frame rather than at its edge — which is the point.
    const backdrop = plane(
      ids,
      "Background",
      next(),
      15.0,
      bandH,
      surface,
      [bodyX + 7.5, seamY + bandH / 2, 0],
      // NO SHADOW ON A SCRIM, and the first render is why. A drop shadow is a
      // blur of the rect's SILHOUETTE, and a scrim's silhouette is the whole
      // rectangle including the part that has already faded to nothing — so the
      // band cast a hard-edged blurry ghost of itself across the picture, well
      // past where the plate was visible. A dissolving edge has nothing to cast
      // a shadow. Depth comes from the tab, which is solid and does.
      scrimSpec(PALETTE.surface, bandH, { width: 15.0, height: bandH }),
      { id: "scrim", from: PALETTE.surface },
    );

    // The role band: shorter, narrower, darker, and dissolving sooner. Three
    // differences rather than one, so it subordinates without needing a rule
    // drawn between them.
    const subBand = plane(
      ids,
      "Role Band",
      next(),
      7.4,
      subH,
      surfaceLift,
      [bodyX + 3.7, floorY + subH / 2, 0],
      // SOLID, where the band above it dissolves — and that contrast is the
      // point rather than an inconsistency. A shelf is small furniture carrying
      // two pieces of type at BOTH its ends, so it needs backing all the way
      // across; a scrim would have faded out under the context slot and left it
      // floating. It also gives the silhouette a hard step to read, which a wash
      // cannot. Big furniture dissolves, small furniture is cut.
      flagSpec(PALETTE.surfaceLift),
      { id: "flag", from: PALETTE.surfaceLift },
    );

    // The tab. Full height of both bands, so it reads as the thing the strap is
    // hinged on. Named "Accent Bar" because that is what every test, preset and
    // saved document already calls it.
    const accentBar = plane(
      ids,
      "Accent Bar",
      next(),
      tabW,
      // OVERSHOOTING THE BAND by a few pixels, so the tab reads as a post the
      // bands hang from rather than as the third rectangle in a row of three.
      // The whole composition is horizontal; this is the one mark that is not.
      bandH + subH + sp(14),
      accent,
      [x0 + tabW / 2, (floorY + topY) / 2 + sp(7), 0.01],
      flagSpec(PALETTE.primary),
      { id: "flag", from: PALETTE.primary },
    );

    // The light line along the top of the name band, fading with the scrim.
    const light = plane(
      ids,
      "Accent Rule",
      next(),
      11.4,
      sp(6),
      accent,
      [bodyX + 5.7, topY - sp(3), 0.02],
      rule(PALETTE.primary, 0.95),
    );

    // RULE 4 — the seam. A hairline where the step happens, so the two orders of
    // information are separated even where the shelf's lift is too subtle to see
    // it over a bright picture. It spans the SHELF, not the band, because that is
    // the edge it belongs to.
    const seam = plane(
      ids,
      "Seam",
      next(),
      7.4,
      sp(2),
      ink,
      [bodyX + 3.7, seamY + sp(1), 0.02],
      rule(PALETTE.ink, 0.45),
    );

    // Centred in the VISIBLE part of the tab, not in the tab itself: the frame
    // crops its left edge, so a mark centred on the full block sits off-centre in
    // the only part anybody sees.
    const mark = logo(ids, "Logo", next(), { $var: "logo" }, { width: 1.16, height: 1.16 }, [
      (-8.89 + x0 + tabW) / 2,
      (floorY + topY) / 2,
      0.03,
    ]);

    const name = type_(ids, "Name", next(), { $var: "name" }, {
      face: FACE.display,
      // 130. The name is what this graphic is for, and at 100 in a frame this
      // size it was one of several things on screen rather than the subject.
      size: 130,
      colour: ink,
      box: { width: 9.2 },
      // Left edge and optical centre. Nudged up by a hair because Bebas has no
      // descenders to balance its caps, so a mathematically centred line of it
      // sits visibly low in a band.
      at: [textX, seamY + bandH / 2 + sp(3), 0.02],
    });

    const role = type_(ids, "Role", next(), { $var: "role" }, {
      face: FACE.text,
      size: 38,
      colour: muted,
      box: { width: 4.4 },
      at: [textX, floorY + subH / 2, 0.02],
    });

    // ANCHORED AT THE RIGHT END OF THE SHELF, and it is there for a compositional
    // reason as much as an editorial one. A slot with type at both ends reads as
    // measured; the same slot with type at one end and nothing at the other reads
    // as unfinished, and that is the difference between air and dead space.
    //
    // It sits on the SHELF rather than on the name band because the band's whole
    // right half is the dissolve — there is nothing opaque out there to anchor
    // anything against, and putting type over the wash would undo it.
    const context = type_(ids, "Context", next(), { $var: "context" }, {
      face: FACE.context,
      size: 30,
      colour: muted,
      box: { width: 2.6 },
      align: "end",
      at: [bodyX + 7.4 - 2.6 - sp(26), floorY + subH / 2, 0.02],
    });

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: 15.0 + tabW, height: bandH + subH },
      // In CREATION order, which is also ascending order-key order — the
      // engine rejects a parent whose children are not sorted, and the array is
      // the paint order, so the two have to be decided together.
      children: [backdrop, subBand, accentBar, light, seam, mark, name, role, context],
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
        // MIXED CASE, because the face has it. The old default shouted "TEAM
        // CAPTAIN" in caps to fake a caption, which is what you do when every
        // line is set in the same face and you have no other way to separate
        // them. Barlow has lowercase; use it.
        variable(ids("variable"), "role", "Role", "Sports Analyst"),
        variable(ids("variable"), "context", "Context", "MATCH OF THE DAY"),
        variable(ids("variable"), "logo", "Logo", STUDIO_IMAGES[0]!.assetId, "asset"),
      ],
      [
        {
          // ============================================================
          // THE REVEAL: THE STRAP ARRIVES, THEN THE LIGHT RUNS ALONG IT
          // ============================================================
          // The assembly comes in from off-frame left — off-frame, so nothing is
          // ever half-drawn on the way — and settles. Then the accent rule WIPES
          // open from the tab's edge, which is the one flourish this graphic
          // gets. A wipe is a scale on one axis with the position compensated to
          // hold the growing edge still, because a node scales about its centre;
          // without the second track the line blooms out of its middle and reads
          // as a zoom.
          //
          // Rule 7 applied to motion as well as to depth: one intentional
          // gesture. Nothing bounces, nothing loops, and nothing about it has to
          // be noticed for the strap to do its job.
          id: ids("timeline"),
          name: "In",
          duration: 0.9,
          tracks: [
            {
              target: holderId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -14, easing: "easeOutCubic" },
                { time: 0.52, value: 0 },
              ],
            },
            {
              target: light.id,
              path: "transform.scale.0",
              delay: 0.34,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.42, value: 1 },
              ],
            },
            {
              target: light.id,
              path: "transform.position.0",
              delay: 0.34,
              keyframes: [
                // Left edge held at `bodyX`: centre = bodyX + scale * width / 2.
                { time: 0, value: bodyX, easing: "easeOutCubic" },
                { time: 0.42, value: bodyX + 5.7 },
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
                { time: 0.45, value: -14 },
              ],
            },
          ],
        },
      ],
    );
  },
};
/**
 * THE SCOREBOARD.
 *
 * ==========================================================================
 * IT HAS TO COMMAND THE FRAME, NOT SIT POLITELY INSIDE IT
 * ==========================================================================
 * The previous pass got the structure right — score in a recessed well, teams
 * mirrored about it, competition on a strip, clock on a flag — and it was still
 * a 7.8-unit bug floating in a 17.8-unit frame with 44% of the width and a tenth
 * of the height. Rendered at broadcast size it read as a developer preview of a
 * scoreboard rather than as a scoreboard.
 *
 * Three things fixed that, and none of them is "scale it up":
 *
 *   IT IS CROPPED BY THE FRAME. The bug hangs off the TOP EDGE — no top edge of
 *   its own, no shadow above it, nothing to read as the boundary of a rectangle.
 *   Furniture that the frame cuts belongs to the broadcast; furniture with four
 *   visible edges belongs to a slide. This is the single biggest change and it
 *   costs nothing but the decision.
 *
 *   IT IS STEPPED, NOT STACKED. A wide main row carrying the score, and a
 *   narrower band beneath it carrying the things that are not the score. The
 *   silhouette is two widths, so the graphic has a shape before it has content —
 *   and the step is what makes the main row read as the important one.
 *
 *   THE FIGURES ARE THE SIZE THEY DESERVE. 150 against the old 76. The score is
 *   now the largest thing in the package after the countdown's own clock, which
 *   is the correct order: those are the two graphics that ARE a number.
 *
 * ==========================================================================
 * THE ORANGE DOES A DIFFERENT JOB HERE
 * ==========================================================================
 * The lower third uses orange as a TAB the strap hinges on. If the scoreboard
 * also used it as a small chip, the accent would be a UI colour that appears in
 * every graphic in the same role rather than an identity.
 *
 * So here it is a CROPPED FIELD: the clock sits in a solid orange block that runs
 * off the right end of the lower band and is cut by it. Same colour, same "this
 * is the live thing" meaning, completely different geometry — a field the frame
 * slices rather than a badge sitting on a plate.
 *
 * Blur test: take the orange out and the composition still works, because it is
 * carried by the well, the step and the size of the figures. Squint and the score
 * is unmistakably the subject.
 */
const SCOREBOARD: PackTemplate = {
  id: "tpl_scoreboard",
  name: "Scoreboard",
  description: "A cropped bug at frame scale: the score in a well, teams either side.",
  build: (ids, token, now) => {
    const rootId = ids("node");
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const surfaceLift = token("color.surfaceLift", PALETTE.surfaceLift);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);
    const onAccent = token("color.onAccent", PALETTE.onAccent);

    // The main row runs off the top of frame. 5 is the frame edge, not the
    // title-safe line: the PLATE may leave the safe area, its TYPE may not.
    const frameTop = 5;
    const rowH = 2.05;
    const rowW = 11.8;
    const rowBottom = frameTop - rowH;
    // The type's own centre, pushed down inside the row so nothing readable
    // strays above the title-safe line at 4.5.
    // Pushed DOWN inside the row by more than looks necessary, because at 190 the
    // figures are 1.25 units of cap height: centred in the row their tops crossed
    // the title-safe line at 4.5, which is the one line a score may not cross.
    // The plate leaves the safe area; the type never does.
    const rowMid = rowBottom + rowH / 2 - 0.28;

    // The lower band: narrower, so the silhouette steps.
    const bandW = 7.4;
    const bandH = 0.62;
    const bandMid = rowBottom - bandH / 2;

    const row = plane(
      ids,
      "Background",
      next(),
      rowW,
      // Overshooting the frame edge, so no top edge exists to be seen.
      rowH + 0.4,
      surface,
      [0, rowBottom + (rowH + 0.4) / 2, 0],
      flagSpec(PALETTE.surface),
      { id: "flag", from: PALETTE.surface },
    );

    const band = plane(
      ids,
      "Context Band",
      next(),
      bandW,
      bandH,
      surfaceLift,
      // ALIGNED TO THE ROW'S LEFT EDGE, not centred under it. Centred, the band
      // read as a pedestal the bug was standing on; flush left it reads as a
      // corner the frame is cutting, which is the same asymmetry the rest of the
      // package is built on.
      [-rowW / 2 + bandW / 2, bandMid, 0.01],
      flagSpec(PALETTE.surfaceLift),
      { id: "flag", from: PALETTE.surfaceLift },
    );

    // ---- The score, and the well it is set into -----------------------------
    const wellW = 4.0;
    const wellH = 1.46;
    const well = plane(
      ids,
      "Score Well",
      next(),
      wellW,
      wellH,
      surface,
      [0, rowMid, 0.01],
      recessed(PALETTE.ink),
    );

    const homeScore = type_(ids, "Home Score", next(), { $var: "homeScore" }, {
      face: FACE.display,
      size: 190,
      colour: ink,
      box: { width: 1.7 },
      align: "end",
      at: [-2.2, rowMid, 0.02],
    });

    // Punctuation, not a field: a dash an operator can empty is a scoreboard that
    // can lose its centre.
    const dash = type_(ids, "Dash", next(), "–", {
      face: FACE.display,
      size: 96,
      colour: muted,
      // A full unit of its own, with the two score boxes butted against it rather
      // than overlapping it. They overlapped by a tenth before, which pulled the
      // home digit hard against the dash and left a gap after it — "2- 1".
      box: { width: 1.0 },
      align: "center",
      at: [-0.5, rowMid + 0.04, 0.02],
    });

    const awayScore = type_(ids, "Away Score", next(), { $var: "awayScore" }, {
      face: FACE.display,
      size: 190,
      colour: ink,
      box: { width: 1.7 },
      at: [0.5, rowMid, 0.02],
    });

    // ---- The teams ----------------------------------------------------------
    // 88, and mirrored about the well. Long club names shrink rather than
    // colliding with the score, which is why each gets its own generous column.
    const teamW = 3.5;
    const home = type_(ids, "Home", next(), { $var: "home" }, {
      face: FACE.display,
      // 76 against the score's 190. The first pass set them at 88 and the two
      // read as equals: a long club name carries more visual mass than a single
      // digit, so parity in size is not parity on screen. Rule 6 — the score is
      // the graphic, and the teams are who it belongs to.
      size: 76,
      colour: ink,
      box: { width: teamW },
      align: "end",
      at: [-rowW / 2 + sp(30), rowMid, 0.02],
    });

    const away = type_(ids, "Away", next(), { $var: "away" }, {
      face: FACE.display,
      size: 76,
      colour: ink,
      box: { width: teamW },
      at: [rowW / 2 - sp(30) - teamW, rowMid, 0.02],
    });

    // ---- The lower band's contents ------------------------------------------
    // The competition reads left; the clock is cut out of the band's right end.
    const competition = type_(ids, "Competition", next(), { $var: "competition" }, {
      face: FACE.display,
      size: 30,
      colour: ink,
      box: { width: 4.3 },
      at: [-rowW / 2 + sp(26), bandMid, 0.02],
    });

    // THE CROPPED ORANGE FIELD. It ends exactly on the band's right edge, so the
    // step cuts it — the accent is a field the geometry slices, not a chip.
    const clockW = 1.72;
    const clockFieldX = -rowW / 2 + bandW - clockW / 2;
    const clockField = plane(
      ids,
      "Clock Field",
      next(),
      clockW,
      bandH,
      accent,
      [clockFieldX, bandMid, 0.02],
      flagSpec(PALETTE.primary),
      { id: "flag", from: PALETTE.primary },
    );
    const clock = type_(ids, "Clock", next(), { $var: "clock" }, {
      face: FACE.display,
      size: 36,
      colour: onAccent,
      box: { width: clockW - sp(24) },
      align: "center",
      at: [-rowW / 2 + bandW - clockW + sp(12), bandMid, 0.03],
    });

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: rowW, height: rowH + bandH },
      children: [
        row,
        band,
        well,
        homeScore,
        dash,
        awayScore,
        home,
        away,
        competition,
        clockField,
        clock,
      ],
    });

    const root: SceneNode = {
      id: rootId,
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
        variable(ids("variable"), "homeScore", "Home score", "2"),
        variable(ids("variable"), "away", "Away", "ARSENAL"),
        variable(ids("variable"), "awayScore", "Away score", "1"),
        variable(ids("variable"), "competition", "Competition", "PREMIER LEAGUE"),
        variable(ids("variable"), "clock", "Clock", "72'"),
      ],
      [
        {
          // It drops from the edge it is cropped by, and the context band steps
          // out from under it a beat later — so the step is something the viewer
          // sees happen rather than a shape that was always there.
          id: ids("timeline"),
          name: "In",
          duration: 0.9,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: rowH + bandH + 0.4, easing: "easeOutCubic" },
                { time: 0.5, value: 0 },
              ],
            },
            {
              target: band.id,
              path: "transform.scale.1",
              delay: 0.42,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.34, value: 1 },
              ],
            },
            {
              target: band.id,
              path: "transform.position.1",
              delay: 0.42,
              keyframes: [
                // Top edge held at the main row's bottom.
                { time: 0, value: rowBottom, easing: "easeOutCubic" },
                { time: 0.34, value: bandMid },
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
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeInCubic" },
                { time: 0.45, value: rowH + bandH + 0.4 },
              ],
            },
          ],
        },
      ],
    );
  },
};



/**
 * THE TITLE CARD.
 *
 * ==========================================================================
 * IT IS NOT A BIGGER LOWER THIRD, AND THAT IS A COMPOSITIONAL DECISION
 * ==========================================================================
 * What was here was a centred headline with a standfirst under it, on a plate,
 * in the middle of frame — which is the lower third's construction at a larger
 * size in a different place. Two graphics built the same way do not become a
 * family by being different sizes.
 *
 * A title card has a job the strap does not: it OPENS something. Nothing else is
 * on screen, it holds for two or three seconds, and it has to feel composed
 * rather than positioned. So it is built as an editorial page:
 *
 *   THE VEIL     A wash across the whole frame that fades UPWARD, out of the
 *                bottom. The strap dissolves sideways because it is furniture
 *                entering from one side; a title card is the picture itself
 *                being dimmed so type can sit on it, and dimming one side of an
 *                image is a mistake rather than a look. Same material, other
 *                axis — see `veilSpec`.
 *
 *   THE KICKER   The programme, in dark type on a solid accent block. Rule 3: a
 *                flag with a job. It is the smallest element and the most
 *                saturated, so it is read first and read as a label — which is
 *                what a competition name is.
 *
 *   THE TITLE    Set at 168, which is nearly twice the lower third's name and
 *                the largest type in the package. Rule 6 applied to a word
 *                rather than a number: this graphic exists to say one thing.
 *
 *   THE RULE     A hairline under the title, as wide as the context beneath it
 *                rather than as wide as the title. Rule 4 — it separates two
 *                orders of information, so it belongs to the smaller one.
 *
 *   THE MARK     Diagonally opposite the type, top right. The whole block is
 *                anchored bottom-left, so the frame's other corner is where the
 *                eye finishes; putting the mark anywhere near the title would
 *                make two things compete to be the identity.
 *
 * ==========================================================================
 * THE ASYMMETRY IS THE POINT
 * ==========================================================================
 * Rule 7. Everything is on the left margin, stacked, with the upper right two
 * thirds of the frame left as picture. A centred title card has to fill the
 * frame to look deliberate; an anchored one is allowed to leave most of it
 * empty, which is what makes room for whatever is behind it.
 */
const TITLE_CARD: PackTemplate = {
  id: "tpl_title_card",
  name: "Title Card",
  description: "A programme flag, a full-frame title and its context. Opens a show.",
  build: (ids, token, now) => {
    const rootId = ids("node");
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);
    const onAccent = token("color.onAccent", PALETTE.onAccent);

    // The left margin every element in the stack starts from. One column inside
    // title-safe, the same line the lower third's tab stands on — which is what
    // makes two completely different compositions feel like one package.
    const marginX = col(1);
    const kickerH = sp(62);

    // Full frame and a little beyond, so the wash has no visible edge anywhere.
    // Fading up, it is opaque along the bottom where the type sits and gone by
    // the upper third where the picture should still be a picture.
    const veil = plane(
      ids,
      "Veil",
      next(),
      17.78,
      8.4,
      surface,
      [0, -0.8, 0],
      veilSpec(PALETTE.surface, 8.4, { width: 17.78, height: 8.4 }),
      { id: "veil", from: PALETTE.surface },
    );

    const kickerFlag = plane(
      ids,
      "Programme Flag",
      next(),
      // 2.9 rather than 3.5. A flag is a label, and a label with an inch of
      // empty colour after the word reads as a button that failed to fit its
      // text. Wide enough to hold "UEFA CHAMPIONS LEAGUE" once it shrinks a
      // step, which is the longest competition name this slot will see.
      2.9,
      kickerH,
      accent,
      [marginX + 1.45, -0.62, 0.01],
      flagSpec(PALETTE.primary),
      { id: "flag", from: PALETTE.primary },
    );

    const kicker = type_(ids, "Programme", next(), { $var: "programme" }, {
      face: FACE.display,
      size: 34,
      // Dark on the flag, never white. See the palette note: white on saturated
      // orange vibrates and fails contrast, and dark type on a bright block is
      // the most recognisable label in sports broadcast.
      colour: onAccent,
      box: { width: 2.5 },
      at: [marginX + sp(22), -0.62, 0.02],
    });

    // 168 in a box that runs to x 4.4 — inside title-safe, and wide enough that
    // "MATCH OF THE DAY" sets at full size with a character to spare.
    const title = type_(ids, "Title", next(), { $var: "title" }, {
      face: FACE.display,
      size: SIZE.mega,
      colour: ink,
      // 12.4, and the reason is legibility rather than layout. A title that
      // SHRINKS renders visibly thinner and greyer than one that does not — the
      // strokes lose coverage — so a 23-character title at 73% looked washed out
      // beside a 16-character one at full size. Widening the box is what keeps a
      // real segment name setting at its authored weight; only something far
      // longer than "THE CHAMPIONSHIP RUN-IN" now shrinks at all.
      box: { width: 12.4 },
      maxLines: 2,
      floor: 0.8,
      at: [marginX, -2.05, 0.02],
    });

    const under = plane(
      ids,
      "Rule",
      next(),
      4.6,
      sp(3),
      ink,
      [marginX + 2.3, -3.02, 0.02],
      rule(PALETTE.ink, 0.5),
    );

    const context = type_(ids, "Context", next(), { $var: "context" }, {
      face: FACE.text,
      size: SIZE.body,
      colour: muted,
      box: { width: 8.0 },
      at: [marginX, -3.56, 0.02],
    });

    // READ BACK from the nodes rather than restated, because `type_` moves a text
    // node's origin: the box hangs downward from it, so the node sits half a box
    // above the optical centre the caller asked for. A timeline written against
    // the authored centre would jump the title half its own height on the first
    // frame — the kind of bug that looks like an easing mistake.
    const titleY = title.transform!.position[1]!;
    const contextY = context.transform!.position[1]!;

    const mark = logo(ids, "Logo", next(), { $var: "logo" }, { width: 1.15, height: 1.15 }, [
      col(11.1),
      3.62,
      0.02,
    ]);

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: 17.78, height: 10 },
      children: [veil, kickerFlag, kicker, title, under, context, mark],
    });

    const root: SceneNode = {
      id: rootId,
      name: "Title Card",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Title Card" }],
    };

    return document_(
      ids,
      "Title Card",
      now,
      root,
      [
        variable(ids("variable"), "programme", "Programme", "PREMIER LEAGUE"),
        variable(ids("variable"), "title", "Title", "MATCH OF THE DAY"),
        variable(ids("variable"), "context", "Context", "Saturday 21:00 · Studio 4"),
        variable(ids("variable"), "logo", "Logo", STUDIO_IMAGES[0]!.assetId, "asset"),
      ],
      [
        {
          // ============================================================
          // THE REVEAL: THE PAGE ASSEMBLES, IT DOES NOT SLIDE
          // ============================================================
          // A strap slides in because it arrives from off-frame. A title card is
          // already the whole frame, so there is nowhere for it to come from —
          // sliding it would look like a slide.
          //
          // Instead the veil rises (a wipe upward: scale on Y with the position
          // compensated to hold the bottom edge still), the programme flag wipes
          // open from the left margin, and the title and its context TRAVEL a
          // short distance up into place, staggered. Travel is small on purpose:
          // this is the largest type in the package, and large type moving far
          // reads as a transition rather than as an entrance.
          id: ids("timeline"),
          name: "In",
          duration: 1.1,
          tracks: [
            {
              target: veil.id,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.5, value: 1 },
              ],
            },
            {
              target: veil.id,
              path: "transform.position.1",
              keyframes: [
                // Bottom edge held at -5: centre = -5 + scale * height / 2.
                { time: 0, value: -5, easing: "easeOutCubic" },
                { time: 0.5, value: -0.8 },
              ],
            },
            {
              target: kickerFlag.id,
              path: "transform.scale.0",
              delay: 0.26,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.36, value: 1 },
              ],
            },
            {
              target: kickerFlag.id,
              path: "transform.position.0",
              delay: 0.26,
              keyframes: [
                { time: 0, value: marginX, easing: "easeOutCubic" },
                { time: 0.36, value: marginX + 1.45 },
              ],
            },
            {
              target: title.id,
              path: "transform.position.1",
              delay: 0.34,
              keyframes: [
                { time: 0, value: titleY - 0.34, easing: "easeOutCubic" },
                { time: 0.44, value: titleY },
              ],
            },
            {
              target: context.id,
              path: "transform.position.1",
              delay: 0.46,
              keyframes: [
                { time: 0, value: contextY - 0.24, easing: "easeOutCubic" },
                { time: 0.44, value: contextY },
              ],
            },
          ],
        },
        {
          id: ids("timeline"),
          name: "Out",
          duration: 0.5,
          tracks: [
            {
              target: veil.id,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 1, easing: "easeInCubic" },
                { time: 0.5, value: 0 },
              ],
            },
            {
              target: veil.id,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -0.8, easing: "easeInCubic" },
                { time: 0.5, value: -5 },
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
      { name: "color.surfaceLift", value: "#1c2029", description: "One level up: sub-bands and row tracks" },
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
      { name: "color.surfaceLift", value: "#191a1d", description: "One level up: sub-bands and row tracks" },
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
      { name: "color.surfaceLift", value: "#ffffff", description: "One level up: sub-bands and row tracks" },
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
    description: "A lower third, a title card and a sponsor bar. Fully editable.",
    tags: ["starter", "lower third", "title", "sponsor"],
    swatch: ["#2f6feb", "#101319"],
    templates: [LOWER_THIRD, TITLE_CARD, SPONSOR],
  },
  {
    id: "pack_news_essentials",
    name: "News Essentials",
    kind: "graphics",
    author: "Streamatrix",
    description: "A ticker with its own exit, and a breaking banner that stages its reveal.",
    tags: ["news", "ticker", "breaking", "bulletin"],
    swatch: ["#c62828", "#0b0b0d"],
    templates: [TICKER, BREAKING],
  },
  {
    id: "pack_sport_essentials",
    name: "Sport & Esports",
    kind: "graphics",
    author: "Streamatrix",
    description: "A scoreboard, a list-driven leaderboard and a pre-show countdown.",
    tags: ["sport", "esports", "scoreboard", "leaderboard", "countdown"],
    swatch: ["#2f6feb", "#f2f5fb"],
    templates: [SCOREBOARD, LEADERBOARD, COUNTDOWN],
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
  // Defaults first, then the open project's palette on top. A template built
  // into a themed project matches it; built into an empty one it still has a
  // complete palette of its own, so no `$token` dangles.
  const merged = new Map<string, SceneToken>();
  const declare: TokenLookup = (name, fallback) => {
    if (!merged.has(name)) merged.set(name, { name, value: fallback });
    return { $var: name };
  };

  const built = template.build(ids, declare, now);
  for (const token of theme) merged.set(token.name, token);

  const tokens = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { ...built, tokens };
}
