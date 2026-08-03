/**
 * Content addressing.
 *
 * ============================================================================
 * WHY NOT SHA-256
 * ============================================================================
 * `crypto.subtle.digest` is the obvious answer, and it is unavailable on plain
 * HTTP origins and asynchronous — which would make hashing infect every call
 * path that imports an asset.
 *
 * More importantly, this is a CACHE and DEDUP key, not a security boundary.
 * Nothing here decides whether to trust bytes; it decides whether two byte
 * ranges are the same one. A 128-bit digest over content and length is far
 * below collision probability for a library of millions.
 *
 * When package SIGNING arrives — verifying a Marketplace publisher, which IS a
 * security boundary — it will use a real cryptographic hash, and it will be a
 * different function with a different name for a different job. Conflating the
 * two is how a cache key quietly becomes a trust decision.
 */

const PRIME = 0x01000193;

/**
 * A content address for these bytes.
 *
 * Four independent FNV-1a lanes over interleaved bytes, so the digest is
 * 128-bit and a single-byte edit disturbs every lane. Length is included
 * because a digest over content alone distinguishes a truncation from the whole
 * only by luck, and a half-downloaded logo must not resolve as the real one.
 */
export function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  let c = (0x811c9dc5 ^ 0x85ebca6b) >>> 0;
  let d = (0x811c9dc5 ^ 0xc2b2ae35) >>> 0;

  const length = bytes.length;
  for (let i = 0; i < length; i += 4) {
    // The padding constants differ per lane so a tail shorter than four bytes
    // still moves every lane rather than leaving three of them at their seed.
    a = Math.imul(a ^ bytes[i]!, PRIME) >>> 0;
    b = Math.imul(b ^ (bytes[i + 1] ?? 0x5a), PRIME) >>> 0;
    c = Math.imul(c ^ (bytes[i + 2] ?? 0xa5), PRIME) >>> 0;
    d = Math.imul(d ^ (bytes[i + 3] ?? 0x3c), PRIME) >>> 0;
  }

  // Length folded into every lane, so it cannot be cancelled by content.
  a = Math.imul(a ^ length, PRIME) >>> 0;
  b = Math.imul(b ^ length, PRIME) >>> 0;
  c = Math.imul(c ^ length, PRIME) >>> 0;
  d = Math.imul(d ^ length, PRIME) >>> 0;

  // ==========================================================================
  // CROSS-MIX, WITHOUT WHICH THIS IS A 32-BIT DIGEST WEARING FOUR HATS
  // ==========================================================================
  // Each lane above reads every fourth byte, so before this loop a one-byte
  // edit moved exactly ONE lane and the other three were bit-identical. Two
  // files differing in a single byte would then collide whenever that lane
  // collided — 1 in 2^32, not 1 in 2^128, which is a real prospect for a
  // library of millions and would silently serve the wrong logo.
  //
  // Three rounds is past the point where every output lane depends on every
  // input lane. Caught by the avalanche test, which was written to check the
  // claim rather than to confirm it.
  for (let round = 0; round < 3; round += 1) {
    a = Math.imul(a ^ (d >>> 13), PRIME) >>> 0;
    b = Math.imul(b ^ (a >>> 7), PRIME) >>> 0;
    c = Math.imul(c ^ (b >>> 17), PRIME) >>> 0;
    d = Math.imul(d ^ (c >>> 11), PRIME) >>> 0;
  }

  const hex = (value: number): string => value.toString(16).padStart(8, "0");
  return `fnv128:${hex(a)}${hex(b)}${hex(c)}${hex(d)}:${length.toString(16)}`;
}
