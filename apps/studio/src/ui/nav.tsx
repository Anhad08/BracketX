import { visibleSections, type Section } from "../studio/shell";

/**
 * The navigation rail.
 *
 * ============================================================================
 * ONE RAIL, ALWAYS VISIBLE, NEVER MORE THAN ONE CLICK FROM ANYWHERE
 * ============================================================================
 * A broadcaster's mental model of this product is a small number of places:
 * where I start, where I design, what I own, what I can buy, where it goes. The
 * rail is that list, and it does not change depending on where you are — an
 * interface that reorganises itself is an interface you have to re-learn every
 * time you look away.
 *
 * Developer sits last, below a divider, and only exists when the mode is on.
 * It is not hidden in a menu: an engineer should find it immediately, and a
 * broadcaster should never trip over it.
 */

export interface NavProps {
  readonly section: Section;
  readonly onSection: (section: Section) => void;
  readonly developerMode: boolean;
  /** Shown as a dot on Design when there is unsaved work. */
  readonly dirty: boolean;
  /** Shown as a tally on the rail, because on-air state is never hidden. */
  readonly onAir: boolean;
}

const ICONS: Record<Section, string> = {
  home: "◆",
  design: "✎",
  production: "◉",
  templates: "▦",
  marketplace: "◈",
  assets: "◍",
  outputs: "▷",
  settings: "⚙",
  developer: "⌥",
};

export function Nav({ section, onSection, developerMode, dirty, onAir }: NavProps) {
  const sections = visibleSections(developerMode);

  return (
    <nav className="rail" aria-label="Sections" data-testid="rail">
      <span className="rail-mark" aria-hidden>
        S
      </span>

      {sections.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={`rail-item ${section === entry.id ? "on" : ""} ${
            entry.developer === true ? "rail-dev" : ""
          }`}
          onClick={() => onSection(entry.id)}
          title={entry.hint}
          aria-current={section === entry.id}
          data-testid={`nav-${entry.id}`}
        >
          <span className="rail-icon" aria-hidden>
            {ICONS[entry.id]}
          </span>
          <span className="rail-label">{entry.label}</span>
          {entry.id === "design" && dirty ? (
            <span className="rail-dot" title="Unsaved changes" data-testid="nav-dirty" />
          ) : null}
        </button>
      ))}

      <span className="spacer" />

      {/* On air, on the rail. An operator must never have to navigate to find
          out whether something is live. */}
      <span
        className={`rail-tally ${onAir ? "on-air" : ""}`}
        data-testid="rail-tally"
        title={onAir ? "A graphic is on air" : "Nothing is on air"}
      >
        {onAir ? "ON AIR" : "OFF"}
      </span>
    </nav>
  );
}
