/**
 * The application's information architecture.
 *
 * ============================================================================
 * THE ENGINE IS OUR TECHNOLOGY. THE STUDIO IS OUR PRODUCT
 * ============================================================================
 * Every name below describes what a person is trying to DO. None of them names
 * a thing the engine has.
 *
 * That is the whole rule, and it is worth stating why it is a rule rather than
 * a preference. Before Phase 4 the editor's tabs were `timeline`, `presets`,
 * `variables`, `library` — three of which are engine nouns and one of which is
 * ours. A designer opening it had to learn our architecture before they could
 * make a graphic, which is the definition of leaking an implementation.
 *
 * ============================================================================
 * DEVELOPER MODE IS A MODE, NOT A PANEL
 * ============================================================================
 * Nothing built for the engineering workbench is deleted, and nothing is
 * hidden behind a flag that only we know. Developer Mode is a first-class,
 * discoverable switch that reveals the mirror, the projection report, backend
 * writes, dirty channels and the atlas — and when it is off, none of those
 * words appear anywhere in the product.
 *
 * The test is exact and asserted: **with Developer Mode off, no engine term
 * appears in any label, tab, command title or panel heading.** A list of the
 * forbidden words lives in the verification suite, so the rule cannot rot.
 */

export type Section =
  | "home"
  | "design"
  | "production"
  | "templates"
  | "marketplace"
  | "assets"
  | "outputs"
  | "settings"
  | "developer";

export interface SectionSpec {
  readonly id: Section;
  readonly label: string;
  /** One line, shown under the title. Says what you DO here. */
  readonly hint: string;
  /** Reveals only in Developer Mode. */
  readonly developer?: boolean;
}

/**
 * The navigation, in the order the work happens.
 *
 * Home first because that is where a session starts. Design second because it
 * is where the time goes. Developer last, and visually separated, because it is
 * ours rather than theirs.
 */
export const SECTIONS: readonly SectionSpec[] = [
  { id: "home", label: "Home", hint: "Recent work, and somewhere to start" },
  { id: "design", label: "Design", hint: "Build and animate a graphic" },
  // PRODUCTION is where scenes go to air. Design is where they are MADE.
  // Mixing the two put a control that starts a transmission next to a control
  // that nudges a rectangle, which is the wrong neighbourhood for it.
  { id: "production", label: "Production", hint: "Cue your scenes and put them on air" },
  { id: "templates", label: "Templates", hint: "Reusable graphics you have saved" },
  { id: "marketplace", label: "Marketplace", hint: "Themes, motion and graphics packs" },
  { id: "assets", label: "Assets", hint: "Fonts, colours and motion you can reuse" },
  { id: "outputs", label: "Outputs", hint: "Where your graphics are sent" },
  { id: "settings", label: "Settings", hint: "Appearance and behaviour" },
  { id: "developer", label: "Developer", hint: "Engine internals and diagnostics", developer: true },
];

export function visibleSections(developerMode: boolean): readonly SectionSpec[] {
  return SECTIONS.filter((section) => developerMode || section.developer !== true);
}

export function sectionSpec(id: Section): SectionSpec {
  return SECTIONS.find((section) => section.id === id) ?? SECTIONS[0]!;
}

/**
 * Panels inside the Design section.
 *
 * `layers` and `properties` rather than `hierarchy` and `inspector`: a designer
 * has layers and properties, an engineer has a hierarchy and an inspector. The
 * data behind them did not change.
 */
export type DesignPanel = "motion" | "text" | "data" | "styles";

export interface PanelSpec {
  readonly id: DesignPanel;
  readonly label: string;
  readonly hint: string;
}

export const DESIGN_PANELS: readonly PanelSpec[] = [
  { id: "motion", label: "Motion", hint: "Animate this graphic" },
  { id: "text", label: "Timeline", hint: "Keyframes and timing" },
  { id: "data", label: "Data", hint: "Fields a producer or feed can change" },
  { id: "styles", label: "Styles", hint: "Colours and spacing used across the graphic" },
];

/**
 * Words that must never appear with Developer Mode off.
 *
 * Exported so the verification suite can assert it over the real UI strings
 * rather than over a promise. Adding a word here is how the rule is tightened;
 * there is deliberately no way to add an exception.
 */
export const ENGINE_TERMS: readonly string[] = [
  "mirror",
  "backend",
  "projection",
  "projector",
  "reconciler",
  "dirty node",
  "backend write",
  "node attachment",
  "snapshot",
  "conformance",
  "primitive",
  "msdf",
  "atlas",
  "glyph",
  "descriptor",
  "handle",
  "transaction",
  "mesh",
  "geometry",
  "material",
  "upem",
  "diagnostic",
];

/**
 * Whether a user-facing string leaks an engine concept.
 *
 * Word-boundary matched, so "Materials" is caught and "immaterial" is not, and
 * so a legitimate product word that merely contains one of these is not a false
 * positive.
 */
export function leaksEngineTerm(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of ENGINE_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`);
    if (pattern.test(lower)) return term;
  }
  return null;
}
