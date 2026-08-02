/**
 * Id minting.
 *
 * ============================================================================
 * WHY A FACTORY AND NOT A RANDOM STRING
 * ============================================================================
 * SCENE_FORMAT §13 wants ids with enough entropy to be collision-safe across
 * concurrent editors, and a `crypto.randomUUID()` suffix would satisfy that in
 * one line.
 *
 * It would also make every one of Studio's guarantees untestable. "Save and
 * reload is lossless", "undo is deterministic", "duplicate preserves identity"
 * are all claims about a document being *identical*, and a document containing
 * random ids is never identical to itself. So the source of entropy is
 * injected: production uses a random seed, tests use a counter, and the
 * assertions are about the same code path either way.
 */
import { ID_PREFIXES, type IdKind } from "@bracketx/engine-scene";

export interface IdFactory {
  (kind: IdKind): string;
}

/** Base-36, so an id stays short enough to read in a hierarchy panel. */
function encode(value: number): string {
  return value.toString(36).padStart(4, "0");
}

/**
 * A factory seeded from a starting counter.
 *
 * Sequential within a session and prefixed by the seed, so two editors that
 * started at different moments cannot collide while a single session's ids
 * stay reproducible from the seed alone.
 */
export function makeIdFactory(seed: number): IdFactory {
  let counter = 0;
  const prefix = encode(seed % 1679616);
  return (kind) => `${ID_PREFIXES[kind]}_${prefix}${encode((counter += 1))}`;
}

/** Production: seeded from the clock. Never used in a test. */
export function randomIdFactory(): IdFactory {
  return makeIdFactory(Math.floor(Date.now() % 1679616));
}

/** A deterministic factory. Tests only, and named so that is obvious. */
export function testIdFactory(): IdFactory {
  return makeIdFactory(0);
}
