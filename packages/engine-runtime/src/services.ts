/**
 * Runtime services. ENGINE_RUNTIME.
 *
 * NO GLOBAL MUTABLE STATE. Every service hangs off a Runtime instance, so two
 * runtimes in one process — an editor preview and an offline render, or two
 * tests in the same worker — cannot interfere. A module-level singleton would
 * make that impossible to detect and impossible to fix later.
 *
 * Ids are allocated per runtime and monotonically, so a replay against a fresh
 * runtime reproduces the same ids. A random or time-seeded allocator would
 * break replay determinism.
 */

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Typed key, so lookup cannot silently return the wrong service. */
export interface ServiceKey<T> {
  readonly name: string;
  readonly __type?: T;
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  return { name };
}

export class ServiceRegistry {
  #services = new Map<string, unknown>();
  #frozen = false;

  register<T>(key: ServiceKey<T>, service: T): void {
    if (this.#frozen) {
      throw new ServiceError(
        `cannot register "${key.name}" after the registry is frozen`,
      );
    }
    if (this.#services.has(key.name)) {
      throw new ServiceError(`service "${key.name}" is already registered`);
    }
    this.#services.set(key.name, service);
  }

  /** Throws when absent: a missing dependency is a wiring error, not a runtime condition. */
  require<T>(key: ServiceKey<T>): T {
    const service = this.#services.get(key.name);
    if (service === undefined) {
      throw new ServiceError(
        `service "${key.name}" is not registered. Registered: ` +
          `${[...this.#services.keys()].join(", ") || "(none)"}`,
      );
    }
    return service as T;
  }

  get<T>(key: ServiceKey<T>): T | undefined {
    return this.#services.get(key.name) as T | undefined;
  }

  has(key: ServiceKey<unknown>): boolean {
    return this.#services.has(key.name);
  }

  /** Closes registration once boot completes, so wiring cannot drift at runtime. */
  freeze(): void {
    this.#frozen = true;
  }

  get names(): readonly string[] {
    return [...this.#services.keys()].sort();
  }

  clear(): void {
    this.#services.clear();
    this.#frozen = false;
  }
}

/**
 * Monotonic id allocation, scoped to a runtime.
 *
 * Deterministic by construction: a replay from a fresh runtime allocates the
 * same ids in the same order.
 */
export class IdAllocator {
  #counters = new Map<string, number>();

  next(namespace: string): number {
    const value = (this.#counters.get(namespace) ?? 0) + 1;
    this.#counters.set(namespace, value);
    return value;
  }

  nextString(namespace: string): string {
    return `${namespace}_${this.next(namespace)}`;
  }

  peek(namespace: string): number {
    return this.#counters.get(namespace) ?? 0;
  }

  reset(): void {
    this.#counters.clear();
  }
}
