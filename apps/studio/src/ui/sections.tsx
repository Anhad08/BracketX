import { useEffect, useRef, useState } from "react";
import type { ProviderStatus } from "../studio/storage";
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";
import type { AssetRecord } from "@bracketx/engine-assets";

import type { StudioSession } from "../studio/session";
import type { IdFactory } from "../studio/ids";
import { SCENE_DRAG } from "../studio/place";
import { TemplateArt } from "./art";
import {
  PRESETS as QUALITY_PRESETS,
  resolveTier,
  TIERS,
  type FrameReport,
  type QualityChoice,
} from "../studio/quality";
import { RENDERERS, rendererSpec, type RendererChoice } from "../studio/renderer";
import type { DeviceInput } from "../studio/device";
import { VOICE_NAMES, VOICES, type VoiceName } from "../studio/sound";
import { PACKS, installTheme, type Pack, type PackTemplate } from "../studio/packs";
import { STUDIO_FONTS } from "../studio/fonts";
import { PRESETS, presetById } from "../studio/presets";
import { colourTokens, removeFromLibrary, type LibraryEntry } from "../studio/library";
import { friendlyDate } from "./home";

/**
 * The non-editor sections: Marketplace, Templates, Assets, Outputs, Settings.
 *
 * ============================================================================
 * EVERY CATEGORY HERE IS REAL
 * ============================================================================
 * The brief lists eleven asset categories and twelve Marketplace categories.
 * Most of them need images, SVG or video, and the engine cannot draw any of
 * those — IF-005.
 *
 * So they are not here. Not stubbed, not greyed out, not "coming soon" tiles: a
 * category that is permanently empty teaches a user to distrust the panel it is
 * in, which is exactly the rule the toolbox settled in Phase 3A. What ships is
 * what works — fonts, colours, motion and templates — plus one honest line
 * saying what is coming.
 */

// ===========================================================================
// Marketplace
// ===========================================================================

/**
 * The template a pack should show as its picture, if it ships one.
 *
 * The first, deliberately: a pack's templates are authored in order and the one
 * a designer put first is the one that represents it. Picking "the most
 * interesting" would need a judgement the data does not carry.
 */
/**
 * Whether a graphic belongs to a category.
 *
 * Matched against the template's OWN name and description, not its pack's. A
 * pack tagged "lower third, title, sponsor" carries three different graphics,
 * and matching on the pack would put all three in every one of those
 * categories — which is how a filter comes to look broken.
 */
function matchesCategory(template: PackTemplate, tag: string): boolean {
  return `${template.name} ${template.description}`.toLowerCase().includes(tag.toLowerCase());
}

/** "lower third" -> "Lower Thirds". The label a broadcaster reads. */
function categoryLabel(tag: string): string {
  // Split/join rather than a regex: two attempts lost the word-boundary
  // escape passing through tooling and silently became "uppercase everything".
  const titled = tag
    .split(" ")
    .map((word) => (word === "" ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
  // NOT pluralised. A naive `+ "s"` turned the "breaking" tag into "Breakings",
  // because these tags are a mix of nouns and adjectives and no single rule
  // fits both. Title Case alone reads correctly for every one of them — Lower
  // Third, Ticker, Scoreboard, Breaking, Sponsor — and invents no grammar.
  return titled;
}

function previewOf(pack: Pack): string | undefined {
  return (pack.templates ?? [])[0]?.id;
}

export interface MarketplaceProps {
  /**
   * Rendered template stills, by template id. Absent until they arrive.
   *
   * The SAME map Home and Production's scene rail already receive. `art.tsx`
   * says outright that "Home, Templates, the Marketplace and Production's scene
   * rail all show the same graphics, and a hover that behaved differently on
   * each would read as four products" — the Marketplace was the surface that
   * never got wired to it, and showed a two-tone `swatch` gradient instead.
   */
  readonly art: ReadonlyMap<string, string>;
  readonly onPlay: ((templateId: string, into: HTMLCanvasElement) => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly installed: ReadonlySet<string>;
  readonly onInstall: (pack: Pack) => void;
  readonly onUninstall: (pack: Pack) => void;
  readonly onApplyTheme: (pack: Pack) => void;
  readonly onUseTemplate: (template: PackTemplate) => void;
  readonly canApply: boolean;
}

const KIND_LABEL: Record<Pack["kind"], string> = {
  theme: "Theme",
  motion: "Motion",
  graphics: "Graphics",
};

export function Marketplace({
  art,
  onPlay,
  onStop,
  installed,
  onInstall,
  onUninstall,
  onApplyTheme,
  onUseTemplate,
  canApply,
}: MarketplaceProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Pack["kind"] | "all">("all");

  /**
   * Which featured pack the hero is showing.
   *
   * User-driven, never a timer. Volume One refuses ambient looping outright — "a
   * moving thing in peripheral vision reads as an alarm" — so a hero that
   * advanced by itself would be a violation, not a flourish.
   */
  const [featured, setFeatured] = useState(0);
  /** Null is "every graphic", not a category called "all". */
  const [category, setCategory] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  /**
   * How far through the pack story the reader has scrolled, as a stage index.
   *
   * ========================================================================
   * SENTINELS AND AN OBSERVER, NOT A SCROLL HANDLER
   * ========================================================================
   * Studio scrolls inside an element rather than the document, so a `window`
   * scroll listener would never fire and a handler on the right container means
   * this component has to know which ancestor that is. Four sentinels crossing
   * the viewport's midline answer the same question without knowing anything:
   * `rootMargin: -50% 0 -50%` collapses the root to a line, and whichever
   * sentinel is on it is the stage.
   *
   * Also cheaper: the browser reports crossings instead of this recomputing
   * geometry on every frame of a scroll.
   */
  const [stage, setStage] = useState(0);
  const marks = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const nodes = marks.current.filter((node): node is HTMLDivElement => node !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.mark ?? 0);
          setStage(index);
        }
      },
      // A BAND, not a line. `-50%` on both edges collapses the root to zero
      // height, and a 1px sentinel then has to land on that exact line — which
      // scrolling almost never does, so the stage never advanced. A 20%-tall
      // band in the middle of the viewport is forgiving enough to catch a
      // sentinel and narrow enough that only one is ever in it.
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
    // Keyed on the FOCUSED INDEX rather than the pack object: `featured` is
    // declared above this, and `hero` is derived below it — reading it here was
    // a use-before-declaration. Same trigger, correct order.
  }, [featured]);

  /**
   * Packs that actually ship graphics, and therefore have something to show.
   *
   * A theme pack is a palette and a motion pack is a set of moves; neither has a
   * picture of its own, so neither can headline. Derived rather than curated,
   * because a hand-written featured list would rot the moment a pack was
   * renamed or removed.
   */
  const showable = PACKS.filter((pack) => previewOf(pack) !== undefined);

  /**
   * Every graphic in the catalogue, with the pack it belongs to.
   *
   * Flattened from real data. No fixture list: the Marketplace shows what the
   * product actually ships, so a template added to a pack appears here without
   * anybody remembering to register it in a second place.
   *
   * The pack travels with it because acquisition and use are different units —
   * a graphic is what a designer opens, a pack is what they acquire — and the
   * card has to know which of the two the button should do.
   */
  const graphics = PACKS.flatMap((pack) =>
    (pack.templates ?? []).map((template) => ({ pack, template })),
  );

  /**
   * The production categories the catalogue can actually honour.
   *
   * ========================================================================
   * DERIVED FROM BOTH SIDES, SO A DEAD CATEGORY CANNOT EXIST
   * ========================================================================
   * The VOCABULARY comes from pack tags — real metadata a pack author wrote,
   * already used by search, and already production language: "lower third",
   * "ticker", "scoreboard", "breaking", "countdown". No second category
   * database to keep in agreement with the catalogue.
   *
   * MEMBERSHIP comes from the template itself: a tag is a category only if some
   * graphic's own name or description carries it. That is what prunes the tags
   * that describe a PACK rather than a graphic — "starter", "dark", "esports" —
   * without anybody maintaining an exclusion list.
   *
   * The consequence is the one L6 demands: a category is on screen only when
   * selecting it returns something. New content grows the list automatically;
   * there is no six-category ceiling written down anywhere.
   */
  const categories = (() => {
    // Only from packs that CONTAIN GRAPHICS. A theme pack is tagged "dark",
    // "daytime"; a motion pack "slide", "fade", "loop". None of those is a
    // production category for browsing graphics — "Slides" appeared as one on
    // the first run, because a template description says "Slides in from the
    // left". Narrowing the SOURCE removes that whole class rather than
    // blacklisting words one at a time.
    const vocabulary = new Set(
      PACKS.filter((pack) => (pack.templates ?? []).length > 0).flatMap((pack) => pack.tags),
    );
    const counted = [...vocabulary]
      .map((tag) => ({
        tag,
        count: graphics.filter(({ template }) => matchesCategory(template, tag)).length,
      }))
      .filter((entry) => entry.count > 0);
    // Commonest first, then alphabetical — a stable order, and the useful ones
    // reachable without reading the whole list.
    counted.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return counted;
  })();

  const inCategory =
    category === null
      ? graphics
      : graphics.filter(({ template }) => matchesCategory(template, category));

  const hero = showable[Math.min(featured, Math.max(0, showable.length - 1))];

  const needle = query.trim().toLowerCase();

  /**
   * Category and search COMPOSE. Neither replaces the other.
   *
   * Declared AFTER `needle` deliberately: it was above it once, and reading a
   * `const` before its initialiser is a TDZ ReferenceError — the whole
   * application refused to boot with "Streamatrix could not start". Cheap to
   * fix, invisible to typecheck, and caught only by opening the page.
   */
  const featuredGraphics = inCategory.filter(({ pack, template }) =>
    needle.length === 0
      ? true
      : [template.name, template.description, pack.name, ...pack.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
  );
  const shown = PACKS.filter((pack) => {
    if (kind !== "all" && pack.kind !== kind) return false;
    if (needle.length === 0) return true;
    return [pack.name, pack.description, ...pack.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  /**
   * How many packs the QUERY alone finds, ignoring the kind filter.
   *
   * This is what makes the empty state actionable rather than a dead end: when a
   * search inside "Themes" finds nothing, the useful fact is that four packs
   * match everywhere else — and the fix is one press, not a retyped query.
   */
  const acrossEverything = PACKS.filter((pack) =>
    needle.length === 0
      ? true
      : [pack.name, pack.description, ...pack.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
  ).length;

  return (
    <div className="section-page" data-testid="marketplace">
      {/* The page names itself FIRST. A featured panel above the title reads as
          an advert that arrived before the page did. */}
      <div className="mk-topline">
        <h1>Marketplace</h1>
        <p className="lede">Themes, motion and graphics. Everything installs instantly.</p>
      </div>

      {/* ==================================================================
          THE HERO — the one place in the product Glass is permitted
          ==================================================================
          Volume One: "Glass exists in exactly three places: Marketplace hero,
          media preview, floating dialog. Nowhere else." Used here, and nowhere
          below it.

          Editorial rather than a banner: the graphic is the hero and the words
          are a caption on it. The headline says what the broadcaster can DO —
          the Marketplace voice rule — carried by the pack's own description,
          because that copy is already written in production language and
          inventing a second capability claim per pack would be inventing data.

          Focus is USER-DRIVEN. Nothing advances on a timer. */}
      {hero !== undefined ? (
        <section className="mk-hero glass" data-testid="mk-hero" aria-label="Featured">
          {/* ================================================================
              THE DECK IS THE HERO'S ARTWORK
              ================================================================
              Reference pattern: Cinematic Card Deck. The focused pack is
              DOMINANT and forward; its neighbours are smaller, offset, partially
              occluded and receding behind it. Changing focus REORGANISES the
              composition — every card moves — rather than sliding a highlight
              along a row of equals.

              The previous version was a row of three identical 132px
              thumbnails under a separate hero image: a grid with a border on the
              selected one, and the same graphic shown twice. Now there is one
              stage, and the focused card IS the hero's picture.

              Depth comes from scale, offset and occlusion — not from a shadow
              per card, which would be the floating-card soup the Design OS
              refuses. Motion is `move`/`press`: no spring, no overshoot,
              nothing autoplays. */}
          <div
            className="mk-stage"
            data-testid="mk-stage"
            role="tablist"
            aria-label="Featured packs"
            onPointerMove={(event) => {
              // CURSOR RESPONSE ON THE ACTIVE CARD. Written as CSS custom
              // properties on the element rather than through state: this fires
              // on every frame of a pointer move, and a React render per frame
              // across a deck of previews is a render per frame.
              const stage = event.currentTarget;
              const box = stage.getBoundingClientRect();
              const x = (event.clientX - box.left) / box.width - 0.5;
              const y = (event.clientY - box.top) / box.height - 0.5;
              // Small. The card acknowledges the cursor; it does not chase it.
              stage.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`);
              stage.style.setProperty("--tilt-x", `${(-y * 3.5).toFixed(2)}deg`);
            }}
            onPointerLeave={(event) => {
              const stage = event.currentTarget;
              stage.style.setProperty("--tilt-y", "0deg");
              stage.style.setProperty("--tilt-x", "0deg");
            }}
          >
            {showable.map((pack, index) => {
              const offset = index - featured;
              const focusedCard = offset === 0;
              /**
               * Position among the cards BEHIND, not signed distance.
               *
               * `Math.abs(offset)` put the card before the focused one and the
               * card after it at the same depth, so they stacked exactly and the
               * deck showed one sliver where there should have been two. Rank is
               * the reading order of what is left once the focused card is
               * removed, which is what "the cards behind" actually means.
               */
              const rank = showable
                .map((_, i) => i)
                .filter((i) => i !== featured)
                .indexOf(index);
              return (
                <button
                  key={pack.id}
                  type="button"
                  /* ==========================================================
                     THE DECK IS A VIEW; THE PROGRESS ROW IS THE CONTROL
                     ==========================================================
                     Real depth means the cards overlap heavily, so the front card
                     covers every other card's centre and swallows the click —
                     twice now, reported as "subtree intercepts pointer events",
                     which is exactly what a cursor would hit.
                     The previous fix shrank the cards behind into narrow slivers
                     so they could be clicked. That bought operability by throwing
                     away the depth: a sliver has no perspective to read.
                     So the deck keeps its depth and stops pretending each card is
                     a button. Focus moves through the progress row, which is a
                     real tablist with one labelled control per pack — reachable,
                     announceable, and impossible to occlude. */
                  aria-hidden={!focusedCard}
                  tabIndex={-1}
                  className={`mk-deck-card ${focusedCard ? "on" : ""}`}
                  data-testid={`mk-deck-${pack.id}`}
                  data-offset={offset}
                  style={{
                    // The deck's arithmetic, as custom properties so the CSS owns
                    // the look and this owns only the ordering.
                    ["--offset" as string]: String(offset),
                    ["--depth" as string]: String(rank + 1),
                    zIndex: 20 - (rank + 1),
                  }}
                  title={pack.name}
                >
                  <TemplateArt
                    className={focusedCard ? "mk-hero-preview" : "mk-deck-art"}
                    templateId={previewOf(pack)!}
                    still={art.get(previewOf(pack)!)}
                    onPlay={focusedCard ? onPlay : undefined}
                    onStop={focusedCard ? onStop : undefined}
                    placeholder={<span className="pack-art-pending" aria-hidden />}
                  />
                  {/* Only the cards behind carry a name; the focused one is
                      titled by the copy column beside it. */}
                  {focusedCard ? null : <span className="mk-deck-name">{pack.name}</span>}
                </button>
              );
            })}
            {/* PROGRESS. Which card of how many, and a way to step through them.
                Not decoration: a deck whose cards recede behind one another hides
                its own length, and this is the only thing that states it. */}
            {showable.length > 1 ? (
              <div className="mk-progress" role="tablist" aria-label="Featured packs" data-testid="mk-progress">
                {showable.map((pack, index) => (
                  <button
                    key={pack.id}
                    type="button"
                    role="tab"
                    aria-selected={index === featured}
                    aria-label={pack.name}
                    className={`mk-progress-seg ${index === featured ? "on" : ""}`}
                    data-testid={`mk-progress-${index}`}
                    onClick={() => setFeatured(index)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="mk-hero-copy">
            <span className="mk-eyebrow">Featured · {KIND_LABEL[hero.kind]}</span>
            <h2 className="mk-hero-title">{hero.name}</h2>
            <p className="mk-claim">{hero.description}</p>
            {/* Cost on the box — Volume Four. "Free" is what the catalogue
                actually carries; no price is invented. Mono, because these are
                numbers a person compares between packs. */}
            <p className="mk-facts mono">
              {hero.author} · Free · {(hero.templates ?? []).length}{" "}
              {(hero.templates ?? []).length === 1 ? "graphic" : "graphics"}
            </p>
            <div className="mk-hero-actions">
              {installed.has(hero.id) ? (
                <button
                  type="button"
                  className="chip primary"
                  data-testid="mk-hero-use"
                  onClick={() => onUseTemplate(hero.templates![0]!)}
                >
                  Open {hero.templates?.[0]?.name ?? "graphic"}
                </button>
              ) : (
                <button
                  type="button"
                  className="chip primary"
                  data-testid="mk-hero-install"
                  onClick={() => onInstall(hero)}
                >
                  Add to library
                </button>
              )}
            </div>
          </div>

        </section>
      ) : null}

      {/* ==================================================================
          THE PACK STORY — ScrollSyncedText, properly this time
          ==================================================================
          The previous version faded a headline and un-hid a grid. Freeze the
          animation and it was a paragraph above some cards.

          What the reference actually describes:

            a PERSISTENT PREFIX that never moves
            an ACTIVE PHRASE that is the focal point
            the ALTERNATIVES still perceptible around it, dimmed — not hidden
            scroll position choosing which phrase is active
            the graphic changing WITH the phrase, recomposing rather than
              being swapped for a different element

          The phrases are not written for the story. They are the pack's actual
          graphics, so the sentence the reader assembles — "Broadcast Starter
          gives you / a lower third" — is a fact about the catalogue.

          THE GRAPHICS USE THE DECK'S DEPTH LANGUAGE. Same frustum, same blur,
          same forward-card grammar. That is deliberate: two different depth
          treatments would be two effects, and one repeated is a vocabulary.

          Motion off, this still reads: a list with one line lit, and a stack
          with one graphic sharp at the front of it. */}
      {hero !== undefined && (hero.templates ?? []).length > 1 ? (
        <section className="mk-story" data-testid="mk-story" data-stage={stage}>
          <div className="mk-story-track" aria-hidden>
            {(hero.templates ?? []).map((template, index) => (
              <div
                key={template.id}
                data-mark={index}
                data-testid={`mk-mark-${index}`}
                className="mk-mark"
                style={{ top: `${12 + index * (76 / Math.max(1, (hero.templates ?? []).length - 1))}%` }}
                ref={(node) => {
                  marks.current[index] = node;
                }}
              />
            ))}
          </div>

          <div className="mk-story-stage">
            <div className="mk-story-copy">
              {/* THE PREFIX NEVER MOVES. It is the fixed half of the sentence,
                  and it is what makes the changing half read as a substitution
                  rather than as a new headline. */}
              <p className="mk-prefix" data-testid="mk-prefix">
                <span className="mk-eyebrow">{hero.name}</span>
                gives you
              </p>

              {/* THE ALTERNATIVES STAY. Every graphic in the pack is listed; the
                  active one is the focal point and the rest are dim but legible.
                  Hiding them was the generic implementation — with them present,
                  the reader can see what else is coming and the section states
                  the pack's contents even standing still. */}
              <ol className="mk-phrases" data-testid="mk-phrases">
                {(hero.templates ?? []).map((template, index) => (
                  <li
                    key={template.id}
                    className={`mk-phrase ${index === stage ? "on" : ""}`}
                    data-testid={`mk-phrase-${template.id}`}
                    aria-current={index === stage ? "true" : undefined}
                  >
                    {template.name}
                  </li>
                ))}
              </ol>

              <p className="mk-story-line" data-testid="mk-story-line">
                {(hero.templates ?? [])[stage]?.description ?? hero.description}
              </p>

              <div className="mk-story-actions">
                {installed.has(hero.id) ? (
                  <button
                    type="button"
                    className="chip primary"
                    data-testid="mk-story-use"
                    onClick={() => onUseTemplate((hero.templates ?? [])[stage]!)}
                  >
                    Use {(hero.templates ?? [])[stage]?.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chip primary"
                    data-testid="mk-story-add"
                    onClick={() => onInstall(hero)}
                  >
                    Add {hero.name}
                  </button>
                )}
              </div>
            </div>

            {/* THE GRAPHICS RECOMPOSE. All of them are always mounted and always
                in the frustum; scroll changes which one is at the front. Nothing
                is added or removed, so there is no swap to cross-fade. */}
            <div className="mk-story-art">
              {(hero.templates ?? []).map((template, index) => {
                const rank = index - stage;
                return (
                  <div
                    className={`mk-story-card ${index === stage ? "on" : ""}`}
                    key={template.id}
                    data-testid={`mk-story-${template.id}`}
                    data-rank={rank}
                    aria-hidden={index !== stage}
                    style={{
                      ["--rank" as string]: String(rank),
                      ["--away" as string]: String(Math.abs(rank)),
                      zIndex: 30 - Math.abs(rank),
                    }}
                  >
                    <TemplateArt
                      className="mk-story-preview"
                      templateId={template.id}
                      still={art.get(template.id)}
                      onPlay={index === stage ? onPlay : undefined}
                      onStop={index === stage ? onStop : undefined}
                      placeholder={<span className="pack-art-pending" aria-hidden />}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* ==================================================================
          THE DISCOVERY BAR — compact, and every item leads somewhere
          ==================================================================
          A dropdown rather than a rail of chips or a sidebar: the category list
          grows with the catalogue, and a row of chips that wraps to three lines
          has stopped being navigation. Compact enough that it does not compete
          with the hero above it.

          Real <button>s throughout. The global Enter/Space defect — both keys
          are transport bindings, so neither activates a focused control
          anywhere in Studio — is NOT worked around here. Correct semantics
          means the one global fix will repair this along with everything else.
          Escape closes, which is the one key the menu owns outright. */}
      <nav className="mk-bar" aria-label="Browse the Marketplace">
        <div className="mk-nav">
          <button
            type="button"
            className={`mk-nav-trigger ${navOpen ? "on" : ""}`}
            data-testid="mk-nav"
            aria-expanded={navOpen}
            aria-haspopup="true"
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="mk-nav-label">
              {category === null ? "Everything" : categoryLabel(category)}
            </span>
            <span className="mk-nav-count mono">
              {featuredGraphics.length}
            </span>
          </button>

          {navOpen ? (
            <div
              className="mk-nav-pop"
              data-testid="mk-nav-pop"
              role="menu"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setNavOpen(false);
                }
              }}
            >
              <button
                type="button"
                role="menuitem"
                className={`mk-nav-item ${category === null ? "on" : ""}`}
                data-testid="mk-cat-all"
                onClick={() => {
                  setCategory(null);
                  setNavOpen(false);
                }}
              >
                Everything
                <span className="mono">{graphics.length}</span>
              </button>

              {/* Derived. A category is here only because a real graphic
                  answers to it, so none of these can lead nowhere. */}
              {categories.map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  role="menuitem"
                  className={`mk-nav-item ${category === tag ? "on" : ""}`}
                  data-testid={`mk-cat-${tag.replace(/\s+/g, "-")}`}
                  onClick={() => {
                    setCategory(tag);
                    setNavOpen(false);
                  }}
                >
                  {categoryLabel(tag)}
                  <span className="mono">{count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Search stays beside the categories, because they compose: a query
            narrows within whatever category is showing. */}
        <input
          className="field mk-search"
          placeholder="Search the Marketplace"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the Marketplace"
        />

        {category !== null ? (
          <button
            type="button"
            className="link"
            data-testid="mk-clear-category"
            onClick={() => setCategory(null)}
          >
            Clear category
          </button>
        ) : null}
      </nav>

      {/* ==================================================================
          FEATURED GRAPHICS — individual graphics, not production identities
          ==================================================================
          Deliberately a different shape from the pack deck above it. A pack is
          a complete look a broadcaster acquires; a graphic is one thing they
          open and put on air. Presenting both as the same card with a different
          title would tell the designer they are the same kind of object.

          So: a scannable grid rather than a focused deck, the rendered graphic
          as the whole top of the card, and an action that says which of the two
          units it operates on — Use the graphic, or add the pack that carries
          it. Flush, seams only; nothing here floats. */}
      {graphics.length > 0 ? (
        <section className="mk-section" data-testid="mk-templates" aria-label="Featured graphics">
          <div className="mk-section-head">
            <h2 className="mk-section-title">Graphics you can put on air today</h2>
            <p className="note">
              Every one is editable, animated and ready to take. Point at a
              preview to watch it move.
            </p>
          </div>

          <div className="mk-grid">
            {featuredGraphics.map(({ pack, template }) => {
              const owned = installed.has(pack.id);
              return (
                <article
                  className="mk-tile"
                  key={template.id}
                  data-testid={`mk-template-${template.id}`}
                >
                  <TemplateArt
                    className="mk-tile-art"
                    templateId={template.id}
                    still={art.get(template.id)}
                    onPlay={onPlay}
                    onStop={onStop}
                    placeholder={<span className="pack-art-pending" aria-hidden />}
                  />
                  <div className="mk-tile-body">
                    <h3 className="mk-tile-name">{template.name}</h3>
                    <p className="mk-tile-claim">{template.description}</p>
                    {/* The production context it belongs to, and its cost. Mono,
                        because a person compares these across cards. */}
                    <p className="mk-facts mono">
                      {pack.name} · Free
                    </p>
                    {owned ? (
                      <button
                        type="button"
                        className="chip primary"
                        data-testid={`mk-use-${template.id}`}
                        onClick={() => onUseTemplate(template)}
                      >
                        Use this graphic
                      </button>
                    ) : (
                      /* NOT a disabled Use button. L6: never draw a control for
                         something that cannot happen. The graphic arrives with
                         its pack, so the honest action is to add the pack. */
                      <button
                        type="button"
                        className="chip"
                        data-testid={`mk-add-${template.id}`}
                        onClick={() => onInstall(pack)}
                      >
                        Add {pack.name}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <header className="section-head">
        <div>
          <h2 className="mk-browse-title">Everything</h2>
        </div>
        <input
          className="field search"
          placeholder="Search packs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search packs"
        />
      </header>

      <nav className="chips" aria-label="Filter by kind">
        {(["all", "theme", "motion", "graphics"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`chip ${kind === entry ? "on" : ""}`}
            onClick={() => setKind(entry)}
          >
            {entry === "all" ? "Everything" : KIND_LABEL[entry]}
          </button>
        ))}
      </nav>

      {/* THE EMPTY STATE IS SPECIFIED, AND IT WAS MISSING.
          Volume One §States writes this one out in full — "Nothing matches
          'esports' · 4 packages match in Marketplace instead", with a way on and
          a way back. Filtering the Marketplace to nothing previously showed an
          EMPTY GRID: no words, no count, no action. Law 7 asks "what now?" and a
          blank area answers nothing.

          The second line is adapted, deliberately and not silently: the
          specified copy offers the Marketplace as the place to look instead,
          which is nonsense when you are already standing in it. The STRUCTURE is
          what the Design OS specifies — the miss, a count of what would match,
          and one press to get there — so the count here is what the query finds
          once the kind filter is dropped. */}
      {shown.length === 0 ? (
        <div className="empty-filtered" data-testid="marketplace-empty">
          <p className="empty-title">Nothing matches “{query.trim()}”</p>
          <p className="note">
            {kind !== "all" && acrossEverything > 0
              ? `${acrossEverything} ${acrossEverything === 1 ? "pack" : "packs"} match outside ${KIND_LABEL[kind]}.`
              : "No pack in the Marketplace carries that word."}
          </p>
          <div className="empty-actions">
            {kind !== "all" && acrossEverything > 0 ? (
              <button
                type="button"
                className="chip primary"
                data-testid="empty-search-everything"
                onClick={() => setKind("all")}
              >
                Search Marketplace
              </button>
            ) : null}
            <button
              type="button"
              className="chip"
              data-testid="empty-clear-filter"
              onClick={() => {
                setQuery("");
                setKind("all");
              }}
            >
              Clear filter
            </button>
          </div>
        </div>
      ) : null}

      <div className="pack-grid">
        {shown.map((pack) => {
          const owned = installed.has(pack.id);
          return (
            <article className="pack-card" key={pack.id} data-testid={`pack-${pack.id}`}>
              {/* THE PACK'S OWN GRAPHIC, RENDERED — not a gradient standing in for it.
                  A theme or motion pack ships no templates of its own, so there
                  is genuinely nothing to render: that case keeps the swatch,
                  which is then an honest palette sample rather than a stand-in
                  for artwork that exists and was not shown. `data-preview` says
                  which it is, so a regression can tell them apart. */}
              {previewOf(pack) !== undefined ? (
                <TemplateArt
                  className="pack-art"
                  templateId={previewOf(pack)!}
                  still={art.get(previewOf(pack)!)}
                  onPlay={onPlay}
                  onStop={onStop}
                  placeholder={<span className="pack-art-pending" aria-hidden />}
                />
              ) : (
                <span
                  className="pack-art"
                  data-preview="swatch"
                  aria-hidden
                  style={{
                    background: `linear-gradient(135deg, ${pack.swatch[0]} 0%, ${pack.swatch[0]} 55%, ${pack.swatch[1]} 55%, ${pack.swatch[1]} 100%)`,
                  }}
                />
              )}
              <div className="pack-body">
                <div className="pack-title">
                  <strong>{pack.name}</strong>
                  <span className="badge">{KIND_LABEL[pack.kind]}</span>
                </div>
                <span className="dim">{pack.description}</span>
                <span className="dim tiny">{pack.author} · Free</span>

                <div className="pack-actions">
                  {owned ? (
                    <>
                      {pack.kind === "theme" ? (
                        <button
                          type="button"
                          className="chip primary"
                          disabled={!canApply}
                          onClick={() => onApplyTheme(pack)}
                          title={canApply ? "Restyle the open graphic" : "Open a graphic first"}
                        >
                          Apply
                        </button>
                      ) : null}
                      {/* A motion pack has nothing to press here — its moves
                          are applied while designing. Saying so turns a card
                          that looked broken into one that has told you where
                          its contents went. */}
                      {pack.kind === "motion" ? (
                        <span className="dim tiny">
                          {(pack.presets ?? []).length} moves, in the Animation
                          list while you design.
                        </span>
                      ) : null}
                      {(pack.templates ?? []).map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className="chip primary"
                          onClick={() => onUseTemplate(template)}
                        >
                          {template.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="link"
                        onClick={() => onUninstall(pack)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="chip primary"
                      onClick={() => onInstall(pack)}
                      data-testid={`install-${pack.id}`}
                    >
                      Install
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* One line, once. Honest about what is not here yet, without a grid of
          tiles that cannot be clicked. */}
      <p className="note pad">
        Icons, stingers and brand packs arrive with image support.
      </p>
    </div>
  );
}

// ===========================================================================
// Templates — what the user has saved
// ===========================================================================

export interface TemplatesProps {
  readonly library: readonly LibraryEntry[];
  readonly onOpen: (entry: LibraryEntry) => void;
  readonly onLibrary: (next: readonly LibraryEntry[]) => void;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export function Templates({ library, onOpen, onLibrary, storage }: TemplatesProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = library.filter((entry) =>
    needle.length === 0
      ? true
      : [entry.name, entry.description ?? "", ...entry.tags].join(" ").toLowerCase().includes(needle),
  );

  return (
    <div className="section-page" data-testid="templates-section">
      <header className="section-head">
        <div>
          <h1>Templates</h1>
          <p className="lede">Graphics you have saved, ready to reuse.</p>
        </div>
        <input
          className="field search"
          placeholder="Search your templates"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search templates"
        />
      </header>

      {shown.length === 0 ? (
        <p className="note pad">
          Nothing saved yet. Build a graphic and choose <em>Save as template</em>
          {" "}to reuse it — the fields you expose become the fields a producer fills in.
        </p>
      ) : (
        <div className="pack-grid">
          {shown.map((entry) => (
            <article className="pack-card" key={entry.id}>
              <span className="pack-art plain" aria-hidden />
              <div className="pack-body">
                <div className="pack-title">
                  <strong>{entry.name}</strong>
                  {entry.isTemplate ? <span className="badge">Template</span> : null}
                </div>
                <span className="dim">{friendlyDate(entry.savedAt)}</span>
                <div className="pack-actions">
                  <button type="button" className="chip primary" onClick={() => onOpen(entry)}>
                    Open a copy
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => onLibrary(removeFromLibrary(library, entry.id, storage))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Assets
// ===========================================================================

export interface AssetsProps {
  readonly session: StudioSession | null;
  readonly installed: ReadonlySet<string>;
  readonly assets: readonly AssetRecord[];
  /** Returns a message on failure, or null when the import succeeded. */
  readonly onImport: (file: File) => Promise<string | null>;
  readonly usersOf: (assetId: string) => readonly string[];
  readonly thumbnails: ReadonlyMap<string, string>;
  readonly onRename: (assetId: string, name: string) => void;
  readonly onFavourite: (assetId: string, favorite: boolean) => void;
  readonly onTags: (assetId: string, tags: readonly string[]) => void;
  readonly onDuplicate: (assetId: string) => void;
  readonly onDelete: (assetId: string) => void;
  readonly onReplace: (assetId: string, file: File) => Promise<string | null>;
  /** Adds an installed scene to the open stage, at its designed position. */
  readonly onPlaceScene: (templateId: string) => void;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Assets({
  session,
  installed,
  assets,
  onImport,
  usersOf,
  thumbnails,
  onRename,
  onFavourite,
  onTags,
  onDuplicate,
  onDelete,
  onReplace,
  onPlaceScene,
}: AssetsProps) {
  const [importing, setImporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const replacer = useRef<HTMLInputElement | null>(null);

  const needle = query.trim().toLowerCase();
  const images = assets
    .filter((asset) => asset.kind === "image")
    .filter(
      (asset) =>
        needle === "" ||
        asset.name.toLowerCase().includes(needle) ||
        asset.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );

  // Selection survives a rename but not a delete, so the inspector is read from
  // the live list rather than held as a copy.
  const selected = assets.find((asset) => asset.id === picked) ?? null;

  const take = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setImporting(true);
    setProblem(null);
    // Sequential, not parallel: a failure must name the file that caused it,
    // and a designer dropping twenty logos would otherwise get one message for
    // an unknown one of them.
    for (const file of Array.from(files)) {
      const failure = await onImport(file);
      if (failure !== null) {
        setProblem(`${file.name}: ${failure}`);
        break;
      }
    }
    setImporting(false);
  };
  const swatches = session === null ? [] : colourTokens(session.document);
  const motion = PACKS.filter((pack) => pack.kind === "motion" && installed.has(pack.id));
  const scenes = PACKS.filter((pack) => installed.has(pack.id)).flatMap((pack) =>
    (pack.templates ?? []).map((template) => ({ pack, template })),
  );

  return (
    <div className="section-page" data-testid="assets">
      <header className="section-head">
        <div>
          <h1>Assets</h1>
          <p className="lede">Everything you can reuse across graphics.</p>
        </div>
      </header>

      <section
        className="home-block"
        data-testid="asset-images"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void take(event.dataTransfer.files);
        }}
      >
        <div className="block-head">
          <h2>Images</h2>
          <span className="dim">
            Logos, marks and backgrounds. Drop a file anywhere here
          </span>
          <input
            className="field"
            placeholder="Search assets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search assets"
            data-testid="asset-search"
          />
          <button
            type="button"
            className="ghost"
            data-testid="import-asset"
            onClick={() => picker.current?.click()}
            disabled={importing}
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png"
            multiple
            hidden
            data-testid="asset-file"
            onChange={(event) => {
              void take(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {problem !== null ? (
          <p className="note pad warn" data-testid="import-problem">
            {problem}
          </p>
        ) : null}

        {images.length === 0 ? (
          <p className="note pad">
            {needle === ""
              ? "Nothing yet. Import a PNG and it becomes available to every graphic."
              : `Nothing matches "${query}".`}
          </p>
        ) : (
          <div className="asset-grid" data-testid="asset-grid">
            {images.map((asset) => {
              const used = usersOf(asset.id);
              const preview = thumbnails.get(asset.id);
              return (
                <button
                  type="button"
                  className={`asset-tile${picked === asset.id ? " on" : ""}`}
                  key={asset.id}
                  data-testid={`asset-${asset.id}`}
                  onClick={() => setPicked(asset.id === picked ? null : asset.id)}
                >
                  <span className="asset-thumb">
                    {preview === undefined ? (
                      <span className="dim tiny">no preview</span>
                    ) : (
                      <img src={preview} alt="" />
                    )}
                    {asset.favorite ? <em className="pin">★</em> : null}
                  </span>
                  <strong>{asset.name}</strong>
                  <span className="dim tiny">
                    {asset.metadata.width ?? "?"} x {asset.metadata.height ?? "?"}
                    {" · "}
                    {fileSize(asset.bytes)}
                  </span>
                  <span className="dim tiny">
                    {asset.origin === "shipped" ? "Included" : "Yours"}
                    {used.length > 0 ? ` · used by ${used.length}` : " · unused"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selected === null ? null : (
          <div className="asset-inspector" data-testid="asset-inspector">
            <div className="row">
              <input
                className="field grow"
                key={`${selected.id}:${selected.name}`}
                defaultValue={selected.name}
                aria-label="Asset name"
                data-testid="asset-name"
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== "" && next !== selected.name) {
                    onRename(selected.id, next);
                  }
                }}
              />
              <button
                type="button"
                className="ghost"
                data-testid="asset-favourite"
                aria-pressed={selected.favorite}
                onClick={() => onFavourite(selected.id, !selected.favorite)}
              >
                {selected.favorite ? "★ Favourite" : "☆ Favourite"}
              </button>
            </div>

            <dl className="asset-facts">
              <div>
                <dt>Size</dt>
                <dd>
                  {selected.metadata.width ?? "?"} x{" "}
                  {selected.metadata.height ?? "?"} px
                </dd>
              </div>
              <div>
                <dt>Stored</dt>
                <dd>{fileSize(selected.bytes)}</dd>
              </div>
              <div>
                <dt>Used by</dt>
                <dd data-testid="asset-usage">
                  {usersOf(selected.id).length} graphic
                  {usersOf(selected.id).length === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Versions</dt>
                {/* The current bytes plus everything it can roll back to. */}
                <dd>{selected.history.length + 1}</dd>
              </div>
            </dl>

            <input
              className="field"
              key={`${selected.id}:tags`}
              defaultValue={selected.tags.join(", ")}
              placeholder="Tags, comma separated"
              aria-label="Tags"
              data-testid="asset-tags"
              onBlur={(event) =>
                onTags(
                  selected.id,
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0),
                )
              }
            />

            <div className="row">
              <button
                type="button"
                className="ghost"
                data-testid="asset-replace"
                onClick={() => replacer.current?.click()}
              >
                Replace…
              </button>
              <input
                ref={replacer}
                type="file"
                accept="image/png"
                hidden
                data-testid="asset-replace-file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file === undefined) return;
                  const failure = await onReplace(selected.id, file);
                  setProblem(failure === null ? null : `${file.name}: ${failure}`);
                }}
              />
              <button
                type="button"
                className="ghost"
                data-testid="asset-duplicate"
                onClick={() => onDuplicate(selected.id)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="ghost danger"
                data-testid="asset-delete"
                // Included assets return on the next launch, so offering to
                // delete one would be a button that does not do what it says.
                disabled={selected.origin === "shipped"}
                title={
                  selected.origin === "shipped"
                    ? "Included assets cannot be removed"
                    : undefined
                }
                onClick={() => {
                  onDelete(selected.id);
                  setPicked(null);
                }}
              >
                Delete
              </button>
            </div>

            <p className="note">
              Replacing keeps this asset's identity, so every graphic using it
              updates without being re-opened.
            </p>
          </div>
        )}

        <p className="note pad">
          PNG today. Vector, video and audio are coming — they are named here
          rather than shown as empty shelves.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Colours</h2>
          <span className="dim">Used by every graphic that references them</span>
        </div>
        {swatches.length === 0 ? (
          <p className="note pad">
            Open a graphic to see its colours. Applying a theme from the
            Marketplace fills this in.
          </p>
        ) : (
          <div className="swatch-grid">
            {swatches.map((token) => (
              <span className="swatch-tile" key={token.name}>
                <span className="tile" style={{ background: String(token.value) }} />
                <strong>{token.name.replace("color.", "")}</strong>
                <span className="dim tiny">{String(token.value)}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Typefaces</h2>
          <span className="dim">Loaded and ready</span>
        </div>
        <div className="font-grid">
          {STUDIO_FONTS.map((font) => (
            <span className="font-tile" key={font.assetId}>
              <strong>{font.label}</strong>
              <span className="dim tiny">{font.scripts.join(" · ")}</span>
            </span>
          ))}
        </div>
      </section>

      {/* SCENES — the journey's missing link. A scene installed from the
          Marketplace lives here, and is DRAGGED onto the Stage. Nothing about
          it is recreated by hand; `placeScene` inserts its real nodes. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Scenes</h2>
          <span className="dim">Drag one onto your stage</span>
        </div>
        {scenes.length === 0 ? (
          <p className="empty">
            Install a graphics pack from the Marketplace and its scenes appear
            here, ready to drop onto the stage.
          </p>
        ) : (
          <div className="scene-grid">
            {scenes.map(({ pack, template }) => (
              <button
                type="button"
                className="scene-tile"
                key={template.id}
                draggable
                data-testid={`scene-${template.id}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SCENE_DRAG, template.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPlaceScene(template.id)}
                title={`Add ${template.name} to your stage`}
              >
                <span
                  className="scene-art"
                  aria-hidden
                  style={{
                    background: `linear-gradient(135deg, ${pack.swatch[0]}, ${pack.swatch[1]})`,
                  }}
                />
                <strong>{template.name}</strong>
                <span className="dim tiny">{template.description}</span>
              </button>
            ))}
          </div>
        )}
        <p className="note">
          Dragging a scene adds it to what you already have. Nothing is replaced.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Motion</h2>
          <span className="dim">From your installed packs</span>
        </div>
        <div className="font-grid">
          {motion.flatMap((pack) =>
            (pack.presets ?? []).map((id) => {
              const preset = presetById(id);
              return preset === undefined ? null : (
                <span className="font-tile" key={`${pack.id}:${id}`}>
                  <strong>{preset.label}</strong>
                  <span className="dim tiny">{pack.name}</span>
                </span>
              );
            }),
          )}
        </div>
        <p className="note">
          {PRESETS.length} moves available. Apply one from the Motion panel while
          designing.
        </p>
      </section>

      <p className="note pad">
        Images, logos, video and audio arrive with image support.
      </p>
    </div>
  );
}

// ===========================================================================
// Outputs
// ===========================================================================

export function Outputs({ session }: { session: StudioSession | null }) {
  const outputs = session?.host.outputs ?? [];
  const document_ = session?.document;

  return (
    <div className="section-page" data-testid="outputs">
      <header className="section-head">
        <div>
          <h1>Outputs</h1>
          <p className="lede">Where your graphics are sent.</p>
        </div>
      </header>

      <section className="home-block">
        <div className="block-head">
          <h2>Frame</h2>
        </div>
        {document_ === undefined ? (
          <p className="note pad">Open a graphic to see its frame.</p>
        ) : (
          <dl className="facts">
            <div>
              <dt>Resolution</dt>
              <dd>
                {document_.world.output.width} × {document_.world.output.height}
              </dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd>{document_.world.output.fps} fps</dd>
            </div>
            <div>
              <dt>Background</dt>
              <dd>Transparent — composites over video</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Destinations</h2>
          <span className="dim">{outputs.length} connected</span>
        </div>
        <ul className="row-list quiet">
          {outputs.map((output) => (
            <li key={output.id}>
              <span className="learn">
                <strong>{output.id === "default" ? "Editor preview" : output.id}</strong>
                <span className="dim">
                  {output.width} × {output.height}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="note">
          A production feed is added when you connect Streamatrix to your
          switcher.
        </p>
      </section>
    </div>
  );
}

// ===========================================================================
// Settings
// ===========================================================================

export interface SettingsProps {
  /** Every place a scene can live. */
  readonly places: readonly ProviderStatus[];
  readonly driveClientId: string;
  readonly dropboxAppKey: string;
  readonly onCloudKeys: (keys: { driveClientId?: string; dropboxAppKey?: string }) => void;
  /** Asks a provider for access. */
  readonly onConnect: (id: string) => void;
  readonly theme: "dark" | "light";
  readonly onTheme: (theme: "dark" | "light") => void;
  readonly developerMode: boolean;
  readonly onDeveloperMode: (on: boolean) => void;
  readonly onResetWorkspace: () => void;
  readonly quality: QualityChoice;
  readonly onQuality: (choice: QualityChoice) => void;
  /** The renderer this session STARTED on, which may differ from the choice. */
  readonly renderer: RendererChoice;
  readonly activeRenderer: RendererChoice;
  readonly onRenderer: (choice: RendererChoice) => void;
  readonly device: DeviceInput;
  /** What the last few seconds actually measured. Null before any frame. */
  readonly frames: FrameReport | null;
  readonly sound: boolean;
  readonly onSound: (on: boolean) => void;
  /** Auditions a voice. Does nothing while sound is off, by design. */
  readonly onAudition: (voice: VoiceName) => void;
  /** True while the desk is live, when the interface is ducked. */
  readonly onAir: boolean;
}

export function Settings({
  places,
  driveClientId,
  dropboxAppKey,
  onCloudKeys,
  onConnect,
  theme,
  onTheme,
  developerMode,
  onDeveloperMode,
  onResetWorkspace,
  quality,
  onQuality,
  renderer,
  activeRenderer,
  onRenderer,
  device,
  frames,
  sound,
  onSound,
  onAudition,
  onAir,
}: SettingsProps) {
  const resolved = resolveTier(quality, device);
  const active = QUALITY_PRESETS[resolved];
  return (
    <div className="section-page" data-testid="settings">
      <header className="section-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Appearance and behaviour.</p>
        </div>
      </header>

      {/* RENDERER. The founder's decision: a second selectable backend, with
          three as the default.

          This is the only control in the product that names a rendering
          library, and it is in Settings rather than anywhere near the Stage
          for that reason — a designer making a lower third should never have
          to have an opinion about it.

          The choice takes effect on the next start, and the panel SAYS SO. A
          backend binds to its canvas for the session's lifetime (MirrorBackend
          C2), so applying it live would rebuild every GPU resource while a
          graphic might be on air. A setting that appears to do nothing is
          worse than one that says when it lands. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Renderer</h2>
          <span className="dim" data-testid="renderer-active">
            {renderer === activeRenderer
              ? `Running on ${rendererSpec(activeRenderer).label}`
              : `Running on ${rendererSpec(activeRenderer).label} — reload to use ${rendererSpec(renderer).label}`}
          </span>
        </div>

        <div className="quality-grid">
          {RENDERERS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              className={`quality-card ${renderer === spec.id ? "on" : ""}`}
              data-testid={`renderer-${spec.id}`}
              aria-pressed={renderer === spec.id}
              onClick={() => onRenderer(spec.id)}
            >
              <strong>{spec.label}</strong>
              <span className="dim tiny">{spec.hint}</span>
            </button>
          ))}
        </div>

        {renderer === activeRenderer ? null : (
          <p className="note" data-testid="renderer-pending">
            Reload Streamatrix to draw with {rendererSpec(renderer).label}.
          </p>
        )}
      </section>

      {/* QUALITY. Named for what it costs, not for what it switches off — a
          user picking a preset is answering "how much machine do I have?",
          not "would you like antialiasing?". */}
      <section className="home-block">
        <div className="block-head">
          <h2>Quality</h2>
          <span className="dim">
            {quality === "auto" ? `Automatic — ${active.label} on this device` : "Chosen by you"}
          </span>
        </div>

        <div className="quality-grid">
          <button
            type="button"
            className={`quality-card ${quality === "auto" ? "on" : ""}`}
            data-testid="quality-auto"
            onClick={() => onQuality("auto")}
          >
            <strong>Automatic</strong>
            <span className="dim tiny">
              Picks a level from this device. Currently {active.label}.
            </span>
          </button>
          {TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`quality-card ${quality === tier ? "on" : ""}`}
              data-testid={`quality-${tier}`}
              onClick={() => onQuality(tier)}
            >
              <strong>{QUALITY_PRESETS[tier].label}</strong>
              <span className="dim tiny">{QUALITY_PRESETS[tier].hint}</span>
            </button>
          ))}
        </div>

        {/* Measured, never claimed. The 95th percentile is beside the average
            because a viewport that runs at 60 and hitches once a second reads
            as broken while averaging perfectly well. */}
        <dl className="facts mono">
          <div>
            <dt>Frame rate</dt>
            {/* "Idle" rather than a number, because the editor DRAWS ONLY
                WHEN SOMETHING CHANGES. Reporting the display's refresh rate
                for a stationary scene would be a number that says nothing
                about whether this machine can cope. */}
            <dd data-testid="fps">
              {frames === null || frames.sampled === 0
                ? "Idle"
                : `${Math.round(frames.fps)} fps`}
            </dd>
          </div>
          <div>
            <dt>Worst frame</dt>
            <dd>
              {frames === null || frames.sampled === 0
                ? "Idle"
                : `${frames.worstMs.toFixed(1)} ms`}
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{active.targetFps} fps</dd>
          </div>
        </dl>
        {frames?.strained === true ? (
          <p className="note" data-testid="strained">
            This device is not keeping up at {active.label}. A lower level will
            be smoother.
          </p>
        ) : null}
        <p className="note">
          Measured while the stage is drawing — playing an animation or moving
          something. A still scene draws nothing, and has nothing to measure.
        </p>
        <p className="note">
          Quality changes the editor preview only. What you send to air is
          never scaled or softened.
        </p>
      </section>

      {/* SOUND. Off by default and remembered — a gallery has its own audio
          discipline, and an unexpected noise on a live desk is a fault. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Sound</h2>
          <span className="dim">Nine voices · synthesised, no files</span>
        </div>

        <label className="sound-switch">
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => onSound(event.target.checked)}
            data-testid="sound-toggle"
          />
          <span>
            <strong>Interface sound</strong>
            <span className="dim tiny">
              Short, dry, mechanical. A sound only ever confirms something you
              can already see.
            </span>
          </span>
        </label>

        <div className="voice-grid" data-testid="voices">
          {VOICE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className="voice"
              data-testid={`voice-${name}`}
              disabled={!sound}
              onClick={() => onAudition(name)}
              title={sound ? `Play ${VOICES[name].label}` : "Turn sound on to audition"}
            >
              <strong>{VOICES[name].label}</strong>
              <span className="dim tiny">{VOICES[name].when}</span>
            </button>
          ))}
        </div>

        {onAir ? (
          <p className="note" data-testid="ducked">
            Ducked. While you are on air the interface is silent — except
            Attention, which has to survive or it is not an alert.
          </p>
        ) : null}
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Appearance</h2>
        </div>
        <div className="setting-row">
          <span>
            <strong>Theme</strong>
            <span className="dim">Dark suits a gallery; light suits an office.</span>
          </span>
          <div className="chips">
            {(["dark", "light"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`chip ${theme === entry ? "on" : ""}`}
                onClick={() => onTheme(entry)}
              >
                {entry === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ==================================================================
          WHERE SCENES LIVE
          ==================================================================
          A scene is a SCENE_FORMAT document and nothing else, so anywhere
          that holds a text file can hold one. This lists the places, and it
          is honest about the ones that are not ready: a provider that needs
          an app registration SAYS so rather than offering a button that
          fails after the click. */}
      <section className="home-block" aria-label="Storage">
        <div className="block-head">
          <h2>Storage</h2>
        </div>
        {places.map((place) => (
          <div className="setting-row" key={place.id} data-testid={`place-${place.id}`}>
            <span>
              <strong>{place.label}</strong>
              <span className="dim">
                {place.blocker ?? place.hint}
              </span>
            </span>
            {place.blocker !== undefined ? (
              <span className="dim tiny" data-testid={`place-blocked-${place.id}`}>
                needs setting up
              </span>
            ) : place.connected ? (
              <span className="ok tiny" data-testid={`place-ready-${place.id}`}>
                ready
              </span>
            ) : (
              <button
                type="button"
                className="chip"
                data-testid={`place-connect-${place.id}`}
                onClick={() => onConnect(place.id)}
              >
                Connect
              </button>
            )}
          </div>
        ))}

        {/* The keys, in the open. Registering the application is the owner's
            act — a client id cannot be invented in a source file — so the
            product asks for it plainly rather than shipping a dead button. */}
        <label className="setting-row">
          <span>
            <strong>Google client id</strong>
            <span className="dim">From the Google Cloud console, for Drive.</span>
          </span>
          <input
            className="field"
            defaultValue={driveClientId}
            data-testid="drive-client-id"
            placeholder="…apps.googleusercontent.com"
            onBlur={(event) => onCloudKeys({ driveClientId: event.target.value.trim() })}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Dropbox app key</strong>
            <span className="dim">From the Dropbox app console.</span>
          </span>
          <input
            className="field"
            defaultValue={dropboxAppKey}
            data-testid="dropbox-app-key"
            onBlur={(event) => onCloudKeys({ dropboxAppKey: event.target.value.trim() })}
          />
        </label>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Advanced</h2>
        </div>
        <div className="setting-row">
          <span>
            <strong>Developer mode</strong>
            <span className="dim">
              Shows engine internals and performance tools. Off by default —
              you never need it to make a graphic.
            </span>
          </span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={developerMode}
              onChange={(event) => onDeveloperMode(event.target.checked)}
              aria-label="Developer mode"
            />
            {developerMode ? "On" : "Off"}
          </label>
        </div>
        <div className="setting-row">
          <span>
            <strong>Reset layout</strong>
            <span className="dim">Puts every panel back where it started.</span>
          </span>
          <button type="button" className="chip" onClick={onResetWorkspace}>
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}

/** Installing a theme is an ordinary document edit. Exported for the shell. */
export function applyThemePack(
  document: SceneDocument,
  pack: Pack,
): Transaction | null {
  return installTheme(document, pack);
}

export type { IdFactory };
