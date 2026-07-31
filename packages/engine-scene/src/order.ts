/**
 * Fractional indexing for sibling order. SCENE_FORMAT §6.2, RFC-002 §4.2.
 *
 * Keys are base-62 fractional digit strings ordered by plain string
 * comparison. Inserting between two siblings mints a key strictly between
 * theirs, so no neighbour is renumbered — which is what makes concurrent
 * inserts mergeable rather than mutually clobbering.
 *
 * ARCHITECTURE_FINAL_REVIEW R4 records that this survives on narrower grounds
 * than it was originally accepted on: its z-order justification was withdrawn,
 * leaving concurrent-edit merge and deterministic iteration. It is retained
 * deliberately, and is the cheapest item to remove if P3 resolves to
 * single-operator.
 *
 * Invariant: keys never end in '0'. A trailing zero has a smaller equivalent
 * with the zero stripped, so permitting both would break the bijection between
 * key and position.
 */

const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

export class OrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderKeyError";
  }
}

function assertValid(key: string, label: string): void {
  if (key.length === 0) {
    throw new OrderKeyError(`${label} must not be empty`);
  }
  for (const character of key) {
    if (!DIGITS.includes(character)) {
      throw new OrderKeyError(
        `${label} contains "${character}", which is not a base-62 digit`,
      );
    }
  }
  if (key.endsWith("0")) {
    throw new OrderKeyError(`${label} must not end in "0" (non-normalised)`);
  }
}

/**
 * A key strictly between `a` and `b`.
 *
 * Null `a` means "before everything"; null `b` means "after everything".
 * Both null yields the first key in an empty list.
 */
export function generateKeyBetween(
  a: string | null,
  b: string | null,
): string {
  if (a !== null) assertValid(a, "lower bound");
  if (b !== null) assertValid(b, "upper bound");
  if (a !== null && b !== null && a >= b) {
    throw new OrderKeyError(
      `lower bound "${a}" must sort before upper bound "${b}"`,
    );
  }
  return midpoint(a ?? "", b);
}

/**
 * Midpoint of two fractional strings, where `a < b` and both omit the leading
 * radix point. An empty `a` represents zero.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Copy the shared prefix, then recurse on what differs. Without this, a
    // key inserted between two long, similar keys would grow without bound.
    let shared = 0;
    while ((a[shared] ?? "0") === b[shared]) shared += 1;
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }

  const lower = a === "" ? 0 : DIGITS.indexOf(a[0]!);
  const upper = b !== null && b.length > 0 ? DIGITS.indexOf(b[0]!) : BASE;

  if (upper - lower > 1) {
    // Room for a digit strictly between: take it and stop.
    return DIGITS[Math.round(0.5 * (lower + upper))]!;
  }

  if (b !== null && b.length > 1) {
    // Adjacent digits, but b has more precision — borrow its first digit.
    return b.slice(0, 1);
  }

  // Adjacent digits with no room: descend a place and try again.
  return DIGITS[lower]! + midpoint(a.slice(1), null);
}

/** `n` keys in ascending order, for building a fresh list. */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  n: number,
): string[] {
  if (n < 0) throw new OrderKeyError("count must not be negative");
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];

  // Split around the midpoint so key length grows logarithmically rather than
  // linearly, which sequential generation would produce.
  const middle = Math.floor(n / 2);
  const pivot = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, pivot, middle),
    pivot,
    ...generateNKeysBetween(pivot, b, n - middle - 1),
  ];
}

/** Comparator for sorting by order key. */
export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
