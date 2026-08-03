/**
 * The asset registry — the single source of truth the brief asks for.
 *
 * ============================================================================
 * WHAT THIS OWNS
 * ============================================================================
 * Records, codecs, decoded residency, and reference counting. Nothing bypasses
 * it: an asset that is not registered here does not exist to Streamatrix, which
 * is the property that makes usage tracking, health checks and cloud sync
 * possible at all rather than approximate.
 *
 * ============================================================================
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * ============================================================================
 * **GPU resources.** MirrorBackend C2 makes texture lifetime the caller's, and a
 * registry that created textures would be a second owner of them. It hands over
 * decoded payloads; the projector uploads and destroys.
 *
 * **Bytes.** Those live behind `AssetStore`, so local, offline-cached and cloud
 * are the same code path from here.
 *
 * ============================================================================
 * RESIDENCY IS REFUSAL, NOT EVICTION
 * ============================================================================
 * The glyph atlas evicts under pressure because a glyph regenerates in about
 * two milliseconds. A decoded 4K logo does not, and dropping one at air time
 * takes a sponsor off screen mid-show. So residency refuses past its budget and
 * says why, at load, where someone can act on it.
 *
 * Reference counting exists for the opposite direction: when the last user of an
 * asset goes away, the decoded form CAN be released, and doing so is safe
 * precisely because nothing is drawing it.
 */
import type {
  AssetCodec,
  AssetKind,
  AssetRecord,
  AssetStore,
  DecodedAsset,
} from "./types";

export interface RegistryOptions {
  /**
   * Decoded-byte ceiling. Default 512 MB.
   *
   * Counted on decoded size, which is the number that matters: a 2 MB PNG is
   * 64 MB of RGBA8, and budgeting the compressed figure would under-count by
   * thirty times on exactly the assets big enough to matter.
   */
  readonly budgetBytes?: number;
}

export type ResolveResult =
  | { readonly ok: true; readonly asset: DecodedAsset }
  | { readonly ok: false; readonly reason: string };

interface Resident {
  readonly asset: DecodedAsset;
  /** How many holders. Zero is legal and means "cached, releasable". */
  refs: number;
}

/**
 * A reference to an asset from somewhere in the product.
 *
 * Recorded rather than inferred, because "which graphics use this logo" is a
 * question the Asset Browser must answer instantly over thousands of assets,
 * and walking every document to find out is the design that stops working at
 * exactly the scale the brief specifies.
 */
export interface AssetReference {
  readonly assetId: string;
  /** Document, node, package — whatever holds it. Opaque here. */
  readonly holder: string;
}

export class AssetRegistry {
  readonly #records = new Map<string, AssetRecord>();
  readonly #codecs: AssetCodec[] = [];
  readonly #resident = new Map<string, Resident>();
  readonly #budget: number;
  #bytes = 0;

  /** assetId -> holders. The usage index. */
  readonly #users = new Map<string, Set<string>>();
  /** holder -> assetIds, so releasing a document is O(what it held). */
  readonly #held = new Map<string, Set<string>>();

  constructor(
    readonly store: AssetStore,
    options: RegistryOptions = {},
  ) {
    this.#budget = options.budgetBytes ?? 512 * 1024 * 1024;
  }

  // -------------------------------------------------------------------------
  // Codecs
  // -------------------------------------------------------------------------

  /**
   * Registers a codec. Later registrations win a tie on `probe`.
   *
   * Last-wins so a host can override a built-in — a hardware JPEG decoder on a
   * render node, say — without the registry knowing such a thing exists.
   */
  addCodec(codec: AssetCodec): void {
    this.#codecs.unshift(codec);
  }

  /** The codec that claims these bytes, by content and then by declared type. */
  codecFor(bytes: Uint8Array, mime?: string): AssetCodec | undefined {
    const sniffed = this.#codecs.find((codec) => codec.probe(bytes));
    if (sniffed !== undefined) return sniffed;
    if (mime === undefined) return undefined;
    return this.#codecs.find((codec) => codec.mimes.includes(mime));
  }

  supports(kind: AssetKind): boolean {
    return this.#codecs.some((codec) => codec.kind === kind);
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  register(record: AssetRecord): void {
    this.#records.set(record.id, record);
  }

  record(assetId: string): AssetRecord | undefined {
    return this.#records.get(assetId);
  }

  records(): readonly AssetRecord[] {
    return [...this.#records.values()];
  }

  /**
   * Replaces an asset's bytes, keeping its id.
   *
   * This IS "replace a logo, and every graphic using it updates": the id a
   * document references never moves, so nothing has to be re-authored. The old
   * hash goes to history rather than being forgotten, and the decoded form is
   * dropped so the next resolve decodes the new bytes.
   */
  replace(assetId: string, hash: string, bytes: number, at: string): boolean {
    const existing = this.#records.get(assetId);
    if (existing === undefined || existing.hash === hash) return false;
    this.#records.set(assetId, {
      ...existing,
      hash,
      bytes,
      updatedAt: at,
      history: [...existing.history, existing.hash],
    });
    this.#evict(existing.hash);
    return true;
  }

  /**
   * Forgets a record. Bytes are NOT deleted from the store.
   *
   * Deliberate: another record, another project, or a package may address the
   * same content, and deleting bytes on a record's removal would be the
   * dedup-shaped bug where removing one asset breaks an unrelated graphic.
   * Reclaiming unreferenced bytes is a store-level sweep — see `orphanedHashes`.
   */
  unregister(assetId: string): boolean {
    const record = this.#records.get(assetId);
    if (record === undefined) return false;
    this.#records.delete(assetId);
    this.#users.delete(assetId);
    for (const held of this.#held.values()) held.delete(assetId);
    if (!this.#anyRecordUses(record.hash)) this.#evict(record.hash);
    return true;
  }

  // -------------------------------------------------------------------------
  // Resolution and residency
  // -------------------------------------------------------------------------

  /**
   * Fetches, decodes and admits an asset. Idempotent per content hash.
   *
   * Asynchronous because storage and decoding both are, and never called from
   * projection: a scene's assets are resolved before its first frame, exactly
   * as TEXT_ENGINE §3 requires of fonts, because an asset arriving mid-broadcast
   * pops on screen.
   *
   * Failures are returned rather than thrown. One broken asset in a package
   * costs that graphic its logo; it does not stop the show.
   */
  async resolve(assetId: string): Promise<ResolveResult> {
    const record = this.#records.get(assetId);
    if (record === undefined) {
      return { ok: false, reason: `no asset registered as "${assetId}"` };
    }

    const resident = this.#resident.get(record.hash);
    if (resident !== undefined) return { ok: true, asset: resident.asset };

    const bytes = await this.store.get(record.hash);
    if (bytes === undefined) {
      // The record survives. A missing byte range is exactly what a health check
      // reports and what a cloud fetch repairs — it is not a reason to forget
      // that the asset exists.
      return { ok: false, reason: `bytes for "${record.name}" are not stored` };
    }

    const codec = this.codecFor(bytes, record.mime);
    if (codec === undefined) {
      return {
        ok: false,
        reason: `no codec for "${record.name}" (${record.mime})`,
      };
    }

    let decoded: DecodedAsset;
    try {
      decoded = await codec.decode(bytes);
    } catch (error) {
      return { ok: false, reason: `${record.name}: ${String(error)}` };
    }

    if (this.#bytes + decoded.bytes > this.#budget) {
      return {
        ok: false,
        reason:
          `asset budget exceeded: "${record.name}" needs ` +
          `${mb(decoded.bytes)} and only ${mb(this.#budget - this.#bytes)} remains`,
      };
    }

    this.#resident.set(record.hash, { asset: decoded, refs: 0 });
    this.#bytes += decoded.bytes;
    return { ok: true, asset: decoded };
  }

  /** The decoded form, if resident. Synchronous, because projection is. */
  decoded(assetId: string): DecodedAsset | undefined {
    const record = this.#records.get(assetId);
    if (record === undefined) return undefined;
    return this.#resident.get(record.hash)?.asset;
  }

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  /** Records that `holder` uses `assetId`, and pins the decoded form. */
  retain(assetId: string, holder: string): void {
    let users = this.#users.get(assetId);
    if (users === undefined) {
      users = new Set();
      this.#users.set(assetId, users);
    }
    if (users.has(holder)) return;
    users.add(holder);

    let held = this.#held.get(holder);
    if (held === undefined) {
      held = new Set();
      this.#held.set(holder, held);
    }
    held.add(assetId);

    const record = this.#records.get(assetId);
    const resident = record && this.#resident.get(record.hash);
    if (resident) resident.refs += 1;
  }

  release(assetId: string, holder: string): void {
    const users = this.#users.get(assetId);
    if (users === undefined || !users.has(holder)) return;
    users.delete(holder);
    this.#held.get(holder)?.delete(assetId);

    const record = this.#records.get(assetId);
    const resident = record && this.#resident.get(record.hash);
    if (resident) resident.refs = Math.max(0, resident.refs - 1);
  }

  /** Releases everything a holder held. What closing a document calls. */
  releaseHolder(holder: string): void {
    for (const assetId of [...(this.#held.get(holder) ?? [])]) {
      this.release(assetId, holder);
    }
    this.#held.delete(holder);
  }

  /** Who uses this asset. The Asset Browser's "used by" column. */
  usersOf(assetId: string): readonly string[] {
    return [...(this.#users.get(assetId) ?? [])];
  }

  /**
   * Frees decoded forms nothing references, newest last.
   *
   * Called by a caller under pressure, never automatically — see the header
   * comment on why nothing is evicted out from under a live graphic. Returns
   * the bytes reclaimed so the caller can decide whether it was enough.
   */
  trim(): number {
    let reclaimed = 0;
    for (const [hash, resident] of [...this.#resident]) {
      if (resident.refs > 0) continue;
      reclaimed += resident.asset.bytes;
      this.#evict(hash);
    }
    return reclaimed;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /**
   * Assets referenced by something and not registered.
   *
   * The broken-reference check. Takes the ids a document actually uses, because
   * only the caller knows how to walk a document — this package must not learn
   * the scene format to answer a question about it.
   */
  brokenReferences(referenced: Iterable<string>): readonly string[] {
    const missing: string[] = [];
    for (const assetId of referenced) {
      if (!this.#records.has(assetId)) missing.push(assetId);
    }
    return missing;
  }

  /** Registered and used by nothing. What a library clean-up offers to remove. */
  unused(): readonly AssetRecord[] {
    return this.records().filter(
      (record) => (this.#users.get(record.id)?.size ?? 0) === 0,
    );
  }

  /**
   * Records that are different names for identical content.
   *
   * Free, because identity is the hash. Without content addressing this needs a
   * pairwise comparison of every asset against every other.
   */
  duplicates(): readonly (readonly AssetRecord[])[] {
    const byHash = new Map<string, AssetRecord[]>();
    for (const record of this.#records.values()) {
      const group = byHash.get(record.hash);
      if (group === undefined) byHash.set(record.hash, [record]);
      else group.push(record);
    }
    return [...byHash.values()].filter((group) => group.length > 1);
  }

  /**
   * Stored hashes no record addresses — reclaimable bytes.
   *
   * History counts as a reference: a hash a record can still roll back to is
   * not an orphan, which is what stops a clean-up destroying the previous
   * version of a logo somebody replaced by mistake.
   */
  async orphanedHashes(): Promise<readonly string[]> {
    const live = new Set<string>();
    for (const record of this.#records.values()) {
      live.add(record.hash);
      for (const previous of record.history) live.add(previous);
    }
    const stored = await this.store.hashes();
    return stored.filter((hash) => !live.has(hash));
  }

  stats(): {
    records: number;
    resident: number;
    bytes: number;
    budgetBytes: number;
    codecs: number;
  } {
    return {
      records: this.#records.size,
      resident: this.#resident.size,
      bytes: this.#bytes,
      budgetBytes: this.#budget,
      codecs: this.#codecs.length,
    };
  }

  #evict(hash: string): void {
    const resident = this.#resident.get(hash);
    if (resident === undefined) return;
    this.#bytes -= resident.asset.bytes;
    this.#resident.delete(hash);
  }

  #anyRecordUses(hash: string): boolean {
    for (const record of this.#records.values()) {
      if (record.hash === hash) return true;
    }
    return false;
  }
}

function mb(bytes: number): string {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
}
