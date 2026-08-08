/**
 * The workspace — everything about the editor that is not the document.
 *
 * Panel sizes, which tabs are open, view toggles, the theme. Persisted, because
 * an editor that forgets its layout on reload is an editor people stop
 * reloading — and never written into the scene file, because a document that
 * carried someone's panel widths would not be portable.
 *
 * Versioned and sanitised: a stale or hostile store falls back to defaults
 * rather than throwing. An editor that will not start because it cannot read a
 * checkbox is worse than one that forgets.
 */

import { SECTIONS, type Section } from "./shell";
import type { QualityChoice } from "./quality";
import type { RendererChoice } from "./renderer";
import type { GizmoMode } from "./spin";

/**
 * Bumped to v2 in Phase 4: the shape gained a section, a mode and installed
 * packs, and a v1 payload has none of them.
 *
 * Exported so a test references the key rather than a literal — the version
 * bump broke two assertions that had it hardcoded, which is a test knowing
 * something it should have been told.
 */
export const WORKSPACE_KEY = "streamatrix.studio.workspace.v2";

const KEY = WORKSPACE_KEY;

/**
 * The packs every account starts with. The brief's free tier.
 *
 * Ids rather than an import of the pack data, so this module stays free of the
 * content it is describing — the workspace remembers a choice, it does not own
 * a catalogue.
 */
export const FREE_TIER: readonly string[] = [
  "pack_theme_midnight",
  "pack_theme_broadcast_red",
  "pack_theme_studio_light",
  "pack_motion_essentials",
  "pack_motion_snap",
  "pack_motion_emphasis",
  "pack_broadcast_starter",
  "pack_news_essentials",
  "pack_sport_essentials",
];

export type Theme = "dark" | "light";

/**
 * The bottom dock's tabs.
 *
 * Ordered the way the work runs — build it, animate it, parameterise it, put it
 * somewhere reusable — rather than alphabetically or by how hard each was to
 * write. `program` is deliberately NOT here: Preview/Program is a permanent row,
 * not a tab, because an operator must never have to find the on-air state.
 */
/**
 * The panels that live in the bottom dock.
 *
 * NOT TABS. Volume Two refuses tabbing by name:
 *
 *   "Streamatrix never tabs a panel. A tab hides a panel's state behind
 *    another panel's, and a hidden panel on a live desk is a panel you forgot
 *    about."
 *
 * and allows exactly three conditions — "in a dock, on a second monitor, or
 * collapsed; there is no fourth condition". Collapsed is legitimate; hidden
 * behind a sibling is not, because a collapsed panel still SHOWS that it
 * exists and what state it is in.
 *
 * So these are stacked sections with headers, any number open at once. The
 * name is kept as `BottomPanel` rather than `BottomTab` so nothing in the
 * codebase can go on calling them tabs.
 */
export const BOTTOM_PANELS = ["timeline", "presets", "variables", "library"] as const;

export type BottomPanel = (typeof BOTTOM_PANELS)[number];

/**
 * TWO LEVELS. Not three depths.
 *
 * ==========================================================================
 * WHY THIS WENT FROM THREE TO TWO
 * ==========================================================================
 * Studio had beginner / designer / advanced, and the control CYCLED through
 * them. Three states on a toggle means a person pressing it cannot predict
 * where they will land, and the middle one had no honest description — every
 * attempt to write the footer for "designer" came out as "some of the things".
 *
 * The prototype has one class on the root and two states:
 *
 *     .expert-only   { display: none; }
 *     .app.expert .expert-only { display: block; }
 *
 * Beginner sees the content of the graphic. Expert sees how it is built. One
 * key moves between them, in both directions, and the footer can state the
 * bargain in a sentence because there are only two sides to it.
 *
 * `Depth` keeps its name so nothing has to be renamed to be understood, but
 * it is a LEVEL now and there are two of them.
 */
export type Depth = "beginner" | "expert";

export const DEPTHS: readonly Depth[] = ["beginner", "expert"];

/**
 * What a level reveals.
 *
 * ==========================================================================
 * ONE DOCK, AND A TIMELINE THAT IS SUMMONED
 * ==========================================================================
 * There were three docks — construction on the left, content on the right,
 * timeline underneath — which is the shape of an IDE, not of the specimen.
 * The prototype is `.spine │ .rail │ .stage │ .dock`: ONE dock, on the right,
 * with Layers and Content stacked inside it and Content always first.
 *
 * The timeline is the exception, and it is the one Volume Two W9 already
 * names: a Designer gets "the navigator, the inspector and the SUMMONED
 * timeline". Summoned, not resident. It needs width that a 320px column does
 * not have, and it is only wanted while somebody is timing something — so it
 * opens across the bottom when asked for and is closed the rest of the time.
 */
export function docksAt(depth: Depth): {
  /** The one dock. Always present: a graphic with no properties is not one. */
  readonly dock: boolean;
  /** Layers, Properties and the create tools, inside that dock. */
  readonly construction: boolean;
  /** The timeline may be summoned. */
  readonly timeline: boolean;
} {
  return {
    dock: true,
    // The layer tree and the create tools are construction. A beginner edits
    // the content of a graphic somebody else built, and the content surface
    // is the whole of their interface.
    construction: depth === "expert",
    timeline: depth === "expert",
  };
}

/** True when a control that names an engine concept may be shown. */
export function revealsEngine(depth: Depth): boolean {
  return depth === "expert";
}

export interface Workspace {
  readonly theme: Theme;
  /**
   * Rendering quality.
   *
   * "auto" is the default and resolves from the device; anything else is a
   * pin the user chose, and a pin is remembered — a preset that quietly reset
   * itself on the next launch is not a setting, it is a suggestion.
   */
  readonly quality: QualityChoice;
  /**
   * Which renderer draws the scene.
   *
   * Remembered like any other layout choice and applied on the next start —
   * a backend binds to its canvas for the session's lifetime (MirrorBackend
   * C2), so swapping under a running session would rebuild every GPU resource
   * while a graphic might be on air.
   */
  readonly renderer: RendererChoice;
  /**
   * Interface sound.
   *
   * Off by default and REMEMBERED PER OPERATOR — Volume One §4. A gallery has
   * its own audio discipline, and an unexpected noise on a live desk is a
   * fault, not a delight.
   */
  readonly sound: boolean;

  /**
   * Which part of the product is open.
   *
   * The application is no longer one screen with panels — it is a product with
   * sections, and the section is the first thing state has to remember.
   */
  readonly section: Section;

  /**
   * Reveals the engine.
   *
   * OFF by default, and that default is the whole point of Phase 4: a
   * broadcaster must never need to know what a mirror is. Nothing is deleted
   * when it is off — the diagnostics that the engineering workbench pioneered
   * are all still there, one switch away.
   */
  readonly developerMode: boolean;

  /**
   * How much of the product is revealed. Volume One L9, Volume Two W9.
   *
   * A DEPTH, not a mode: it never changes by itself, it is remembered like any
   * other layout state, and moving between depths is a deliberate act with the
   * same standing as applying a preset.
   *
   * `beginner` is the default because the first five minutes decide whether
   * anyone reaches the fifth. A first-time user meeting a layer tree, a
   * timeline and a Camera button has been told the product is not for them.
   */
  readonly depth: Depth;

  /** Which packs the user has installed. Free-tier packs are pre-installed. */
  readonly installedPacks: readonly string[];

  /** Dismissed once, remembered forever. Nobody wants a tour twice. */
  readonly welcomed: boolean;

  /** Panel sizes, in pixels / viewport percent. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly bottomHeight: number;

  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
  readonly bottomOpen: boolean;
  /** Which bottom panels are expanded. Any number, including none. */
  readonly bottomExpanded: readonly BottomPanel[];
  /** The Preview/Program row. Off for a designer who is not airing anything. */
  readonly programOpen: boolean;
  /** Seconds visible in the timeline editor. Zoom, not a clock. */
  readonly timelineZoom: number;

  // -- Scene view toggles ---------------------------------------------------
  readonly showSafeAreas: boolean;
  readonly showGrid: boolean;
  readonly showGuides: boolean;
  readonly showRulers: boolean;
  readonly showDebug: boolean;
  readonly snapEnabled: boolean;
  /**
   * What snapping snaps to, per kind.
   *
   * Four toggles rather than one, because the kinds genuinely conflict: nudging
   * a graphic a grid step at a time wants the grid and not other objects, and
   * aligning a row of sponsor logos wants exactly the opposite. One switch
   * forces a designer to turn off the half that is helping them.
   *
   * All default on. A snap nobody asked for is easier to notice and turn off
   * than a snap nobody knew existed is to find.
   */
  readonly snapToGrid: boolean;
  readonly snapToObjects: boolean;
  readonly snapToSafeAreas: boolean;
  readonly snapToAngle: boolean;
  readonly snapToSize: boolean;
  /** World units between grid lines. */
  readonly gridStep: number;
  /** Degrees between rotation detents. */
  readonly angleStep: number;
  /**
   * Which transform the spatial gizmo is offering: move, rotate or scale.
   *
   * A preference rather than a per-selection state, because it is a TOOL — the
   * same distinction a paintbrush has from a canvas. Somebody positioning a set
   * spends an hour in Move and a designer angling a plinth spends it in Rotate,
   * and neither wants the choice reset by clicking a different object.
   */
  readonly gizmoMode: GizmoMode;

  /**
   * OAuth ids for the cloud providers.
   *
   * Kept in the workspace rather than in the source because registering the
   * application is the OWNER'S act, not the product's — a client id cannot be
   * invented in a file, and shipping a Connect button for an application that
   * does not exist would be a control that lies.
   */
  readonly driveClientId: string;
  readonly dropboxAppKey: string;
}

export const DEFAULT_WORKSPACE: Workspace = {
  theme: "dark",
  quality: "auto",
  renderer: "three",
  sound: false,
  section: "home",
  developerMode: false,
  depth: "beginner",
  // The free tier, pre-installed. A first-time user who has to install
  // something before they can evaluate anything has already been asked to do
  // work before seeing value.
  installedPacks: FREE_TIER,
  welcomed: false,
  leftWidth: 260,
  rightWidth: 300,
  bottomHeight: 220,
  leftOpen: true,
  rightOpen: true,
  // SUMMONED, not resident. Closed until somebody asks for it (⌥T).
  bottomOpen: false,
  bottomExpanded: ["timeline"],
  programOpen: false,
  timelineZoom: 1,
  showSafeAreas: true,
  showGrid: false,
  showGuides: true,
  showRulers: true,
  showDebug: false,
  snapEnabled: true,
  snapToGrid: true,
  snapToObjects: true,
  snapToSafeAreas: true,
  snapToAngle: true,
  snapToSize: true,
  gridStep: 0.5,
  angleStep: 15,
  gizmoMode: "move",
  driveClientId: "",
  dropboxAppKey: "",
};

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): WorkspaceStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    localStorage.getItem(KEY);
    return localStorage;
  } catch {
    return null;
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function sanitize(value: unknown): Workspace {
  if (value === null || typeof value !== "object") return DEFAULT_WORKSPACE;
  const raw = value as Record<string, unknown>;
  const bool = (key: keyof Workspace): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (DEFAULT_WORKSPACE[key] as boolean);

  const packs = Array.isArray(raw.installedPacks)
    ? (raw.installedPacks as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : DEFAULT_WORKSPACE.installedPacks;

  return {
    theme: raw.theme === "light" ? "light" : "dark",
    // An unknown renderer falls back to the default rather than throwing: a
    // corrupt preference must never leave the editor unable to draw.
    renderer: raw.renderer === "babylon" ? "babylon" : "three",
    quality:
      raw.quality === "low" || raw.quality === "mid" || raw.quality === "high"
        ? raw.quality
        : "auto",
    // Anything other than an explicit `true` is off. A corrupted preference
    // must never turn sound ON.
    sound: raw.sound === true,
    // A section that no longer exists, or the Developer section with the mode
    // off, both fall back to Home. Without the second check a stale preference
    // renders the Developer panel while the rail hides its entry — Developer
    // Mode replacing the normal interface, which it must never do.
    section:
      SECTIONS.some((entry) => entry.id === raw.section) &&
      !(raw.section === "developer" && bool("developerMode") === false)
        ? (raw.section as Section)
        : "home",
    developerMode: bool("developerMode"),
    // An unknown level falls back to beginner rather than to the deeper one:
    // a corrupt preference must never reveal more than the user chose. This
    // also catches the retired three-depth values — a stored "designer" or
    // "advanced" lands on beginner, and one ⌥E puts it back.
    depth: DEPTHS.includes(raw.depth as Depth) ? (raw.depth as Depth) : "beginner",
    // The free tier is always present, even if a stored list dropped it: a
    // corrupt preference must not take a user's starter content away.
    installedPacks: [...new Set([...FREE_TIER, ...packs])],
    welcomed: bool("welcomed"),
    // Clamped, so a corrupt width cannot render a panel that cannot be grabbed
    // to fix it — the failure mode where the only escape is clearing storage.
    leftWidth: clamp(raw.leftWidth, 180, 600, DEFAULT_WORKSPACE.leftWidth),
    rightWidth: clamp(raw.rightWidth, 220, 640, DEFAULT_WORKSPACE.rightWidth),
    bottomHeight: clamp(raw.bottomHeight, 120, 700, DEFAULT_WORKSPACE.bottomHeight),
    leftOpen: bool("leftOpen"),
    rightOpen: bool("rightOpen"),
    bottomOpen: bool("bottomOpen"),
    bottomExpanded: Array.isArray(raw.bottomExpanded)
      ? (raw.bottomExpanded as unknown[]).filter((value): value is BottomPanel =>
          BOTTOM_PANELS.includes(value as BottomPanel),
        )
      : DEFAULT_WORKSPACE.bottomExpanded,
    programOpen: bool("programOpen"),
    // Clamped like every other size: a zoom of zero divides by nothing and
    // renders a timeline with no width, which cannot be dragged back.
    timelineZoom: clamp(raw.timelineZoom, 0.1, 20, DEFAULT_WORKSPACE.timelineZoom),
    showSafeAreas: bool("showSafeAreas"),
    showGrid: bool("showGrid"),
    showGuides: bool("showGuides"),
    showRulers: bool("showRulers"),
    showDebug: bool("showDebug"),
    snapEnabled: bool("snapEnabled"),
    snapToGrid: bool("snapToGrid"),
    snapToObjects: bool("snapToObjects"),
    snapToSafeAreas: bool("snapToSafeAreas"),
    snapToAngle: bool("snapToAngle"),
    snapToSize: bool("snapToSize"),
    gridStep: clamp(raw.gridStep, 0.05, 5, DEFAULT_WORKSPACE.gridStep),
    // Clamped to angles that divide 90, so square stays reachable. A step of
    // 7° would make a right angle impossible to snap to, which is the one
    // angle that must never be approximate.
    angleStep: clamp(raw.angleStep, 1, 90, DEFAULT_WORKSPACE.angleStep),
    // An unknown mode lands on Move, which is the one that can undo the damage
    // any other mode could have done.
    gizmoMode:
      raw.gizmoMode === "rotate" || raw.gizmoMode === "scale" ? raw.gizmoMode : "move",
    driveClientId: typeof raw.driveClientId === "string" ? raw.driveClientId : "",
    dropboxAppKey: typeof raw.dropboxAppKey === "string" ? raw.dropboxAppKey : "",
  };
}

export function loadWorkspace(
  store: WorkspaceStorage | null = defaultStorage(),
): Workspace {
  if (store === null) return DEFAULT_WORKSPACE;
  try {
    const raw = store.getItem(KEY);
    return raw === null ? DEFAULT_WORKSPACE : sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function saveWorkspace(
  workspace: Workspace,
  store: WorkspaceStorage | null = defaultStorage(),
): void {
  try {
    store?.setItem(KEY, JSON.stringify(workspace));
  } catch {
    // A full store must not break the editor.
  }
}

export function resetWorkspace(store: WorkspaceStorage | null = defaultStorage()): void {
  store?.removeItem(KEY);
}
