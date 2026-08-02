/**
 * Identifiers. SCENE_FORMAT §13.
 *
 * Opaque, kind-prefixed, client-generated with enough entropy to be
 * collision-safe across concurrently editing clients. Nothing may parse meaning
 * out of an id beyond its prefix.
 *
 * Randomness is injectable because determinism in tests matters more than
 * convenience here: a scene fixture that changes ids on every run cannot be
 * compared against a committed snapshot.
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** ~95 bits. Collision probability is negligible for concurrent editors. */
const ID_LENGTH = 16;

export const ID_PREFIXES = {
  scene: "scn",
  node: "nod",
  component: "cmp",
  variable: "var",
  asset: "ast",
  track: "trk",
  state: "st",
  material: "mat",
  /** A timeline. `anm` rather than `tml` because documents already carry it. */
  timeline: "anm",
  /** A declared state transition. Phase 6 R3. */
  transition: "trn",
  /**
   * A `TemplateDefinition`. §11.3.
   *
   * Its own kind rather than reusing `scene`, because a template's id is its
   * LINEAGE: instantiating one remints the document id and keeps this, so
   * "which template is this graphic from" stays answerable. Two ids that mean
   * different things sharing a prefix is how that stops being obvious.
   */
  template: "tpl",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type Id<K extends IdKind = IdKind> = string & { readonly __kind?: K };

/** Returns bytes in [0, 256). */
export type RandomSource = (byteCount: number) => Uint8Array;

export const cryptoRandom: RandomSource = (byteCount) => {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export interface IdFactory {
  (kind: IdKind): string;
}

export function createIdFactory(random: RandomSource = cryptoRandom): IdFactory {
  return (kind) => {
    const bytes = random(ID_LENGTH);
    let out = "";
    for (let i = 0; i < ID_LENGTH; i += 1) {
      // Modulo bias across 62 of 256 values is ~1.6% on the last 8 symbols.
      // Irrelevant at 95 bits of entropy and not worth rejection sampling.
      out += ALPHABET[bytes[i]! % ALPHABET.length];
    }
    return `${ID_PREFIXES[kind]}_${out}`;
  };
}

/** Deterministic factory for tests. Never use in production. */
export function createSequentialIdFactory(): IdFactory {
  const counters = new Map<IdKind, number>();
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${ID_PREFIXES[kind]}_${String(next).padStart(4, "0")}`;
  };
}

const PREFIX_PATTERN = new RegExp(
  `^(${Object.values(ID_PREFIXES).join("|")})_[0-9A-Za-z]+$`,
);

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && PREFIX_PATTERN.test(value);
}

export function hasKind(value: string, kind: IdKind): boolean {
  return value.startsWith(`${ID_PREFIXES[kind]}_`);
}
