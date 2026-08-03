/**
 * Store implementations that need no platform.
 *
 * `MemoryAssetStore` is not a test double — it is the correct store for a
 * headless render node that receives a scene and its bytes over the wire and
 * has nowhere to persist them. That it also makes tests trivial is a
 * consequence of the port being right.
 *
 * Studio's IndexedDB store and the future cloud store implement the same
 * interface and are not here, because this package must not know a browser or a
 * network exists.
 */
import type { AssetStore } from "./types";

export class MemoryAssetStore implements AssetStore {
  readonly #bytes = new Map<string, Uint8Array>();

  async has(hash: string): Promise<boolean> {
    return this.#bytes.has(hash);
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    return this.#bytes.get(hash);
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    // Idempotent. Content addressing means a second put of the same hash is the
    // same bytes by definition, so a retried sync is safe rather than lucky.
    if (this.#bytes.has(hash)) return;
    this.#bytes.set(hash, bytes);
  }

  async delete(hash: string): Promise<void> {
    this.#bytes.delete(hash);
  }

  async hashes(): Promise<readonly string[]> {
    return [...this.#bytes.keys()];
  }
}
