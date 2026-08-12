/**
 * THE TACTICAL PACK — a competitive-shooter esports look.
 *
 * ============================================================================
 * WHY IT IS NOT CALLED WHAT THE REFERENCE CALLS IT
 * ============================================================================
 * The brief for this pack was a spec sheet for a "VALORANT Broadcast Pack",
 * carrying Riot's V mark, its team names and its league. The LOOK is fair game
 * and is what was asked for; the name and the mark are not ours to ship. A pack
 * in a storefront called VALORANT with Riot's logo on it is trademark
 * infringement no matter how good the graphics are, and it is the kind of problem
 * that surfaces after launch rather than before.
 *
 * So the design language is delivered in full and the identity is our own.
 * Realistic org names stay as SAMPLE DATA — every field here is a variable, and
 * "SENTINELS vs LOUD" in a template is the same thing as "LIVERPOOL 2–1 ARSENAL"
 * in the football scoreboard: content an operator replaces on the way to air.
 *
 * ============================================================================
 * THE ANGULAR LANGUAGE, AND WHAT THE ENGINE CAN ACTUALLY CUT
 * ============================================================================
 * The reference's signature is chamfered panels — corners sliced at 45 degrees.
 * NOTHING IN THE ENGINE CAN DRAW THAT. `paint` has `cornerRadius` and per-corner
 * radii, which round a corner; it has no chamfer, no polygon and no path.
 * `meshRenderer` takes a loaded model asset, not procedural geometry. And the
 * obvious cheat — a background-coloured wedge laid over each corner — only works
 * over a known flat backdrop, which is exactly what a broadcast overlay never has:
 * over live gameplay it would draw eight solid triangles.
 *
 * Faking it was the wrong answer. Looking again at the reference, the chamfers are
 * not what carries its character — these four things are, and every one of them is
 * drawable today:
 *
 *   BRACKETS    L-shaped corner marks, two thin rects each. The reference puts
 *               them on almost every panel, and they do the job a chamfer does:
 *               they say "this is a frame" without drawing a whole rectangle.
 *
 *   SLANTS      Rotated rects. A rect at 24 degrees is a real skewed sliver — the
 *               one genuinely angular mark available — used as an accent bar and
 *               as a divider.
 *
 *   PIPS        Small rects rotated 45 degrees are DIAMONDS, which is how a
 *               round-by-round scoreline is drawn in this genre. Angular geometry
 *               for free, because a square turned is a diamond.
 *
 *   GLOW        A shadow the colour of the thing casting it. The reference's depth
 *               is coloured bloom around red furniture, and `shadow` does that.
 *
 * The result reads as the same family as the reference without a single shape the
 * renderer had to be lied to about.
 */
import {
  IDENTITY_TRANSFORM,
  generateKeyBetween,
  type PaintSpecDoc,
  type SceneNode,
} from "@bracketx/engine-scene";

import {
  FACE,
  SAFE,
  flagSpec,
  plane,
  recessed,
  scrimSpec,
  shade,
  sp,
  type_,
} from "./broadcast";
import type { IdFactory } from "./ids";
import { camera, document_, group, nextOrder, variable, type PackTemplate } from "./packs";

/**
 * THE PALETTE, taken from the reference's own swatches.
 *
 * Read in the order the eye uses them: a signal red that carries state, a magenta
 * that partners it in gradients, a purple reserved for the OPPOSING side, and
 * three neutrals. Two accents facing each other across a scoreboard is the whole
 * reason this pack needs a third colour where the broadcast family needs one — a
 * competitive graphic has two teams in it and they cannot share a hue.
 */
export const TAC = {
  /** Signal red. State, brackets, the attacking side. */
  red: "#FF4655",
  /** Magenta. Never alone — it is the far end of red's gradients. */
  magenta: "#FF1E6E",
  /** The other side. Purple, so no round is ambiguous. */
  purple: "#A855F7",
  /** Frame black. Deeper than the broadcast family's, because this look is harder. */
  black: "#0B0C10",
  /** Panel. The only mid tone, and it does a lot of work. */
  panel: "#181B23",
  /** Ink. */
  ink: "#E6E7EB",
  /** Ink that has stepped back. */
  dim: "#8A8F9C",
} as const;

// ---------------------------------------------------------------------------
// The angular vocabulary
// ---------------------------------------------------------------------------

/**
 * THE PACK PANEL MATERIAL, and the reason the first pass looked flat.
 *
 * Every panel in the first version used `flagSpec` — a gradient and a shadow. Put
 * beside the reference that reads as coloured cardboard, and the difference is not
 * the gradient: it is the RIM. Every panel in a HUD-styled pack has a light edge
 * along its top and sides, brightest where a light would catch it and gone by the
 * bottom. `stroke` takes a gradient of its own, so that edge was one object away
 * and had simply never been used.
 *
 * Three layers, which is what depth costs: a body ramped along its length, a rim
 * that fades downward, and a shadow to sit the whole thing over the picture.
 */
function panelSpec(fill: string, options: { readonly rim?: number } = {}): PaintSpecDoc {
  return {
    corners: [0, 0, 0, 0],
    gradient: {
      kind: "linear",
      angle: 74,
      stops: [
        { at: 0, color: shade(fill, -0.24) },
        { at: 0.55, color: fill },
        { at: 1, color: shade(fill, 0.14) },
      ],
    },
    stroke: {
      color: "#ffffff",
      width: sp(1.6),
      opacity: options.rim ?? 0.5,
      gradient: {
        kind: "linear",
        angle: 90,
        stops: [
          { at: 0, color: "#ffffff", opacity: 0.02 },
          { at: 0.72, color: "#ffffff", opacity: 0.24 },
          { at: 1, color: "#ffffff", opacity: 0.62 },
        ],
      },
    },
    shadow: { color: "#000000", blur: sp(34), offsetY: -sp(8), opacity: 0.6 },
    density: 40,
  };
}

/**
 * A TEAM FIELD: the colour of a side, ramped across HUE rather than lightness.
 *
 * Red into magenta, purple into indigo. The reference shifts hue across every
 * coloured block, and that is what stops a saturated rectangle reading as a
 * swatch — a lightness ramp of a single colour cannot do it.
 */
function fieldSpec(from: string, to: string): PaintSpecDoc {
  return {
    corners: [0, 0, 0, 0],
    gradient: {
      kind: "linear",
      angle: 62,
      stops: [
        { at: 0, color: shade(from, -0.16) },
        { at: 0.5, color: from },
        { at: 1, color: to },
      ],
    },
    shadow: { color: from, blur: sp(26), opacity: 0.5 },
    density: 40,
  };
}

/** A rect with a rotation, which `plane` deliberately does not offer. */
function turned(
  ids: IdFactory,
  name: string,
  order: string,
  width: number,
  height: number,
  fill: string,
  at: readonly [number, number, number],
  degrees: number,
): SceneNode {
  return {
    id: ids("node"),
    name,
    order,
    transform: {
      position: [...at] as [number, number, number],
      rotation: [0, 0, degrees],
      scale: [1, 1, 1],
    },
    size: { width, height },
    components: [
      {
        id: ids("component"),
        type: "rect",
        props: { width, height, fill, paint: flagSpec(fill) },
      },
    ],
  };
}

/**
 * A corner BRACKET: two thin rects meeting at a right angle.
 *
 * `corner` names which corner it hugs, and the arms run inward from it. Drawn as
 * separate nodes rather than one L, because a rect cannot be an L — and two rects
 * is the honest cost of the mark.
 */
function bracket(
  ids: IdFactory,
  name: string,
  next: () => string,
  corner: "tl" | "tr" | "bl" | "br",
  at: { readonly x: number; readonly y: number },
  arm: number,
  fill: string,
): readonly SceneNode[] {
  const weight = sp(3);
  const right = corner === "tr" || corner === "br";
  const top = corner === "tl" || corner === "tr";
  const dx = right ? -1 : 1;
  const dy = top ? -1 : 1;
  return [
    // The horizontal arm, running inward along the edge.
    plane(ids, `${name} H`, next(), arm, weight, fill, [
      at.x + (dx * arm) / 2,
      at.y - (dy * weight) / 2,
      0.05,
    ]),
    // The vertical arm. Shortened by the weight so the two do not double up in
    // the corner itself, which reads as a thicker blob at every corner.
    plane(ids, `${name} V`, next(), weight, arm - weight, fill, [
      at.x + (dx * weight) / 2,
      at.y - dy * (weight + (arm - weight) / 2),
      0.05,
    ]),
  ];
}

/**
 * A round-by-round pip row: small squares turned 45 degrees.
 *
 * `won` is how many of them are filled; the rest are drawn in the panel tone so
 * the row states the length of the match as well as its score. This is the one
 * element in the pack that is genuinely a data visualisation, and it is why a
 * scoreboard in this genre can be read without its numbers.
 */
function pips(
  ids: IdFactory,
  name: string,
  next: () => string,
  count: number,
  won: number,
  fill: string,
  origin: { readonly x: number; readonly y: number },
  step: number,
): readonly SceneNode[] {
  const side = sp(9);
  return Array.from({ length: count }, (_, index) =>
    turned(
      ids,
      `${name} ${index + 1}`,
      next(),
      side,
      side,
      index < won ? fill : shade(TAC.panel, 0.16),
      [origin.x + index * step, origin.y, 0.04],
      45,
    ),
  );
}

// ---------------------------------------------------------------------------
// 01 — THE SCOREBOARD
// ---------------------------------------------------------------------------

/**
 * THE SCOREBOARD, and it is the pack's centrepiece.
 *
 * A tactical-shooter scoreboard carries more at once than any graphic in the
 * broadcast family: two teams, two scores, a round number, a round clock, which
 * side each team is on, the map, the stage of the tournament, and the round-by-
 * round history. Nine facts, and the composition's whole job is stopping them
 * from becoming a table.
 *
 * The answer is a MIRROR with a spine. Everything about the two teams is
 * symmetrical about the centre line — badge, name, tag, score, all reflected —
 * and the things that belong to the MATCH rather than to either team live on the
 * spine between them: the round, the clock, the side in play. Symmetry does the
 * work a label would otherwise have to: nothing needs to say which column is
 * whose.
 *
 * Bleeding off the top of frame, because this bug is on screen for the entire map
 * and a graphic that is permanently present should not have a permanent top edge
 * to notice.
 */
export const TAC_SCOREBOARD: PackTemplate = {
  id: "tpl_tac_scoreboard",
  name: "Match Scoreboard",
  description: "Two teams, the round clock and the round-by-round pips. Sits on the top edge.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const panel = token("color.surface", TAC.panel);
    const red = token("color.primary", TAC.red);
    const purple = token("color.opposing", TAC.purple);
    const ink = token("color.ink", TAC.ink);
    const dim = token("color.muted", TAC.dim);

    // BIGGER AND LOWER. The first pass was 12.9 x 1.62 jammed against the frame
    // edge with the context strip half off-screen and both of its labels clipped —
    // unreadable, and exactly the kind of fault only a render shows.
    const barW = 14.8;
    const barH = 2.05;
    const stripH = 0.48;
    // The strip sits on top of the bar and INSIDE the frame, with the assembly
    // hung low enough that every label is legible.
    const stripTop = 4.52;
    const stripMid = stripTop - stripH / 2;
    const barTop = stripTop - stripH;
    const barBottom = barTop - barH;
    const barMid = barBottom + barH / 2;

    const strip = plane(
      ids,
      "Context Strip",
      next(),
      barW - 3.4,
      stripH,
      panel,
      [0, stripMid, 0],
      panelSpec(shade(TAC.panel, -0.34), { rim: 0.3 }),
    );

    const bar = plane(
      ids,
      "Background",
      next(),
      barW,
      barH,
      panel,
      [0, barMid, 0.01],
      panelSpec(TAC.panel),
    );

    // The two side fields. Solid team colour behind each badge, running to the
    // bar's outer edges — the accent as a FIELD the composition ends with, and
    // the fastest read of "who is which colour" in the whole graphic.
    const fieldW = 1.05;
    const fieldL = plane(
      ids,
      "Home Field",
      next(),
      fieldW,
      barH,
      red,
      [-barW / 2 + fieldW / 2, barMid, 0.02],
      fieldSpec(TAC.red, TAC.magenta),
    );
    const fieldR = plane(
      ids,
      "Away Field",
      next(),
      fieldW,
      barH,
      purple,
      [barW / 2 - fieldW / 2, barMid, 0.02],
      fieldSpec(TAC.purple, "#6D28D9"),
    );

    // A slanted sliver against each field's inner edge. The one genuinely angular
    // mark the renderer can make, and it is what stops the fields reading as two
    // plain blocks. Rotated the same way on both sides rather than mirrored, so
    // the whole bug leans — mirrored slants read as a bow tie.
    // CONTAINED INSIDE THE BAR. At 1.5x its height they overshot top and bottom and
    // read as two stray diagonal lines crossing the graphic — the worst single
    // fault in the first render. A slant that leaves its panel is a scratch.
    const slantH = barH * 0.96;
    const slantL = turned(ids, "Home Slant", next(), sp(6), slantH, TAC.magenta, [
      -barW / 2 + fieldW + sp(12),
      barMid,
      0.03,
    ], 10);
    const slantR = turned(ids, "Away Slant", next(), sp(6), slantH, "#6D28D9", [
      barW / 2 - fieldW - sp(12),
      barMid,
      0.03,
    ], 10);

    const nameL = type_(ids, "Home", next(), { $var: "home" }, {
      face: FACE.tacticalHead,
      size: 76,
      colour: ink,
      box: { width: 3.6 },
      at: [-barW / 2 + fieldW + sp(34), barMid + sp(18), 0.04],
    });
    const tagL = type_(ids, "Home Tag", next(), { $var: "homeTag" }, {
      face: FACE.tacticalLabel,
      size: 26,
      colour: dim,
      box: { width: 2.0 },
      at: [-barW / 2 + fieldW + sp(36), barMid - sp(46), 0.04],
    });

    const nameR = type_(ids, "Away", next(), { $var: "away" }, {
      face: FACE.tacticalHead,
      size: 76,
      colour: ink,
      box: { width: 3.6 },
      align: "end",
      at: [barW / 2 - fieldW - sp(34) - 3.6, barMid + sp(18), 0.04],
    });
    const tagR = type_(ids, "Away Tag", next(), { $var: "awayTag" }, {
      face: FACE.tacticalLabel,
      size: 26,
      colour: dim,
      box: { width: 2.0 },
      align: "end",
      at: [barW / 2 - fieldW - sp(36) - 2.0, barMid - sp(46), 0.04],
    });

    // THE SCORES, in the tabular face. Turned inward against the spine so the
    // gap between them is fixed no matter what the numbers are.
    const scoreL = type_(ids, "Home Score", next(), { $var: "homeScore" }, {
      face: FACE.display,
      size: 140,
      colour: ink,
      box: { width: 1.5 },
      align: "end",
      at: [-2.72, barMid, 0.04],
    });
    const scoreR = type_(ids, "Away Score", next(), { $var: "awayScore" }, {
      face: FACE.display,
      size: 140,
      colour: ink,
      box: { width: 1.5 },
      at: [1.22, barMid, 0.04],
    });

    // THE SPINE — what belongs to the match rather than to either team.
    const spine = plane(
      ids,
      "Spine",
      next(),
      2.34,
      barH,
      panel,
      [0, barMid, 0.03],
      // RECESSED, so the facts belonging to the match read as set into the bug
      // rather than printed on it — and so the two scores either side are divided
      // by something with depth instead of by a change of tone.
      recessed(TAC.ink, sp(22)),
    );
    const roundNo = type_(ids, "Round", next(), { $var: "round" }, {
      face: FACE.tacticalLabel,
      size: 30,
      colour: dim,
      box: { width: 2.2 },
      align: "center",
      at: [-1.1, barMid + sp(58), 0.04],
    });
    const clock = type_(ids, "Clock", next(), { $var: "clock" }, {
      face: FACE.display,
      size: 76,
      colour: ink,
      box: { width: 2.2 },
      align: "center",
      at: [-1.1, barMid + sp(4), 0.04],
    });
    const side = type_(ids, "Side", next(), { $var: "side" }, {
      face: FACE.tacticalHead,
      size: 30,
      colour: red,
      box: { width: 2.2 },
      align: "center",
      at: [-1.1, barMid - sp(56), 0.04],
    });

    // The context strip's own two facts, pushed to its ends.
    const map = type_(ids, "Map", next(), { $var: "map" }, {
      face: FACE.tacticalLabel,
      size: 24,
      colour: dim,
      box: { width: 3.4 },
      at: [-barW / 2 + 1.7 + sp(18), stripMid, 0.04],
    });
    const stage = type_(ids, "Stage", next(), { $var: "stage" }, {
      face: FACE.tacticalLabel,
      size: 24,
      colour: dim,
      box: { width: 3.4 },
      align: "end",
      at: [barW / 2 - 1.7 - sp(18) - 3.4, stripMid, 0.04],
    });

    // THE PIP ROW, under the bar and centred on the spine. Two runs facing each
    // other, so the row reads outward from the middle the way the match does.
    const step = sp(34);
    const pipY = barBottom - sp(22);
    const homePips = pips(ids, "Home Pip", next, 6, 4, TAC.red, { x: -step * 0.5 - step * 5, y: pipY }, step);
    const awayPips = pips(ids, "Away Pip", next, 6, 3, TAC.purple, { x: step * 0.5, y: pipY }, step);

    // Brackets on the bar's outer corners, in the signal colour.
    const brackets = [
      ...bracket(ids, "Bracket TL", next, "tl", { x: -barW / 2, y: barTop }, 0.42, TAC.red),
      ...bracket(ids, "Bracket BL", next, "bl", { x: -barW / 2, y: barBottom }, 0.42, TAC.red),
      ...bracket(ids, "Bracket TR", next, "tr", { x: barW / 2, y: barTop }, 0.42, TAC.purple),
      ...bracket(ids, "Bracket BR", next, "br", { x: barW / 2, y: barBottom }, 0.42, TAC.purple),
    ];

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: barW, height: barH + stripH },
      // In CREATION order, which is ascending order-key order — the engine rejects
      // a parent whose children are not sorted. Depth between overlapping pieces
      // is carried by their z instead, which is why the spine may be created after
      // the scores and still sit behind them.
      children: [
        strip,
        bar,
        fieldL,
        fieldR,
        slantL,
        slantR,
        nameL,
        tagL,
        nameR,
        tagR,
        scoreL,
        scoreR,
        spine,
        roundNo,
        clock,
        side,
        map,
        stage,
        ...homePips,
        ...awayPips,
        ...brackets,
      ],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Match Scoreboard",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Match Scoreboard" }],
    };

    return document_(
      ids,
      "Match Scoreboard",
      now,
      root,
      [
        variable(ids("variable"), "home", "Home", "SENTINELS"),
        variable(ids("variable"), "homeTag", "Home tag", "#SEN"),
        variable(ids("variable"), "homeScore", "Home score", "13"),
        variable(ids("variable"), "away", "Away", "LOUD"),
        variable(ids("variable"), "awayTag", "Away tag", "#LOUD"),
        variable(ids("variable"), "awayScore", "Away score", "9"),
        variable(ids("variable"), "round", "Round", "ROUND 21"),
        variable(ids("variable"), "clock", "Clock", "0:45"),
        variable(ids("variable"), "side", "Side", "ATTACK"),
        variable(ids("variable"), "map", "Map", "MAP: HAVEN"),
        variable(ids("variable"), "stage", "Stage", "DECIDER"),
      ],
      [
        {
          // Down from the edge it is cropped by, as one unit. A scoreboard that is
          // up for a whole map has no business making an entrance.
          id: ids("timeline"),
          name: "In",
          duration: 0.7,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: barH + stripH + 0.5, easing: "easeOutCubic" },
                { time: 0.5, value: 0 },
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
                { time: 0.45, value: barH + stripH + 0.5 },
              ],
            },
          ],
        },
      ],
    );
  },
};

// ---------------------------------------------------------------------------
// 02 — THE PLAYER LOWER THIRD
// ---------------------------------------------------------------------------

/**
 * A PLAYER STRAP, which is a lower third with a stat line in it.
 *
 * The broadcast family's strap answers "who is this". This one answers "who is
 * this and how are they doing", and the second half is what changes the
 * composition: three figures with labels cannot go under the name without the
 * strap becoming two stacked graphics, so they go BESIDE it, in their own
 * columns, divided by rules.
 *
 * The name block and the stat block are separated by a slanted sliver rather than
 * a vertical rule — the pack's one angular mark, earning its place at the seam
 * between two kinds of information.
 */
export const TAC_PLAYER: PackTemplate = {
  id: "tpl_tac_player",
  name: "Player Strap",
  description: "A player, their role and their match figures, in columns.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const panel = token("color.surface", TAC.panel);
    const red = token("color.primary", TAC.red);
    const ink = token("color.ink", TAC.ink);
    const dim = token("color.muted", TAC.dim);

    const barW = 13.4;
    const barH = 1.5;
    const leftX = -barW / 2;
    const midY = -3.3;
    const top = midY + barH / 2;
    const bottom = midY - barH / 2;

    const bar = plane(
      ids,
      "Background",
      next(),
      barW,
      barH,
      panel,
      [0, midY, 0],
      // A scrim rather than a flag: this strap comes and goes over gameplay, and
      // the far end should dissolve into it.
      scrimSpec(TAC.panel, barH, { width: barW, height: barH }),
    );

    // The identity field: solid signal colour, cropped by the frame's left edge.
    const fieldW = 1.5;
    const field = plane(
      ids,
      "Identity Field",
      next(),
      fieldW + 0.6,
      barH,
      red,
      [leftX + (fieldW + 0.6) / 2 - 0.6, midY, 0.01],
      flagSpec(TAC.red),
    );

    const name = type_(ids, "Name", next(), { $var: "name" }, {
      face: FACE.tacticalHead,
      size: 78,
      colour: ink,
      box: { width: 4.2 },
      at: [leftX + fieldW + sp(30), midY + sp(16), 0.03],
    });
    const role = type_(ids, "Role", next(), { $var: "role" }, {
      face: FACE.tacticalLabel,
      size: 30,
      colour: red,
      box: { width: 2.2 },
      at: [leftX + fieldW + sp(32), midY - sp(36), 0.03],
    });
    const team = type_(ids, "Team", next(), { $var: "team" }, {
      face: FACE.tacticalLabel,
      size: 26,
      colour: dim,
      box: { width: 2.4 },
      at: [leftX + fieldW + sp(32) + 2.3, midY - sp(36), 0.03],
    });

    // The seam: one slanted sliver between the identity and the figures.
    const seamX = leftX + 6.5;
    const seam = turned(ids, "Seam", next(), sp(5), barH * 1.4, TAC.red, [seamX, midY, 0.03], 14);

    // THREE STAT COLUMNS. Figure over label, the figure in the tabular face so a
    // K/D that ticks does not shift its column.
    const stats = [
      { key: "statA", label: "labelA" },
      { key: "statB", label: "labelB" },
      { key: "statC", label: "labelC" },
    ];
    const columnW = 1.9;
    const firstX = seamX + sp(34);
    const columns = stats.flatMap((stat, index) => {
      const x = firstX + index * columnW;
      return [
        type_(ids, `Stat ${index + 1}`, next(), { $var: stat.key }, {
          face: FACE.display,
          size: 56,
          colour: ink,
          box: { width: columnW - sp(20) },
          align: "center",
          at: [x, midY + sp(14), 0.03],
        }),
        type_(ids, `Stat label ${index + 1}`, next(), { $var: stat.label }, {
          face: FACE.tacticalLabel,
          size: 22,
          colour: dim,
          box: { width: columnW - sp(20) },
          align: "center",
          at: [x, midY - sp(38), 0.03],
        }),
      ];
    });

    const brackets = [
      ...bracket(ids, "Bracket TR", next, "tr", { x: barW / 2, y: top }, 0.36, TAC.red),
      ...bracket(ids, "Bracket BR", next, "br", { x: barW / 2, y: bottom }, 0.36, TAC.red),
    ];

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: barW, height: barH },
      children: [bar, field, name, role, team, seam, ...columns, ...brackets],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Player Strap",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Player Strap" }],
    };

    return document_(
      ids,
      "Player Strap",
      now,
      root,
      [
        variable(ids("variable"), "name", "Name", "ZEKKEN"),
        variable(ids("variable"), "role", "Role", "DUELIST"),
        variable(ids("variable"), "team", "Team", "SENTINELS"),
        variable(ids("variable"), "statA", "Stat 1", "24 / 11"),
        variable(ids("variable"), "labelA", "Label 1", "K/D"),
        variable(ids("variable"), "statB", "Stat 2", "324"),
        variable(ids("variable"), "labelB", "Label 2", "ACS"),
        variable(ids("variable"), "statC", "Stat 3", "82%"),
        variable(ids("variable"), "labelC", "Label 3", "KAST"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.75,
          tracks: [
            {
              target: holderId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -barW - 1, easing: "easeOutCubic" },
                { time: 0.52, value: 0 },
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
                { time: 0.45, value: -barW - 1 },
              ],
            },
          ],
        },
      ],
    );
  },
};

// ---------------------------------------------------------------------------
// 04 — ROUND WIN
// ---------------------------------------------------------------------------

/**
 * ROUND WIN — the pack's stinger, and the one graphic that is pure impact.
 *
 * It is on screen for about a second and a half between rounds, so it has no
 * information problem to solve: two words, and the composition's whole job is
 * hitting. Which makes it the place the angular language can be used hardest —
 * four slanted slivers raking across the frame behind the words, a full-bleed
 * wash under them, and brackets that frame the whole picture rather than a panel.
 *
 * The slants are all rotated the SAME way and spaced unevenly. Mirrored, they
 * would make a chevron and the eye would read a direction; parallel and uneven,
 * they read as motion.
 */
export const TAC_ROUND: PackTemplate = {
  id: "tpl_tac_round",
  name: "Round Win",
  description: "A full-frame result stinger, raked with angular slivers.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const red = token("color.primary", TAC.red);
    const ink = token("color.ink", TAC.ink);

    const wash = plane(
      ids,
      "Wash",
      next(),
      17.9,
      4.6,
      token("color.surface", TAC.black),
      [0, 0.1, 0],
      scrimSpec(TAC.black, 4.6, { width: 4.6, height: 4.6 }),
    );

    // Raking slivers. Uneven spacing on purpose: an even run is a pattern, and a
    // pattern reads as decoration rather than as speed.
    const rake = [-5.6, -3.9, 3.4, 5.9].map((x, index) =>
      turned(
        ids,
        `Rake ${index + 1}`,
        next(),
        sp(index % 2 === 0 ? 10 : 5),
        5.6,
        index % 2 === 0 ? TAC.red : TAC.magenta,
        [x, 0.1, 0.01],
        14,
      ),
    );

    const title = type_(ids, "Title", next(), { $var: "title" }, {
      face: FACE.tacticalHead,
      size: 210,
      colour: ink,
      box: { width: 13.0 },
      align: "center",
      at: [-6.5, 0.62, 0.03],
    });

    const under = plane(ids, "Rule", next(), 3.2, sp(4), red, [0, -0.62, 0.03], flagSpec(TAC.red));

    const sub = type_(ids, "Subtitle", next(), { $var: "subtitle" }, {
      face: FACE.tacticalLabel,
      size: 54,
      colour: red,
      box: { width: 9.0 },
      align: "center",
      at: [-4.5, -1.24, 0.03],
    });

    const brackets = [
      ...bracket(ids, "Bracket TL", next, "tl", { x: -7.6, y: 2.1 }, 0.7, TAC.red),
      ...bracket(ids, "Bracket BR", next, "br", { x: 7.6, y: -1.9 }, 0.7, TAC.red),
    ];

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: 17.9, height: 4.6 },
      children: [wash, ...rake, title, under, sub, ...brackets],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Round Win",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Round Win" }],
    };

    return document_(
      ids,
      "Round Win",
      now,
      root,
      [
        variable(ids("variable"), "title", "Title", "ROUND WIN"),
        variable(ids("variable"), "subtitle", "Subtitle", "ATTACK"),
      ],
      [
        {
          // The wash opens from the centre line — a scale on Y about its own
          // middle, which needs no position compensation because the middle is
          // where it should grow from. Then the rule wipes out under the words.
          id: ids("timeline"),
          name: "In",
          duration: 0.9,
          tracks: [
            {
              target: holderId,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.34, value: 1 },
              ],
            },
            {
              target: under.id,
              path: "transform.scale.0",
              delay: 0.34,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.3, value: 1 },
              ],
            },
          ],
        },
        {
          id: ids("timeline"),
          name: "Out",
          duration: 0.4,
          tracks: [
            {
              target: holderId,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 1, easing: "easeInCubic" },
                { time: 0.4, value: 0 },
              ],
            },
          ],
        },
      ],
    );
  },
};

export const TACTICAL: readonly PackTemplate[] = [
  TAC_SCOREBOARD,
  TAC_PLAYER,
  TAC_ROUND,
];

void SAFE;
