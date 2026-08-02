/**
 * The command palette and the keymap.
 *
 * ============================================================================
 * ONE LIST, TWO SURFACES
 * ============================================================================
 * Every action the workbench can perform is declared once, here, and both the
 * palette and the keyboard read from that list. The alternative — a switch in a
 * key handler and a separate array for the palette — is how tools end up with
 * shortcuts nobody can discover and palette entries that silently stop working.
 *
 * A consequence worth stating: an action without a palette entry does not
 * exist. If a future tool adds a button and no action, it is undiscoverable by
 * search and unreachable from the keyboard, and the audit test in the suite
 * fails on it.
 */
import type { ShowcaseScene } from "../registry";
import { rank, type Ranked } from "./search";

export type PaletteSection =
  | "Scene"
  | "Tool"
  | "Transport"
  | "Inspect"
  | "Capture"
  | "Layers"
  | "Workspace";

export interface PaletteAction {
  readonly id: string;
  readonly title: string;
  readonly section: PaletteSection;
  /** Secondary line: what it does, or the current value. */
  readonly hint?: string;
  /** Rendered chord, e.g. "⌘K" — display only; binding lives in KEYMAP. */
  readonly shortcut?: string;
  readonly keywords?: readonly string[];
  readonly run: () => void;
}

/**
 * A key binding.
 *
 * `key` is matched against `KeyboardEvent.key`, lowercased. Modifiers are
 * explicit rather than encoded in a string so the matcher cannot silently
 * disagree with the label a user reads.
 */
export interface KeyBinding {
  readonly id: string;
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly label: string;
  readonly description: string;
  /** Allowed while a text field has focus. Almost nothing should be. */
  readonly whileTyping?: boolean;
}

/**
 * Every binding, in the order the help sheet shows them.
 *
 * Chosen against the tools engineers already have in their fingers: ⌘K for a
 * palette, ⌘F for find, `.` and `,` for frame stepping (After Effects, Resolve,
 * Premiere all step with the bracket-adjacent keys and every NLE uses a pair),
 * space for transport. Inventing a novel scheme would cost every new engineer a
 * week of misfires for no benefit.
 */
export const KEYMAP: readonly KeyBinding[] = [
  { id: "palette.open", key: "k", mod: true, label: "Ctrl/⌘ K", description: "Command palette", whileTyping: true },
  { id: "palette.scenes", key: "p", mod: true, label: "Ctrl/⌘ P", description: "Go to scene", whileTyping: true },
  { id: "search.nodes", key: "f", mod: true, label: "Ctrl/⌘ F", description: "Find node in scene graph", whileTyping: true },
  { id: "transport.toggle", key: " ", label: "Space", description: "Play / pause" },
  { id: "transport.stepForward", key: ".", label: ".", description: "Step one frame" },
  { id: "transport.stepBack", key: ",", label: ",", description: "Step back one frame" },
  { id: "transport.stepForwardTen", key: ".", shift: true, label: "Shift .", description: "Step ten frames" },
  { id: "transport.restart", key: "r", label: "R", description: "Seek to frame 0" },
  { id: "scene.previous", key: "[", label: "[", description: "Previous scene" },
  { id: "scene.next", key: "]", label: "]", description: "Next scene" },
  { id: "workbench.toggle", key: "\\", label: "\\", description: "Show / hide workbench" },
  { id: "perf.baseline", key: "b", label: "B", description: "Capture performance baseline" },
  { id: "capture.screenshot", key: "s", shift: true, label: "Shift S", description: "Capture screenshot" },
  { id: "capture.snapshot", key: "d", shift: true, label: "Shift D", description: "Capture session snapshot for diffing" },
  { id: "help.keys", key: "?", shift: true, label: "?", description: "Keyboard reference" },
  { id: "ui.escape", key: "escape", label: "Esc", description: "Close overlay", whileTyping: true },
];

/** Tool tabs are 1..9. Declared separately because the count is data. */
export const TOOL_DIGIT_KEYS = "123456789";

export function matchBinding(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  typing: boolean,
): KeyBinding | null {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  for (const binding of KEYMAP) {
    if (binding.key !== key) continue;
    if ((binding.mod ?? false) !== mod) continue;
    if ((binding.shift ?? false) !== event.shiftKey) continue;
    if (typing && binding.whileTyping !== true) continue;
    return binding;
  }
  return null;
}

export function shortcutFor(id: string): string | undefined {
  return KEYMAP.find((binding) => binding.id === id)?.label;
}

export interface PaletteContext {
  readonly scenes: readonly ShowcaseScene[];
  readonly currentSceneId: string | null;
  readonly tools: readonly { id: string; label: string }[];
  readonly recentSceneIds: readonly string[];
  readonly playing: boolean;

  readonly goToScene: (id: string) => void;
  readonly openTool: (id: string) => void;
  readonly toggleTransport: () => void;
  readonly step: (frames: number) => void;
  readonly restart: () => void;
  readonly captureBaseline: () => void;
  readonly captureSnapshot: () => void;
  readonly screenshot: () => void;
  readonly toggleLayer: (layer: string) => void;
  readonly toggleWorkbench: () => void;
  readonly resetWorkspace: () => void;
  readonly showKeys: () => void;
}

/**
 * The palette's contents for the current context.
 *
 * Recently-viewed scenes are listed first inside their section. It is a small
 * thing and it is the difference between "type three letters" and "read a list
 * of twelve": the scene an engineer wants next is nearly always one of the two
 * they were just in.
 */
export function buildPalette(context: PaletteContext): readonly PaletteAction[] {
  const out: PaletteAction[] = [];

  const recentRank = new Map(context.recentSceneIds.map((id, index) => [id, index]));
  const scenes = [...context.scenes].sort((a, b) => {
    const left = recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  for (const scene of scenes) {
    out.push({
      id: `scene.${scene.id}`,
      title: scene.title,
      section: "Scene",
      hint:
        scene.id === context.currentSceneId
          ? "current"
          : recentRank.has(scene.id)
            ? `recent · ${scene.capability}`
            : scene.capability,
      keywords: [scene.id, scene.group, scene.capability, ...(scene.keywords ?? [])],
      run: () => context.goToScene(scene.id),
    });
  }

  for (const tool of context.tools) {
    out.push({
      id: `tool.${tool.id}`,
      title: `Open ${tool.label}`,
      section: "Tool",
      keywords: [tool.id, "panel", "workbench"],
      run: () => context.openTool(tool.id),
    });
  }

  out.push(
    {
      id: "transport.toggle",
      title: context.playing ? "Pause" : "Play",
      section: "Transport",
      shortcut: shortcutFor("transport.toggle"),
      keywords: ["clock", "playback"],
      run: context.toggleTransport,
    },
    {
      id: "transport.stepForward",
      title: "Step one frame",
      section: "Transport",
      shortcut: shortcutFor("transport.stepForward"),
      hint: "Pauses the clock first, so the frame you inspect is the frame you named",
      keywords: ["advance", "frame"],
      run: () => context.step(1),
    },
    {
      id: "transport.stepBack",
      title: "Step back one frame",
      section: "Transport",
      shortcut: shortcutFor("transport.stepBack"),
      keywords: ["reverse", "frame"],
      run: () => context.step(-1),
    },
    {
      id: "transport.stepForwardTen",
      title: "Step ten frames",
      section: "Transport",
      shortcut: shortcutFor("transport.stepForwardTen"),
      run: () => context.step(10),
    },
    {
      id: "transport.restart",
      title: "Seek to frame 0",
      section: "Transport",
      shortcut: shortcutFor("transport.restart"),
      keywords: ["rewind", "start"],
      run: context.restart,
    },
    {
      id: "perf.baseline",
      title: "Capture performance baseline",
      section: "Capture",
      shortcut: shortcutFor("perf.baseline"),
      hint: "Everything after this is compared against it",
      keywords: ["regression", "compare", "benchmark"],
      run: context.captureBaseline,
    },
    {
      id: "capture.snapshot",
      title: "Capture session snapshot",
      section: "Capture",
      shortcut: shortcutFor("capture.snapshot"),
      hint: "For diffing against a later state",
      keywords: ["diff", "state", "compare"],
      run: context.captureSnapshot,
    },
    {
      id: "capture.screenshot",
      title: "Capture screenshot",
      section: "Capture",
      shortcut: shortcutFor("capture.screenshot"),
      keywords: ["png", "image", "reference"],
      run: context.screenshot,
    },
    {
      id: "workbench.toggle",
      title: "Show / hide workbench",
      section: "Workspace",
      shortcut: shortcutFor("workbench.toggle"),
      run: context.toggleWorkbench,
    },
    {
      id: "workspace.reset",
      title: "Reset workspace",
      section: "Workspace",
      hint: "Clears panel sizes, pins, and watches",
      keywords: ["defaults", "clear"],
      run: context.resetWorkspace,
    },
    {
      id: "help.keys",
      title: "Keyboard reference",
      section: "Workspace",
      shortcut: shortcutFor("help.keys"),
      keywords: ["shortcuts", "bindings", "help"],
      run: context.showKeys,
    },
  );

  for (const layer of ["bounds", "layout", "anchors", "origins"]) {
    out.push({
      id: `layer.${layer}`,
      title: `Toggle ${layer} overlay`,
      section: "Layers",
      keywords: ["debug", "draw", "overlay"],
      run: () => context.toggleLayer(layer),
    });
  }

  return out;
}

/** Ranked palette results. Empty query keeps declaration order. */
export function searchActions(
  actions: readonly PaletteAction[],
  query: string,
  limit = 20,
): readonly Ranked<PaletteAction>[] {
  if (query.trim().length === 0) {
    return actions.slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  }
  return rank(
    actions,
    query,
    (action) => [action.title, action.section, ...(action.keywords ?? [])],
    limit,
  );
}
