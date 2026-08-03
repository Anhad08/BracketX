/**
 * The RTGFX asset model. IF-006.
 *
 * ============================================================================
 * AN ASSET IS ITS BYTES
 * ============================================================================
 * Identity is the CONTENT HASH, and the asset id is a name pointing at it. That
 * single decision is what makes most of the brief's asset-management list fall
 * out rather than be built:
 *
 *   - **Deduplication** is a consequence. Two Marketplace packages shipping the
 *     same sponsor mark store it once and upload it once, however many ids
 *     point at it.
 *   - **Integrity** is a comparison. A package whose bytes do not hash to what
 *     it declared has been corrupted or tampered with, and that is checkable
 *     without a signature scheme.
 *   - **Sync** is a set difference. A cloud store and a local store reconcile by
 *     comparing hashes, not by comparing timestamps — which is why this model
 *     does not need a conflict resolver for BYTES, only for records.
 *   - **Version history** is a list of hashes. Replacing a logo is a new hash
 *     under the same id, and the old bytes are still addressable.
 *
 * The alternative — identity by id, bytes as a mutable payload — makes every one
 * of those a separate mechanism and makes "the same asset" a question nobody can
 * answer offline.
 *
 * ============================================================================
 * WHY RECORDS AND BYTES ARE SEPARATE
 * ============================================================================
 * A record is small, listable, searchable and syncable. Bytes are large, lazily
 * fetched and immutable. An Asset Browser showing four thousand assets reads
 * four thousand records and zero bytes; that is the difference between an
 * instant library and a loading spinner, and it is a consequence of keeping
 * them apart from the start.
 */

/**
 * What an asset IS, which decides which codec reads it and where it may be used.
 *
 * Deliberately broader than what renders today. `video`, `audio`, `model`,
 * `material` and `environment` are declared here and refused by IF-006 §4–5 —
 * declaring them costs nothing and makes the day they arrive a registration
 * rather than a migration of every stored record.
 */
export type AssetKind =
  | "image"
  | "vector"
  | "video"
  | "audio"
  | "font"
  | "model"
  | "material"
  | "environment";

/**
 * Where an asset came from. Drives what a user may do with it.
 *
 * A `shipped` asset cannot be deleted (it would return on next launch), a
 * `marketplace` asset is replaced by its package rather than edited, and an
 * `imported` asset is the user's own. Recording provenance at import is the only
 * moment the answer is known for certain.
 */
export type AssetOrigin = "shipped" | "imported" | "marketplace" | "cloud";

/**
 * Format-specific facts extracted at import, not at use.
 *
 * Open by design: a video record carries duration and frame rate, a font record
 * carries its family and axes. Typing this as a closed union would mean a format
 * arriving is a change to this file and to everything that reads it.
 */
export interface AssetMetadata {
  readonly width?: number;
  readonly height?: number;
  /** Seconds. Video and audio. */
  readonly duration?: number;
  readonly [extra: string]: unknown;
}

export interface AssetRecord {
  /** Stable name a document references. Survives the bytes changing. */
  readonly id: string;
  readonly kind: AssetKind;
  /** Content address. The identity. See the header comment. */
  readonly hash: string;
  /** As declared by the importer, e.g. `image/png`. */
  readonly mime: string;
  /** What a designer calls it. Not a filename — see IF-006 §"users and files". */
  readonly name: string;
  readonly bytes: number;
  readonly origin: AssetOrigin;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly favorite: boolean;
  readonly metadata: AssetMetadata;
  /**
   * The package that installed it, when one did.
   *
   * Present for `marketplace` assets, and what makes uninstalling a package a
   * precise operation rather than a guess about which assets it brought.
   */
  readonly packageId?: string;
  /**
   * Prior content hashes, oldest first.
   *
   * Version history without a version-control system: replacing a logo pushes
   * the old hash here, so a broadcaster who replaced the wrong one can go back
   * and a cloud store can garbage-collect what nothing references.
   */
  readonly history: readonly string[];
}

/**
 * Bytes, addressed by content.
 *
 * A PORT, and the reason the brief's "never design assuming only local storage"
 * is satisfiable: local, in-memory and cloud are three implementations of this
 * and nothing above it changes. Content addressing is what makes that safe — a
 * `get` is idempotent and cache-coherent by construction, so an offline cache is
 * correct without an invalidation protocol.
 */
export interface AssetStore {
  has(hash: string): Promise<boolean>;
  get(hash: string): Promise<Uint8Array | undefined>;
  /**
   * Stores bytes under their hash.
   *
   * Idempotent: storing a hash already held is a no-op, not an overwrite, which
   * is what makes a re-import or a partially-failed sync safe to retry.
   */
  put(hash: string, bytes: Uint8Array): Promise<void>;
  delete(hash: string): Promise<void>;
  /** Every hash held. What a sync diffs and a health check walks. */
  hashes(): Promise<readonly string[]>;
}

/** A decoded asset, ready for whoever consumes that kind. */
export interface DecodedAsset {
  readonly kind: AssetKind;
  /** Bytes the decoded form occupies. What residency budgets against. */
  readonly bytes: number;
  readonly metadata: AssetMetadata;
  /**
   * The decoded payload, whose shape is the kind's business.
   *
   * `unknown` on purpose. An image decodes to pixels, a font to a parsed face, a
   * model to a scene graph — and this package must not learn what any of those
   * are, or it becomes the place every format lands.
   */
  readonly value: unknown;
}

/**
 * Reads one family of formats.
 *
 * Registered rather than imported, so adding JPEG is a registration and touches
 * no projection, no registry and no browser code. This is the seam IF-006 §2
 * leans on when it defers WebP, AVIF, SVG, video, audio and glTF: every one of
 * them is a codec, and the architecture above them is already finished.
 */
export interface AssetCodec {
  readonly kind: AssetKind;
  /** MIME types this codec claims. Used when the importer supplied one. */
  readonly mimes: readonly string[];
  /**
   * Sniffs the leading bytes.
   *
   * Content, not extension. A file named `.png` that is a JPEG is common enough
   * to be routine, and a user who renamed a file should not get a broken asset
   * — they should get the right decoder.
   */
  probe(bytes: Uint8Array): boolean;
  decode(bytes: Uint8Array): Promise<DecodedAsset>;
}
