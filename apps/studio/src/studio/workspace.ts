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

const KEY = "streamatrix.studio.workspace.v1";

export type Theme = "dark" | "light";

export type BottomTab = "timeline" | "variables";

export interface Workspace {
  readonly theme: Theme;

  /** Panel sizes, in pixels / viewport percent. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly bottomHeight: number;

  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
  readonly bottomOpen: boolean;
  readonly bottomTab: BottomTab;

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
  leftWidth: 260,
  rightWidth: 300,
  bottomHeight: 220,
  leftOpen: true,
  rightOpen: true,
  bottomOpen: true,
  bottomTab: "timeline",
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

  return {
    theme: raw.theme === "light" ? "light" : "dark",
    // Clamped, so a corrupt width cannot render a panel that cannot be grabbed
    // to fix it — the failure mode where the only escape is clearing storage.
    leftWidth: clamp(raw.leftWidth, 180, 600, DEFAULT_WORKSPACE.leftWidth),
    rightWidth: clamp(raw.rightWidth, 220, 640, DEFAULT_WORKSPACE.rightWidth),
    bottomHeight: clamp(raw.bottomHeight, 120, 700, DEFAULT_WORKSPACE.bottomHeight),
    leftOpen: bool("leftOpen"),
    rightOpen: bool("rightOpen"),
    bottomOpen: bool("bottomOpen"),
    bottomTab: raw.bottomTab === "variables" ? "variables" : "timeline",
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
