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
/**
 * BREAKING NEWS.
 *
 * ==========================================================================
 * URGENCY IS STRUCTURAL. RED IS THE SMALLEST PART OF IT
 * ==========================================================================
 * What was here was a lower third with a red kicker on it. That is the trap this
 * graphic sets: red is the easiest thing to reach for, it is the first thing that
 * stops meaning anything once every graphic has some, and a red chip on a
 * normal-sized strap communicates a category rather than an emergency.
 *
 * Four structural decisions carry the urgency here, and the colour is the fifth:
 *
 *   MASS         The assembly is a third of the frame and runs off both edges and
 *                off the bottom. Every other graphic in this package is furniture
 *                sitting in a picture; this one TAKES the picture. A viewer
 *                registers the change in how much screen is spoken for before
 *                they read a word.
 *
 *   HARD EDGES   No scrim, no dissolve, no relieved corner. Rule 1 is for
 *                furniture that stops inside the frame — this deliberately does
 *                not soften, because a softened edge reads as calm.
 *
 *   SCALE        The headline is set at 82 against the ticker's 44 and the lower
 *                third's role at 32. It is the second-largest type in the whole
 *                package, behind only the title card.
 *
 *   DENSITY      Leading of 0.98 — tighter than a single line is tall, and the
 *                only place in the package where type is set tighter than 1.0.
 *                Packed lines read as pressure. Loose ones read as a poster.
 *
 *   THEN COLOUR  A full-bleed band of `color.urgent`, held back from every other
 *                graphic in the family precisely so it still means something
 *                here. Dark type on it, not white — see the palette note.
 *
 * The band also carries the TIME, right-anchored. A breaking strap without a
 * timestamp is a strap that is still breaking an hour later, and putting the
 * clock in the red band rather than in the body is what makes it read as "this is
 * when", not "this is another fact".
 */
export const BREAKING: PackTemplate = {
  id: "tpl_breaking",
  name: "Breaking News",
  description: "A full-bleed alert: the band, the headline and when it happened.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const urgent = token("color.urgent", PALETTE.urgent);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);
    const onAccent = token("color.onAccent", PALETTE.onAccent);

    // Bleeding past both frame edges. Nothing here has a visible end.
    const bleed = 18.6;
    const bandH = 0.68;
    const bandY = -1.24;
    const blockTop = bandY - bandH / 2;
    const blockH = blockTop + 5;

    const block = plane(
      ids,
      "Background",
      next(),
      bleed,
      blockH,
      surface,
      [0, blockTop - blockH / 2, 0],
      flagSpec(PALETTE.surface),
      { id: "flag", from: PALETTE.surface },
    );

    const band = plane(
      ids,
      "Alert Band",
      next(),
      bleed,
      bandH,
      urgent,
      [0, bandY, 0.01],
      flagSpec(PALETTE.urgent),
      { id: "flag", from: PALETTE.urgent },
    );

    const kicker = type_(ids, "Kicker", next(), { $var: "kicker" }, {
      face: FACE.display,
      size: 46,
      colour: onAccent,
      box: { width: 6.0 },
      at: [SAFE.left, bandY, 0.02],
    });

    const stamp = type_(ids, "Time", next(), { $var: "time" }, {
      face: FACE.display,
      size: 34,
      colour: onAccent,
      box: { width: 2.6 },
      align: "end",
      at: [SAFE.right - 2.6, bandY, 0.02],
    });

    const headline = type_(ids, "Headline", next(), { $var: "headline" }, {
      face: FACE.headline,
      size: 82,
      colour: ink,
      box: { width: 15.4 },
      maxLines: 2,
      // The one place in the package set tighter than a line is tall.
      lineHeight: 0.98,
      floor: 0.55,
      at: [SAFE.left, -2.5, 0.02],
    });

    const under = plane(
      ids,
      "Rule",
      next(),
      6.2,
      sp(3),
      ink,
      [SAFE.left + 3.1, -3.26, 0.02],
      // 0.55, not 0.32. At a third of ink on a near-black block a three-pixel
      // rule is not subtle, it is absent — it did not appear in the render at
      // all. Rule 4 says a rule separates two orders of information; one nobody
      // can see is decoration that failed to draw.
      rule(PALETTE.ink, 0.55),
    );

    const context = type_(ids, "Context", next(), { $var: "context" }, {
      face: FACE.text,
      size: SIZE.body,
      colour: muted,
      box: { width: 11.0 },
      at: [SAFE.left, -3.66, 0.02],
    });

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: bleed, height: blockH + bandH },
      children: [block, band, kicker, stamp, headline, under, context],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Breaking News",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Breaking News" }],
    };

    return document_(
      ids,
      "Breaking News",
      now,
      root,
      [
        variable(ids("variable"), "kicker", "Kicker", "BREAKING NEWS"),
        variable(
          ids("variable"),
          "headline",
          "Headline",
          "Anfield stoppage-time winner sends Liverpool top of the table",
        ),
        variable(ids("variable"), "context", "Context", "Live at Anfield · Reporter, Alex Rivera"),
        variable(ids("variable"), "time", "Time", "21:04"),
      ],
      [
        {
          // IT ARRIVES IN ONE MOVE, FAST, and nothing about it is staggered.
          //
          // A cue this graphic answers is not a reveal, it is an interruption:
          // the whole block comes up from the bottom of frame in under half a
          // second and stops dead. Staggering the parts would make a viewer watch
          // it assemble, and the one thing an alert must not look like is
          // something that took its time.
          id: ids("timeline"),
          name: "In",
          duration: 0.55,
          tracks: [
            {
              target: holderId,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -6.4, easing: "easeOutCubic" },
                { time: 0.42, value: 0 },
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
                { time: 0.45, value: -6.4 },
              ],
            },
          ],
        },
      ],
    );
  },
};
/**
 * THE COUNTDOWN.
 *
 * ==========================================================================
 * A FULL-FRAME HOLD, NOT A CLOCK ON A PLATE
 * ==========================================================================
 * What was here was a large clock over a caption, on a panel, in the middle of
 * frame. The clock was the biggest thing in it, which is right, and everything
 * else about it was a plate — so it read as a widget rather than as the thing a
 * channel puts up when it has nothing else to show.
 *
 * A countdown is the only graphic in the package that is ALONE on air. Nothing is
 * behind it and nothing is competing with it, so it does not need a plate to
 * separate it from anything — it needs to look composed at the scale of the whole
 * frame. That changes every decision:
 *
 *   THE FIGURES  Set at 320, by a distance the largest thing in the package —
 *                more than three times the lower third's name and nearly twice
 *                the title card's title. Rule 6 taken to its limit: this graphic
 *                is a number and admits it.
 *
 *   TABULAR      02:14 becomes 02:13 becomes 02:12, once a second, forever. With
 *                proportional figures the whole graphic would twitch on every
 *                tick — a 1 is 284 units wide against a 4 at 484 in the faces
 *                that were rejected. At 320 that difference is over sixty pixels
 *                of jump. This is the graphic the display face was chosen for.
 *
 *   CENTRED      Optically centred, and slightly above the frame's middle: a
 *                block of type with a caption under it balances high, because the
 *                caption and the space beneath it read as part of the mass.
 *
 *   THE FLAGS    A status flag above the clock and a caption below it, both
 *                centred, both tiny against the figures. The whole hierarchy is
 *                one enormous element and two labels — no third level, because a
 *                third level would be something to read while waiting, and there
 *                is nothing to read.
 *
 *   THE VEIL     A full-frame wash rather than a panel, so a station ident or a
 *                studio shot behind it stays visible. Nothing here is furniture
 *                over a picture; it IS the picture, dimmed.
 */
export const COUNTDOWN: PackTemplate = {
  id: "tpl_countdown",
  name: "Countdown",
  description: "A held clock at frame scale, with its status and its caption.",
  build: (ids, token, now) => {
    const holderId = ids("node");
    let order: string | null = null;
    const next = (): string => (order = nextOrder(order));

    const surface = token("color.surface", PALETTE.surface);
    const accent = token("color.primary", PALETTE.primary);
    const ink = token("color.ink", PALETTE.ink);
    const muted = token("color.muted", PALETTE.muted);
    const onAccent = token("color.onAccent", PALETTE.onAccent);

    // Balanced high: the caption and the air beneath it belong to the mass, so a
    // clock on the geometric centre line reads as sitting low.
    const clockY = 0.35;

    const veil = plane(
      ids,
      "Veil",
      next(),
      17.9,
      10.1,
      surface,
      [0, 0, 0],
      veilSpec(PALETTE.surface, 10.1, { width: 17.9, height: 10.1 }),
      { id: "veil", from: PALETTE.surface },
    );

    // The status flag, above the clock and centred on it.
    const flagW = 2.9;
    const flagH = 0.52;
    const statusFlag = plane(
      ids,
      "Status Flag",
      next(),
      flagW,
      flagH,
      accent,
      [0, clockY + 1.72, 0.01],
      flagSpec(PALETTE.primary),
      { id: "flag", from: PALETTE.primary },
    );
    const status = type_(ids, "Status", next(), { $var: "status" }, {
      face: FACE.display,
      size: 34,
      colour: onAccent,
      box: { width: flagW - sp(28) },
      align: "center",
      at: [-flagW / 2 + sp(14), clockY + 1.72, 0.02],
    });

    // 320. The box is wide enough for HH:MM:SS as well as MM:SS, so a two-hour
    // pre-show hold and a two-minute break are the same graphic.
    const clock = type_(ids, "Clock", next(), { $var: "clock" }, {
      face: FACE.display,
      size: 320,
      colour: ink,
      box: { width: 13.0 },
      align: "center",
      // A high shrink floor: this is the one slot where shrinking is worse than
      // any alternative, because the figures ARE the graphic. HH:MM:SS at 320
      // fits, so nothing a clock can hold should ever reach the floor.
      floor: 0.85,
      at: [-6.5, clockY, 0.02],
    });

    const under = plane(
      ids,
      "Rule",
      next(),
      3.4,
      sp(3),
      ink,
      [0, clockY - 1.72, 0.02],
      // Centred, so it fades symmetrically rather than dying off to one side the
      // way a strap's rule does.
      {
        gradient: {
          kind: "linear",
          angle: 0,
          stops: [
            { at: 0, color: PALETTE.ink, opacity: 0 },
            { at: 0.5, color: PALETTE.ink, opacity: 0.5 },
            { at: 1, color: PALETTE.ink, opacity: 0 },
          ],
        },
      },
    );

    const caption = type_(ids, "Caption", next(), { $var: "caption" }, {
      face: FACE.text,
      size: SIZE.lead,
      colour: muted,
      box: { width: 9.0 },
      align: "center",
      at: [-4.5, clockY - 2.2, 0.02],
    });

    const holder = group(holderId, next(), {
      position: [0, 0, 0],
      size: { width: 17.9, height: 10.1 },
      children: [veil, statusFlag, status, clock, under, caption],
    });

    const root: SceneNode = {
      id: ids("node"),
      name: "Countdown",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(ids, nextOrder(null)), { ...holder, name: "Countdown" }],
    };

    return document_(
      ids,
      "Countdown",
      now,
      root,
      [
        variable(ids("variable"), "status", "Status", "STARTING SOON"),
        variable(ids("variable"), "clock", "Clock", "02:14"),
        variable(ids("variable"), "caption", "Caption", "Match Day · Liverpool v Arsenal"),
      ],
      [
        {
          // THE VEIL RISES AND THE FIGURES DO NOT MOVE.
          //
          // At 320 the clock cannot travel: type this large moving even a tenth of
          // the frame reads as a transition between two graphics rather than as
          // one arriving. So the wash comes up, the status flag wipes open, and
          // the number is simply there — which is also how a countdown behaves,
          // since it is on screen long before anybody looks at it.
          id: ids("timeline"),
          name: "In",
          duration: 0.9,
          tracks: [
            {
              target: veil.id,
              path: "transform.scale.1",
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.52, value: 1 },
              ],
            },
            {
              target: veil.id,
              path: "transform.position.1",
              keyframes: [
                { time: 0, value: -5.05, easing: "easeOutCubic" },
                { time: 0.52, value: 0 },
              ],
            },
            {
              target: statusFlag.id,
              path: "transform.scale.0",
              delay: 0.34,
              keyframes: [
                { time: 0, value: 0, easing: "easeOutCubic" },
                { time: 0.34, value: 1 },
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
                { time: 0, value: 0, easing: "easeInCubic" },
                { time: 0.5, value: -5.05 },
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
