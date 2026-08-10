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
/**
 * THE TICKER.
 *
 * ==========================================================================
 * AN INFORMATION SYSTEM, WHICH MEANS CELLS AND A READING ORDER
 * ==========================================================================
 * What was here was one strip with a headline in it. A news strap is the densest
 * graphic in any package and the only one carrying four unrelated facts at once,
 * so the design problem is not the strip — it is deciding what is read first and
 * making that decision visible.
 *
 * The order is fixed left to right, and each cell is given exactly the weight its
 * job needs:
 *
 *   STATE      "LIVE", in dark type on a lit accent flag. First, smallest, most
 *              saturated, and the ONLY glow in the whole package — rule 7 keeps
 *              it for things that are genuinely transmitting. If this graphic is
 *              on screen, that is the fact the viewer needs before any other.
 *
 *   CATEGORY   On a lifted cell of its own, in the display face at the smallest
 *              size. It is a filing label, not a sentence, so it gets a box
 *              rather than a line of type.
 *
 *   HEADLINE   The widest cell by far, in Barlow Condensed Bold — the only face
 *              in the set that holds twelve words of mixed-case copy at a
 *              legible size. Rule 5: mixed case comes from the face, and a
 *              headline in caps is a headline nobody can scan.
 *
 *   TIME       Right-anchored on the title-safe line, in the display face
 *              because its figures are TABULAR. A clock whose digits change
 *              width shifts the cell every minute; it is the reason the display
 *              face was chosen by measurement.
 *
 * ==========================================================================
 * WHY IT DOES NOT CRAWL
 * ==========================================================================
 * A crawl is a position animation, which the timeline can do. What it cannot do
 * is clip: without a mask the headline would run straight over the category cell
 * on one side and the clock on the other, and a crawl that overprints its own
 * furniture is worse than no crawl. So this is a static strap — which is what
 * most broadcasters actually cut to for a single story — and the crawl waits for
 * the masking capability rather than being faked.
 *
 * The strip is solid and runs off BOTH frame edges, so it has no ends to soften.
 * Rule 1 is about furniture that stops inside the picture; this does not.
 */
export const TICKER: PackTemplate = {
  id: "tpl_ticker",
  name: "Ticker",
  description: "State, category, headline and clock, in one strap. Reads left to right.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const surfaceLift = token("color.surfaceLift", PALETTE.surfaceLift);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);
    const onAccent = token("color.onAccent", PALETTE.onAccent);

    // The strip's band. Its centre is chosen so the type inside it stays within
    // the bottom title-safe line rather than the strip merely touching it — a
    // ticker whose words are outside title-safe is a ticker a fifth of the
    // audience cannot read.
    const stripH = 0.92;
    const midY = -4.28;
    const topY = midY + stripH / 2;

    // Bleeding past both frame edges, so neither end is ever visible.
    const strip = plane(
      ids,
      "Background",
      next(),
      18.6,
      stripH,
      surface,
      [0, midY, 0],
      flagSpec(PALETTE.surface),
      { id: "flag", from: PALETTE.surface },
    );

    const edge = plane(ids, "Edge", next(), 18.6, sp(3), accent, [0, topY, 0.01]);

    // LIVE, on the title-safe left line. Full strip height: a state badge that
    // floats inside the strip reads as a chip; one that fills it reads as part of
    // the system.
    const stateW = 1.46;
    const stateFlag = plane(
      ids,
      "Live Flag",
      next(),
      stateW,
      stripH,
      accent,
      [SAFE.left + stateW / 2, midY, 0.02],
      litFlagSpec(PALETTE.primary),
    );
    const state = type_(ids, "State", next(), { $var: "state" }, {
      face: FACE.display,
      size: 34,
      colour: onAccent,
      box: { width: stateW - sp(20) },
      align: "center",
      at: [SAFE.left + sp(10), midY, 0.03],
    });

    // The category cell, butted against the state flag with a hairline of gap.
    const categoryX = SAFE.left + stateW;
    const categoryW = 2.34;
    const categoryCell = plane(
      ids,
      "Category Cell",
      next(),
      categoryW,
      stripH,
      surfaceLift,
      [categoryX + categoryW / 2, midY, 0.02],
      flagSpec(PALETTE.surfaceLift),
      { id: "flag", from: PALETTE.surfaceLift },
    );
    const category = type_(ids, "Category", next(), { $var: "category" }, {
      face: FACE.display,
      size: 30,
      // INK, not muted. A filing label at 30px in muted grey on the lifted cell
      // measured as the least legible thing in the package — and a category a
      // viewer has to work at is a category doing no work. Its subordination
      // comes from size and from the cell around it, both of which are already
      // doing that job; taking the contrast as well was one signal too many.
      colour: ink,
      box: { width: categoryW - sp(36) },
      align: "center",
      at: [categoryX + sp(18), midY, 0.03],
    });

    // The headline. Everything between the category cell and the clock, which is
    // most of the frame — the widest cell, for the only cell holding a sentence.
    const clockW = 1.9;
    const clockX = SAFE.right - clockW;
    const headlineX = categoryX + categoryW + sp(30);
    const headline = type_(ids, "Headline", next(), { $var: "headline" }, {
      face: FACE.headline,
      size: 44,
      colour: ink,
      box: { width: clockX - headlineX - sp(40) },
      // A LOWER SHRINK FLOOR THAN ANYTHING ELSE IN THE PACKAGE, because a
      // headline is the one slot in the package whose length nobody controls. A
      // name has a natural maximum and a score has three characters; a strap
      // takes whatever the newsroom sends.
      //
      // 0.5 takes it to about 130 characters at a legible 22px, which is longer
      // than any single-story strap a broadcaster cuts. Beyond that the string
      // genuinely cannot be shown: without a mask there is no clipping and no
      // ellipsis to design with, so the floor is the only lever there is.
      //
      // (An earlier version of this comment blamed the floor for a headline that
      // rendered nothing. That was wrong — see the edited-text defect in
      // `e2e/design-review.spec.ts`. Lowering the floor was measured against
      // authored strings afterwards and kept on its own merits.)
      floor: 0.5,
      at: [headlineX, midY, 0.03],
    });

    // A hairline before the clock, so the time reads as a separate fact rather
    // than as the end of the headline.
    const divide = plane(
      ids,
      "Divider",
      next(),
      sp(2),
      stripH - sp(30),
      muted,
      [clockX - sp(14), midY, 0.02],
    );

    const clock = type_(ids, "Time", next(), { $var: "time" }, {
      face: FACE.display,
      size: 44,
      colour: ink,
      box: { width: clockW },
      align: "end",
      at: [clockX, midY, 0.03],
    });

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: 18.6, height: stripH },
      children: [
        strip,
        edge,
        stateFlag,
        state,
        categoryCell,
        category,
        headline,
        divide,
        clock,
      ],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Ticker",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Ticker" }],
    };

    return document_(
      ids,
      "Ticker",
      now,
      root,
      [
        variable(ids("variable"), "state", "State", "LIVE"),
        variable(ids("variable"), "category", "Category", "PREMIER LEAGUE"),
        variable(
          ids("variable"),
          "headline",
          "Headline",
          "Liverpool take the lead at Anfield through a second-half header",
        ),
        variable(ids("variable"), "time", "Time", "21:04"),
      ],
      [
        {
          // The strap rises out of the bottom of frame and the cells are already
          // in it. Staggering them would animate the FURNITURE, and a viewer has
          // no reason to watch a strap assemble — they are here for the sentence.
          id: ids("timeline"),
          name: "In",
          duration: 0.6,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -stripH - 0.3, easing: "easeOutCubic" },
                { time: 0.45, value: 0 },
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
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeInCubic" },
                { time: 0.4, value: -stripH - 0.3 },
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
