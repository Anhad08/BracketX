import type { SceneDocument } from "@bracketx/engine-scene";

import type { RecentProject } from "../studio/project";
import type { LibraryEntry } from "../studio/library";
import { PACKS, templatesOf, type PackTemplate } from "../studio/packs";

/**
 * Home.
 *
 * ============================================================================
 * WHAT A BROADCASTER SEES IN THE FIRST SECOND
 * ============================================================================
 * Not a canvas. Not a node tree. Three things: **what you were doing**, **what
 * you can start**, and **what you already own**.
 *
 * The brief's success criterion is thirty seconds to a lower third, and the
 * single biggest determinant of that number is what is on screen when the
 * application opens. An empty canvas asks a first-time user to be a designer
 * before they are allowed to be a user; a grid of real, editable graphics asks
 * them to pick one.
 *
 * No technical terminology appears on this screen. That is asserted, not
 * intended — `leaksEngineTerm` runs over every string this component can
 * produce.
 */

export interface HomeProps {
  readonly recents: readonly RecentProject[];
  readonly library: readonly LibraryEntry[];
  readonly installedPacks: ReadonlySet<string>;
  readonly onCreate: (template: PackTemplate) => void;
  readonly onBlank: () => void;
  readonly onOpenRecent: (project: RecentProject) => void;
  readonly onOpenLibrary: (entry: LibraryEntry) => void;
  readonly onBrowse: () => void;
  readonly document: SceneDocument | null;
}

export function Home({
  recents,
  library,
  installedPacks,
  onCreate,
  onBlank,
  onOpenRecent,
  onOpenLibrary,
  onBrowse,
  document: _document,
}: HomeProps) {
  const owned = PACKS.filter((pack) => installedPacks.has(pack.id));
  const templates = templatesOf(owned);

  return (
    <div className="home" data-testid="home">
      <header className="home-head">
        <div>
          <h1>Streamatrix</h1>
          <p className="lede">
            Design broadcast graphics, preview them, and put them on air.
          </p>
        </div>
      </header>

      {/* Start, first and largest. The most common intent gets the most space. */}
      <section className="home-block" aria-label="Start something">
        <div className="block-head">
          <h2>Start something</h2>
          <button type="button" className="link" onClick={onBrowse}>
            Browse the Marketplace
          </button>
        </div>

        <div className="start-grid">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="start-card"
              onClick={() => onCreate(template)}
              data-testid={`start-${template.id}`}
            >
              <span className="start-art" aria-hidden>
                <TemplatePreview id={template.id} />
              </span>
              <strong>{template.name}</strong>
              <span className="dim">{template.description}</span>
            </button>
          ))}

          <button
            type="button"
            className="start-card blank"
            onClick={onBlank}
            data-testid="start-blank"
          >
            <span className="start-art blank-art" aria-hidden>
              +
            </span>
            <strong>Blank graphic</strong>
            <span className="dim">Start from an empty frame.</span>
          </button>
        </div>
      </section>

      <div className="home-columns">
        <section className="home-block" aria-label="Recent">
          <div className="block-head">
            <h2>Recent</h2>
          </div>
          {recents.length === 0 ? (
            <p className="note pad">
              Nothing yet. Anything you save appears here.
            </p>
          ) : (
            <ul className="row-list">
              {recents.slice(0, 6).map((project) => (
                <li key={project.id}>
                  <button type="button" onClick={() => onOpenRecent(project)}>
                    <strong>{project.name}</strong>
                    <span className="dim">{friendlyDate(project.savedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-block" aria-label="Your templates">
          <div className="block-head">
            <h2>Your templates</h2>
          </div>
          {library.length === 0 ? (
            <p className="note pad">
              Save a graphic as a template and it will be here, ready to reuse.
            </p>
          ) : (
            <ul className="row-list">
              {library.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => onOpenLibrary(entry)}>
                    <strong>{entry.name}</strong>
                    <span className="dim">{friendlyDate(entry.savedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-block" aria-label="Learn">
          <div className="block-head">
            <h2>Learn</h2>
          </div>
          {/* Deliberately three, and deliberately about the WORKFLOW rather
              than about features. Somebody who can do these three can produce
              a show. */}
          <ul className="row-list quiet">
            {[
              ["Make your first lower third", "Pick a template, type a name, press Take."],
              ["Change the look", "Styles restyle every graphic that uses them at once."],
              ["Preview and Program", "Nothing reaches air until you take it there."],
            ].map(([title, body]) => (
              <li key={title}>
                <span className="learn">
                  <strong>{title}</strong>
                  <span className="dim">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * A tiny abstract preview of each template.
 *
 * Drawn rather than screenshotted, so it cannot go stale when a template
 * changes and costs nothing to ship. It shows the SHAPE of the graphic — where
 * the bar is, where the words go — which is what a person picking one is
 * actually looking for.
 */
function TemplatePreview({ id }: { id: string }) {
  if (id === "tpl_scoreboard") {
    return (
      <svg viewBox="0 0 120 68" className="preview">
        <rect x="18" y="10" width="84" height="14" rx="2" className="p-surface" />
        <rect x="52" y="10" width="22" height="14" rx="2" className="p-accent" />
        <rect x="24" y="15" width="22" height="4" rx="2" className="p-ink" />
        <rect x="80" y="15" width="18" height="4" rx="2" className="p-ink" />
      </svg>
    );
  }
  if (id === "tpl_title_card") {
    return (
      <svg viewBox="0 0 120 68" className="preview">
        <rect x="30" y="26" width="60" height="8" rx="2" className="p-ink" />
        <rect x="42" y="40" width="36" height="4" rx="2" className="p-muted" />
        <rect x="50" y="50" width="20" height="2" rx="1" className="p-accent" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 68" className="preview">
      <rect x="14" y="38" width="80" height="20" rx="2" className="p-surface" />
      <rect x="14" y="38" width="3" height="20" className="p-accent" />
      <rect x="22" y="43" width="42" height="5" rx="2" className="p-ink" />
      <rect x="22" y="51" width="26" height="3" rx="1.5" className="p-muted" />
    </svg>
  );
}

/**
 * "2 hours ago", not an ISO timestamp.
 *
 * Computed from a passed-in clock nowhere — it reads `Date.now()` directly,
 * which is correct here and nowhere else in Studio: this is presentation, not
 * engine state, and a relative time that froze would be worse than one that is
 * approximate.
 */
export function friendlyDate(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}
