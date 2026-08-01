/**
 * Scoped variable resolution. Project Alpha A2.
 *
 * A repeat instance needs to see its own item without that item becoming a
 * global variable. `{ $var: "player.name" }` inside instance 3 must resolve to
 * item 3, and nothing outside the instance may see `player` at all.
 *
 * So resolution is a chain: innermost scope first, falling through to the
 * document's variables. Scopes are immutable and cheap to create — one per
 * instance per projection — because creating them is on the hot path when a
 * collection changes.
 *
 * Dotted paths (`player.team.name`) are read here rather than in the variable
 * system, because only a scope has a structured value to walk into. A plain
 * document variable is a scalar and a dotted path against it resolves to
 * undefined, which is the correct answer rather than an error: a binding that
 * points at nothing renders its fallback and the show continues.
 */
import type { VariableSource } from "./resolve";

/** Segments of a dotted path. Rejects the prototype-pollution vectors. */
function readPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    if (
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * A variable source that overlays named values on a parent.
 *
 * Deliberately not a Map merge: the parent stays live, so a document variable
 * changing is visible inside every instance without rebuilding scopes.
 */
export class ScopedVariables implements VariableSource {
  readonly #parent: VariableSource;
  readonly #name: string;
  readonly #value: unknown;

  constructor(parent: VariableSource, name: string, value: unknown) {
    this.#parent = parent;
    this.#name = name;
    this.#value = value;
  }

  read(key: string): unknown {
    if (key === this.#name) return this.#value;

    // `player.name` — the scope owns everything under its name.
    const dot = key.indexOf(".");
    if (dot > 0 && key.slice(0, dot) === this.#name) {
      return readPath(this.#value, key.slice(dot + 1).split("."));
    }

    return this.#parent.read(key);
  }
}

/**
 * The variable key a binding depends on, for the dependency index.
 *
 * `player.name` depends on `player`. Recording the full dotted path would mean
 * a change to the collection never matched the recorded key, and the instance
 * would silently stop updating — the dependency index has to agree with the
 * resolver about what a dependency *is*.
 */
export function dependencyKeyOf(binding: string): string {
  const dot = binding.indexOf(".");
  return dot > 0 ? binding.slice(0, dot) : binding;
}

/** Reads a possibly-dotted key against a plain source. */
export function readScoped(source: VariableSource, key: string): unknown {
  const direct = source.read(key);
  if (direct !== undefined) return direct;

  const dot = key.indexOf(".");
  if (dot <= 0) return undefined;

  const root = source.read(key.slice(0, dot));
  if (root === undefined) return undefined;
  return readPath(root, key.slice(dot + 1).split("."));
}
