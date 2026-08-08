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
  /**
   * This binding SHARES its chord with a later one and is resolved by state.
   *
   * Declared rather than inferred, because a duplicate chord is normally a bug
   * — one of the two shortcuts silently never fires — and the test suite
   * refuses them. This marks the one case where two bindings legitimately want
   * the same key and only one can apply at a time, and it obliges the pair: a
   * contested binding must sit ABOVE an uncontested fallback on the same
   * chord, so the key always does something.
   *
   * `matchBinding`'s `available` callback is what picks between them.
   */
  readonly contested?: boolean;
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
  // ==========================================================================
  // THE THREE TRANSFORMS
  // ==========================================================================
  // G, R, S — unmodified, and taken from Blender because a 3D product's first
  // three keys are the three a 3D person's hand already knows. All three were
  // free: only the modified variants were spoken for (⌘G groups, ⇧G is the
  // debug overlay, ⌘S saves), which is why no existing binding moves.
  { id: "gizmo.move", key: "g", label: "G", description: "Move — slide along an axis" },
  { id: "gizmo.rotate", key: "r", label: "R", description: "Rotate — turn about an axis" },
  { id: "gizmo.scale", key: "s", label: "S", description: "Scale — stretch along an axis" },
  { id: "select.all", key: "a", mod: true, label: "Ctrl/⌘ A", description: "Select all" },
  // AHEAD of `select.none`, and only available while something is armed. Esc
  // means "back out of where I am", and being armed to transmit outranks
  // having a layer selected. See `matchBinding`.
  { id: "air.uncue", key: "escape", label: "Esc", description: "Un-cue", contested: true },
  { id: "select.none", key: "escape", label: "Esc", description: "Deselect", whileTyping: true },
  { id: "select.up", key: "arrowup", label: "↑", description: "Select previous node" },
  { id: "select.down", key: "arrowdown", label: "↓", description: "Select next node" },
  { id: "view.fit", key: "f", label: "F", description: "Fit scene in view" },
  // Shift+F rather than F. F is an approved binding for "fit scene in view"
  // and reassigning it would change a decision this sprint has no authority
  // to change, however much other editors use F for framing a selection.
  { id: "view.frameSelected", key: "f", shift: true, label: "Shift F", description: "Frame selection" },
  { id: "view.zoomIn", key: "=", label: "=", description: "Zoom in" },
  { id: "view.zoomOut", key: "-", label: "-", description: "Zoom out" },
  { id: "view.actualSize", key: "0", label: "0", description: "Zoom to 100%" },

  /**
   * CAMERA PRESETS. `studio-specification.html` §03 — six, ⌥1–⌥6, set with
   * ⌥⇧1–⌥⇧6.
   *
   * Generated so the pair can never drift apart: a recall binding with no
   * matching store binding is a preset a designer can reach and never fill.
   */
  ...Array.from({ length: 6 }, (_, index) => index + 1).flatMap((slot) => [
    {
      id: `view.recall${slot}`,
      key: String(slot),
      code: `Digit${slot}`,
      alt: true,
      label: `⌥${slot}`,
      description: `Camera ${slot}`,
    },
    {
      id: `view.store${slot}`,
      key: String(slot),
      code: `Digit${slot}`,
      alt: true,
      shift: true,
      label: `⌥⇧${slot}`,
      description: `Set camera ${slot}`,
    },
  ]),
  { id: "view.safeAreas", key: "'", label: "'", description: "Toggle safe areas" },
  { id: "view.grid", key: "\\", label: "\\", description: "Toggle grid" },
  { id: "view.snap", key: ";", label: ";", description: "Toggle snapping" },
  { id: "view.debug", key: "g", shift: true, label: "Shift G", description: "Toggle debug overlay" },
  { id: "transport.toggle", key: " ", label: "Space", description: "Play / pause" },
  { id: "transport.stepForward", key: ".", label: ".", description: "Step one frame" },
  { id: "transport.stepBack", key: ",", label: ",", description: "Step back one frame" },
  { id: "transport.stop", key: "home", label: "Home", description: "Stop and rewind" },
  // ==========================================================================
  // AIR
  // ==========================================================================
  // The prototype binds Cue to SPACE — and, in the same transport, labels the
  // Play control "SPC". Its key handler cues; its button says play. Both are
  // the specimen, and they disagree, exactly as Volume One §4 disagrees with
  // itself about `offair`'s length.
  //
  // Space stays PLAY here. It is the universal editor binding, it is already
  // approved in the keymap above, and Studio — unlike a three-field prototype
  // — has a timeline that somebody scrubs all day. Cue takes `C`, which is
  // free, is the letter of the word, and is what a gallery panel is labelled.
  //
  // This is flagged rather than buried, so that the day the prototype resolves
  // its own contradiction, the code is found.
  { id: "air.cue", key: "c", label: "C", description: "Cue — arm for the next take" },
  // ==========================================================================
  // THE TWO LEVELS
  // ==========================================================================
  // One key, BOTH directions. A toggle you can only travel one way along is
  // how somebody ends up at a depth they did not choose and cannot leave.
  // `whileTyping`, because the prototype allows it and it is safe: changing
  // what is revealed cannot lose a keystroke.
  { id: "view.expert", key: "e", alt: true, label: "⌥E", description: "Show how it is built", whileTyping: true },
  { id: "view.timeline", key: "t", alt: true, label: "⌥T", description: "Summon the timeline" },
  { id: "help.keys", key: "?", shift: true, label: "?", description: "Keyboard reference" },
];

/**
 * The binding a keystroke fires.
 *
 * ============================================================================
 * ONE KEY, TWO CLAIMS
 * ============================================================================
 * Escape means "back out of where I am", and there is more than one place to
 * back out of: a selection, and an armed cue. Both are correct uses of the key
 * and only one can win at a time — which one depends on the state, not on the
 * keystroke.
 *
 * `available` is how a caller says which. It is asked ONLY for bindings whose
 * key already matched, so it is not a filter over the keymap; it is the tie
 * break between two bindings that both want the same key, resolved in KEYMAP
 * order. Without it, `air.uncue` sits behind `select.none` in the list and
 * never fires at all — the shortcut would exist, be documented, and do
 * nothing, which is worse than not having it.
 */
export function matchBinding(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  typing: boolean,
  available?: (id: string) => boolean,
): KeyBinding | null {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  for (const binding of KEYMAP) {
    if (binding.key !== key) continue;
    if ((binding.mod ?? false) !== mod) continue;
    if ((binding.shift ?? false) !== event.shiftKey) continue;
    if ((binding.alt ?? false) !== event.altKey) continue;
    if (typing && binding.whileTyping !== true) continue;
    if (available !== undefined && !available(binding.id)) continue;
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
