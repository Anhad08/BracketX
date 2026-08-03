/**
 * Studio's local asset store. IF-006.
 *
 * ============================================================================
 * INDEXEDDB, NOT LOCALSTORAGE
 * ============================================================================
 * `localStorage` is strings, which means base64 — a third larger — inside a
 * quota that is typically 5 MB per origin. One 4K sponsor mark exceeds it. It is
 * also synchronous, so writing an asset would block the frame that is drawing
 * the graphic the user just imported it into.
 *
 * IndexedDB stores `Uint8Array` directly, has a quota measured in a share of
 * free disk, and is asynchronous. For binary assets it is the only correct
 * choice in a browser, and the fact that it is more work is not a reason.
 *
 * ============================================================================
 * KEYED BY CONTENT, WHICH IS WHY THIS IS ALSO THE OFFLINE CACHE
 * ============================================================================
 * Because the key is a content hash, a `get` is idempotent and can never be
 * stale: the bytes for a hash either are those bytes or do not exist. So when
 * the cloud store arrives, this same class is its offline cache with no
 * invalidation protocol — that property is a consequence of the `AssetStore`
 * port being content-addressed, and it is the main reason it is.
 */
import type { AssetStore } from "@bracketx/engine-assets";

const DATABASE = "streamatrix.assets";
const STORE = "bytes";
const VERSION = 1;

/**
 * A store backed by IndexedDB, with an in-memory fallback.
 *
 * The fallback is not a degraded mode to apologise for: private browsing modes
 * and some embedded webviews refuse IndexedDB outright, and a broadcaster who
 * cannot persist assets must still be able to import one and put it on air for
 * this session. Losing them on reload is bad; refusing to work is worse.
 */
export class IndexedDbAssetStore implements AssetStore {
  #database: Promise<IDBDatabase | null> | null = null;
  readonly #fallback = new Map<string, Uint8Array>();

  #open(): Promise<IDBDatabase | null> {
    if (this.#database !== null) return this.#database;

    this.#database = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DATABASE, VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      // Blocked, refused, or in a private window. The fallback takes over and
      // the editor keeps working.
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.#database;
  }

  async #transact<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> {
    const database = await this.#open();
    if (database === null) return undefined;
    return new Promise<T | undefined>((resolve) => {
      let request: IDBRequest<T>;
      try {
        request = run(database.transaction(STORE, mode).objectStore(STORE));
      } catch {
        resolve(undefined);
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  }

  async has(hash: string): Promise<boolean> {
    if (this.#fallback.has(hash)) return true;
    const count = await this.#transact<number>("readonly", (store) =>
      store.count(hash),
    );
    return (count ?? 0) > 0;
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    const cached = this.#fallback.get(hash);
    if (cached !== undefined) return cached;
    const stored = await this.#transact<unknown>("readonly", (store) =>
      store.get(hash),
    );
    if (stored instanceof Uint8Array) return stored;
    if (stored instanceof ArrayBuffer) return new Uint8Array(stored);
    return undefined;
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    // Held in memory as well as written, so an import is usable on the frame
    // after it lands rather than after a round trip to disk.
    this.#fallback.set(hash, bytes);
    await this.#transact("readwrite", (store) => store.put(bytes, hash));
  }

  async delete(hash: string): Promise<void> {
    this.#fallback.delete(hash);
    await this.#transact("readwrite", (store) => store.delete(hash));
  }

  async hashes(): Promise<readonly string[]> {
    const keys = await this.#transact<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(),
    );
    const stored = (keys ?? []).filter(
      (key): key is string => typeof key === "string",
    );
    // Union, because the fallback may hold what the database refused.
    return [...new Set([...stored, ...this.#fallback.keys()])];
  }
}
