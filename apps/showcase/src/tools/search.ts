/**
 * Fuzzy matching, shared by the command palette and the scene-graph search.
 *
 * ============================================================================
 * WHY NOT SUBSTRING
 * ============================================================================
 * `includes()` is one line and it is the reason people stop using search boxes.
 * An engineer looking for `nod_entry_background` types `neb`, or `entrybg`, and
 * a substring search returns nothing — so they go back to scrolling, which is
 * the seconds-per-lookup this tool exists to remove.
 *
 * Subsequence matching with position bonuses handles both, and it is about
 * thirty lines. The scoring rules are the whole design:
 *
 *   - consecutive characters beat scattered ones, so `entry` ranks
 *     `nod_entry` above `e-n-t-r-y` spread across a long id
 *   - a match at a word boundary beats one mid-word, so `nb` finds
 *     `node_background` rather than `unbind`
 *   - shorter candidates win ties, because the shortest thing that matches is
 *     almost always the thing that was meant
 *
 * Case-insensitive on the needle, case-aware on the bonus: an uppercase letter
 * in a camelCase candidate is a word boundary.
 */

export interface MatchResult {
  readonly score: number;
  /** Indices of matched characters, for highlighting. */
  readonly indices: readonly number[];
}

const CONSECUTIVE_BONUS = 8;
const BOUNDARY_BONUS = 10;
const START_BONUS = 12;
const GAP_PENALTY = 1;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  if (previous === "_" || previous === "-" || previous === "." || previous === " " || previous === "#") {
    return true;
  }
  // camelCase: a capital preceded by a lowercase starts a word.
  const current = text[index]!;
  return current !== previous.toUpperCase() && current === current.toUpperCase() && /[a-z]/.test(previous);
}

/**
 * Scores `needle` against `candidate`. Null when it does not match at all.
 *
 * Greedy left-to-right, not optimal. An optimal alignment is a dynamic program
 * and would be the right call for a code completion engine; for a palette of a
 * few hundred entries the greedy pass is indistinguishable to a reader and
 * costs a single scan.
 */
export function fuzzyMatch(needle: string, candidate: string): MatchResult | null {
  if (needle.length === 0) return { score: 1, indices: [] };
  if (candidate.length === 0) return null;

  const lowerNeedle = needle.toLowerCase();
  const lowerCandidate = candidate.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousMatch = -2;

  for (let n = 0; n < lowerNeedle.length; n += 1) {
    const character = lowerNeedle[n]!;
    if (character === " ") continue;

    const found = lowerCandidate.indexOf(character, cursor);
    if (found === -1) return null;

    score += 1;
    if (found === previousMatch + 1) score += CONSECUTIVE_BONUS;
    if (isBoundary(candidate, found)) score += found === 0 ? START_BONUS : BOUNDARY_BONUS;
    score -= Math.min(GAP_PENALTY * (found - cursor), 6);

    indices.push(found);
    previousMatch = found;
    cursor = found + 1;
  }

  // Shorter wins ties: the shortest thing that matches is usually the target.
  score -= candidate.length * 0.05;
  // An exact prefix is almost never wrong.
  if (lowerCandidate.startsWith(lowerNeedle)) score += 20;
  if (lowerCandidate === lowerNeedle) score += 40;

  return { score, indices };
}

/** Best score across several fields, so an id, a name, and a tag all match. */
export function fuzzyMatchAny(
  needle: string,
  candidates: readonly string[],
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const candidate of candidates) {
    const result = fuzzyMatch(needle, candidate);
    if (result !== null && (best === null || result.score > best.score)) best = result;
  }
  return best;
}

export interface Ranked<T> {
  readonly item: T;
  readonly score: number;
  readonly indices: readonly number[];
}

/**
 * Ranks items, keeping the top `limit`.
 *
 * The limit is applied by a running comparison rather than by sorting
 * everything: a scene-graph search over a hundred thousand nodes should not
 * allocate a hundred thousand result objects to show twenty.
 */
export function rank<T>(
  items: Iterable<T>,
  query: string,
  fields: (item: T) => readonly string[],
  limit = 40,
): readonly Ranked<T>[] {
  const out: Ranked<T>[] = [];
  let worst = -Infinity;

  for (const item of items) {
    const match = fuzzyMatchAny(query, fields(item));
    if (match === null) continue;
    if (out.length >= limit && match.score <= worst) continue;

    out.push({ item, score: match.score, indices: match.indices });
    out.sort((a, b) => b.score - a.score);
    if (out.length > limit) out.pop();
    worst = out[out.length - 1]!.score;
  }
  return out;
}
