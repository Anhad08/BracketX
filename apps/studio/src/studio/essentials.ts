/**
 * Streamatrix Essentials — the starter graphics.
 *
 * ============================================================================
 * WHY THIS IS CONTENT WORK, NOT A SUBSYSTEM
 * ============================================================================
 * Every graphic here is built from the same `rect`, `text`, `image`, layout,
 * repeat and timeline primitives the first three templates used. Nothing below
 * needed an engine change, which is exactly why it belongs in a completion
 * milestone: the platform was finished enough to demonstrate and was not
 * demonstrating itself.
 *
 * Three templates cannot show a broadcaster that Streamatrix does their job.
 * These are spread deliberately across the jobs they actually have — news,
 * sport, events, sponsorship — because breadth is the claim being made.
 *
 * ============================================================================
 * WHY THEY LIVE IN THEIR OWN FILE
 * ============================================================================
 * `packs.ts` owns the scene-construction helpers and the pack catalogue.
 * Content that USES those helpers is a different concern and grows on a
 * different schedule — every future Essentials graphic lands here and nothing
 * about the pack machinery moves.
 */
import { IDENTITY_TRANSFORM, generateKeyBetween, type SceneNode } from "@bracketx/engine-scene";

import type { IdFactory } from "./ids";
import { STUDIO_IMAGES } from "./images";
import {
  FACE,
  PALETTE,
  SAFE,
  SIZE,
  col,
  flagSpec,
  litFlagSpec,
  plane,
  recessed,
  rule,
  scrimSpec,
  sp,
  type_,
  veilSpec,
} from "./broadcast";
import {
  PLATE,
  bar,
  camera,
  document_,
  group,
  label,
  logo,
  nextOrder,
  variable,
  type PackTemplate,
} from "./packs";

/**
 * THE SPONSOR BAR.
 *
 * ==========================================================================
 * A SPONSORSHIP TREATMENT, NOT THE WORD "SPONSOR" IN A RECTANGLE
 * ==========================================================================
 * What was here: a 6.4 x 1.8 panel, an accent line along the bottom, a courtesy
 * line and a mark. It said the right words and it was built like every other
 * plate in the set.
 *
 * A sponsor billboard is a different KIND of graphic from a strap, and the
 * difference is whose graphic it is. A lower third belongs to the broadcaster and
 * is anchored to their margin. A sponsor bar is a contractual object: the
 * partner's mark has to be the largest thing in it, it has to be unmistakably
 * separate from editorial content, and it has to look like it was placed rather
 * than fitted in.
 *
 * So this is the one graphic in the family that is CENTRED, and that is the whole
 * compositional idea:
 *
 *   THE STANCE    Centred on the frame and sitting on the bottom title-safe
 *                 line. Every other graphic here is anchored to the left margin;
 *                 a billboard that shares their stance reads as more editorial
 *                 furniture. Centring is what makes it read as an interruption.
 *
 *   THE SPLIT     Courtesy and programme on the left, the partner's mark on the
 *                 right, with a hairline between them. Two columns rather than a
 *                 stack, because the two halves are saying things on behalf of
 *                 two different parties and should not read as one sentence.
 *
 *   THE MARK      Given a box 2.9 units wide against 40-pixel type beside it, so
 *                 the partner is the largest element by a wide margin. `contain`
 *                 always: a stretched brand mark is the most visible mistake this
 *                 component can make, and the one a partner will notice.
 *
 *   THE EDGE      A solid accent line along the TOP, drawn with a flat bound
 *                 fill and no paint at all. A three-pixel line needs no gradient,
 *                 and leaving it flat keeps it bound to the brand token — which a
 *                 gradient, whose stops cannot hold a binding, would break.
 *
 * The veil fades UP, out of the bottom of frame, so the billboard has no bottom
 * edge to read. A centred plate cannot dissolve sideways without lying about
 * which side it belongs to.
 */
export const SPONSOR: PackTemplate = {
  id: "tpl_sponsor",
  name: "Sponsor Bar",
  description: "A partner's mark, credited and kept separate. Sits on the frame edge.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);

    const plateW = 9.2;
    const plateH = 1.85;
    // RUNNING OFF THE BOTTOM OF FRAME, not sitting on the title-safe line. The
    // first render put the plate's bottom edge at -4.5 and it read as a bar
    // floating above the frame edge with a hard line under it. A billboard rises
    // out of the bottom of the picture; giving it no bottom edge at all is what
    // makes it look placed rather than pasted.
    const floorY = -5;
    const midY = floorY + plateH / 2;
    const leftX = -plateW / 2;
    const divideX = 0.55;

    const backdrop = plane(
      ids,
      "Background",
      next(),
      plateW,
      plateH,
      surface,
      [0, midY, 0],
      // SOLID, not a veil. A veil's fade is scaled to a full-frame wash, and over
      // 1.85 units it had already given up most of its opacity by the time it
      // reached the type — a billboard has to carry a partner's mark at full
      // contrast. It needs no dissolve: its bottom edge is off-frame and its top
      // edge is the accent line, so there is no edge left to soften.
      flagSpec(PALETTE.surface),
      { id: "flag", from: PALETTE.surface },
    );

    // Flat, bound, and deliberately unpainted — see the note above.
    const edge = plane(ids, "Edge", next(), plateW, sp(3), accent, [0, floorY + plateH, 0.01]);

    const courtesy = type_(ids, "Courtesy", next(), { $var: "courtesy" }, {
      face: FACE.display,
      size: 28,
      colour: muted,
      box: { width: 4.4 },
      at: [leftX + sp(30), midY + sp(28), 0.02],
    });

    const programme = type_(ids, "Programme", next(), { $var: "programme" }, {
      face: FACE.headline,
      size: 40,
      colour: ink,
      box: { width: 4.4 },
      at: [leftX + sp(30), midY - sp(20), 0.02],
    });

    // The divider. Short of the plate's full height on both sides, so it reads as
    // a division between two columns rather than as the plate being cut in half.
    const divide = plane(
      ids,
      "Divider",
      next(),
      sp(2),
      plateH - sp(38),
      muted,
      [divideX, midY, 0.02],
    );

    // CENTRED IN THE COLUMN IT OWNS — from the divider to the plate's right edge
    // — rather than in a box that happened to be 2.9 wide. `contain` centres the
    // mark inside its box, so a box that does not fill the column puts the mark
    // off-centre in the space a viewer actually sees.
    const markColumn = plateW / 2 - divideX;
    const mark = logo(
      ids,
      "Logo",
      next(),
      { $var: "logo" },
      { width: markColumn - sp(48), height: 0.92 },
      [divideX + markColumn / 2, midY, 0.02],
    );

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: plateW, height: plateH },
      children: [backdrop, edge, courtesy, programme, divide, mark],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Sponsor Bar",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Sponsor Bar" }],
    };

    return document_(
      ids,
      "Sponsor Bar",
      now,
      root,
      [
        variable(ids("variable"), "courtesy", "Courtesy", "PRESENTED BY"),
        variable(ids("variable"), "programme", "Programme", "Match of the Day"),
        variable(ids("variable"), "logo", "Logo", STUDIO_IMAGES[0]!.assetId, "asset"),
      ],
      [
        {
          // A billboard RISES rather than slides. It is centred, so there is no
          // side for it to come from — and a centred object entering sideways
          // looks like it missed its mark and corrected. One wipe upward,
          // holding the bottom edge, and the accent edge arrives with it.
          id: ids("timeline"),
          name: "In",
          duration: 0.7,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -plateH - 0.2, easing: "easeOutCubic" },
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
                { time: 0.45, value: -plateH - 0.2 },
              ],
            },
          ],
        },
      ],
    );
  },
};

/** The stage every graphic is composed on. 16:9 at Studio's unit scale. */
function stage(ids: IdFactory, name: string, holder: SceneNode): SceneNode {
  return {
    id: ids("node"),
    name,
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    size: { width: 17.78, height: 10 },
    children: [camera(ids, nextOrder(null)), holder],
  };
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export const TICKER: PackTemplate = {
  id: "tpl_ticker",
  name: "Ticker",
  description: "A full-width strip with a category flag. Slides up, slides away.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", "#101319");
    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");

    const holderId = ids("node");
    const strip = bar(ids, "Strip", next(), 17.78, 0.9, surface, [0, 0, 0], PLATE.strip(surface, 0.9));
    const flag = bar(ids, "Flag", next(), 3.1, 0.9, accent, [-7.34, 0, 0.01]);
    const category = label(
      ids, "Category", next(), { $var: "category" }, ink, 34,
      { width: 2.8 }, [-8.74, 0, 0.02], { align: "center" },
    );
    const headline = label(
      ids, "Headline", next(), { $var: "headline" }, ink, 36,
      { width: 13.4 }, [-5.6, 0, 0.02],
    );

    const holder = group(holderId, next(), {
      position: [0, -4.2, 0],
      size: { width: 17.78, height: 0.9 },
      children: [strip, flag, category, headline],
    });

    return document_(
      ids, "Ticker", now, stage(ids, "Ticker", { ...holder, name: "Ticker" }),
      [
        variable(ids("variable"), "category", "Category", "LIVE"),
        variable(ids("variable"), "headline", "Headline", "Markets close higher for a third straight session"),
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
                { time: 0, value: -5.4, easing: "easeOutCubic" },
                { time: 0.5, value: -4.2 },
              ],
            },
          ],
        },
        {
          // A ticker is the one graphic an operator genuinely leaves up and
          // takes down, so it ships with the exit its workflow needs rather
          // than making them build one.
          id: ids("timeline"),
          name: "Out",
          duration: 0.5,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -4.2, easing: "easeInCubic" },
                { time: 0.4, value: -5.4 },
              ],
            },
          ],
        },
      ],
    );
  },
};

export const BREAKING: PackTemplate = {
  id: "tpl_breaking",
  name: "Breaking News",
  description: "An urgent banner with a kicker. Wipes open, then the headline arrives.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", "#101319");
    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");

    const holderId = ids("node");
    const backdrop = bar(ids, "Background", next(), 16.4, 1.5, surface, [0, 0, 0], PLATE.panel(surface, 1.5));
    const kickerBar = bar(ids, "Kicker Bar", next(), 4.6, 0.58, accent, [-5.9, 1.02, 0.01], PLATE.urgent(accent, 0.58));
    const kicker = label(
      ids, "Kicker", next(), { $var: "kicker" }, ink, 30,
      { width: 4.2 }, [-7.9, 1.02, 0.02],
    );
    const headline = label(
      ids, "Headline", next(), { $var: "headline" }, ink, 62,
      { width: 15.4 }, [-7.7, 0, 0.02],
    );

    const holder = group(holderId, next(), {
      position: [0, -2.6, 0],
      size: { width: 16.4, height: 1.5 },
      children: [backdrop, kickerBar, kicker, headline],
    });

    return document_(
      ids, "Breaking News", now, stage(ids, "Breaking News", { ...holder, name: "Breaking" }),
      [
        variable(ids("variable"), "kicker", "Kicker", "BREAKING"),
        variable(ids("variable"), "headline", "Headline", "Parliament passes the budget"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.8,
          tracks: [
            // Staggered rather than simultaneous: the bar opens, the flash
            // lands, then the words arrive. Everything moving at once reads as
            // one shape sliding, which is the difference between a graphic that
            // looks authored and one that looks generated.
            {
              target: backdrop.id,
              path: "transform.scale.0",
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.5, value: 1 },
              ],
            },
            {
              target: kickerBar.id,
              path: "transform.scale.0",
              delay: 0.12,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.35, value: 1 },
              ],
            },
            {
              target: headline.id,
              path: "transform.position.0",
              delay: 0.24,
              keyframes: [
                { time: 0, value: -9.1, easing: "easeOutCubic" },
                { time: 0.45, value: -7.7 },
              ],
            },
          ],
        },
      ],
    );
  },
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const COUNTDOWN: PackTemplate = {
  id: "tpl_countdown",
  name: "Countdown",
  description: "A large clock over a caption. For pre-show holds and breaks.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");
    const muted = token("color.muted", "#8a93a6");

    const holderId = ids("node");
    const caption = label(
      ids, "Caption", next(), { $var: "caption" }, muted, 40,
      { width: 10 }, [-5, 1.6, 0.02], { align: "center" },
    );
    const clock = label(
      ids, "Clock", next(), { $var: "clock" }, ink, 190,
      { width: 10 }, [-5, -0.1, 0.02], { align: "center" },
    );
    const rule = bar(ids, "Rule", next(), 4.4, 0.05, accent, [0, -1.9, 0.01]);

    const holder = group(holderId, next(), {
      size: { width: 10, height: 4.6 },
      children: [caption, clock, rule],
    });

    return document_(
      ids, "Countdown", now, stage(ids, "Countdown", { ...holder, name: "Countdown" }),
      [
        variable(ids("variable"), "caption", "Caption", "COVERAGE BEGINS IN"),
        variable(ids("variable"), "clock", "Clock", "05:00"),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.7,
          tracks: [
            // Scaled from just under 1 rather than from 0: a clock that grows
            // from nothing reads as a logo sting. This reads as a settle.
            {
              target: clock.id,
              path: "transform.scale.0",
              keyframes: [
                { time: 0, value: 0.88, easing: "easeOutCubic" },
                { time: 0.55, value: 1 },
              ],
            },
            {
              target: clock.id,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 0.88, easing: "easeOutCubic" },
                { time: 0.55, value: 1 },
              ],
            },
            {
              target: rule.id,
              path: "transform.scale.0",
              delay: 0.15,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.5, value: 1 },
              ],
            },
          ],
        },
      ],
    );
  },
};
// ---------------------------------------------------------------------------
// Sport and esports
// ---------------------------------------------------------------------------

export const LEADERBOARD: PackTemplate = {
  id: "tpl_leaderboard",
  name: "Leaderboard",
  description: "A standings table driven by a list. Add teams without redesigning.",
  build: (ids, token, now) => {
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", "#101319");
    const accent = token("color.primary", "#2f6feb");
    const ink = token("color.ink", "#f2f5fb");
    const muted = token("color.muted", "#8a93a6");

    const holderId = ids("node");
    const backdrop = bar(ids, "Background", next(), 8.6, 5.4, surface, [0, 0, 0], PLATE.panel(surface, 2.2));
    const titleBar = bar(ids, "Title Bar", next(), 8.6, 0.9, accent, [0, 2.25, 0.01]);
    const title = label(
      ids, "Title", next(), { $var: "title" }, ink, 42,
      { width: 7.8 }, [-3.9, 2.25, 0.02],
    );

    // ONE row, repeated. `{ $var: "row.<field>" }` resolves per instance, so a
    // list of five renders five rows and a list of twenty renders twenty —
    // nothing is authored twice and adding a team is a data edit.
    let rowOrder: string | null = null;
    const rowNext = (): string => (rowOrder = nextOrder(rowOrder));
    const rank = label(
      ids, "Rank", rowNext(), { $var: "row.rank" }, muted, 32,
      { width: 0.7 }, [-3.85, 0, 0.02],
    );
    const team = label(
      ids, "Team", rowNext(), { $var: "row.team" }, ink, 32,
      { width: 5.4 }, [-2.95, 0, 0.02],
    );
    const points = label(
      ids, "Points", rowNext(), { $var: "row.points" }, ink, 32,
      { width: 1.1 }, [2.7, 0, 0.02], { align: "end" },
    );

    const row: SceneNode = {
      id: ids("node"),
      name: "Row",
      order: next(),
      transform: IDENTITY_TRANSFORM,
      size: { width: 8.2, height: 0.62 },
      children: [rank, team, points],
    };

    const rows: SceneNode = {
      id: ids("node"),
      name: "Standings",
      order: next(),
      transform: { position: [0, -0.55, 0.01], rotation: [0, 0, 0], scale: [1, 1, 1] },
      size: { width: 8.2, height: 3.9 },
      layout: { mode: "vertical", gap: 0.08, align: "stretch" },
      repeat: { source: "standings", as: "row", key: "rank" },
      children: [row],
    };

    const holder = group(holderId, next(), {
      position: [-4.2, 0.4, 0],
      size: { width: 8.6, height: 5.4 },
      children: [backdrop, titleBar, title, rows],
    });

    return document_(
      ids, "Leaderboard", now, stage(ids, "Leaderboard", { ...holder, name: "Leaderboard" }),
      [
        variable(ids("variable"), "title", "Title", "STANDINGS"),
        variable(
          ids("variable"),
          "standings",
          "Standings",
          [
            { rank: "1", team: "Northgate United", points: "72" },
            { rank: "2", team: "Riverside FC", points: "68" },
            { rank: "3", team: "Kingsbury Athletic", points: "64" },
            { rank: "4", team: "Elmwood Rovers", points: "61" },
            { rank: "5", team: "Harbour City", points: "57" },
          ],
          "list",
        ),
      ],
      [
        {
          id: ids("timeline"),
          name: "In",
          duration: 0.8,
          tracks: [
            {
              target: holderId,
              path: "transform.position.0",
              keyframes: [
                { time: 0, value: -11.6, easing: "easeOutCubic" },
                { time: 0.6, value: -4.2 },
              ],
            },
            {
              target: titleBar.id,
              path: "transform.scale.0",
              delay: 0.2,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.45, value: 1 },
              ],
            },
          ],
        },
      ],
    );
  },
};

/** Everything this file adds, in the order a starter library should read. */
export const ESSENTIALS: readonly PackTemplate[] = [
  TICKER,
  BREAKING,
  COUNTDOWN,
  SPONSOR,
  LEADERBOARD,
];
