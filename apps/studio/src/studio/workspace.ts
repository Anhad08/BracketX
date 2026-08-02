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
export const BOTTOM_TABS = ["timeline", "presets", "variables", "library"] as const;

export type BottomTab = (typeof BOTTOM_TABS)[number];

export interface Workspace {
  readonly theme: Theme;

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
  readonly bottomTab: BottomTab;
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
  /** World units between grid lines. */
  readonly gridStep: number;
}

export const DEFAULT_WORKSPACE: Workspace = {
  theme: "dark",
  section: "home",
  developerMode: false,
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
  bottomOpen: true,
  bottomTab: "timeline",
  programOpen: false,
  timelineZoom: 1,
  showSafeAreas: true,
  showGrid: false,
  showGuides: true,
  showRulers: true,
  showDebug: false,
  snapEnabled: true,
  gridStep: 0.5,
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
    section: SECTIONS.some((entry) => entry.id === raw.section)
      ? (raw.section as Section)
      : "home",
    developerMode: bool("developerMode"),
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
    bottomTab: BOTTOM_TABS.includes(raw.bottomTab as BottomTab)
      ? (raw.bottomTab as BottomTab)
      : "timeline",
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
    gridStep: clamp(raw.gridStep, 0.05, 5, DEFAULT_WORKSPACE.gridStep),
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
