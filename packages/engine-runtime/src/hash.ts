/**
 * Deterministic structural hashing, for determinism verification.
 *
 * Two runs that produce equal state must produce equal hashes on any machine.
 * That requires canonical ordering — Map and Set iteration order depends on
 * insertion order, so two structurally equal states can serialise differently
 * unless keys are sorted.
 *
 * The canonical *string* is the authority for equality assertions; the hash is
 * a convenience for logging and for cheap comparison in property tests. FNV-1a
 * is not collision-free, so a test that must be exact compares the string.
 */

export function canonicalString(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const kind = typeof value;

  if (kind === "number") {
    if (Number.isNaN(value as number)) return "NaN";
    if (!Number.isFinite(value as number)) {
      return (value as number) > 0 ? "Infinity" : "-Infinity";
    }
    // -0 and 0 are === but stringify differently; collapse so structurally
    // equal states cannot differ on sign of zero.
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (kind === "string") return JSON.stringify(value);
  if (kind === "boolean" || kind === "bigint") return String(value);
  if (kind === "function") {
    throw new TypeError("functions are not hashable runtime state");
  }

  if (Array.isArray(value)) {
    return `[${value.map(write).join(",")}]`;
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [write(k), write(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `Map{${entries.map(([k, v]) => `${k}:${v}`).join(",")}}`;
  }

  if (value instanceof Set) {
    const entries = [...value.values()]
      .map(write)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `Set{${entries.join(",")}}`;
  }

  if (value instanceof Date) {
    throw new TypeError(
      "Date is not hashable runtime state — engine time is frames (I2)",
    );
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${write(record[key])}`)
    .join(",");
  return `{${body}}`;
}

/** FNV-1a, 32-bit, returned as 8 hex characters. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 16777619, via shifts to stay in 32-bit integer arithmetic.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function hashValue(value: unknown): string {
  return hashString(canonicalString(value));
}
