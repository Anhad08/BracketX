import { useEffect, useMemo, useRef, useState } from "react";

import { KEYMAP, searchActions, type PaletteAction } from "../tools/palette";

/**
 * The command palette.
 *
 * ============================================================================
 * WHY THIS IS THE HIGHEST-VALUE THING IN V3
 * ============================================================================
 * Every other feature here saves an engineer time once they know where to look.
 * The palette is what removes "where do I look" — one chord reaches every
 * scene, every tool, and every action, ranked by what they typed.
 *
 * It is also the discoverability mechanism. A workbench with twelve scenes and
 * eight tools has more surface than anyone will read documentation for; a
 * palette turns that surface into something you find by guessing at it, which
 * is how people actually learn tools.
 *
 * Keyboard-only by construction: it opens on a chord, filters as you type,
 * moves with the arrows, runs on Enter, closes on Escape. A palette that needs
 * the mouse has missed the point.
 */
export function CommandPalette({
  actions,
  onClose,
}: {
  actions: readonly PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchActions(actions, query, 40), [actions, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const run = (index: number) => {
    const action = results[index]?.item;
    if (action === undefined) return;
    // Close FIRST. An action that navigates would otherwise leave the palette
    // rendered over the thing it just opened.
    onClose();
    action.run();
  };

  return (
    <div className="palette-scrim" onMouseDown={onClose} data-testid="palette">
      <div
        className="palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Go to a scene, open a tool, run an action…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(cursor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          aria-label="Command"
        />

        <ol className="palette-results">
          {results.length === 0 ? (
            <li className="dim pad">Nothing matches.</li>
          ) : (
            results.map(({ item }, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={index === cursor ? "on" : ""}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(index)}
                >
                  <span className="palette-section">{item.section}</span>
                  <span className="palette-title">{item.title}</span>
                  {item.hint !== undefined ? (
                    <span className="palette-hint">{item.hint}</span>
                  ) : null}
                  {item.shortcut !== undefined ? (
                    <kbd className="palette-key">{item.shortcut}</kbd>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}

/**
 * The keyboard reference.
 *
 * Generated from KEYMAP rather than written by hand, so it cannot drift from
 * the bindings. A shortcut sheet that lies is worse than no sheet.
 */
export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="palette-scrim" onMouseDown={onClose} data-testid="keyboard-help">
      <div
        className="palette keys"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Keyboard reference"
      >
        <h3>Keyboard</h3>
        <dl className="keymap">
          {KEYMAP.map((binding) => (
            <div key={binding.id} className="pair">
              <dt>
                <kbd>{binding.label}</kbd>
              </dt>
              <dd>{binding.description}</dd>
            </div>
          ))}
          <div className="pair">
            <dt>
              <kbd>1</kbd>…<kbd>8</kbd>
            </dt>
            <dd>Switch workbench tool</dd>
          </div>
        </dl>
        <p className="note">
          Generated from the keymap, so it cannot disagree with what the keys actually do.
        </p>
      </div>
    </div>
  );
}
