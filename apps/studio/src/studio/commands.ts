/**
 * Commands and keys — one list, three surfaces.
 *
 * Every action Studio can perform is declared once. The palette searches it,
 * the keyboard dispatches from it, and the menus render it. The alternative — a
 * switch in a key handler plus a separate array for the palette — is how an
 * editor ends up with shortcuts nobody can discover and menu items that
 * silently stopped working.
 *
 * A consequence stated plainly, and asserted in the test suite: **an action
 * with no entry here does not exist.** A button that calls something directly
 * is unreachable from the keyboard and invisible to search.
 */

export type CommandSection =
  | "File"
  | "Edit"
  | "Create"
  | "Arrange"
  | "Motion"
  | "Select"
  | "View"
  | "Transport"
  | "Program"
  | "Help";

export interface StudioCommand {
  readonly id: string;
  readonly title: string;
  readonly section: CommandSection;
  readonly hint?: string;
  /** Display only; the binding itself lives in KEYMAP. */
  readonly shortcut?: string;
  readonly keywords?: readonly string[];
  /** False greys it in the palette rather than hiding it — absence is confusing. */
  readonly enabled?: boolean;
  readonly run: () => void;
}

export interface KeyBinding {
  readonly id: string;
  /** Matched against `KeyboardEvent.key`, lowercased. */
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly label: string;
  readonly description: string;
  /** Allowed while a text field has focus. Almost nothing should be. */
  readonly whileTyping?: boolean;
}

/**
 * The keymap.
 *
 * Chosen against what an editor user already has in their fingers — ⌘Z, ⌘S,
 * ⌘D, Delete, F to frame, Space to play, arrows to nudge. Inventing a scheme
 * would cost every designer a week of misfires for nothing.
 */
export const KEYMAP: readonly KeyBinding[] = [
  { id: "palette.open", key: "k", mod: true, label: "Ctrl/⌘ K", description: "Command palette", whileTyping: true },
  { id: "file.new", key: "n", mod: true, alt: true, label: "Ctrl/⌘ ⌥ N", description: "New scene" },
  { id: "file.open", key: "o", mod: true, label: "Ctrl/⌘ O", description: "Open scene" },
  { id: "file.save", key: "s", mod: true, label: "Ctrl/⌘ S", description: "Save" },
  { id: "file.saveAs", key: "s", mod: true, shift: true, label: "Ctrl/⌘ ⇧ S", description: "Save as" },
  { id: "edit.undo", key: "z", mod: true, label: "Ctrl/⌘ Z", description: "Undo" },
  { id: "edit.redo", key: "z", mod: true, shift: true, label: "Ctrl/⌘ ⇧ Z", description: "Redo" },
  { id: "edit.duplicate", key: "d", mod: true, label: "Ctrl/⌘ D", description: "Duplicate" },
  { id: "edit.delete", key: "delete", label: "Delete", description: "Delete selection" },
  { id: "edit.deleteBack", key: "backspace", label: "Backspace", description: "Delete selection" },
  { id: "edit.rename", key: "f2", label: "F2", description: "Rename" },
  // Arrange. ⌘G / ⌘⇧G for group and ungroup, and bracket keys for layer order,
  // because that is what a designer's hands already do in every other tool.
  { id: "arrange.group", key: "g", mod: true, label: "Ctrl/⌘ G", description: "Group selection" },
  { id: "arrange.ungroup", key: "g", mod: true, shift: true, label: "Ctrl/⌘ ⇧ G", description: "Ungroup" },
  { id: "arrange.front", key: "]", mod: true, shift: true, label: "Ctrl/⌘ ⇧ ]", description: "Bring to front" },
  { id: "arrange.forward", key: "]", mod: true, label: "Ctrl/⌘ ]", description: "Bring forward" },
  { id: "arrange.backward", key: "[", mod: true, label: "Ctrl/⌘ [", description: "Send backward" },
  { id: "arrange.back", key: "[", mod: true, shift: true, label: "Ctrl/⌘ ⇧ [", description: "Send to back" },
  { id: "select.all", key: "a", mod: true, label: "Ctrl/⌘ A", description: "Select all" },
  { id: "select.none", key: "escape", label: "Esc", description: "Deselect", whileTyping: true },
  { id: "select.up", key: "arrowup", label: "↑", description: "Select previous node" },
  { id: "select.down", key: "arrowdown", label: "↓", description: "Select next node" },
  { id: "view.fit", key: "f", label: "F", description: "Fit scene in view" },
  { id: "view.zoomIn", key: "=", label: "=", description: "Zoom in" },
  { id: "view.zoomOut", key: "-", label: "-", description: "Zoom out" },
  { id: "view.actualSize", key: "0", label: "0", description: "Zoom to 100%" },
  { id: "view.safeAreas", key: "'", label: "'", description: "Toggle safe areas" },
  { id: "view.grid", key: "\\", label: "\\", description: "Toggle grid" },
  { id: "view.snap", key: ";", label: ";", description: "Toggle snapping" },
  { id: "view.debug", key: "g", shift: true, label: "Shift G", description: "Toggle debug overlay" },
  { id: "transport.toggle", key: " ", label: "Space", description: "Play / pause" },
  { id: "transport.stepForward", key: ".", label: ".", description: "Step one frame" },
  { id: "transport.stepBack", key: ",", label: ",", description: "Step back one frame" },
  { id: "transport.stop", key: "home", label: "Home", description: "Stop and rewind" },
  { id: "help.keys", key: "?", shift: true, label: "?", description: "Keyboard reference" },
];

export function matchBinding(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  typing: boolean,
): KeyBinding | null {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  for (const binding of KEYMAP) {
    if (binding.key !== key) continue;
    if ((binding.mod ?? false) !== mod) continue;
    if ((binding.shift ?? false) !== event.shiftKey) continue;
    if ((binding.alt ?? false) !== event.altKey) continue;
    if (typing && binding.whileTyping !== true) continue;
    return binding;
  }
  return null;
}

export function shortcutFor(id: string): string | undefined {
  return KEYMAP.find((binding) => binding.id === id)?.label;
}

// ---------------------------------------------------------------------------
// Fuzzy search
// ---------------------------------------------------------------------------

/**
 * Subsequence matching with position bonuses.
 *
 * `includes()` is one line and it is why people stop using search boxes: a
 * designer looking for "Save as" types "sa" and a substring match returns
 * "Toggle safe areas" first. Consecutive runs and word boundaries score higher,
 * shorter candidates win ties.
 */
export function score(needle: string, candidate: string): number | null {
  if (needle.length === 0) return 0;
  const lowerNeedle = needle.toLowerCase();
  const lowerCandidate = candidate.toLowerCase();

  let total = 0;
  let cursor = 0;
  let previous = -2;

  for (const character of lowerNeedle) {
    if (character === " ") continue;
    const found = lowerCandidate.indexOf(character, cursor);
    if (found === -1) return null;
    total += 1;
    if (found === previous + 1) total += 8;
    if (found === 0 || /[\s_.\-/]/.test(candidate[found - 1] ?? "")) total += 10;
    total -= Math.min(found - cursor, 6);
    previous = found;
    cursor = found + 1;
  }

  total -= candidate.length * 0.05;
  if (lowerCandidate.startsWith(lowerNeedle)) total += 20;
  if (lowerCandidate === lowerNeedle) total += 40;
  return total;
}

export function searchCommands(
  commands: readonly StudioCommand[],
  query: string,
  limit = 30,
): readonly StudioCommand[] {
  if (query.trim().length === 0) return commands.slice(0, limit);

  const ranked: { command: StudioCommand; value: number }[] = [];
  for (const command of commands) {
    let best: number | null = null;
    for (const field of [command.title, command.section, ...(command.keywords ?? [])]) {
      const value = score(query, field);
      if (value !== null && (best === null || value > best)) best = value;
    }
    if (best !== null) ranked.push({ command, value: best });
  }
  ranked.sort((a, b) => b.value - a.value);
  return ranked.slice(0, limit).map((entry) => entry.command);
}
