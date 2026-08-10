/**
 * THE STREAMATRIX BROADCAST LANGUAGE
 *
 * ============================================================================
 * WHY A LANGUAGE FILE AND NOT EIGHT BETTER TEMPLATES
 * ============================================================================
 * The eight shipped graphics were each a dark rounded rectangle with a gradient,
 * a thin accent stripe and two lines of Inter at different sizes. Eight variations
 * on one composition is not a family — it is one graphic with eight names, and no
 * amount of adjusting a radius or a font size turns it into a broadcast package.
 *
 * So the vocabulary is defined ONCE, here, and each graphic is a different
 * SENTENCE in it. That is the difference between a package and a pile: a viewer
 * should recognise the scoreboard and the lower third as belonging to the same
 * network without them sharing a layout.
 *
 * ============================================================================
 * WHAT THE ENGINE ACTUALLY GIVES A DESIGNER
 * ============================================================================
 * Every device below is built from something that exists. There is no
 * `letterSpacing`, no `textTransform`, no OpenType feature selection, no mask and
 * no blur-behind. What there is:
 *
 *   FACE          five Latin files, chosen for contrast — see `fonts.ts`
 *   SIZE          design pixels, exact at 108 px/unit
 *   COLOUR        per-node, and bindable to a theme token
 *   GRADIENT      linear, radial, conic — WITH PER-STOP OPACITY
 *   CORNERS       four radii, independently
 *   STROKE        its own colour and its own gradient
 *   SHADOW        offset, spread, and `inner`
 *   GEOMETRY      position, rotation, scale, and the composition itself
 *
 * PER-STOP OPACITY IS THE MOST IMPORTANT ONE and it was being used for nothing.
 * A gradient that ends at `opacity: 0` is a plate that DISSOLVES INTO THE
 * PICTURE instead of ending at an edge. That single fact is what separates a
 * broadcast scrim from a UI card, and it needed no engine work at all.
 *
 * ============================================================================
 * THE SEVEN RULES
 * ============================================================================
 * 1  A SCRIM, NOT A CARD. Furniture over live pictures fades out on the side
 *    the picture continues. A hard rectangle announces a graphics system; a
 *    scrim announces the person's name.
 *
 * 2  ONE CORNER, NOT FOUR. Uniform radius is the single most UI-looking mark
 *    there is. Broadcast furniture is cut square and relieved at one corner, so
 *    the shape itself carries direction. `corners` does this exactly.
 *
 * 3  FLAGS, NOT STRIPES. An accent is a solid block with a job — it holds a
 *    kicker, it butts against the plate edge, it marks the leader. A 2px
 *    vertical line beside some text is a decoration nobody chose.
 *
 * 4  RULES DO WORK. A hairline separates two orders of information. It is never
 *    there to fill space, and it is never the same weight as the type it sits
 *    under.
 *
 * 5  CASE COMES FROM THE FACE. Bebas is caps; Barlow is mixed. Choosing the face
 *    chooses the case, which is how a package with no `textTransform` still has
 *    a caps/lowercase hierarchy.
 *
 * 6  NUMBERS ARE THE PICTURE. When a graphic exists to carry a number — a score,
 *    a clock, a position — that number is set two full steps above everything
 *    else and everything else gets out of its way.
 *
 * 7  ASYMMETRY, AND ONE STEP OF DEPTH. Information packs to one side and the
 *    other side is air. Exactly one shadow grounds the furniture against the
 *    picture; glow is reserved for things that are genuinely live.
 */
import type { PaintSpecDoc, SceneNode } from "@bracketx/engine-scene";

import type { IdFactory } from "./ids";

/**
 * Design pixels per world unit for every graphic in the family.
 *
 * The stage is 17.78 x 10 units and outputs 1920 x 1080, so 108 px/unit makes a
 * design pixel an output pixel exactly. Type sizes are therefore what a designer
 * would type into any other tool — 88, not 0.81.
 *
 * DECLARED HERE rather than in `packs.ts`, which re-exports it: the templates
 * depend on the language, so the language may not depend back on them.
 */
export const STAGE_PPU = 108;

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** One design pixel, in world units. The stage is 1920x1080 at 108 px/unit. */
export const PX = 1 / STAGE_PPU;

/** Design pixels as world units. `sp(24)` is 24 output pixels, exactly. */
export const sp = (pixels: number): number => pixels * PX;

/**
 * Broadcast safe areas, as the numbers a director would quote.
 *
 * Title-safe is 90% of the frame: nothing readable goes outside it, because a
 * proportion of the audience is watching on a set that overscans. The stage is
 * 17.78 x 10, so the title-safe box is 16 x 9 and its edges are the constants
 * every graphic in this family aligns to.
 */
export const SAFE = {
  /** x of the title-safe left edge. */
  left: -8,
  /** x of the title-safe right edge. */
  right: 8,
  /** y of the title-safe top edge. */
  top: 4.5,
  /** y of the title-safe bottom edge. */
  bottom: -4.5,
  /** Where a lower third's baseline furniture sits — the classic lower third. */
  lowerThird: -2.72,
} as const;

/**
 * A twelve-column grid across the title-safe width, in world units.
 *
 * Twelve because it divides by 2, 3, 4 and 6, so a scoreboard's halves, a
 * leaderboard's thirds and a sponsor bar's quarters all land on the same lines.
 * Graphics in this family are aligned to `col()`, which is what makes them look
 * like one package rather than eight independent guesses.
 */
export const COLUMN = (SAFE.right - SAFE.left) / 12;

/** The x of a column edge, 0 at title-safe left through 12 at the right. */
export const col = (index: number): number => SAFE.left + COLUMN * index;

/**
 * THE PALETTE THE FAMILY SHIPS WITH.
 *
 * These are the DEFAULTS behind `color.surface`, `color.primary`, `color.ink`
 * and `color.muted` — every fill stays bound to its token, so a theme pack still
 * owns the colour. What is chosen here is the relationship between them, which a
 * theme inherits whether or not it changes the hues.
 *
 *   SURFACE is not grey. #05070C is a blue-black: over a picture, a neutral grey
 *   scrim reads as a dead patch, and a scrim with a trace of blue in it reads as
 *   shadow. Two points of hue is the whole difference.
 *
 *   ACCENT is orange, and that is a decision about the family rather than a
 *   preference. Broadcast red is spoken for — it means BREAKING, and a package
 *   whose ordinary accent is red has nothing left to escalate to. Orange carries
 *   the same energy at the same saturation, sits clear of every team colour in
 *   football, and is legible against grass, crowd and studio grey alike.
 *
 *   INK ON ACCENT IS NEAR-BLACK, never white. White on saturated orange fails
 *   contrast and vibrates; dark type on a bright flag is the most recognisable
 *   mark in sports broadcast.
 *
 *   URGENT is held back for the one graphic that means it.
 */
export const PALETTE = {
  surface: "#05070C",
  /**
   * A SECOND surface, because subordination needs somewhere to go.
   *
   * A lower third's role band, a leaderboard's row track and a scoreboard's
   * context strip are all "the same furniture, one level down". Without a token
   * for that they either matched the main surface — losing the distinction — or
   * were hand-shaded, which is what stopped a theme from reaching them.
   *
   * LIGHTER than the surface, not darker, and the first render is why. A
   * sub-band a shade deeper than a near-black scrim is invisible over any
   * picture: the step that the whole silhouette depends on simply was not there.
   * Subordination on a dark package comes from a LIFT — the band reads as a
   * lit shelf under the name — with the type on it muted rather than bright.
   */
  surfaceLift: "#1E2635",
  primary: "#FF5A1F",
  ink: "#F5F8FD",
  muted: "#93A0B5",
  /** Type that sits ON the accent. */
  onAccent: "#0A0D13",
  /** Breaking only. Never decoration. */
  urgent: "#E01B24",
  /** A live indicator. Green reads as "running" in every gallery in the world. */
  live: "#20D07A",
} as const;

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** The faces, by the job they do rather than by their names. */
export const FACE = {
  /** Bebas Neue. Caps, condensed, tabular figures. Names, scores, clocks. */
  display: "ast_display",
  /** Barlow Condensed Bold. Mixed-case headlines that must hold many words. */
  headline: "ast_headline",
  /** Barlow Condensed Medium. Competition, category, timestamp. */
  context: "ast_kicker",
  /** Barlow Medium. Roles and sentences — the only face with real lowercase. */
  text: "ast_text",
} as const;

/**
 * The type scale, in design pixels.
 *
 * A GEOMETRIC SCALE, not a list of numbers that looked right. Each step is about
 * 1.4x the one below — a fourth — which is wide enough that two adjacent steps
 * are never mistaken for each other. The old templates ran name 60 / role 26,
 * which is 2.3x and sat between two steps; that is why they read as "heading and
 * subheading" rather than as a name with a caption under it.
 *
 * `hero` and `mega` exist for the two graphics that are a number: the clock and
 * the score. Rule 6 — the number is the picture, and it is set two steps clear.
 */
export const SIZE = {
  micro: 19,
  small: 26,
  body: 34,
  lead: 46,
  title: 64,
  display: 88,
  hero: 122,
  mega: 168,
} as const;

/**
 * A text node in one of the family's faces.
 *
 * Wraps `label`'s job without going through it, because a face is not an
 * afterthought passed in an `extra` bag — it is half the design decision, and
 * every call here has to state it.
 *
 * ==========================================================================
 * `at` IS THE LEFT EDGE AND THE OPTICAL CENTRE, NOT THE NODE POSITION
 * ==========================================================================
 * A TEXT NODE HANGS FROM ITS TOP-LEFT CORNER. A rect is centred on its origin,
 * text is not, and the difference is invisible until a composition depends on
 * alignment — at which point every line lands half a box-width to the right of
 * where it was drawn on paper. The first render of the redesigned lower third had
 * the name sitting in the MIDDLE of its band, and the cause was this and nothing
 * else: `align: "start"` was working perfectly, measured from a box whose origin
 * had been placed at the band's centre.
 *
 * Alignment is an offset from `box.width`, so `start` puts the first glyph at the
 * box's left edge — which means the caller wants to say where that edge is. So
 * `at` is stated as [LEFT EDGE, VERTICAL CENTRE] and the conversion to the node's
 * own anchor happens here, once, where the reason for it is written down.
 *
 * `fit: shrink` on everything, always: a name slot holding both "LI" and
 * "KONSTANTINOS PAPADOPOULOS" is the normal case, not the exception. The floor
 * is 62% rather than `label`'s 55% — Volume Four's specimen rule is that the
 * WORST case in the feed still has to look designed, and text shrunk past about
 * two-thirds stops matching the composition around it. Where a long string must
 * survive, the box is made wider rather than the floor lowered.
 */
export function type_(
  ids: IdFactory,
  name: string,
  order: string,
  content: unknown,
  options: {
    readonly face: string;
    readonly size: number;
    readonly colour: unknown;
    readonly box: { readonly width: number; readonly height?: number };
    readonly at: readonly [number, number, number];
    readonly align?: "start" | "center" | "end";
    readonly lineHeight?: number;
    readonly maxLines?: number;
    /** Shrink floor, as a fraction of `size`. Raised for numerals. */
    readonly floor?: number;
  },
): SceneNode {
  const height = options.box.height ?? sp(options.size) * 1.42;
  // The box hangs DOWNWARD from the origin, and `verticalAlign: middle` centres
  // the line within it — so the origin sits half a box above the optical centre
  // the caller asked for.
  const at: [number, number, number] = [
    options.at[0],
    options.at[1] + height / 2,
    options.at[2],
  ];
  return {
    id: ids("node"),
    name,
    order,
    transform: {
      position: at,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    size: { width: options.box.width, height },
    components: [
      {
        id: ids("component"),
        type: "text",
        props: {
          content,
          font: { assetId: options.face, size: options.size },
          color: options.colour,
          align: options.align ?? "start",
          // The SAME width the box is, so a line wraps where it aligns. Left
          // unset, a long string runs straight out of the composition.
          maxWidth: options.box.width,
          verticalAlign: "middle",
          lineHeight: options.lineHeight ?? 1.02,
          ...(options.maxLines === undefined ? {} : { maxLines: options.maxLines }),
          fit: { mode: "shrink", minSize: options.size * (options.floor ?? 0.62) },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * A rect with a paint, positioned by its centre.
 *
 * `style` is what keeps a shipped graphic THEMEABLE, and leaving it off is a
 * silent bug rather than an omission. `repaint` rebuilds a plate's gradient when
 * a token moves, but only for a plate that says which look built it and from
 * which colour — otherwise the paint is treated as hand-adjusted art and left
 * alone. A template whose plates do not declare this looks perfect until the
 * first theme change, and then keeps last month's brand colour in every gradient
 * while its flat fills go red.
 */
export function plane(
  ids: IdFactory,
  name: string,
  order: string,
  width: number,
  height: number,
  fill: unknown,
  at: readonly [number, number, number],
  paint?: PaintSpecDoc,
  style?: { readonly id: string; readonly from: string },
): SceneNode {
  return {
    id: ids("node"),
    name,
    order,
    transform: { position: [...at] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width, height },
    components: [
      {
        id: ids("component"),
        type: "rect",
        props: {
          width,
          height,
          fill,
          ...(paint === undefined ? {} : { paint }),
          ...(style === undefined
            ? {}
            : { paintStyle: style.id, paintFrom: style.from }),
        },
      },
    ],
  };
}

/** A literal hex, or null when the value is a theme binding. */
export function literalOf(fill: unknown): string | null {
  return typeof fill === "string" && /^#[0-9a-fA-F]{6,8}$/.test(fill) ? fill : null;
}

/** Mixes a literal hex towards white (positive) or black (negative). */
export function shade(hex: string, amount: number): string {
  const value = hex.replace(/^#/, "").slice(0, 6);
  if (value.length < 6) return hex;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const part = (at: number): string => {
    const channel = parseInt(value.slice(at, at + 2), 16);
    const mixed = Math.round(channel + (target - channel) * t);
    return Math.max(0, Math.min(255, mixed)).toString(16).padStart(2, "0");
  };
  return `#${part(0)}${part(2)}${part(4)}`;
}

/**
 * RULE 1 — THE SCRIM.
 *
 * A plate that is opaque where the type sits and gone before the far edge. This
 * is the family's default background and the reason nothing here reads as a
 * card: there is no far edge to read. Over a live picture the graphic appears to
 * be lit onto the image rather than pasted over it.
 *
 * ==========================================================================
 * NO PARAMETERS, AND THAT IS THE POINT
 * ==========================================================================
 * The first version took `from`, `to` and `corners` per plate, and every graphic
 * would have picked its own — which is how a family becomes eight unrelated
 * gradients again. It also broke theming, and that is the harder reason.
 *
 * A theme pack rewrites tokens; `repaint` then rebuilds each plate's paint from
 * the new colour. It can only do that for a paint it can REPRODUCE — it compares
 * the stored paint against `build(paintFrom)` and leaves anything that differs
 * alone, correctly, because a difference means somebody hand-adjusted it. A
 * hand-tuned scrim per plate is therefore a plate that silently stops following
 * the brand colour, which is exactly what happened here: recolouring the accent
 * stopped moving the tab, and `tokens.test.ts` caught it within the hour.
 *
 * So the scrim takes a colour and a BOX, and nothing else. Direction comes from
 * the shape — furniture fades along its long axis — and the corner relief scales
 * with the height. One scrim, reproducible from a colour and a size, which makes
 * it a design constraint and a themeable material at the same time.
 */
export function scrimSpec(
  fill: string,
  shorterSide: number,
  box: { readonly width: number; readonly height: number },
): PaintSpecDoc {
  // Wide furniture fades along its length; a column fades upward. Ties go to
  // "right", because a square plate in this family is a chip, and a chip reads
  // left to right like everything else.
  const upward = box.height > box.width * 1.25;
  // Rule 2 — relieved at the LEADING corner only, so the shape carries
  // direction. Radii are bottom-left first, counter-clockwise: index 2 is
  // top-right, index 3 top-left.
  const relief = Math.min(shorterSide * 0.14, sp(16));
  return {
    corners: upward ? [0, 0, relief, relief] : [0, 0, relief, 0],
    gradient: {
      kind: "linear",
      angle: upward ? 90 : 0,
      stops: [
        // Two stops before the fade begins, so the solid end has depth of its
        // own rather than being one flat wash that then disappears.
        { at: 0, color: shade(fill, -0.3), opacity: 0.94 },
        // THE DISSOLVE STARTS AT 62% AND RUNS TO THE EDGE, and the number was
        // settled against renders of the worst content rather than by eye.
        //
        // It began at 88%, which made the plate a rectangle with a soft corner:
        // with a SHORT name — "LI" — seven units of solid dark band sat empty
        // beside two letters, which is the "acres of empty plate" failure, and
        // with a LONG one the tail of the name crossed the fade and lost its
        // backing entirely.
        //
        // Starting the fade early makes the plate a WASH rather than a box, so
        // there is no empty rectangle to notice when the content is short, and a
        // long name still has 40-60% of backing under its tail — which bright
        // condensed caps carry, and which is exactly how a name over a soft
        // gradient is done on air.
        { at: 0.45, color: fill, opacity: 0.9 },
        { at: 1, color: fill, opacity: 0 },
      ],
    },
  };
}

/**
 * A VEIL — the scrim's other axis.
 *
 * `scrimSpec` fades along the LONG axis, which is right for furniture: a strap
 * dissolves off the end it entered from. A full-frame wash is the opposite case.
 * It is wide because it spans the picture, and it has to fade UPWARD, out of the
 * bottom of frame — fading it sideways would darken one half of the image and
 * leave the other bright, which is a mistake, not a look.
 *
 * So the two materials differ by axis and nothing else, and both are
 * parameterless and reproducible for the same reason — see `scrimSpec`.
 *
 * Square corners always. A veil reaches the frame edge; a radius on it would
 * draw a rounded rectangle around the whole picture.
 */
export function veilSpec(
  fill: string,
  _shorterSide: number,
  box: { readonly width: number; readonly height: number },
): PaintSpecDoc {
  const upward = box.width >= box.height;
  return {
    corners: [0, 0, 0, 0],
    gradient: {
      kind: "linear",
      angle: upward ? 90 : 0,
      stops: [
        { at: 0, color: shade(fill, -0.35), opacity: 0.93 },
        { at: 0.34, color: fill, opacity: 0.78 },
        { at: 1, color: fill, opacity: 0 },
      ],
    },
  };
}

/**
 * RULE 3 — A FLAG.
 *
 * A solid accent block that holds something: a kicker, a position, a score.
 * Square by intent and lit from one side — a rounded, softly-gradiented accent
 * is a button, and a button is the most UI-looking thing a broadcast graphic can
 * contain.
 */
export function flagSpec(fill: string): PaintSpecDoc {
  return {
    corners: [0, 0, 0, 0],
    gradient: {
      kind: "linear",
      angle: 74,
      stops: [
        { at: 0, color: shade(fill, -0.16) },
        { at: 1, color: shade(fill, 0.16) },
      ],
    },
    // THE DEPTH LIVES HERE rather than being added per plate, and that is a
    // themeability requirement as much as a design one. `repaint` rebuilds a
    // plate's paint when a token moves, but only one it can REPRODUCE from the
    // style — so a flag with a shadow bolted on at the call site is a flag that
    // silently stops following the brand colour. Adding `shadow: grounded()` to
    // the accent tab did exactly that, and `tokens.test.ts` caught it twice.
    //
    // It also belongs here: rule 7 gives the family ONE step of depth, and a
    // flag is the solid furniture that has an edge to cast it. A scrim does not
    // and deliberately has none.
    shadow: grounded(),
  };
}

/**
 * A flag for the one thing on screen that is genuinely LIVE.
 *
 * The same block with a glow in its own colour. Reserved deliberately: rule 7
 * gives glow to things that are transmitting, never to things that are merely
 * important.
 */
export function litFlagSpec(fill: string): PaintSpecDoc {
  return { ...flagSpec(fill), shadow: { color: fill, blur: sp(30), opacity: 0.55 } };
}

/**
 * RULE 4 — A RULE.
 *
 * A hairline that separates two orders of information. Drawn as a rect because
 * that is what a rule is; given a fade so it does not end with a hard stop where
 * the scrim behind it has already gone.
 */
export function rule(ink: unknown, opacity = 0.22): PaintSpecDoc {
  const colour = literalOf(ink);
  if (colour === null) return {};
  return {
    gradient: {
      kind: "linear",
      angle: 0,
      stops: [
        { at: 0, color: colour, opacity },
        { at: 0.62, color: colour, opacity: opacity * 0.5 },
        { at: 1, color: colour, opacity: 0 },
      ],
    },
  };
}

/**
 * RULE 7 — ONE STEP OF DEPTH.
 *
 * The single shadow that grounds furniture against a moving picture. Wide, soft,
 * pushed DOWN, and dark — it is a shadow cast by the graphic, not a glow around
 * it. Applied to the one element per graphic that is nearest the viewer.
 */
export function grounded(): NonNullable<PaintSpecDoc["shadow"]> {
  return { color: "#000000", blur: sp(52), offsetY: -sp(14), opacity: 0.52 };
}

/**
 * A recessed slot: an inner shadow, no fill of its own.
 *
 * For the places a broadcast graphic shows a well rather than a plate — the
 * track a leaderboard row sits in, the gap a score sits inside. Depth that
 * reads as construction rather than as elevation.
 */
export function recessed(ink: unknown, depth = sp(18)): PaintSpecDoc {
  const colour = literalOf(ink) ?? "#000000";
  return {
    gradient: {
      kind: "linear",
      angle: 90,
      // DEEPER than the first version, which could not be seen at all. A recess
      // over a near-black plate has almost no room to be darker, so most of the
      // effect has to come from the inner shadow's edge rather than from the
      // wash — and the wash still has to be dark enough that the edge has
      // something to sit against.
      stops: [
        { at: 0, color: "#000000", opacity: 0.62 },
        { at: 1, color: "#000000", opacity: 0.24 },
      ],
    },
    shadow: { color: shade(colour, -0.94), blur: depth, offsetY: -depth * 0.3, opacity: 0.9, inner: true },
  };
}
