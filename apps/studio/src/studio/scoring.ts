/**
 * The scoreboard, recognised out of a template's fields.
 *
 * ============================================================================
 * WHY THIS IS NOT JUST A NUMBER FIELD
 * ============================================================================
 * A score was rendered as one more row in the generic grid: a small minus, a
 * number input, a small plus, the same size as "competition" and "clock". That
 * is a form. What an operator does during a match is press ONE target, dozens
 * of times, often without looking, while something else is happening.
 *
 * So a score gets its own surface: the team it belongs to beside it, the number
 * large enough to read across a desk, one big target to add a point, and a
 * smaller one to take it back. A correction is a different act from scoring and
 * must not be the same size as it.
 *
 * ============================================================================
 * PAIRED BY CONVENTION, NOT BY CONFIGURATION
 * ============================================================================
 * `homeScore` belongs to `home`. The template author already expressed that by
 * naming them, and asking them to declare it again in a schema would be asking
 * twice for something we can read once.
 */
import type { SurfaceField } from "./surface";

export interface Side {
  /** The variable holding the score. */
  readonly scoreKey: string;
  /** What to call this side — the team's own value where there is one. */
  readonly name: string;
  /** The variable holding the team name, when the pairing found one. */
  readonly nameKey: string | null;
  /** The score, as a number, whatever the document stores it as. */
  readonly score: number;
  /** True when this side's score differs from the template's default. */
  readonly overridden: boolean;
}

export interface Scoreboard {
  readonly sides: readonly Side[];
  /** Keys the scoreboard has taken, so the generic grid does not repeat them. */
  readonly claimed: ReadonlySet<string>;
}

/**
 * Is this value a COUNT, whatever the document declares it as?
 *
 * A scoreboard authors its scores as strings — "0", "1" — because that is what
 * a text node draws. Gating on the declared type therefore found no scores at
 * all, which is the bug this predicate exists to avoid repeating.
 */
export function isCount(field: SurfaceField, live: unknown): boolean {
  const value = live === undefined ? field.value : live;
  return (
    field.type === "number" ||
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value.trim()))
  );
}

/** `homeScore` → `home`. Null when the key does not name a score. */
export function sideKeyOf(scoreKey: string): string | null {
  const match = /^(.*?)[._-]?scores?$/i.exec(scoreKey);
  if (match === null) return null;
  const prefix = match[1] ?? "";
  return prefix.length === 0 ? null : prefix;
}

function toNumber(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * The scoreboard a template describes, or null when it describes none.
 *
 * `read` supplies the LIVE value for a key — the override an operator has set,
 * which is never the same thing as the template's default.
 */
export function scoreboardOf(
  fields: readonly SurfaceField[],
  read: (key: string) => unknown,
): Scoreboard | null {
  const byKey = new Map(fields.map((field) => [field.key.toLowerCase(), field]));
  const sides: Side[] = [];
  const claimed = new Set<string>();

  for (const field of fields) {
    const live = read(field.key);
    if (!isCount(field, live)) continue;
    const sideKey = sideKeyOf(field.key);
    if (sideKey === null) continue;

    const teamField = byKey.get(sideKey.toLowerCase());
    const teamLive = teamField === undefined ? undefined : read(teamField.key);
    const teamValue = teamLive === undefined ? teamField?.value : teamLive;

    // The team's own NAME where the template has one, and the score's label
    // otherwise — never "homeScore", which is our word rather than theirs.
    const name =
      typeof teamValue === "string" && teamValue.trim().length > 0
        ? teamValue
        : field.label.replace(/\s*scores?$/i, "").trim() || field.label;

    sides.push({
      scoreKey: field.key,
      name,
      nameKey: teamField?.key ?? null,
      score: toNumber(live === undefined ? field.value : live),
      overridden: field.overridden,
    });
    claimed.add(field.key);
  }

  // One side is not a scoreboard — it is a counter, and the generic field is a
  // better home for it than a surface built around two teams facing each other.
  if (sides.length < 2) return null;
  return { sides, claimed };
}

/**
 * The key that adds a point to a side, and the one that takes it back.
 *
 * Left hand for the left side, right hand for the right, which is how the
 * scoreboard is already laid out on screen and on the wall. Shift corrects.
 */
export const SCORE_KEYS: readonly string[] = ["q", "p", "z", "m"];

export function keyForSide(index: number): string | null {
  return SCORE_KEYS[index] ?? null;
}
