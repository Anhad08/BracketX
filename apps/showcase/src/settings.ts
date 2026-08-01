/**
 * Persistent developer settings.
 *
 * Which overlays are open, whether the clock auto-plays, the preferred output
 * size. Small things, but a tool that forgets them is a tool that gets closed:
 * an engineer debugging a frame-timing problem should not re-enable the
 * performance overlay every time they reload.
 *
 * Versioned, so a settings shape change does not resurrect stale keys. A
 * corrupt or unreadable store falls back to defaults rather than throwing —
 * localStorage is unavailable in private modes and absent in tests, and a
 * developer tool that will not start because it cannot remember a checkbox is
 * worse than one that forgets.
 */

const STORAGE_KEY = "bracketx.showcase.settings.v1";

export interface ShowcaseSettings {
  readonly developerOverlay: boolean;
  readonly performanceOverlay: boolean;
  /** Advance the clock on load. Off is useful for frame-exact inspection. */
  readonly autoPlay: boolean;
  /** Bind a second, lower-cadence output to exercise the multi-output path. */
  readonly previewOutput: boolean;
  /** Scale the canvas to the pane. Off renders at the document's own size. */
  readonly fitCanvas: boolean;
  readonly lastSceneId: string | null;
}

export const DEFAULT_SETTINGS: ShowcaseSettings = {
  developerOverlay: true,
  performanceOverlay: true,
  autoPlay: true,
  previewOutput: false,
  fitCanvas: true,
  lastSceneId: null,
};

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

/** Keeps only known keys, so a stale or hostile store cannot inject fields. */
function sanitize(value: unknown): ShowcaseSettings {
  if (value === null || typeof value !== "object") return DEFAULT_SETTINGS;
  const raw = value as Record<string, unknown>;

  const bool = (key: keyof ShowcaseSettings, fallback: boolean): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;

  return {
    developerOverlay: bool("developerOverlay", DEFAULT_SETTINGS.developerOverlay),
    performanceOverlay: bool("performanceOverlay", DEFAULT_SETTINGS.performanceOverlay),
    autoPlay: bool("autoPlay", DEFAULT_SETTINGS.autoPlay),
    previewOutput: bool("previewOutput", DEFAULT_SETTINGS.previewOutput),
    fitCanvas: bool("fitCanvas", DEFAULT_SETTINGS.fitCanvas),
    lastSceneId:
      typeof raw.lastSceneId === "string" ? raw.lastSceneId : null,
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
