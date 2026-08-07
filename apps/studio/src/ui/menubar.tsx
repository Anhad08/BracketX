import { useEffect, useRef, useState } from "react";

import type { CommandSection, StudioCommand } from "../studio/commands";

/**
 * The menu bar.
 *
 * ============================================================================
 * WHY A PRODUCT LIKE THIS NEEDS ONE
 * ============================================================================
 * Streamatrix had a command palette and a keymap, and both are excellent for
 * somebody who already knows what the product can do. Neither answers the
 * question a person actually arrives with, which is "what CAN it do?" A
 * palette is a search box: you have to know the word before it will help you.
 *
 * Every application a broadcaster already uses — Photoshop, Premiere, Resolve,
 * After Effects — answers that question the same way, with a bar you can read
 * top to bottom. It is not nostalgia. It is the only discoverable, complete,
 * always-in-the-same-place index of a program's capabilities that anyone has
 * found, and its absence is most of why software feels like a toy.
 *
 * ============================================================================
 * IT IS THE SAME COMMANDS, NOT A SECOND LIST
 * ============================================================================
 * `commands.ts` states the rule this depends on: "an action with no entry here
 * does not exist", and the palette, the keyboard and the context menu all read
 * from it. This bar is a fourth reader — it declares nothing of its own.
 *
 * That is what stops it rotting. A hand-written menu is a second list of what
 * the product does, and the day it disagrees with the first, a menu item does
 * nothing and nobody can explain why. Here, a command with a `section` appears
 * in the menu of that name automatically, wearing the same enablement rule and
 * the same shortcut label as everywhere else.
 */

/**
 * The menus, in the order a person expects to find them.
 *
 * Ordered by the shape of the work — what you are making, then how you change
 * it, then what you can see, then what it does, then where it goes — rather
 * than by the internal section names. `Select` folds into Edit and `Transport`
 * into Motion, because two menus with three items each is worse than one with
 * six.
 */
const MENUS: readonly {
  readonly label: string;
  readonly sections: readonly CommandSection[];
}[] = [
  { label: "File", sections: ["File"] },
  { label: "Edit", sections: ["Edit", "Select"] },
  { label: "Create", sections: ["Create"] },
  { label: "Arrange", sections: ["Arrange"] },
  { label: "View", sections: ["View"] },
  { label: "Motion", sections: ["Motion", "Transport"] },
  { label: "Air", sections: ["Program"] },
  { label: "Help", sections: ["Help"] },
];

export interface MenuBarProps {
  readonly commands: readonly StudioCommand[];
}

export function MenuBar({ commands }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);

  /**
   * Once a menu is open, POINTING at a sibling opens it.
   *
   * Every desktop application does this and nobody notices it until it is
   * missing — without it, browsing a menu bar is click, read, click away,
   * click again, which is three times the work for the one activity a menu bar
   * exists for.
   */
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (open === null) return;
    const dismiss = (event: MouseEvent): void => {
      if (bar.current?.contains(event.target as Node) === true) return;
      setOpen(null);
      setBrowsing(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Stopped here so the same key does not also clear the selection behind
      // the menu — backing out of one thing at a time is the whole meaning of
      // Escape.
      event.stopPropagation();
      setOpen(null);
      setBrowsing(false);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const menus = MENUS.map((menu) => ({
    ...menu,
    items: commands.filter((command) => menu.sections.includes(command.section)),
  })).filter((menu) => menu.items.length > 0);

  return (
    <div className="menubar" ref={bar} role="menubar" data-testid="menubar">
      {menus.map((menu) => (
        <div className="menu" key={menu.label}>
          <button
            type="button"
            className={`menu-title ${open === menu.label ? "on" : ""}`}
            data-testid={`menu-${menu.label.toLowerCase()}`}
            aria-haspopup="menu"
            aria-expanded={open === menu.label}
            onClick={() => {
              const next = open === menu.label ? null : menu.label;
              setOpen(next);
              setBrowsing(next !== null);
            }}
            onPointerEnter={() => {
              if (browsing) setOpen(menu.label);
            }}
          >
            {menu.label}
          </button>

          {open === menu.label ? (
            <div className="menu-pop" role="menu" data-testid={`menu-pop-${menu.label.toLowerCase()}`}>
              {menu.items.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid={`menu-item-${command.id}`}
                  /* Greyed rather than hidden. A menu whose contents change
                     shape as you work cannot be learned, and half the value of
                     a menu bar is that the third item is always the third
                     item. */
                  disabled={command.enabled === false}
                  title={command.hint ?? ""}
                  onClick={() => {
                    setOpen(null);
                    setBrowsing(false);
                    command.run();
                  }}
                >
                  <span className="menu-label">{command.title}</span>
                  {command.shortcut === undefined ? null : (
                    <span className="menu-key">{command.shortcut}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
