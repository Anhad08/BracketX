/**
 * Serialization. SCENE_FORMAT §12.
 *
 * JSON, UTF-8. `NaN` and `Infinity` are invalid and rejected rather than
 * repaired. Floats round to 5 decimals — 10µm at metre scale, which is beyond
 * any authoring precision and keeps diffs free of float noise.
 *
 * Unknown fields round-trip byte-for-byte (SCENE_FORMAT §13 rules 1–3). This is
 * the rule that makes a plugin ecosystem possible later: opening a document in
 * an older client and saving it must never destroy work.
 */
import { round } from "./math";
import { SCENE_FORMAT_ID, SCENE_FORMAT_VERSION } from "./types";
import type { SceneDocument } from "./types";

export const FLOAT_PRECISION = 5;

export class SerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

function normalise(value: unknown, path: string): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SerializationError(
        `non-finite number at "${path}" (NaN and Infinity are invalid)`,
      );
    }
    return round(value, FLOAT_PRECISION);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalise(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // `undefined` is not JSON. An unset property is omitted; `null` means
      // explicitly absent. SCENE_FORMAT §12 keeps those distinct.
      if (item === undefined) continue;
      out[key] = normalise(item, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

/** Recursively key-sorted, for canonical output. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Human-readable form. Stored documents use this so `psql` output is legible. */
export function serialize(document: SceneDocument): string {
  return JSON.stringify(normalise(document, ""), null, 2);
}

/**
 * Canonical form: sorted keys, no insignificant whitespace.
 *
 * For hashing, deduplication, and stable diffs. Two structurally identical
 * documents must produce identical bytes regardless of construction order.
 */
export function canonicalize(document: SceneDocument): string {
  return JSON.stringify(sortKeys(normalise(document, "")));
}

export function deserialize(json: string): SceneDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SerializationError(
      `document is not valid JSON: ${(error as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SerializationError("document must be a JSON object");
  }

  const candidate = parsed as Partial<SceneDocument>;

  if (candidate.format !== SCENE_FORMAT_ID) {
    throw new SerializationError(
      `unrecognised format "${String(candidate.format)}"; expected "${SCENE_FORMAT_ID}"`,
    );
  }

  if (typeof candidate.version !== "number") {
    throw new SerializationError("document has no numeric version");
  }

  // SCENE_FORMAT §3: a reader seeing a higher version must REFUSE, never read
  // partially. Round-tripping unknown fields is only safe when the overall
  // structure is understood.
  if (candidate.version > SCENE_FORMAT_VERSION) {
    throw new SerializationError(
      `document version ${candidate.version} is newer than the supported ` +
        `version ${SCENE_FORMAT_VERSION}. Refusing to load rather than risk ` +
        `discarding fields on save.`,
    );
  }

  if (candidate.version < SCENE_FORMAT_VERSION) {
    throw new SerializationError(
      `document version ${candidate.version} requires migration to ` +
        `${SCENE_FORMAT_VERSION}; no migration is registered`,
    );
  }

  return parsed as SceneDocument;
}
