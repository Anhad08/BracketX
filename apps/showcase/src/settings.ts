/**
 * Persistent workspace.
 *
 * Which overlays are open, which tool was in front, what was pinned, what was
 * being watched, where the panel divider sat. Small things, and together they
 * are the difference between a tool that is picked up and one that is closed:
 * an engineer who has to re-pin four nodes and re-enable the performance
 * overlay after every reload will stop reloading, which means they stop using
 * the tool.
 *
 * Versioned, so a shape change does not resurrect stale keys. A corrupt or
 * unreadable store falls back to defaults rather than throwing — localStorage
 * is unavailable in private modes and absent in tests, and a developer tool
 * that will not start because it cannot remember a checkbox is worse than one
 * that forgets.
 */
import type { StressConfig } from "./tools/stress";

/**
 * v2. The v1 key is deliberately NOT migrated.
 *
 * A migration would be maybe forty lines to preserve five booleans that take
 * two seconds to set again. Carrying a migration path for a debugging tool's
 * checkbox state is technical debt bought for nothing.
 */
const STORAGE_KEY = "bracketx.workbench.v2";

export interface ShowcaseSettings {
  readonly developerOverlay: boolean;
  readonly performanceOverlay: boolean;
  readonly alertsOverlay: boolean;
  /** Advance the clock on load. Off is useful for frame-exact inspection. */
  readonly autoPlay: boolean;
  /** Bind a second, lower-cadence output to exercise the multi-output path. */
  readonly previewOutput: boolean;
  /** Scale the canvas to the pane. Off renders at the document's own size. */
  readonly fitCanvas: boolean;
  readonly lastSceneId: string | null;

  // --- Workspace ---------------------------------------------------------
  readonly tool: string;
  readonly workbenchOpen: boolean;
  /** Workbench height as a percentage of the viewport. */
  readonly workbenchSize: number;
  /** Most recent first, capped. Feeds the palette's ordering. */
  readonly recentSceneIds: readonly string[];
  /** Node ids kept in view across scenes and reloads. */
  readonly pinnedNodeIds: readonly string[];
  /** Variable keys in the watch window. */
  readonly watchedKeys: readonly string[];
  readonly layers: Readonly<Record<string, boolean>>;
  readonly savedStress: readonly StressConfig[];
}

export const DEFAULT_SETTINGS: ShowcaseSettings = {
  developerOverlay: true,
  performanceOverlay: true,
  alertsOverlay: true,
  autoPlay: true,
  previewOutput: false,
  fitCanvas: true,
  lastSceneId: null,

  tool: "inspector",
  workbenchOpen: true,
  workbenchSize: 42,
  recentSceneIds: [],
  pinnedNodeIds: [],
  watchedKeys: [],
  layers: { bounds: false, layout: false, anchors: false, origins: false },
  savedStress: [],
};

const RECENT_LIMIT = 8;
const PIN_LIMIT = 32;
const WATCH_LIMIT = 32;

/**
 * The slice of Storage this module uses.
 *
 * Injectable so the store can be verified without a browser. Node has no
 * localStorage, which is a real case rather than a testing inconvenience —
 * the same absence happens in a locked-down browser.
 */
export type SettingsStorage = Pick<
  globalThis.Storage,
  "getItem" | "setItem" | "removeItem"
>;

function defaultStorage(): SettingsStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Touching it is the only reliable availability check: it exists and
    // throws on access in some private-browsing modes.
    localStorage.getItem(STORAGE_KEY);
    return localStorage;
  } catch {
    return null;
  }
}

function stringList(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, limit);
}

/** Keeps only known keys, so a stale or hostile store cannot inject fields. */
function sanitize(value: unknown): ShowcaseSettings {
  if (value === null || typeof value !== "object") return DEFAULT_SETTINGS;
  const raw = value as Record<string, unknown>;

  const bool = (key: keyof ShowcaseSettings, fallback: boolean): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;

  const layers: Record<string, boolean> = { ...DEFAULT_SETTINGS.layers };
  if (raw.layers !== null && typeof raw.layers === "object") {
    for (const [key, entry] of Object.entries(raw.layers as Record<string, unknown>)) {
      if (key in layers && typeof entry === "boolean") layers[key] = entry;
    }
  }

  const savedStress = Array.isArray(raw.savedStress)
    ? (raw.savedStress.filter(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          typeof (entry as StressConfig).id === "string",
      ) as StressConfig[]).slice(0, 20)
    : [];

  return {
    developerOverlay: bool("developerOverlay", DEFAULT_SETTINGS.developerOverlay),
    performanceOverlay: bool("performanceOverlay", DEFAULT_SETTINGS.performanceOverlay),
    alertsOverlay: bool("alertsOverlay", DEFAULT_SETTINGS.alertsOverlay),
    autoPlay: bool("autoPlay", DEFAULT_SETTINGS.autoPlay),
    previewOutput: bool("previewOutput", DEFAULT_SETTINGS.previewOutput),
    fitCanvas: bool("fitCanvas", DEFAULT_SETTINGS.fitCanvas),
    lastSceneId: typeof raw.lastSceneId === "string" ? raw.lastSceneId : null,

    tool: typeof raw.tool === "string" ? raw.tool : DEFAULT_SETTINGS.tool,
    workbenchOpen: bool("workbenchOpen", DEFAULT_SETTINGS.workbenchOpen),
    workbenchSize:
      typeof raw.workbenchSize === "number" && Number.isFinite(raw.workbenchSize)
        ? Math.min(80, Math.max(15, raw.workbenchSize))
        : DEFAULT_SETTINGS.workbenchSize,
    recentSceneIds: stringList(raw.recentSceneIds, RECENT_LIMIT),
    pinnedNodeIds: stringList(raw.pinnedNodeIds, PIN_LIMIT),
    watchedKeys: stringList(raw.watchedKeys, WATCH_LIMIT),
    layers,
    savedStress,
  };
}

export function loadSettings(
  store: SettingsStorage | null = defaultStorage(),
): ShowcaseSettings {
  if (store === null) return DEFAULT_SETTINGS;
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_SETTINGS : sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(
  settings: ShowcaseSettings,
  store: SettingsStorage | null = defaultStorage(),
): void {
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or unavailable store must not break the tool.
  }
}

export function clearSettings(
  store: SettingsStorage | null = defaultStorage(),
): void {
  store?.removeItem(STORAGE_KEY);
}

/** Most-recent-first, deduplicated, capped. */
export function pushRecent(
  recent: readonly string[],
  id: string,
): readonly string[] {
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
}

/** Adds or removes an id, keeping order stable so pins do not jump around. */
export function toggleInList(
  list: readonly string[],
  value: string,
  limit = PIN_LIMIT,
): readonly string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value].slice(-limit);
}
