/**
 * GPU resource accounting — budget, reference counts and lifetime.
 *
 * ==========================================================================
 * RENDERER-AGNOSTIC, AND THAT IS WHY IT LIVES HERE
 * ==========================================================================
 * A reference count is a reference count and a byte budget is a byte budget;
 * neither has anything to do with which library owns the buffer. This module
 * was written inside `engine-render-three` and referenced three's types for
 * exactly three fields — `ResourcePool<T>` was already generic underneath.
 *
 * It moved when the second backend arrived. Two copies of a budget policy is
 * two products: the day one of them starts refusing an allocation the other
 * accepts, a scene renders on one renderer and not on the other, and nothing
 * in the type system says why.
 *
 * The type parameters are the backend's own resource types. Nothing here ever
 * inspects them — they are handles as far as this file is concerned.
 */
export type ResourceClass =
  | "geometry"
  | "material"
  | "texture"
  | "renderTarget";

export class ResourceViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceViolation";
  }
}

interface Entry<T> {
  readonly id: number;
  readonly key: string;
  value: T;
  refCount: number;
  /** Estimated GPU bytes. See estimateBytes on each factory. */
  bytes: number;
  /** Retained so the object can be rebuilt after context loss. */
  readonly recreate: () => T;
  readonly dispose: (value: T) => void;
}

export interface ResourceStats {
  readonly geometry: ClassStats;
  readonly material: ClassStats;
  readonly texture: ClassStats;
  readonly renderTarget: ClassStats;
  readonly totalBytes: number;
  readonly totalLive: number;
  /** Creates avoided by content addressing. The dedupe payoff, measured. */
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

export interface ClassStats {
  readonly live: number;
  readonly created: number;
  readonly disposed: number;
  readonly bytes: number;
  /** created - disposed - live. Non-zero is a leak. */
  readonly balance: number;
}

export interface ResourceBudget {
  /** Hard ceiling in bytes. Exceeding it refuses rather than evicts. */
  readonly maxBytes: number;
}

const DEFAULT_BUDGET: ResourceBudget = { maxBytes: 512 * 1024 * 1024 };

/**
 * Reference-counted, content-addressed GPU resources.
 *
 * Generic over the resource type so geometry, materials, and textures share
 * one implementation of the parts that are genuinely identical — counting,
 * budgeting, leak detection, and context recreation.
 */
class ResourcePool<T> {
  #byKey = new Map<string, Entry<T>>();
  #byId = new Map<number, Entry<T>>();
  #created = 0;
  #disposed = 0;
  #bytes = 0;
  #hits = 0;
  #misses = 0;

  constructor(
    private readonly kind: ResourceClass,
    private readonly nextId: () => number,
  ) {}

  get live(): number {
    return this.#byId.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get hits(): number {
    return this.#hits;
  }

  get misses(): number {
    return this.#misses;
  }

  stats(): ClassStats {
    return {
      live: this.#byId.size,
      created: this.#created,
      disposed: this.#disposed,
      bytes: this.#bytes,
      balance: this.#created - this.#disposed - this.#byId.size,
    };
  }

  /** Returns an existing handle for an identical descriptor, or creates one. */
  acquire(
    key: string,
    bytes: number,
    create: () => T,
    dispose: (value: T) => void,
  ): { id: number; value: T; reused: boolean } {
    const existing = this.#byKey.get(key);
    if (existing) {
      existing.refCount += 1;
      this.#hits += 1;
      return { id: existing.id, value: existing.value, reused: true };
    }

    this.#misses += 1;
    const value = create();
    const entry: Entry<T> = {
      id: this.nextId(),
      key,
      value,
      refCount: 1,
      bytes,
      recreate: create,
      dispose,
    };

    this.#byKey.set(key, entry);
    this.#byId.set(entry.id, entry);
    this.#created += 1;
    this.#bytes += bytes;
    return { id: entry.id, value, reused: false };
  }

  get(id: number): T | undefined {
    return this.#byId.get(id)?.value;
  }

  require(id: number, operation: string): T {
    const entry = this.#byId.get(id);
    if (!entry) {
      throw new ResourceViolation(
        `${operation}: ${this.kind} handle ${id} is unknown or already released`,
      );
    }
    return entry.value;
  }

  /** Adds a reference. Used when a second node adopts an existing resource. */
  retain(id: number): void {
    const entry = this.#byId.get(id);
    if (!entry) {
      throw new ResourceViolation(
        `retain: ${this.kind} handle ${id} is unknown`,
      );
    }
    entry.refCount += 1;
  }

  /**
   * Drops a reference, disposing at zero.
   *
   * Immediate rather than deferred: ENGINE_RUNTIME §4.5 requires deterministic
   * disposal, and a resource released while still referenced cannot happen
   * because the count is the authority.
   */
  release(id: number): boolean {
    const entry = this.#byId.get(id);
    if (!entry) {
      throw new ResourceViolation(
        `release: ${this.kind} handle ${id} is unknown or already released`,
      );
    }

    entry.refCount -= 1;
    if (entry.refCount > 0) return false;
    if (entry.refCount < 0) {
      throw new ResourceViolation(
        `release: ${this.kind} handle ${id} released more times than retained`,
      );
    }

    entry.dispose(entry.value);
    this.#byKey.delete(entry.key);
    this.#byId.delete(entry.id);
    this.#disposed += 1;
    this.#bytes -= entry.bytes;
    return true;
  }

  refCountOf(id: number): number {
    return this.#byId.get(id)?.refCount ?? 0;
  }

  /**
   * Rebuilds every resource after context loss, preserving handles.
   *
   * Handle stability is what lets the engine survive a GPU reset untouched:
   * the mirror still points at the same ids, so no reconciliation is needed.
   */
  recreateAll(): number {
    let rebuilt = 0;
    for (const entry of this.#byId.values()) {
      // The old object belongs to a dead context; disposing it is a no-op at
      // best and an error at worst, so it is simply dropped.
      entry.value = entry.recreate();
      rebuilt += 1;
    }
    return rebuilt;
  }

  disposeAll(): void {
    for (const entry of this.#byId.values()) {
      entry.dispose(entry.value);
      this.#disposed += 1;
    }
    this.#byId.clear();
    this.#byKey.clear();
    this.#bytes = 0;
  }

  ids(): number[] {
    return [...this.#byId.keys()].sort((a, b) => a - b);
  }
}

export class GpuResourceManager<
  TGeometry = unknown,
  TMaterial = unknown,
  TTexture = unknown,
> {
  #nextId = 1;
  readonly geometry: ResourcePool<TGeometry>;
  readonly material: ResourcePool<TMaterial>;
  readonly texture: ResourcePool<TTexture>;
  readonly renderTarget: ResourcePool<{ dispose(): void }>;
  #budget: ResourceBudget;

  constructor(budget: ResourceBudget = DEFAULT_BUDGET) {
    const allocate = () => this.#nextId++;
    this.geometry = new ResourcePool("geometry", allocate);
    this.material = new ResourcePool("material", allocate);
    this.texture = new ResourcePool("texture", allocate);
    this.renderTarget = new ResourcePool("renderTarget", allocate);
    this.#budget = budget;
  }

  get totalBytes(): number {
    return (
      this.geometry.bytes +
      this.material.bytes +
      this.texture.bytes +
      this.renderTarget.bytes
    );
  }

  /**
   * True when an allocation of `bytes` would exceed the budget.
   *
   * The caller refuses rather than evicting — see the on-air pinning note at
   * the top. Failing to bring up a new graphic is recoverable; blanking one
   * that is live is not.
   */
  wouldExceedBudget(bytes: number): boolean {
    return this.totalBytes + bytes > this.#budget.maxBytes;
  }

  stats(): ResourceStats {
    return {
      geometry: this.geometry.stats(),
      material: this.material.stats(),
      texture: this.texture.stats(),
      renderTarget: this.renderTarget.stats(),
      totalBytes: this.totalBytes,
      totalLive:
        this.geometry.live +
        this.material.live +
        this.texture.live +
        this.renderTarget.live,
      cacheHits:
        this.geometry.hits +
        this.material.hits +
        this.texture.hits +
        this.renderTarget.hits,
      cacheMisses:
        this.geometry.misses +
        this.material.misses +
        this.texture.misses +
        this.renderTarget.misses,
    };
  }

  /** True when every pool balances. Cheap enough for a dev-build assertion. */
  isBalanced(): boolean {
    const stats = this.stats();
    return (
      stats.geometry.balance === 0 &&
      stats.material.balance === 0 &&
      stats.texture.balance === 0 &&
      stats.renderTarget.balance === 0
    );
  }

  /** Rebuilds every GPU object after context restore. Handles are preserved. */
  recreateAll(): { geometry: number; material: number; texture: number } {
    return {
      geometry: this.geometry.recreateAll(),
      material: this.material.recreateAll(),
      texture: this.texture.recreateAll(),
    };
  }

  disposeAll(): void {
    this.geometry.disposeAll();
    this.material.disposeAll();
    this.texture.disposeAll();
    this.renderTarget.disposeAll();
  }
}

/**
 * FNV-1a over raw bytes.
 *
 * Content addressing needs a key that depends on every byte — a length-and-
 * endpoints shortcut would collide on meshes that differ only in the middle,
 * which is exactly what two variants of the same model look like. The cost is
 * measured in the benchmarks rather than assumed acceptable.
 */
export function hashBytes(view: ArrayBufferView, seed = 0x811c9dc5): number {
  const bytes = new Uint8Array(
    view.buffer,
    view.byteOffset,
    view.byteLength,
  );
  let hash = seed;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function hashString(input: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
