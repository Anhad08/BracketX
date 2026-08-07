import type { ReactNode } from "react";
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
  /** Armed, but not out. The state between nothing and air. */
  readonly cued: boolean;
}

/**
 * THE RAIL'S ICONS.
 *
 * ============================================================================
 * WHY THESE ARE DRAWN AND NOT TYPED
 * ============================================================================
 * They were unicode characters — ◆ ✎ ◉ ▦ ◈ ◍ ▷ ⚙ — and that is the single
 * loudest "this is somebody's side project" signal an interface can send.
 * Typed glyphs come from whatever font the machine happens to have, so they
 * arrive at different weights, different optical sizes and different baselines
 * from each other; the rail was a row of mismatched marks pretending to be a
 * set.
 *
 * Drawn on one grid, at one stroke weight, they read as a family. Each is the
 * INSTRUMENT the section is about rather than an abstraction of it: Production
 * is a tally lamp, Outputs is a signal leaving, Assets is a stack of media.
 * A broadcaster should recognise the rail before reading a word of it.
 */
const ICONS: Record<Section, (props: { readonly on: boolean }) => ReactNode> = {
  // A frame with its lower third lit — the product's own first object.
  home: () => (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M6.5 15h7" className="fill-stroke" />
    </>
  ),
  // A pen nib over a baseline. Authoring, not "settings for a document".
  design: () => (
    <>
      <path d="M4 20l1.2-4.2L15.4 5.6a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8 4 20z" />
      <path d="M14.2 6.8l3 3" />
    </>
  ),
  // A tally lamp: the ring, and the light inside it when you are on it.
  production: ({ on }) => (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r={on ? 3.6 : 2.6} className="glyph-fill" />
    </>
  ),
  // A sheet with a repeated band — a layout that gets reused.
  templates: () => (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M9 9.5V20" />
    </>
  ),
  // A shop awning over goods, not a shopping cart: this is a catalogue.
  marketplace: () => (
    <>
      <path d="M4 9.5h16l-1 10.5H5L4 9.5z" />
      <path d="M8 9.5V7a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  // A stack of media, seen from a slight angle.
  assets: () => (
    <>
      <rect x="3.5" y="7" width="13" height="13" rx="2.2" />
      <path d="M7.5 4h10a2.5 2.5 0 0 1 2.5 2.5v10" />
    </>
  ),
  // Signal leaving the building.
  outputs: () => (
    <>
      <rect x="3.5" y="5.5" width="12" height="13" rx="2.2" />
      <path d="M15 12h5.5M18 9.2l2.8 2.8-2.8 2.8" />
    </>
  ),
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.6M12 18.4V21M21 12h-2.6M5.6 12H3M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9M18.4 18.4l-1.9-1.9M7.5 7.5L5.6 5.6" />
    </>
  ),
  // Under the surface. A chevron into a rule.
  developer: () => (
    <>
      <path d="M9.5 8.5L5 12l4.5 3.5M14.5 8.5L19 12l-4.5 3.5" />
    </>
  ),
};
export function Nav({ section, onSection, developerMode, dirty, onAir, cued }: NavProps) {
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
            {/* One grid, one stroke weight, one join style — which is what
                makes eight marks read as a set rather than as eight fonts. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICONS[entry.id]({ on: section === entry.id })}
            </svg>
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
        className={`rail-tally ${onAir ? "on-air" : ""} ${cued ? "cued" : ""}`}
        data-testid="rail-tally"
        data-air={onAir ? "live" : cued ? "cued" : "off"}
        title={
          onAir
            ? "A graphic is on air"
            : cued
              ? "A graphic is armed for the next take. Nothing is on air."
              : "Nothing is on air"
        }
      >
        {onAir ? "ON AIR" : cued ? "CUED" : "OFF"}
      </span>
    </nav>
  );
}
