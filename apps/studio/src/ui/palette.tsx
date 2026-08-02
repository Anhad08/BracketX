import { useEffect, useMemo, useRef, useState } from "react";

import { KEYMAP, searchCommands, type StudioCommand } from "../studio/commands";

/**
 * The command palette.
 *
 * One chord reaches every action Studio has. It is also the discoverability
 * mechanism: an editor with this much surface has more than anyone reads
 * documentation for, and a palette turns that surface into something you find
 * by guessing at it.
 *
 * Keyboard-only by construction — opens on a chord, filters as you type, moves
 * with the arrows, runs on Enter, closes on Escape. A palette that needs the
 * mouse has missed the point.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly StudioCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchCommands(commands, query, 40), [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const run = (index: number) => {
    const command = results[index];
    if (command === undefined || command.enabled === false) return;
    // Close FIRST. An action that opens a dialog would otherwise leave the
    // palette rendered over the thing it just opened.
    onClose();
    command.run();
  };

  return (
    <div className="scrim" onMouseDown={onClose} data-testid="palette">
      <div
        className="palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Run a command…"
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
            <li className="note pad">Nothing matches.</li>
          ) : (
            results.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={`${index === cursor ? "on" : ""} ${command.enabled === false ? "disabled" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(index)}
                  disabled={command.enabled === false}
                >
                  <span className="section">{command.section}</span>
                  <span className="title">{command.title}</span>
                  {command.hint !== undefined ? (
                    <span className="hint">{command.hint}</span>
                  ) : null}
                  {command.shortcut !== undefined ? (
                    <kbd>{command.shortcut}</kbd>
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
 * Generated from KEYMAP, so it cannot drift from the bindings. A shortcut sheet
 * that lies is worse than no sheet.
 */
export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={onClose} data-testid="keyboard-help">
      <div
        className="palette keys"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Keyboard reference"
      >
        <h3>Keyboard</h3>
        <dl className="keymap">
          {KEYMAP.map((binding) => (
            <div key={`${binding.id}:${binding.label}`} className="pair">
              <dt>
                <kbd>{binding.label}</kbd>
              </dt>
              <dd>{binding.description}</dd>
            </div>
          ))}
        </dl>
        <p className="note">
          Generated from the keymap, so it cannot disagree with what the keys do.
        </p>
      </div>
    </div>
  );
}
