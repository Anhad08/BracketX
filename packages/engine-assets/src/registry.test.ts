import { describe, expect, it } from "vitest";

import { AssetRegistry } from "./registry";
import { MemoryAssetStore } from "./store";
import { hashBytes } from "./hash";
import type { AssetCodec, AssetRecord } from "./types";

/**
 * The asset system's own verification.
 *
 * ============================================================================
 * WHAT IS FALSIFIABLE HERE
 * ============================================================================
 * "Permanent architecture" is not testable and nothing below pretends
 * otherwise. What IS testable is the set of properties the permanence rests on,
 * and each one is a claim IF-006 makes:
 *
 *   1. Identity is content, so dedup and duplicate detection are free.
 *   2. Formats are registrations, so a new codec changes nothing above it.
 *   3. Residency refuses rather than evicting a live asset.
 *   4. References are tracked, so usage and clean-up are exact, not guessed.
 *   5. Replacing bytes keeps the id, so graphics never need re-authoring.
 *
 * If any of those stops holding, this system needs replacing — which is the
 * outcome the milestone exists to prevent.
 */

const NOW = "2026-01-01T00:00:00.000Z";

function record(over: Partial<AssetRecord> & { id: string; hash: string }): AssetRecord {
  return {
    kind: "image",
    mime: "image/png",
    name: over.id,
    bytes: 8,
    origin: "imported",
    createdAt: NOW,
    updatedAt: NOW,
    tags: [],
    collections: [],
    favorite: false,
    metadata: {},
    history: [],
    ...over,
  };
}

/** A codec that claims bytes starting 0xAA and decodes to a stated size. */
function fakeCodec(decodedBytes = 64): AssetCodec {
  return {
    kind: "image",
    mimes: ["image/fake"],
    probe: (bytes) => bytes[0] === 0xaa,
    decode: async (bytes) => ({
      kind: "image",
      bytes: decodedBytes,
      metadata: { width: bytes.length, height: 1 },
      value: { pixels: bytes },
    }),
  };
}

function setup(options?: { budgetBytes?: number }): {
  registry: AssetRegistry;
  store: MemoryAssetStore;
} {
  const store = new MemoryAssetStore();
  const registry = new AssetRegistry(store, options);
  registry.addCodec(fakeCodec());
  return { registry, store };
}

describe("identity is content", () => {
  it("gives identical bytes the same address and different bytes a different one", () => {
    const a = hashBytes(new Uint8Array([1, 2, 3, 4, 5]));
    const b = hashBytes(new Uint8Array([1, 2, 3, 4, 5]));
    const c = hashBytes(new Uint8Array([1, 2, 3, 4, 6]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("distinguishes truncation, which a content-only digest need not", () => {
    // Length is in the address precisely so a prefix is not the same asset.
    const full = hashBytes(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
    const short = hashBytes(new Uint8Array([9, 9, 9, 9]));
    expect(full).not.toBe(short);
  });

  it("moves every lane on a single-byte change", () => {
    // Four independent lanes only help if a small edit disturbs all of them; a
    // digest where one lane is stable is a 32-bit digest wearing four hats.
    const digest = (b: Uint8Array) => hashBytes(b).split(":")[1]!;
    const base = digest(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]));
    const moved = digest(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]));
    for (let lane = 0; lane < 4; lane += 1) {
      const from = base.slice(lane * 8, lane * 8 + 8);
      const to = moved.slice(lane * 8, lane * 8 + 8);
      expect(to, `lane ${lane} did not move`).not.toBe(from);
    }
  });

  it("stores shared content once, however many ids point at it", async () => {
    const { registry, store } = setup();
    const bytes = new Uint8Array([0xaa, 1, 2, 3]);
    const hash = hashBytes(bytes);
    await store.put(hash, bytes);
    // The same sponsor mark shipped by two Marketplace packages.
    registry.register(record({ id: "ast_a", hash }));
    registry.register(record({ id: "ast_b", hash }));

    expect((await store.hashes()).length).toBe(1);

    const first = await registry.resolve("ast_a");
    const second = await registry.resolve("ast_b");
    expect(first.ok && second.ok).toBe(true);
    // The SAME decoded object: one decode, and one upload downstream.
    expect(first.ok && second.ok && first.asset === second.asset).toBe(true);
    expect(registry.stats().resident).toBe(1);
  });

  it("finds duplicates without comparing every asset to every other", () => {
    const { registry } = setup();
    registry.register(record({ id: "ast_a", hash: "h1" }));
    registry.register(record({ id: "ast_b", hash: "h1" }));
    registry.register(record({ id: "ast_c", hash: "h2" }));

    const groups = registry.duplicates();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((r) => r.id).sort()).toEqual(["ast_a", "ast_b"]);
  });
});

describe("formats are registrations", () => {
  it("routes by sniffed content, not by declared type", async () => {
    // A file named .png that is really something else is routine, and a user
    // who renamed a file should get the right decoder rather than a broken
    // asset.
    const { registry, store } = setup();
    const bytes = new Uint8Array([0xaa, 7]);
    const hash = hashBytes(bytes);
    await store.put(hash, bytes);
    registry.register(record({ id: "ast_x", hash, mime: "image/png" }));

    const result = await registry.resolve("ast_x");
    expect(result.ok).toBe(true);
    expect(result.ok && result.asset.metadata.width).toBe(2);
  });

  it("says so when nothing can read the bytes", async () => {
    const { registry, store } = setup();
    const bytes = new Uint8Array([0xbb, 7]); // No codec probes this.
    const hash = hashBytes(bytes);
    await store.put(hash, bytes);
    registry.register(record({ id: "ast_x", hash, mime: "image/unknown" }));

    const result = await registry.resolve("ast_x");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/no codec/);
  });

  it("lets a later codec override an earlier one", async () => {
    // A render node with a hardware decoder replaces a built-in without the
    // registry knowing such a thing exists.
    const { registry, store } = setup();
    registry.addCodec({ ...fakeCodec(), decode: async () => ({
      kind: "image", bytes: 1, metadata: { width: 999 }, value: null,
    }) });

    const bytes = new Uint8Array([0xaa, 1]);
    const hash = hashBytes(bytes);
    await store.put(hash, bytes);
    registry.register(record({ id: "ast_x", hash }));

    const result = await registry.resolve("ast_x");
    expect(result.ok && result.asset.metadata.width).toBe(999);
  });

  it("reports which kinds it can actually read", () => {
    const { registry } = setup();
    expect(registry.supports("image")).toBe(true);
    // The kinds IF-006 refuses are declared in the model and unreadable, which
    // is what lets the Asset Browser show only categories that are real.
    expect(registry.supports("video")).toBe(false);
    expect(registry.supports("audio")).toBe(false);
    expect(registry.supports("model")).toBe(false);
  });
});

describe("residency", () => {
  it("refuses past budget rather than evicting something on air", async () => {
    const { registry, store } = setup({ budgetBytes: 64 });
    for (const tag of [1, 2]) {
      const bytes = new Uint8Array([0xaa, tag]);
      await store.put(hashBytes(bytes), bytes);
      registry.register(record({ id: `ast_${tag}`, hash: hashBytes(bytes) }));
    }

    expect((await registry.resolve("ast_1")).ok).toBe(true);
    const second = await registry.resolve("ast_2");
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toMatch(/budget exceeded/);
    // And the one already admitted is untouched — the whole point.
    expect(registry.decoded("ast_1")).toBeDefined();
  });

  it("frees only what nothing references", async () => {
    const { registry, store } = setup();
    for (const tag of [1, 2]) {
      const bytes = new Uint8Array([0xaa, tag]);
      await store.put(hashBytes(bytes), bytes);
      registry.register(record({ id: `ast_${tag}`, hash: hashBytes(bytes) }));
      await registry.resolve(`ast_${tag}`);
    }
    registry.retain("ast_1", "doc_live");

    const reclaimed = registry.trim();
    expect(reclaimed).toBe(64);
    expect(registry.decoded("ast_1")).toBeDefined();
    expect(registry.decoded("ast_2")).toBeUndefined();
  });

  it("keeps the record when the bytes are missing", async () => {
    // A missing byte range is what a health check reports and a cloud fetch
    // repairs. It is not a reason to forget the asset exists.
    const { registry } = setup();
    registry.register(record({ id: "ast_x", hash: "nowhere", name: "Logo" }));

    const result = await registry.resolve("ast_x");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/not stored/);
    expect(registry.record("ast_x")).toBeDefined();
  });
});

describe("references", () => {
  it("tracks who uses what, and releases a whole holder at once", () => {
    const { registry } = setup();
    registry.register(record({ id: "ast_logo", hash: "h" }));
    registry.register(record({ id: "ast_bg", hash: "h2" }));

    registry.retain("ast_logo", "scn_a");
    registry.retain("ast_logo", "scn_b");
    registry.retain("ast_bg", "scn_a");
    expect(registry.usersOf("ast_logo").sort()).toEqual(["scn_a", "scn_b"]);

    // Closing a document costs what it held, not a scan of everything.
    registry.releaseHolder("scn_a");
    expect(registry.usersOf("ast_logo")).toEqual(["scn_b"]);
    expect(registry.usersOf("ast_bg")).toEqual([]);
  });

  it("counts a holder once however often it retains", () => {
    // Re-projecting a node must not inflate the count, or nothing is ever
    // releasable after the first frame.
    const { registry } = setup();
    registry.register(record({ id: "ast_logo", hash: "h" }));
    registry.retain("ast_logo", "scn_a");
    registry.retain("ast_logo", "scn_a");
    registry.release("ast_logo", "scn_a");
    expect(registry.usersOf("ast_logo")).toEqual([]);
  });
});

describe("health", () => {
  it("names references nothing satisfies", () => {
    const { registry } = setup();
    registry.register(record({ id: "ast_have", hash: "h" }));
    expect(registry.brokenReferences(["ast_have", "ast_gone"])).toEqual(["ast_gone"]);
  });

  it("lists what nothing uses", () => {
    const { registry } = setup();
    registry.register(record({ id: "ast_used", hash: "h1" }));
    registry.register(record({ id: "ast_idle", hash: "h2" }));
    registry.retain("ast_used", "scn_a");
    expect(registry.unused().map((r) => r.id)).toEqual(["ast_idle"]);
  });

  it("treats a rollback target as live, not as an orphan", async () => {
    // A clean-up that destroyed the previous version of a logo somebody
    // replaced by mistake would be worse than never cleaning up at all.
    const { registry, store } = setup();
    await store.put("old", new Uint8Array([0xaa, 1]));
    await store.put("new", new Uint8Array([0xaa, 2]));
    await store.put("stray", new Uint8Array([0xaa, 3]));

    registry.register(record({ id: "ast_logo", hash: "old" }));
    registry.replace("ast_logo", "new", 8, NOW);

    expect(await registry.orphanedHashes()).toEqual(["stray"]);
  });
});

describe("replacing bytes keeps the id", () => {
  it("is what makes every graphic update without re-authoring", async () => {
    const { registry, store } = setup();
    const first = new Uint8Array([0xaa, 1, 1, 1]);
    const second = new Uint8Array([0xaa, 2]);
    await store.put(hashBytes(first), first);
    await store.put(hashBytes(second), second);
    registry.register(record({ id: "ast_logo", hash: hashBytes(first) }));

    const before = await registry.resolve("ast_logo");
    expect(before.ok && before.asset.metadata.width).toBe(4);

    // A document referencing "ast_logo" is untouched by this.
    expect(registry.replace("ast_logo", hashBytes(second), 2, NOW)).toBe(true);
    expect(registry.record("ast_logo")!.history).toEqual([hashBytes(first)]);

    // The stale decode is gone, so the next resolve reads the new bytes.
    expect(registry.decoded("ast_logo")).toBeUndefined();
    const after = await registry.resolve("ast_logo");
    expect(after.ok && after.asset.metadata.width).toBe(2);
  });

  it("is a no-op when the content is the same", () => {
    const { registry } = setup();
    registry.register(record({ id: "ast_logo", hash: "h" }));
    expect(registry.replace("ast_logo", "h", 8, NOW)).toBe(false);
    expect(registry.record("ast_logo")!.history).toEqual([]);
  });
});

describe("scale", () => {
  it("holds four thousand records with instant lookup and exact usage", () => {
    // The brief specifies thousands of assets and instant search. This is the
    // shape check: registration, lookup and health must not be O(n^2).
    const { registry } = setup();
    for (let i = 0; i < 4000; i += 1) {
      registry.register(record({ id: `ast_${i}`, hash: `h${i % 3500}` }));
      if (i % 2 === 0) registry.retain(`ast_${i}`, `scn_${i % 50}`);
    }

    const started = performance.now();
    expect(registry.record("ast_3999")).toBeDefined();
    expect(registry.unused()).toHaveLength(2000);
    expect(registry.duplicates().length).toBeGreaterThan(0);
    expect(registry.stats().records).toBe(4000);
    // Generous by design: this catches a quadratic, not a regression of 2ms.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
